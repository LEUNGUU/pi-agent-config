// Supplemental Otty state reporting for pi. Complements — does not replace —
// Otty's own managed extension (~/.pi/agent/extensions/otty-integration.ts).
//
// Why a separate file: Otty verifies its managed extension against the stock
// template and shows a persistent "Install Pi Integration" prompt when the
// content differs, then overwrites customizations on install. Keeping our
// additions here lets the stock file stay byte-identical to Otty's template.
//
// What this adds on top of the stock integration:
//
// 1. awaiting badge — blocking UI prompts (e.g. permission-gate's dangerous-
//    command confirm) emit `otty:awaiting` / `otty:awaiting-done` on pi.events;
//    we forward them to Otty so a backgrounded tab shows it needs attention
//    instead of silently timing out. The stock integration has no such hook.
//
// 2. settled idle — the stock integration reports idle on agent_end, which is
//    early: pi may still auto-retry, auto-compact, or run a queued follow-up.
//    Those follow-ups re-trigger agent_start/tool_call (so the stock badge
//    self-corrects to processing), but only agent_settled means "nothing more
//    runs automatically". We re-report idle there so the task-complete badge
//    is authoritative.
//
// Duplicate idle/processing reports are harmless — Otty state updates are
// idempotent per session-id.
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const OTTY_CLI = "/Applications/Otty.app/Contents/MacOS/otty-cli";
const OTTY_SOCKET = join(homedir(), "Library/Application Support/io.appmakes.otty/otty.sock");
const OTTY_AGENT = "pi";

// Same session-id derivation as the stock integration, so our reports land on
// the same Otty pane state.
function sessionIdFor(ctx: any): string {
	try {
		const file = ctx?.sessionManager?.getSessionFile?.();
		if (file) return basename(String(file)).replace(/\.jsonl$/, "");
	} catch {}
	return `pid-${process.pid}`;
}

function cwdFor(ctx: any): string {
	try {
		return ctx?.cwd ? String(ctx.cwd) : "";
	} catch {
		return "";
	}
}

// Otty accepts exactly: processing | idle | awaiting.
// Fire-and-forget; detached + unref'd so it never blocks the agent process.
function notify(sessionId: string, state: string, cwd: string) {
	if (!sessionId) return;
	const args = [
		`state:${OTTY_AGENT}`,
		`session-id=${sessionId}`,
		`state=${state}`,
		`agent-pid=${process.pid}`,
	];
	if (cwd) args.push(`cwd=${cwd}`);
	const env = { ...process.env, OTTY_SOCKET };
	try {
		const proc = spawn(OTTY_CLI, args, { stdio: "ignore", detached: true, env });
		proc.on("error", () => {});
		proc.unref();
	} catch {}
}

export default function (pi: ExtensionAPI) {
	// pi.events handlers receive no ExtensionContext, so cache the identifiers
	// from lifecycle events. session_start always fires first, so these are
	// populated before any prompt can block.
	let lastSessionId = "";
	let lastCwd = "";

	function track(ctx: any) {
		lastSessionId = sessionIdFor(ctx);
		lastCwd = cwdFor(ctx);
	}

	pi.on("session_start", async (_event, ctx) => {
		track(ctx);
	});
	pi.on("agent_start", async (_event, ctx) => {
		track(ctx);
	});
	// Authoritative task-complete: fires only once nothing more runs
	// automatically (after auto-retry / auto-compact / queued follow-ups).
	pi.on("agent_settled", async (_event, ctx) => {
		track(ctx);
		notify(lastSessionId, "idle", lastCwd);
	});

	// Blocking UI prompts have no lifecycle event, so the extension that
	// blocks announces itself here (see permission-gate.ts).
	pi.events.on("otty:awaiting", () => {
		notify(lastSessionId, "awaiting", lastCwd);
	});
	pi.events.on("otty:awaiting-done", () => {
		notify(lastSessionId, "processing", lastCwd);
	});
}
