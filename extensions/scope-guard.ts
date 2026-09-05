// scope-guard: block scope creep — the agent must justify every changed file.
//
// Why: models over-implement. Ask for one feature and you get config systems,
// extra abstractions, and package.json changes you never requested. Prompt
// rules ("keep complexity low") are soft; this extension adds the hard part:
// an evaluation gate with veto power. Port of the Scope Guard idea
// (github.com/atoolz/scope-guard) to pi.
//
// Mechanism (code owns the process, an LLM owns the semantic judgment):
//   1. before_agent_start — capture the user's request(s) for the current task.
//   2. tool_call          — silently track every file touched via edit/write.
//   3. agent_settled      — diff the tracked files, ask a cheap model one
//      question per file: "explicitly requested, or obviously required
//      (imports/types/tests)?" Anything else is scope creep. Violations are
//      injected back as a follow-up turn: delete the changes or justify them
//      to the user. At most MAX_ROUNDS enforcement rounds per task, then it
//      notifies and stands down (no infinite loops).
//
// Rules mirrored from the original: same folder ≠ related; new dependencies
// (package.json & friends) are creep unless explicitly requested.
//
// Known gaps: file changes made through bash (sed/heredoc) are not tracked;
// gold-plating *inside* a legitimately-touched file is judged best-effort.
//
// /scope-guard toggles it (default ON — turn off for refactors where you
// intentionally give the agent free rein).
import { execSync } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Cheap judge: the evaluation is a small classification task.
// Override via env: PI_SCOPE_GUARD_MODEL="provider/modelId".
const DEFAULT_JUDGE = "kiro/claude-haiku-4.5";

// Enforcement rounds per task before giving up (prevents block/rewrite loops).
const MAX_ROUNDS = 2;

// Diff budget sent to the judge: per file / total (chars).
const PER_FILE_DIFF = 2000;
const TOTAL_DIFF = 12000;

