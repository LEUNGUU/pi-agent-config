#!/usr/bin/env node
// xreview: give one task to several coding agents, one Otty tab each.
//
//   node otty/xreview.mjs [diff scope] [--task-file <file> | task text...]
//   diff scope (optional): --uncommitted | --commit <sha> | --base <ref> | --range <a>..<b>
//
// Every agent gets the same task (plus the diff file, when a scope is given),
// read-only. With a scope and no task, the task is a bug-focused code review.
// All agents run interactively, so the user can keep talking to them in their
// tab. Otty has no Kiro integration; writeKiroWorkspace() gives Kiro a hook that
// reports to Otty and a read-only `xreview` agent that never asks (see kiro()). Blocks until every agent is done, then writes <out>/<name>.md
// per agent and <out>/summary.json.
// Never answers an agent's question: one stuck on a question is reported.

import { execFileSync, spawn } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME = homedir();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", ...opts }).trim();
const otty = (...args) => run("otty", args);
const ottyJson = (...args) => JSON.parse(otty(...args, "--json")).data;
const ottyWait = (args) => new Promise((r) => spawn("otty", args, { stdio: "ignore" }).on("close", r));

// --- arguments -> task (+ optional diff) -----------------------------------------
const USAGE =
	"usage: xreview.mjs [--uncommitted | --commit <sha> | --base <ref> | --range <a>..<b>] [--task-file <file> | task...]";
// A scope is either git arguments, or { from } for "working tree, untracked
// files included, against <from>". --base includes uncommitted work, so one run
// covers unpushed commits plus the fixes on top.
const SCOPES = {
	"--uncommitted": () => [{ from: "HEAD" }, "uncommitted changes"],
	"--commit": (v) => [["show", "--end-of-options", v], `commit ${v}`],
	"--base": (v) => [{ from: v, mergeBase: true }, `changes since ${v}, including uncommitted work`],
	"--range": (v) => [["diff", "--end-of-options", v], `range ${v}`],
};
const args = process.argv.slice(2);
let diffArgs, label, taskFile, diffFile;
const words = [];
for (let i = 0; i < args.length; i++) {
	const a = args[i];
	// Object.hasOwn: `in` also matched task words such as "constructor".
	const scope = Object.hasOwn(SCOPES, a);
	const needsValue = a === "--task-file" || (scope && a !== "--uncommitted");
	if (needsValue && args[i + 1] === undefined) {
		console.error(`${a} needs a value\n${USAGE}`);
		process.exit(2);
	}
	// A value like "--output=x" would become a git option that writes a file.
	if (scope && needsValue && args[i + 1].startsWith("-")) {
		console.error(`${a} needs a revision, not an option: ${args[i + 1]}`);
		process.exit(2);
	}
	if (scope && diffArgs) {
		console.error(`only one diff scope at a time\n${USAGE}`);
		process.exit(2);
	}
	if (a === "--task-file") taskFile = args[++i];
	else if (scope) [diffArgs, label] = SCOPES[a](needsValue ? args[++i] : undefined);
	else words.push(a);
}
let task = (taskFile ? readFileSync(taskFile, "utf8") : words.join(" ")).trim();
if (!task && !diffArgs) {
	console.error(USAGE);
	process.exit(2);
}

// Untracked files that look like secrets or are large stay out of the diff,
// which goes to four outside models.
const SECRET_NAME = /(^|\/)(\.env(\..*)?|.*\.(pem|key|p12|pfx|keystore)|id_(rsa|dsa|ecdsa|ed25519)|.*credentials.*|.*secret.*)$/i;
const MAX_UNTRACKED = 1 << 20;

/** The diff for a scope. A { from } scope diffs the working tree, untracked
 *  files included, through a throwaway index so the real one is untouched. */
