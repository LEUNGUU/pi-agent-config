/**
 * compaction-model: always run compaction/summarization on a designated strong model.
 *
 * Why: weak/slow models (e.g. kiro/claude-fable-5) time out on large summarization
 * requests, silently breaking auto-compact and letting context overflow. This hooks
 * session_before_compact and generates the summary with SUMMARIZER_MODEL instead of
 * the session's current model. Falls back to the default flow (current model) if the
 * summarizer model is unavailable.
 *
 * Override via env: PI_COMPACTION_MODEL="provider/modelId"
 */
import { compact } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DEFAULT_SUMMARIZER = "kiro/claude-sonnet-5";

export default function (pi: ExtensionAPI) {
	pi.on("session_before_compact", async (event, ctx) => {
		const spec = process.env.PI_COMPACTION_MODEL || DEFAULT_SUMMARIZER;
		const slash = spec.indexOf("/");
		if (slash <= 0) return undefined;
		const providerId = spec.slice(0, slash);
		const modelId = spec.slice(slash + 1);

		// Current model already is the summarizer: let the default flow handle it.
		if (ctx.model?.provider === providerId && ctx.model?.id === modelId) {
			return undefined;
		}

		const model = ctx.modelRegistry.find(providerId, modelId);
		if (!model) return undefined;

		try {
			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
			if (!auth.ok) throw new Error(auth.error);
			const result = await compact(
				event.preparation,
				model,
				auth.apiKey,
				auth.headers,
				event.customInstructions,
				event.signal,
				pi.getThinkingLevel(),
				undefined, // streamFn: default
			);
			return { compaction: result };
		} catch (error) {
			if (event.signal.aborted) return { cancel: true };
			// Summarizer failed: fall back to the default flow with the current model.
			if (ctx.hasUI) {
				const msg = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`compaction-model: ${spec} failed (${msg}), falling back to current model`, "warning");
			}
			return undefined;
		}
	});
}
