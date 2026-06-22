/**
 * Hindsight MCP bridge for pi.
 *
 * pi has no native MCP support, so this extension connects to the self-hosted
 * Hindsight memory server over its native HTTP MCP transport, discovers its
 * tools, and re-registers each one as a native pi tool (prefixed `hs_`). The
 * LLM then calls them like any other pi tool; calls are forwarded over MCP.
 *
 * Hindsight runs on the EC2 'hindsight' box, reached via an SSH tunnel:
 *   ssh -f -N -L 8888:localhost:8888 hindsight
 *
 * Single-bank mode: the URL pins all tools to the "pi" bank, so tool calls
 * don't need a bank_id argument.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Type } from "typebox";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { basename } from "node:path";

/** Hindsight MCP endpoint (single-bank mode pins to bank "pi"). */
const MCP_URL = "http://localhost:8888/mcp/pi/";

/** Hindsight REST base for the same bank — used by the session-capture hooks. */
const RETAIN_URL = "http://localhost:8888/v1/default/banks/pi/memories";

// ---------------------------------------------------------------------------
// Session capture
//
// Streams this pi session (user prompts, assistant responses) into Hindsight
// via its retain endpoint. Hindsight's LLM then extracts facts, entities, and
// relationships automatically (its "learning" pipeline) — this is what gives
// recall/reflect material beyond manual hs_retain calls.
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

let client: Client | undefined;
let connecting: Promise<Client> | undefined;

async function getClient(): Promise<Client> {
	if (client) return client;
	if (connecting) return connecting;

	connecting = (async () => {
		const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));
		const c = new Client(
			{ name: "pi-hindsight-bridge", version: "0.1.0" },
			{ capabilities: {} },
		);
		await c.connect(transport);
		client = c;
		return c;
	})();

	return connecting;
}

export default function hindsightMcp(pi: ExtensionAPI) {
	const registered = new Set<string>();

	const wire = async (ctx: {
		ui: { notify: (m: string, l: "error" | "info" | "warning") => void };
	}) => {
		let c: Client;
		try {
			c = await getClient();
		} catch (err) {
			ctx.ui.notify(`Hindsight: failed to connect (tunnel up?): ${String(err)}`, "error");
			return;
		}

		const { tools } = await c.listTools();
		let count = 0;
		for (const tool of tools) {
			const name = `hs_${tool.name}`;
			if (registered.has(name)) continue;
			registered.add(name);
			count++;

			pi.registerTool({
				name,
				label: `Hindsight: ${tool.name}`,
				description: tool.description ?? `Hindsight MCP tool: ${tool.name}`,
				parameters: (tool.inputSchema as unknown as ReturnType<typeof Type.Object>) ??
					Type.Object({}),
				async execute(_toolCallId, params, signal) {
					const result = await c.callTool(
						{
							name: tool.name,
							arguments: params as Record<string, unknown>,
						},
						undefined,
						signal ? { signal } : undefined,
					);
					const content = (result.content as Array<{ type: string; text?: string }>) ?? [];
					const text = content
						.map((b) => (b.type === "text" ? (b.text ?? "") : `[${b.type}]`))
						.join("\n");
					return {
						content: [{ type: "text", text: text || "(no output)" }],
						details: { tool: tool.name, isError: result.isError ?? false },
					};
				},
			});
		}
		ctx.ui.notify(`Hindsight: registered ${count} tool(s)`, "info");
	};

	pi.on("session_start", async (_event, ctx) => {
		await wire(ctx);
	});

	// Close the MCP connection when the session ends (quit/reload), so we don't
	// leak a dangling client + transport. wire() rebuilds it on the next start.
	pi.on("session_shutdown", async () => {
		try {
			await client?.close();
		} catch {
			// ignore
		}
		client = undefined;
		connecting = undefined;
		registered.clear();
	});

	// --- Session capture: stream prompts + responses into Hindsight ---

	pi.on("before_agent_start", async (event, _ctx) => {
		const prompt = (event as { prompt?: string }).prompt;
		if (prompt) retain(`User: ${prompt}`);
	});

	pi.on("agent_end", async (event, _ctx) => {
		const text = lastAssistantText((event as { messages?: unknown }).messages);
		if (text) retain(`Assistant: ${text}`);
	});

	pi.registerCommand("hindsight-reconnect", {
		description: "Reconnect to the Hindsight MCP server and re-register its tools",
		handler: async (_args, ctx) => {
			try {
				await client?.close();
			} catch {
				// ignore
			}
			client = undefined;
			connecting = undefined;
			registered.clear();
			await wire(ctx);
		},
	});
}
