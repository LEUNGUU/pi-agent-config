import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncCodexHooks } from "../extensions/codex-otty-pid";

const otty = (state: string) => ({
	_otty: true,
	hooks: [{ type: "command", command: `OTTY_CLI='/x/otty-cli' '/x/otty-hook.sh' ${state} "$PPID"` }],
});
const other = { hooks: [{ type: "command", command: 'node "/y/hook.cjs" codex' }] };
const file = (hooks: object) => JSON.stringify({ hooks }, null, 2) + "\n";

test("adds one fixed copy per Otty hook and leaves the rest alone", () => {
	const next = JSON.parse(syncCodexHooks(file({ Stop: [otty("idle"), other] }))!);
	expect(next.hooks.Stop).toHaveLength(3);
	expect(next.hooks.Stop[0]).toEqual(otty("idle"));
	expect(next.hooks.Stop[1]).toEqual(other);
	const copy = next.hooks.Stop[2];
	expect(copy._otty_codex_pid).toBe(true);
	expect(copy._otty).toBeUndefined();
	expect(copy.hooks[0].command).toEndWith(`'/x/otty-hook.sh' idle "$p"`);
});

test("is idempotent, and follows Otty rewriting its own entries", () => {
	const once = syncCodexHooks(file({ Stop: [otty("idle")] }))!;
	expect(syncCodexHooks(once)).toBeUndefined();
	// Otty update replaces its entry; the stale copy is rebuilt from the new one.
	const updated = JSON.parse(once);
	updated.hooks.Stop[0] = otty("done");
	const resynced = JSON.parse(syncCodexHooks(JSON.stringify(updated, null, 2) + "\n")!);
	expect(resynced.hooks.Stop).toHaveLength(2);
	expect(resynced.hooks.Stop[1].hooks[0].command).toContain(`otty-hook.sh' done "$p"`);
});

test("drops the copies once Otty stops passing $PPID", () => {
	const once = JSON.parse(syncCodexHooks(file({ Stop: [otty("idle")] }))!);
	once.hooks.Stop[0].hooks[0].command = "'/x/otty-hook.sh' idle";
	const next = JSON.parse(syncCodexHooks(JSON.stringify(once, null, 2) + "\n")!);
	expect(next.hooks.Stop).toHaveLength(1);
});

test("the shell prefix walks up to the outermost codex", () => {
	// Process chain like toolbox Codex: codex -> codex -> sh running the hook.
	const { command } = JSON.parse(syncCodexHooks(file({ Stop: [otty("idle")] }))!).hooks.Stop[1].hooks[0];
	const dir = mkdtempSync(join(tmpdir(), "codex-pid-"));
	try {
		const codex = join(dir, "codex");
		symlinkSync("/bin/bash", codex);
		writeFileSync(join(dir, "hook.sh"), command.slice(0, command.indexOf("OTTY_CLI=")) + 'echo "found=$p"\n');
		// "; true" stops bash from exec-ing the last command, which would drop a level.
		const inner = `${codex} -c 'sh ${join(dir, "hook.sh")}; true'`;
		const out = execFileSync(codex, ["-c", `echo "outer=$$"; ${inner}; true`], { encoding: "utf8" });
		const outer = /outer=(\d+)/.exec(out)![1];
		expect(out).toContain(`found=${outer}`);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a copy keeps the group's other fields, such as a matcher", () => {
	const group = { ...otty("processing"), matcher: "Bash" };
	const copy = JSON.parse(syncCodexHooks(file({ PreToolUse: [group] }))!).hooks.PreToolUse[1];
	expect(copy.matcher).toBe("Bash");
	expect(copy._otty).toBeUndefined();
});
