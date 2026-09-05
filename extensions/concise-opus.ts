// concise-opus: per-turn conciseness reminder for Claude Opus 5.
//
// Why: Opus 5's default responses run long, and per Anthropic's own docs
// ("Prompting Claude Opus 5"), effort/thinking levels do NOT reliably change
// visible response length — only explicit prompting does. Our AGENTS.md already
// says "keep answers short", but it sits mid-prompt, followed by 100+ lines of
// skills/context, exactly the "diluted in a long system prompt" failure mode
// the docs call out. Their fix: pair the instruction with a short reminder
// near the END of the prompt.
//
// Mechanism (same philosophy as walkthrough/simpledlc — guarantee in code, not
// prompt): on every turn where the active model is an Opus 5 variant, append a
// short conciseness block to the tail of the chained system prompt. Appending
// per turn keeps it last no matter what other extensions add, and immune to
// long-session drift. Other models are untouched.
//
// Enforcement: prompting alone is soft, so message_end also measures the final
// assistant reply (prose only — fenced code blocks are exempt). If it exceeds
// LIMIT, the extension itself calls the model once to rewrite the reply and
// returns it as an in-place replacement — the session keeps a single (short)
// message instead of a long one followed by a correction. Only the final reply
// is touched; messages with tool calls are left alone. The long reply streams
// visibly, then is replaced on finalize.
//
// /concise toggles it (default ON) for turns where you want long-form output.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Matches claude-opus-5, us.anthropic.claude-opus-5, opus-5.1, opus-4.8, etc.
const OPUS5 = /opus-?(4[.-]8|5)/i;

// Follows Anthropic's published guidance: positive shape description, lead
// with the outcome, high-level unless asked. Kept short — it rides every turn.
const REMINDER = `

<final_reminder>
Keep responses focused, brief, and concise. Hard target: 100 characters (Chinese) / ~50 words of prose per response.
- Exceptions only when the deliverable itself requires it: code blocks, file contents, or the user explicitly asking for depth. Even then, keep the surrounding prose within the target.
- Lead with the outcome or answer in the first sentence; supporting detail after, only as needed.
- Don't restate what tool output already showed, don't enumerate options you won't pursue, and keep caveats to one line.
- Prefer one short paragraph over a bulleted essay. If a response fits in one sentence, use one sentence.
</final_reminder>`;

// Prose budget: CJK chars + ASCII words, code blocks excluded.
const LIMIT = 100;

// Rewrites are mechanical — use a cheaper/faster model than the Opus session
// model. Override via env: PI_CONCISE_MODEL="provider/modelId". Falls back to
// the session model if unavailable.
const DEFAULT_REWRITER = "kiro/claude-haiku-4.5";

/** Length of the prose part of a reply: CJK chars count 1 each, ASCII word = 1. */
function proseLength(text: string): number {
	const prose = text.replace(/```[\s\S]*?(```|$)/g, "");
	const cjk = (prose.match(/[\u3000-\u9fff\uf900-\ufaff]/g) ?? []).length;
	const words = (prose.match(/[A-Za-z0-9_'-]+/g) ?? []).length;
	return cjk + words;
}

export default function (pi: ExtensionAPI) {
	let enabled = true;

	pi.on("before_agent_start", async (event, ctx) => {
		if (!enabled) return undefined;
		if (!OPUS5.test(ctx.model?.id ?? "")) return undefined;
		return { systemPrompt: event.systemPrompt + REMINDER };
	});

	pi.on("message_end", async (event, ctx) => {
		if (!enabled || !OPUS5.test(ctx.model?.id ?? "")) return;
		const msg = event.message;
		if (msg.role !== "assistant" || !Array.isArray(msg.content)) return;
		// Only final replies: a message with tool calls is mid-run, leave it alone.
		if (msg.content.some((b: { type: string }) => b.type === "toolCall")) return;

		const text = msg.content
			.filter((b: { type: string }): b is { type: "text"; text: string } => b.type === "text")
			.map((b: { text: string }) => b.text)
			.join("\n");
		const len = proseLength(text);
		if (len <= LIMIT || !ctx.model) return;

		if (ctx.hasUI) ctx.ui.notify(`concise-opus: reply ${len} > ${LIMIT}, rewriting in place`, "info");
		try {
			// Prefer the designated rewriter model; fall back to the session model.
			let model = ctx.model;
			const spec = process.env.PI_CONCISE_MODEL || DEFAULT_REWRITER;
			const slash = spec.indexOf("/");
			if (slash > 0) {
				const found = ctx.modelRegistry.find(spec.slice(0, slash), spec.slice(slash + 1));
				if (found) model = found;
			}
			const response = await ctx.modelRegistry.complete(
				model,
				{
					messages: [
						{
							role: "user",
							content: `Rewrite the assistant reply below to at most ${LIMIT} units of prose (CJK chars + English words; fenced code blocks are exempt and must be kept verbatim). Keep only what the user needs; same language as the original. Output ONLY the rewritten reply.\n\n<reply>\n${text}\n</reply>`,
							timestamp: Date.now(),
						},
					],
				},
				{ maxTokens: 2048, signal: ctx.signal },
			);
			const rewritten = response.content
				.filter((b): b is { type: "text"; text: string } => b.type === "text")
				.map((b) => b.text)
				.join("\n")
				.trim();
			// Keep the original if the rewrite is empty or didn't actually help.
			if (!rewritten || proseLength(rewritten) >= len) return;
			return {
				message: {
					...msg,
					content: [
						// Preserve thinking blocks; swap the visible text.
						...msg.content.filter((b: { type: string }) => b.type !== "text"),
						{ type: "text" as const, text: rewritten },
					],
				},
			};
		} catch (err) {
			if (ctx.hasUI) ctx.ui.notify(`concise-opus: rewrite failed (${err instanceof Error ? err.message : String(err)})`, "warning");
			return; // rewrite failed: keep the original reply
		}
	});

	pi.registerCommand("concise", {
		description: "Toggle the Opus 5 conciseness reminder (default ON; turn off for long-form output)",
		handler: async (_args, ctx) => {
			enabled = !enabled;
			ctx.ui.notify(`Opus 5 conciseness reminder ${enabled ? "ON" : "OFF"}`, "info");
		},
	});
}
