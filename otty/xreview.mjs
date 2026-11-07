#!/usr/bin/env node
// xreview: cross-review one change with several coding agents, one Otty tab each.
//
//   node otty/xreview.mjs <scope> [focus...]
//   scope: --uncommitted | --commit <sha> | --base <ref> | <a>..<b>
//
// Each reviewer gets the same diff file and prompt, read-only. Claude Code,
// Codex and Pi run interactively, so the user can keep talking to them in
// their tab; Kiro runs headless (no Otty integration) and is resumed with
// `kiro-cli chat --no-interactive --resume`. Blocks until every reviewer is
// done, then writes <out>/<name>.md per reviewer and <out>/summary.json.
// Never answers an agent's question: a reviewer stuck on one is reported.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME = homedir();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", ...opts }).trim();
const otty = (...args) => run("otty", args);
const ottyJson = (...args) => JSON.parse(otty(...args, "--json")).data;
const ottyWait = (args) => new Promise((r) => spawn("otty", args, { stdio: "ignore" }).on("close", r));

// --- scope -> diff -----------------------------------------------------------
const [scope, ...rest] = process.argv.slice(2);
if (!scope) {
	console.error("usage: xreview.mjs --uncommitted | --commit <sha> | --base <ref> | <a>..<b> [focus]");
	process.exit(2);
}
let diffArgs, label, focus;
if (scope === "--uncommitted") [diffArgs, label, focus] = [["diff", "HEAD"], "uncommitted changes", rest];
else if (scope === "--commit") [diffArgs, label, focus] = [["show", rest[0]], `commit ${rest[0]}`, rest.slice(1)];
else if (scope === "--base") [diffArgs, label, focus] = [["diff", `${rest[0]}...HEAD`], `changes since ${rest[0]}`, rest.slice(1)];
else [diffArgs, label, focus] = [["diff", scope], `range ${scope}`, rest];

const root = run("git", ["rev-parse", "--show-toplevel"]);
const out = join("/tmp/xreview", new Date().toISOString().replace(/[:.]/g, "-"));
mkdirSync(out, { recursive: true });
const diffFile = join(out, "diff.patch");
writeFileSync(diffFile, run("git", ["-C", root, ...diffArgs], { maxBuffer: 64 << 20 }) + "\n");
if (readFileSync(diffFile, "utf8").trim() === "") {
	console.error(`xreview: ${label} is empty`);
	process.exit(1);
}

const prompt = [
	`Review the ${label} in this repository (${root}).`,
	`The full diff is in ${diffFile}; read any repository file you need.`,
	"Report only real bugs, security issues and risky edge cases. For each: file:line, why it matters, and how sure you are.",
	"No style nits. Do not modify any file. If you find nothing serious, say so.",
	// Without a budget one reviewer spent 113 tool calls (22 min) on a 30 KB diff.
	"Work efficiently: read the diff first, then only the files you need, about 20 tool calls at most.",
	focus.length ? `Focus: ${focus.join(" ")}` : "",
].filter(Boolean).join("\n");
const promptFile = join(out, "prompt.txt");
writeFileSync(promptFile, prompt + "\n");