function sh(cmd: string): string {
	return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export default function (pi: ExtensionAPI) {
	let enabled = true;
	// Current task state. A "task" spans user prompts until an evaluation
	// passes clean (or rounds run out); enforcement turns don't reset it.
	let prompts: string[] = [];
	let touched = new Set<string>();
	let rounds = 0;
	let enforcing = false; // the turn currently running was injected by us

	// Bail out entirely when not in a git repo — we need diffs to judge.
	let inRepo = true;
	try {
		sh("git rev-parse --is-inside-work-tree");
	} catch {
		inRepo = false;
	}

	function resetTask() {
		prompts = [];
		touched = new Set();
		rounds = 0;
		enforcing = false;
	}

	pi.on("before_agent_start", async (event) => {
		if (!enabled || !inRepo) return;
		// Enforcement turns and non-user messages don't widen the scope.
		if (enforcing) return;
		if (typeof event.prompt === "string" && event.prompt.trim()) {
			prompts.push(event.prompt.trim());
		}
	});

	pi.on("tool_call", async (event) => {
		if (!enabled || !inRepo) return;
		if (event.toolName !== "edit" && event.toolName !== "write") return;
		const path = (event.input as { path?: unknown }).path;
		if (typeof path === "string") touched.add(path);
	});

	pi.on("agent_settled", async (_event, ctx) => {
		if (!enabled || !inRepo || touched.size === 0 || prompts.length === 0) return;
		enforcing = false;

		// Collect what actually changed among the tracked files.
		let total = 0;
		const diffs: string[] = [];
		for (const file of touched) {
			let diff = "";
			try {
				diff = sh(`git diff HEAD -- ${JSON.stringify(file)}`);
				if (!diff) {
					// Untracked new file: show its content as an addition.
					const untracked = sh(`git ls-files --others --exclude-standard -- ${JSON.stringify(file)}`);
					if (untracked) diff = `NEW FILE ${file}:\n${sh(`head -c ${PER_FILE_DIFF} ${JSON.stringify(file)}`)}`;
				}
			} catch {
				continue;
			}
			if (!diff) continue; // touched but reverted/no net change
			if (diff.length > PER_FILE_DIFF) diff = `${diff.slice(0, PER_FILE_DIFF)}\n[...truncated]`;
			total += diff.length;
			diffs.push(diff);
			if (total > TOTAL_DIFF) break;
		}
		if (diffs.length === 0) {
			resetTask();
			return;
		}

		// Ask the judge for a per-file verdict.
		let model = ctx.model;
		const spec = process.env.PI_SCOPE_GUARD_MODEL || DEFAULT_JUDGE;
		const slash = spec.indexOf("/");
		if (slash > 0) {
			const found = ctx.modelRegistry.find(spec.slice(0, slash), spec.slice(slash + 1));
			if (found) model = found;
		}
		if (!model) return;

		let verdict: { violations: { file: string; reason: string }[] };
		try {
			const response = await ctx.modelRegistry.complete(
				model,
				{
					messages: [
						{
							role: "user",
							content: [
								"You are a scope-creep auditor for a coding agent. Judge each changed file against the user's request.",
								"",
								"For each file ask: (1) Is it explicitly part of the request? (2) If not, is it OBVIOUSLY required to fulfil it (imports, type definitions, tests for requested code)?",
								"If neither, it is scope creep. Rules: same folder does NOT mean related. New dependencies (package.json, lockfiles, requirements.txt, etc.) are creep unless the request names them. Extra config systems, abstractions, refactors, docs, or changelog edits the user didn't ask for are creep.",
								"Be lenient about HOW requested changes are implemented; be strict about WHAT was changed beyond the request.",
								"",
								`<user_request>\n${prompts.join("\n---\n")}\n</user_request>`,
								"",
								`<changes>\n${diffs.join("\n\n")}\n</changes>`,
								"",
								'Reply with ONLY JSON: {"violations": [{"file": "path", "reason": "why this is beyond the request"}]}. Empty array if everything is in scope.',
							].join("\n"),
							timestamp: Date.now(),
						},
					],
				},
				{ maxTokens: 1024, signal: ctx.signal },
			);
			const text = response.content
				.filter((b): b is { type: "text"; text: string } => b.type === "text")
				.map((b) => b.text)
				.join("\n");
			const match = text.match(/\{[\s\S]*\}/);
			verdict = match ? JSON.parse(match[0]) : { violations: [] };
			if (!Array.isArray(verdict.violations)) verdict.violations = [];
		} catch (err) {
			if (ctx.hasUI) ctx.ui.notify(`scope-guard: evaluation failed (${err instanceof Error ? err.message : String(err)})`, "warning");
			return; // fail open: never block work because the judge is down
		}

		if (verdict.violations.length === 0) {
			resetTask();
			return;
		}

		if (rounds >= MAX_ROUNDS) {
			if (ctx.hasUI) {
				ctx.ui.notify(
					`scope-guard: still out of scope after ${MAX_ROUNDS} rounds — review manually: ${verdict.violations.map((v) => v.file).join(", ")}`,
					"warning",
				);
			}
			resetTask();
			return;
		}

		rounds++;
		enforcing = true;
		const list = verdict.violations.map((v) => `- ${v.file}: ${v.reason}`).join("\n");
		pi.sendMessage(
			{
				customType: "scope-guard",
				content: [
					"SCOPE CREEP DETECTED. These changes go beyond what the user asked for:",
					list,
					"",
					`Original request: ${prompts.join(" / ")}`,
					"For each flagged file, either REVERT the change (git checkout / delete the file) or, if you believe it is genuinely required, briefly justify it to the user and leave it. Do not add anything new.",
				].join("\n"),
				display: true,
			},
			{ triggerTurn: true },
		);
	});

	pi.registerCommand("scope-guard", {
		description: "Toggle scope-creep enforcement (default ON; turn off for intentional wide-ranging work)",
		handler: async (_args, ctx) => {
			enabled = !enabled;
			if (!enabled) resetTask();
			ctx.ui.notify(`scope-guard ${enabled ? "ON" : "OFF"}`, "info");
		},
	});
}
