// codex-otty-pid: keep Codex sessions visible in Otty with toolbox Codex.
//
// Why: toolbox Codex runs as codex -> bin/codex -> codex. Otty's Codex hooks
// report "$PPID" (the innermost codex), but Otty matches a report to a pane
// only by the shell's direct child, the outermost codex. Reports are dropped,
// so `otty pane wait` and `watch:codex` never see the session.
//
// Fix: next to each Otty hook (marked "_otty") that passes "$PPID", add a copy
// that first walks up to the outermost codex process. Otty's own entries stay
// untouched, so an Otty update can rewrite them freely; this re-syncs the
// copies from whatever Otty wrote, on every session start. If Otty stops
// passing "$PPID" (a sign it fixed the matching), the copies are removed.
// Codex asks once to trust hooks whenever they change.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HOOKS = join(homedir(), ".codex", "hooks.json");
const MARK = "_otty_codex_pid";
const PPID_ARG = '"$PPID"';
// Walk from $PPID up through parents whose command ends in "codex".
const OUTER_PID = `p=$PPID; while q=$(ps -o ppid= -p "$p" | tr -d ' '); [ "\${q:-1}" -gt 1 ] && ps -o comm= -p "$q" | grep -q 'codex$'; do p=$q; done; `;

interface Hook { command?: string; [key: string]: unknown }
interface Group { hooks?: Hook[]; [key: string]: unknown }
type HooksFile = { hooks?: Record<string, Group[]> };

/** Rebuild the fixed copies; returns the new file text, or undefined if nothing changes. */
export function syncCodexHooks(text: string): string | undefined {
	const file = JSON.parse(text) as HooksFile;
	if (!file.hooks) return undefined;
	for (const [event, groups] of Object.entries(file.hooks)) {
		const kept = groups.filter((g) => !g[MARK]);
		const copies = kept
			.filter((g) => g._otty)
			// Keep the group's other fields (a matcher, for example); swap only the marker.
			.flatMap(({ _otty, hooks, ...group }) =>
				(hooks ?? [])
					.filter((h) => h.command?.includes(PPID_ARG))
					.map((h) => ({ ...group, [MARK]: true, hooks: [{ ...h, command: OUTER_PID + h.command!.replaceAll(PPID_ARG, '"$p"') }] })),
			);
		file.hooks[event] = [...kept, ...copies];
	}
	const next = JSON.stringify(file, null, 2) + "\n";
	return next === text ? undefined : next;
}

export default function codexOttyPid(pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		if (!existsSync(HOOKS)) return;
		try {
			const next = syncCodexHooks(readFileSync(HOOKS, "utf8"));
			if (!next) return;
			// Write a temp file and rename it: Codex never reads a half-written file.
			// Through the real path and with the old mode: a symlinked hooks.json
			// stays a symlink, and a private one stays private.
			const target = realpathSync(HOOKS);
			const tmp = `${target}.${process.pid}.tmp`;
			try {
				writeFileSync(tmp, next, { mode: statSync(target).mode & 0o777 });
				renameSync(tmp, target);
			} finally {
				rmSync(tmp, { force: true });
			}
			const message = "Updated Codex hooks so Otty can see Codex sessions. Codex will ask you to trust the changed hooks once.";
			if (ctx.hasUI) ctx.ui.notify(message, "info");
			else console.error(message);
		} catch (error) {
			const message = `codex-otty-pid: could not sync ${HOOKS}: ${error instanceof Error ? error.message : String(error)}`;
			if (ctx.hasUI) ctx.ui.notify(message, "warning");
			else console.error(message);
		}
	});
}