function gitDiff(root, scope) {
	const opts = { maxBuffer: 64 << 20 };
	if (Array.isArray(scope)) return run("git", ["-C", root, ...scope], opts);
	const from = scope.mergeBase ? run("git", ["-C", root, "merge-base", "--end-of-options", scope.from, "HEAD"]) : scope.from;
	const untracked = run("git", ["-C", root, "ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean);
	const skipped = untracked.filter((f) => SECRET_NAME.test(f) || statSync(join(root, f)).size > MAX_UNTRACKED);
	const added = untracked.filter((f) => !skipped.includes(f));
	if (added.length) console.log(`xreview: untracked files included: ${added.join(", ")}`);
	if (skipped.length) console.log(`xreview: untracked files left out (secret-like name or over 1 MB): ${skipped.join(", ")}`);
	const index = join(out, "index");
	const real = run("git", ["-C", root, "rev-parse", "--path-format=absolute", "--git-path", "index"]);
	if (existsSync(real)) copyFileSync(real, index);
	const env = { ...process.env, GIT_INDEX_FILE: index };
	try {
		if (added.length) run("git", ["-C", root, "add", "--intent-to-add", "--", ...added], { env });
		return run("git", ["-C", root, "diff", "--end-of-options", from], { ...opts, env });
	} finally {
		rmSync(index, { force: true });
	}
}

let root;
try {
	root = run("git", ["rev-parse", "--show-toplevel"], { stdio: ["ignore", "pipe", "ignore"] });
} catch {
	if (diffArgs) throw new Error("xreview: a diff scope needs a git repository");
	root = process.cwd();
}
const out = join("/tmp/xreview", new Date().toISOString().replace(/[:.]/g, "-"));
// Diffs and prompts may hold private code: keep them readable by this user only.
mkdirSync(out, { recursive: true, mode: 0o700 });
chmodSync("/tmp/xreview", 0o700);

const parts = [];
if (diffArgs) {
	diffFile = join(out, "diff.patch");
	writeFileSync(diffFile, gitDiff(root, diffArgs) + "\n", { mode: 0o600 });
	if (readFileSync(diffFile, "utf8").trim() === "") {
		console.error(`xreview: ${label} is empty`);
		process.exit(1);
	}
	task ||=
		"Review this change. Report only real bugs, security issues and risky edge cases. " +
		"For each: file:line, why it matters, and how sure you are. No style nits. If you find nothing serious, say so.";
	parts.push(`The full diff of the ${label} is in ${diffFile}.`);
}
const prompt = [
	`Task: ${task}`,
	"",
	...parts,
	`You are working in ${root}; read any file you need. Do not modify any file.`,
	// Without a budget one reviewer spent 113 tool calls (22 min) on a 30 KB diff.
	"Work efficiently: read only what the task needs, about 20 tool calls at most.",
].join("\n");
const promptFile = join(out, "prompt.txt");
writeFileSync(promptFile, prompt + "\n", { mode: 0o600 });
label ||= "task";

// --- reviewers -----------------------------------------------------------------
const q = (s) => `'${s.replaceAll("'", `'\\''`)}'`;
// Kiro runs with the run folder as its workspace, not the repository, so a
// reviewed repository's .kiro/ (agents, hooks, steering) never loads. The hook
// lives in that run folder. The agent must be global: Kiro ignores "allow"
// rules from a workspace agent, so a repository cannot grant itself access.
// It is rewritten every run, since other tools edit global agent files (one
// added a credentials tool; the mcp deny below still blocks it).
//
// Otty matches a status report to a pane by the shell's direct child, and
// Kiro's hooks run in a sandbox that can't walk the process tree. So start
// Kiro through `sh -c 'export OTTY_AGENT_PID=$$; exec kiro-cli ...'`: exec
// keeps sh's pid, and the hook reports that pid.
const kiro = (name, model) => ({
	name,
	cwd: out,
	start: `sh -c 'export OTTY_AGENT_PID=$$; exec kiro-cli chat --agent xreview --trust-workspace --model ${model}'`,
	ready: /ask a question or describe a task/,
	// Otty's prompt queue waits for an idle report, which Kiro only sends after a turn.
	submit: "--submit=now",
});

const ottyState = (state) =>
	`[ -n "$OTTY_AGENT_PID" ] || exit 0; ` +
	`sid=$(sed -n 's/.*"session_id":"\\([^"]*\\)".*/\\1/p'); ` +
	`"\${OTTY_CLI:-/Applications/Otty.app/Contents/MacOS/otty-cli}" state:kiro session-id="$sid" state=${state} ` +
	`cwd="$PWD" agent-pid="$OTTY_AGENT_PID" label=Kiro >/dev/null 2>&1; exit 0`;
// A read-only Kiro agent that never asks. No shell at all: Kiro strips `> file`
// before matching shell rules, so an allowed `cat` could still write through a
// redirect, and options like `rg --pre` run programs. Home dotfiles (~/.ssh,
// ~/.aws, tokens in ~/.config, ~/.netrc, ...) and secret-like files are
// unreadable. Everything else that would ask (a skill load did) is denied, and
// deny always wins.
const SECRETS = ["~/.*", "~/.*/**", "**/.env", "**/.env.*", "**/*.pem", "**/*.key"];
function writeKiroWorkspace() {
	const write = (path, value) => {
		mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
		writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
	};
	write(join(HOME, ".kiro", "agents", "xreview.json"), {
		name: "xreview",
		description: "Read-only agent for xreview: reads files, runs nothing, never asks for approval.",
		tools: ["read"],
		permissions: {
			rules: [
				{ capability: "fs_read", effect: "allow" },
				{ capability: "fs_read", match: SECRETS, effect: "deny" },
				...["shell", "fs_write", "skill", "power", "subagent", "web_fetch", "web_search", "mcp"].map((capability) => ({ capability, effect: "deny" })),
			],
		},
	});
	// Silent: UserPromptSubmit stdout goes to the agent.
	const hook = (name, trigger, state) => ({ name, trigger, action: { type: "command", command: ottyState(state) } });
	write(join(out, ".kiro", "hooks", "otty-state.json"), {
		version: "v1",
		hooks: [hook("otty-state-prompt", "UserPromptSubmit", "processing"), hook("otty-state-stop", "Stop", "idle")],
	});
}
const REVIEWERS = [
	// dontAsk: denies anything that needs approval, never shows a dialog (plan mode
	// could end in an "approve this plan" dialog that hid the reply).
	// --disallowedTools: dontAsk alone still runs anything a saved allow rule permits,
	// including rules in the reviewed repository's .claude/settings.json.
	{ name: "claude", start: `claude --permission-mode dontAsk --add-dir ${q(out)} --disallowedTools Edit Write NotebookEdit Bash` },
	{ name: "codex", start: "codex -s read-only", ready: /Ask Codex/ },
	kiro("kiro-claude", "claude-opus-5.5"),
	kiro("kiro-gpt", "gpt-5.6-sol"),
];

const paneOf = (name, cwd = root) => {
	const tab = ottyJson("tab", "new", "--cwd", cwd, "--title", `xreview: ${name}`, "--no-focus").id;
	return ottyJson("pane", "list", "--tab", tab)[0].id;
};
// Kiro's approval menu; an agent quoting one phrase of it must not match.
const ASKING = /Allow once[^\n]*\n\s*Deny once/;
const show = (pane) => ottyJson("pane", "show", "--pane", pane);
const screen = (pane) => otty("pane", "capture", "--pane", pane, "--lines", "60");

/** Poll (the one documented polling case) until test() holds, up to ms. */
async function until(test, ms) {
	for (const end = Date.now() + ms; Date.now() < end; await sleep(2000)) if (test()) return true;
	return test();
}

async function review(r) {
	const pane = (r.pane = paneOf(r.name, r.cwd));
	// A fresh shell needs a moment before shell integration can report a command.
	await until(() => /\S/.test(screen(pane)), 15000);
	otty("pane", "send-text", "--pane", pane, "--submit", r.start);
	const up = await until(() => (r.ready ? r.ready.test(screen(pane)) : Boolean(show(pane).agent_session_id)), 60000);
	if (/Hooks need review|Trust, continue|trust this folder/i.test(screen(pane))) return void (r.status = "needs your answer in its tab");
	if (!up) return void (r.status = "did not start");
	otty("pane", "send-text", "--pane", pane, r.submit ?? "--submit", "--from-file", promptFile);
	// Don't wait on a pane that has not started the turn: an idle agent returns at once.
	await until(() => show(pane).agent_state === "processing", 90000);
	// Wait in rounds: `pane wait` keeps blocking on an agent that stopped on a question.
	// Kiro's hooks can't report a question, so its approval menu is read off the
	// screen. Otty's own screen heuristic can flag "awaiting" for a moment while
	// an agent thinks, so a question counts only if it is still there 5 s later.
	const asked = () => show(pane).agent_state === "awaiting" || ASKING.test(screen(pane));
	let asking = false;
	for (const end = Date.now() + 1800000; Date.now() < end; ) {
		await ottyWait(["pane", "wait", "--pane", pane, "--settle-ms", "3000", "--timeout-secs", "30"]);
		if (show(pane).agent_state === "idle") break;
		if (asked() && (await sleep(5000), asked())) {
			asking = true;
			break;
		}
	}
	const s = show(pane);
	r.session = s.agent_session_id;
	r.status = asking ? "needs your answer in its tab" : s.agent_state === "idle" ? "ok" : `still ${s.agent_state || "running"} after 30 min`;
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
	// Kiro: ~/.kiro/sessions/<workspace>/<session>/messages.jsonl; the answer is the last reply.
	const base = join(HOME, ".kiro", "sessions");
	const dir = existsSync(base) && readdirSync(base).map((w) => join(base, w, r.session)).find((d) => existsSync(d));
	const es = dir ? jsonl(join(dir, "messages.jsonl")).map((e) => e.payload ?? {}) : [];
	const last = es.findLastIndex((p) => p.type === "user");
	// Skip "Reasoning" entries: their content is a "..." placeholder.
	const replies = es.slice(last + 1).filter((p) => p.type === "assistant" && p.operationType !== "Reasoning" && typeof p.content === "string");
	return replies.at(-1)?.content.trim() ?? "";
}

// --- main ------------------------------------------------------------------------
writeKiroWorkspace();
console.log(`xreview: ${label} -> ${out}`);
await Promise.all(
	REVIEWERS.map((r) =>
		review(r).catch((e) => void (r.status = `failed: ${e.message.split("\n")[0]}`)),
	),
);
const summary = REVIEWERS.map((r) => {
	const body = r.status?.startsWith("ok") ? reply(r) : "";
	if (body) writeFileSync(join(out, `${r.name}.md`), body + "\n");
	else if (r.status === "ok") r.status = "no reply found";
	let link = "";
	try { link = r.pane ? otty("pane", "link", "--pane", r.pane) : ""; } catch {}
	return { name: r.name, status: r.status, pane: r.pane, session: r.session, link, file: body ? join(out, `${r.name}.md`) : undefined };
});
writeFileSync(join(out, "summary.json"), JSON.stringify({ label, root, diff: diffFile, reviewers: summary }, null, 2) + "\n");
for (const s of summary) console.log(`${s.name.padEnd(12)} ${s.status}${s.file ? `  ${s.file}` : ""}  ${s.link}`);
console.log(`summary: ${join(out, "summary.json")}`);
