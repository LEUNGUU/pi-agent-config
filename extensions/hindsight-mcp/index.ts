/**
 * Hindsight memory integration for pi.
 *
 * Registers the self-hosted Hindsight MCP server through pi's built-in MCP
 * support (tools appear as `mcp__hindsight__<tool>`), and streams this session
 * (user prompts, assistant responses) into Hindsight's retain endpoint so its
 * learning pipeline can extract facts automatically.
 *
 * The host:port is read from HINDSIGHT_HOST (default localhost:8888) so the
 * real endpoint stays out of source control — set it in your environment,
 * or run an SSH tunnel and leave the default:
 *   ssh -f -N -L 8888:localhost:8888 <host>
 *
 * Single-bank mode: the URL pins all tools to the "pi" bank, so tool calls
 * don't need a bank_id argument.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { basename } from "node:path";

/** Host:port of the Hindsight server; override via env to keep it out of git. */
const HINDSIGHT_HOST = process.env.HINDSIGHT_HOST ?? "localhost:8888";

/** Hindsight MCP endpoint (single-bank mode pins to bank "pi"). */
const MCP_URL = `http://${HINDSIGHT_HOST}/mcp/pi/`;

/** Hindsight REST base for the same bank — used by the session-capture hooks. */
const RETAIN_URL = `http://${HINDSIGHT_HOST}/v1/default/banks/pi/memories`;

/**
 * Models barred from Hindsight. Kiro's Fable models are flagged upstream as
 * "[Internal] DEVELOPMENT USE CASES ONLY, NOT FOR CUSTOMER DATA, ITAR OR PII",
 * so neither the memory tools nor session capture should run under them —
 * capture matters more than the tools, since it ships prompts and replies to
 * the memory store without the model asking.
 */
const BLOCKED_MODEL = /fable/i;

// ---------------------------------------------------------------------------
// Session capture
//
// Fire-and-forget: a down tunnel or service must never block or break the
// user's session. async:true so retain returns immediately and Hindsight
// consolidates in the background.
//
// Project scoping: every captured memory is tagged `project:<name>-<hash>` so
// recall can be scoped to the repo you're working in (the `pi` bank is shared
// across all repos). The tag is derived once from the session's working
// directory: the basename of the git repo root (else cwd) plus the first 8 hex
// chars of a SHA-256 of the absolute path, so repos that share a folder name
// (two `docs/`, two `app/`) get distinct tags.
// ---------------------------------------------------------------------------
let projectTag: string | undefined;

function resolveProjectTag(): string {
	if (projectTag) return projectTag;
	let root: string;
	try {
		root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	} catch {
		root = "";
	}
	if (!root) root = process.cwd();
	const name = basename(root) || "unknown";
	const hash = createHash("sha256").update(root).digest("hex").slice(0, 8);
	projectTag = `project:${name}-${hash}`;
	return projectTag;
}

function retain(content: string): void {
	if (!content.trim()) return;
	const tag = resolveProjectTag();
	void fetch(RETAIN_URL, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			async: true,
			items: [{ content, timestamp: new Date().toISOString(), tags: [tag] }],
			document_tags: [tag],
		}),
		signal: AbortSignal.timeout(4000),
	}).catch(() => {
		// Tunnel down / service unavailable: silently skip capture.
	});
}

/** Extract plain assistant text from an agent_end message list. */
function lastAssistantText(messages: unknown): string {
	if (!Array.isArray(messages)) return "";
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = (messages[i] as { role?: string; content?: unknown })?.content
			? (messages[i] as { role?: string; content?: unknown })
			: (messages[i] as { message?: { role?: string; content?: unknown } })?.message;
		if (!m || (m as { role?: string }).role !== "assistant") continue;
		const content = (m as { content?: unknown }).content;
		if (typeof content === "string") return content;
		if (Array.isArray(content)) {
			return content
				.filter((b) => (b as { type?: string }).type === "text")
				.map((b) => (b as { text?: string }).text ?? "")
				.join("");
		}
		return "";
	}
	return "";
}

export default function hindsightMcp(pi: ExtensionAPI) {
	// Built-in MCP connects this on session start; reconnect/inspect via /mcp.
	// recall/retain/reflect are small and frequent: declared directly. The
	// list_* enumerators return up to 100 items; `codemode` forces the model to
	// filter them in a script instead of dumping the JSON into context.
	// delete_*/clear_* are irreversible bulk operations: hidden; run them from
	// the Hindsight UI/API instead of via the model.
	pi.registerMcpServer("hindsight", {
		url: MCP_URL,
		exposure: "direct",
		toolExposure: { "list_*": "codemode", "delete_*": "hidden", "clear_*": "hidden" },
		description: "Long-term memory: recall, reflect, retain facts and preferences across sessions",
	});

	// Set per turn from before_agent_start; agent_end capture reads it too.
	let blocked = false;

	// --- Fable guard: no memory tools, no capture, under a blocked model ---

	pi.on("tool_call", async (event, ctx) => {
		if (!event.toolName.startsWith("mcp__hindsight__")) return;
		if (!BLOCKED_MODEL.test(ctx.model?.id ?? "")) return;
		return {
			block: true,
			reason: `Hindsight is disabled under ${ctx.model?.id} (internal-use model: no customer data, ITAR or PII).`,
		};
	});

	// --- Session capture: stream prompts + responses into Hindsight ---

	pi.on("before_agent_start", async (event, ctx) => {
		blocked = BLOCKED_MODEL.test(ctx.model?.id ?? "");
		if (blocked) return;
		const prompt = (event as { prompt?: string }).prompt;
		if (prompt) retain(`User: ${prompt}`);
	});

	pi.on("agent_end", async (event, _ctx) => {
		if (blocked) return;
		const text = lastAssistantText((event as { messages?: unknown }).messages);
		if (text) retain(`Assistant: ${text}`);
	});
}
