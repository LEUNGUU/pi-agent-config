// commit-guard: secret-scan every `git commit` the agent runs, before it runs.
//
// Why an extension instead of a git hook: pi commits in many repos, and a hook
// has to be installed per repo (core.hooksPath is taken by Code Defender on
// corp machines). This catches the agent's commits in any repo, and the scan is
// code, not a prompt rule the model can forget. Manual commits in a terminal
// are not covered.
//
// Mechanism: tool_call on bash. Each command segment is walked in order,
// tracking `cd` so `cd X && git commit` scans X; `git -C X commit` scans X.
// gitleaks scans the staged diff, plus unstaged tracked changes when the
// commit uses -a/--all (they get committed too). Findings block the call and
// are reported with file, line and rule, secrets redacted. A missing gitleaks
// also blocks: never commit unscanned.
//
// `ssh host '... git commit ...'` is blocked outright: the commit happens on
// the remote, out of reach of a local scan. Commit locally, then sync.
//
// False positive: allow it with a `gitleaks:allow` comment on the line or a
// fingerprint in the repo's .gitleaksignore — never by skipping the scan.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type Finding = { File: string; StartLine: number; RuleID: string };
type Commit = { dir: string; all: boolean };

const GIT_COMMIT = /^(?:\S+=\S*\s+)*git\b(?:\s+-C\s+(\S+)|\s+-c\s+\S+|\s+--?[\w-]+(?:=\S+)?)*\s+commit\b(.*)$/s;

function unquote(s: string): string {
	return s.replace(/^(['"])(.*)\1$/, "$2");
}

function resolveDir(base: string, p: string): string {
	const path = unquote(p);
	if (path === "~" || path.startsWith("~/")) return homedir() + path.slice(1);
	return resolve(base, path);
}

/** Find the `git commit` invocations in a command and the repo each targets. */
function findCommits(command: string, cwd: string): Commit[] {
	const commits: Commit[] = [];
	let dir = cwd;
	for (const raw of command.split(/&&|\|\||[;|\n]/)) {
		const seg = raw.trim();
		const cd = seg.match(/^cd\s+(\S+)$/);
		if (cd) {
			dir = resolveDir(dir, cd[1]);
			continue;
		}
		const m = seg.match(GIT_COMMIT);
		if (!m) continue;
		const args = m[2];
		commits.push({
			dir: m[1] ? resolveDir(dir, m[1]) : dir,
			// -a, --all, or -a bundled with other short flags (-am "msg").
			all: /(?:^|\s)(?:--all|-[a-zA-Z]*a[a-zA-Z]*)(?=\s|$)/.test(args),
		});
	}
	return commits;
}

export default function (pi: ExtensionAPI) {
	/** Run gitleaks in one mode; returns findings, or an error string. */
	async function scan(dir: string, mode: "--staged" | "--pre-commit"): Promise<Finding[] | string> {
		let res: Awaited<ReturnType<typeof pi.exec>>;
		try {
			res = await pi.exec(
				"gitleaks",
				["git", mode, "--no-banner", "--redact", "--report-format", "json", "--report-path", "-", "."],
				{ cwd: dir, timeout: 60_000 },
			);
		} catch (err) {
			return `could not run gitleaks (${err instanceof Error ? err.message : String(err)}); install it: brew install gitleaks`;
		}
		// 0 = clean, 1 = leaks found; anything else is a failed scan.
		if (res.code !== 0 && res.code !== 1) {
			return `gitleaks failed (exit ${res.code}): ${(res.stderr || res.stdout).trim().split("\n").pop()}`;
		}
		try {
			return JSON.parse(res.stdout || "[]") as Finding[];
		} catch {
			return res.code === 0 ? [] : "gitleaks reported leaks but its output could not be parsed";
		}
	}

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return undefined;
		const command = (event.input as { command?: unknown }).command;
		if (typeof command !== "string" || !/\bgit\b[\s\S]*\bcommit\b/.test(command)) return undefined;

		if (/(?:^|[;&|(]\s*)ssh\s/m.test(command)) {
			return {
				block: true,
				reason: "commit-guard: commits over ssh can't be secret-scanned locally. Commit in the local checkout (it gets scanned), then sync the commit to the remote.",
			};
		}

		for (const { dir, all } of findCommits(command, ctx.cwd)) {
			if (!existsSync(dir)) {
				return { block: true, reason: `commit-guard: can't resolve the repo directory (${dir}) to scan. Use a literal path (no shell variables) in cd / git -C.` };
			}
			const findings: Finding[] = [];
			for (const mode of all ? (["--staged", "--pre-commit"] as const) : (["--staged"] as const)) {
				const result = await scan(dir, mode);
				if (typeof result === "string") return { block: true, reason: `commit-guard: ${result}. Commit blocked: never commit unscanned.` };
				findings.push(...result);
			}
			if (findings.length === 0) continue;
			const list = findings.map((f) => `  ${f.File}:${f.StartLine}  ${f.RuleID}`).join("\n");
			if (ctx.hasUI) ctx.ui.notify(`commit-guard: blocked commit in ${dir} (${findings.length} finding(s))`, "warning");
			return {
				block: true,
				reason: `commit-guard: gitleaks found ${findings.length} possible secret(s) in the changes to be committed (${dir}):\n${list}\nRemove them (use an env var or !cat indirection). If one is a false positive, ask the user before allowing it via a gitleaks:allow comment or .gitleaksignore.`,
			};
		}
		return undefined;
	});
}