// --- reviewers -----------------------------------------------------------------
const q = (s) => `'${s.replaceAll("'", `'\\''`)}'`;
const REVIEWERS = [
	{ name: "claude", kind: "interactive", start: `claude --permission-mode plan --add-dir ${q(out)}` },
	{ name: "codex", kind: "interactive", start: "codex -s read-only", ready: /Ask Codex/ },
	{ name: "grok", kind: "interactive", start: "pi --model amazon-bedrock/global.xai.grok-4.7 --tools read,grep,find,ls" },
	{
		name: "kiro",
		kind: "headless",
		cmd: `kiro-cli chat --no-interactive --trust-workspace --trust-tools=fs_read "$(cat ${q(promptFile)})" 2>&1 | tee ${q(join(out, "kiro.md"))}`,
	},
];

const paneOf = (name) => {
	const tab = ottyJson("tab", "new", "--cwd", root, "--title", `xreview: ${name}`, "--no-focus").id;
	return ottyJson("pane", "list", "--tab", tab)[0].id;
};
const show = (pane) => ottyJson("pane", "show", "--pane", pane);
const screen = (pane) => otty("pane", "capture", "--pane", pane, "--lines", "60");

/** Poll (the one documented polling case) until test() holds, up to ms. */
async function until(test, ms) {
	for (const end = Date.now() + ms; Date.now() < end; await sleep(2000)) if (test()) return true;
	return test();
}

async function review(r) {
	const pane = (r.pane = paneOf(r.name));
	// A fresh shell needs a moment before shell integration can report a command.
	await until(() => /\S/.test(screen(pane)), 15000);
	if (r.kind === "headless") {
		writeFileSync(join(out, `${r.name}.sh`), `set -o pipefail\ncd ${q(root)}\n${r.cmd}\n`);
		const code = await ottyWait(["pane", "run", "--pane", pane, "--timeout", "1800000", "--", "bash", join(out, `${r.name}.sh`)]);
		r.status = code === 0 ? "ok" : `exit ${code}`;
		return;
	}
	otty("pane", "send-text", "--pane", pane, "--submit", r.start);
	const up = await until(() => (r.ready ? r.ready.test(screen(pane)) : Boolean(show(pane).agent_session_id)), 60000);
	if (/Hooks need review|Trust, continue|trust this folder/i.test(screen(pane))) return void (r.status = "needs your answer in its tab");
	if (!up) return void (r.status = "did not start");
	otty("pane", "send-text", "--pane", pane, "--submit", "--from-file", promptFile);
	// Don't wait on a pane that has not started the turn: an idle agent returns at once.
	await until(() => show(pane).agent_state === "processing", 90000);
	// Wait in rounds: `pane wait` keeps blocking on an agent that stopped on a question.
	for (const end = Date.now() + 1800000; Date.now() < end; ) {
		if ((await ottyWait(["pane", "wait", "--pane", pane, "--settle-ms", "3000", "--timeout-secs", "60"])) === 0) break;
		if (show(pane).agent_state === "awaiting") break;
	}
	const s = show(pane);
	r.session = s.agent_session_id;
	r.status = { awaiting: "needs your answer in its tab", idle: "ok" }[s.agent_state] ?? `still ${s.agent_state || "running"} after 30 min`;
}

// --- read replies ----------------------------------------------------------------
const jsonl = (file) =>
	readFileSync(file, "utf8").split("\n").flatMap((l) => {
		try { return [JSON.parse(l)]; } catch { return []; }
	});
const findFile = (dir, test) => {
	if (!existsSync(dir)) return undefined;
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, e.name);
		if (e.isDirectory()) { const f = findFile(p, test); if (f) return f; }
		else if (test(e.name)) return p;
	}
};
const text = (blocks) => (Array.isArray(blocks) ? blocks.filter((b) => b.type === "text").map((b) => b.text).join("") : "");

function reply(r) {
	if (r.kind === "headless") return existsSync(join(out, "kiro.md")) ? readFileSync(join(out, "kiro.md"), "utf8") : "";
	if (!r.session) return "";
	if (r.name === "claude") {
		const f = findFile(join(HOME, ".claude", "projects"), (n) => n === `${r.session}.jsonl`);
		const es = f ? jsonl(f) : [];
		// Final answer = assistant text after the last real user prompt (not a tool result).
		const last = es.findLastIndex((e) => e.type === "user" && !(Array.isArray(e.message?.content) && e.message.content.some((b) => b.type === "tool_result")));
		return es.slice(last + 1).filter((e) => e.type === "assistant").map((e) => text(e.message?.content)).join("\n").trim();
	}
	if (r.name === "codex") {
		const f = findFile(join(HOME, ".codex", "sessions"), (n) => n.endsWith(`${r.session}.jsonl`));
		const msgs = (f ? jsonl(f) : []).map((e) => e.payload).filter((p) => p?.type === "message" && p.role === "assistant");
		return msgs.length ? msgs.at(-1).content.map((c) => c.text ?? "").join("") : "";
	}
	const f = findFile(join(HOME, ".pi", "agent", "sessions"), (n) => n === `${r.session}.jsonl`);
	const last = (f ? jsonl(f) : []).map((e) => e.message).filter((m) => m?.role === "assistant").at(-1);
	if (last?.errorMessage) r.status = `error: ${last.errorMessage}`;
	return text(last?.content);
}

// --- main ------------------------------------------------------------------------
console.log(`xreview: ${label} -> ${out}`);
await Promise.all(
	REVIEWERS.map((r) =>
		review(r).catch((e) => void (r.status = `failed: ${e.message.split("\n")[0]}`)),
	),
);
const summary = REVIEWERS.map((r) => {
	const body = r.status?.startsWith("ok") || r.status?.startsWith("error") || r.kind === "headless" ? reply(r) : "";
	if (body) writeFileSync(join(out, `${r.name}.md`), body + "\n");
	else if (r.status === "ok") r.status = "no reply found";
	let link = "";
	try { link = r.pane ? otty("pane", "link", "--pane", r.pane) : ""; } catch {}
	return { name: r.name, status: r.status, pane: r.pane, session: r.session, link, file: body ? join(out, `${r.name}.md`) : undefined };
});
writeFileSync(join(out, "summary.json"), JSON.stringify({ label, root, diff: diffFile, reviewers: summary }, null, 2) + "\n");
for (const s of summary) console.log(`${s.name.padEnd(7)} ${s.status}${s.file ? `  ${s.file}` : ""}  ${s.link}`);
console.log(`summary: ${join(out, "summary.json")}`);
