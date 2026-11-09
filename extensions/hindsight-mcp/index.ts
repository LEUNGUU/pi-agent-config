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

/** Tells extraction who said what, so the agent's own "fixed" or "done" is kept as its claim, not a fact. */
const RETAIN_CONTEXT =
	"One turn between the user and their AI coding agent. User lines are the user's own words and preferences; " +
	"Assistant lines are the agent's claims about its work, not verified facts.";

/** Warn once per outage: a stale HINDSIGHT_HOST once dropped a whole session without a trace. */
let captureWarned = false;

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

function retain(content: string, warn: (message: string) => void): void {
	if (!content.trim()) return;
	const tag = resolveProjectTag();
	void fetch(RETAIN_URL, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			async: true,
			items: [{ content, context: RETAIN_CONTEXT, timestamp: new Date().toISOString(), tags: [tag] }],
			document_tags: [tag],
		}),
		signal: AbortSignal.timeout(4000),
	})
		.then((res) => {
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			captureWarned = false; // recovered: warn again on the next failure
		})
		.catch((error: unknown) => {
			// Never block the session, but say once per outage that saves are failing.
			if (captureWarned) return;
			captureWarned = true;
			const reason = error instanceof Error ? error.message : String(error);
			const message = `A Hindsight save failed (${HINDSIGHT_HOST}: ${reason}). Memory capture may be off until it recovers.`;
			try {
				warn(message);
			} catch {
				console.error(message); // the UI went away (session replaced or reloaded)
			}
		});
}

type Message = { role?: string; content?: unknown; stopReason?: string };
const NOT_AN_ANSWER = new Set(["toolUse", "error", "aborted", "pending", "deferred"]);

const textOf = (content: unknown): string =>
	typeof content === "string"
		? content
		: Array.isArray(content)
			? content
					.filter((b) => (b as { type?: string }).type === "text")
					.map((b) => (b as { text?: string }).text ?? "")
					.join("")
			: "";

/**
 * One user run as "User:/Assistant:" lines: each user message (the prompt and any
 * follow-up queued during the run) paired with the last finished reply before the
 * next one. Only replies that end a turn count: text sent with a tool call is
 * in-between commentary ("Looking now."), and failed or aborted replies are not
 * answers, so a retry keeps only the real answer. Custom and tool messages are dropped.
 */
export function turnText(messages: readonly unknown[], prompt: string): string {
	const lines: string[] = [];
	let reply = "";
	const flush = () => {
		if (reply) lines.push(`Assistant: ${reply}`);
		reply = "";
	};
	const all = messages as readonly Message[];
	const p = prompt.trim();
	if (p && !all.some((m) => m.role === "user" && textOf(m.content).trim() === p)) lines.push(`User: ${p}`);
	for (const m of all) {
		const t = textOf(m.content).trim();
		if (m.role === "user") {
			flush();
			if (t) lines.push(`User: ${t}`);
		} else if (m.role === "assistant" && t && !NOT_AN_ANSWER.has(m.stopReason ?? "")) {
			reply = t;
		}
	}
	flush();
	return lines.join("\n\n");
}

export default function hindsightMcp(pi: ExtensionAPI) {
	// Built-in MCP connects this on session start; reconnect/inspect via /mcp.
	// Every tool is reachable only from codemode (searchTools / describeTool):
	// declaring even recall/retain/reflect directly costs ~1.8k tokens per
	// request, while codemode costs nothing until called and needs no extra
	// tool_search round trip. The mcp_servers section carries the description
	// below, so the model still knows the server exists. The list_* enumerators
	// return up to 100 items: a script must filter them instead of dumping the
	// JSON into context.
	// delete_*/clear_* are irreversible bulk operations: hidden; run them from
	// the Hindsight UI/API instead of via the model.
	pi.registerMcpServer("hindsight", {
		url: MCP_URL,
		exposure: "codemode",
		toolExposure: { "delete_*": "hidden", "clear_*": "hidden" },
		description:
			"Long-term memory of the user across sessions: recall({query}) before personal suggestions, retain({content}) for new preferences or facts, reflect({query}) for synthesis",
	});

	// Set per run from before_agent_start; capture reads it at agent_settled.
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

	// --- Recall: smaller, flatter results ---
	// The server default (max_tokens 4096) returns ~85 facts as full JSON
	// records, duplicated in content and structuredContent: ~21k tokens per call.
	// Cap at 1024 unless the caller asks for more, and keep only what the model
	// reads (type, date, text). Default types skip `experience`: session capture
	// below retains every prompt as one, so recall would mostly echo the user's
	// own earlier questions. Pass types explicitly to search them.
	// Nested codemode calls pass through these hooks too.
	const RECALL = "mcp__hindsight__recall";

	pi.on("tool_call", async (event) => {
		if (event.toolName !== RECALL) return;
		const input = event.input as { max_tokens?: number; types?: string[] };
		input.max_tokens ??= 1024;
		input.types ??= ["world", "observation"];
	});

	pi.on("tool_result", async (event) => {
		if (event.toolName !== RECALL || event.isError) return;
		const first = event.content?.[0];
		if (first?.type !== "text") return;
		let results: { text?: string; fact_type?: string; mentioned_at?: string | null }[];
		try {
			results = JSON.parse(first.text).results;
		} catch {
			return; // unexpected shape: pass through untouched
		}
		if (!Array.isArray(results)) return;
		const facts = results.map((r) => ({
			type: r.fact_type ?? "",
			date: r.mentioned_at?.slice(0, 10) ?? "",
			text: r.text ?? "",
		}));
		const text = facts.length
			? facts.map((f) => `- [${f.type} ${f.date}] ${f.text}`).join("\n")
			: "No memories found.";
		return { content: [{ type: "text", text }], structuredContent: { facts } };
	});

	// --- Session capture: one retain per user run, once Pi is idle ---
	// agent_end fires again for retries, compaction retries and queued follow-ups
	// (no new before_agent_start); only agent_settled is final. So collect every
	// low-level run's messages and save the whole run at settle.
	let pendingPrompt = "";
	let runMessages: unknown[] = [];

	pi.on("before_agent_start", async (event, ctx) => {
		blocked = BLOCKED_MODEL.test(ctx.model?.id ?? "");
		pendingPrompt = blocked ? "" : ((event as { prompt?: string }).prompt ?? "");
		runMessages = [];
	});

	pi.on("agent_end", async (event) => {
		if (!blocked) runMessages.push(...((event as { messages?: unknown[] }).messages ?? []));
	});

	pi.on("agent_settled", async (_event, ctx) => {
		const turn = blocked ? "" : turnText(runMessages, pendingPrompt);
		pendingPrompt = "";
		runMessages = [];
		// Bind the UI now: ctx goes stale after /new or /reload, and the save settles later.
		const ui = ctx.hasUI ? ctx.ui : undefined;
		retain(turn, (message) => (ui ? ui.notify(message, "warning") : console.error(message)));
	});
}
