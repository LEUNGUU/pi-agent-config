/**
 * compaction-model: always run compaction/summarization on a designated strong model.
 *
 * Why: weak/slow models (e.g. kiro/claude-fable-5) time out on large summarization
 * requests, silently breaking auto-compact and letting context overflow. This hooks
 * session_before_compact and generates the summary with SUMMARIZER_MODEL instead of
 * the session's current model. Falls back to the default flow (current model) if the
 * summarizer model is unavailable.
 *
 * Override via env: PI_COMPACTION_MODEL="provider/modelId" (comma-separated for a
 * fallback chain, tried in order).
 */
import { compact } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Tried in order. Haiku 5.5 on Bedrock first: cheap, 1M context, no Kiro
 * gateway. kiro/glm-5 stays as a second family because Kiro's upstream content
 * filter refuses whole conversations per model family (`[content filter: CYBER]`
 * on sessions about secret scanning or exploit code); without a second candidate
 * the only fallback is the session's own model, usually the expensive one
 * compaction exists to avoid.
 */
const DEFAULT_SUMMARIZERS = ["amazon-bedrock/global.anthropic.claude-haiku-5-5", "kiro/glm-5"];

export default function (pi: ExtensionAPI) {
	pi.on("session_before_compact", async (event, ctx) => {
		const specs = (process.env.PI_COMPACTION_MODEL?.split(",") ?? DEFAULT_SUMMARIZERS)
			.map((s) => s.trim())
			.filter((s) => s.includes("/"));

		const failures: string[] = [];

		for (const spec of specs) {
			const slash = spec.indexOf("/");
			const providerId = spec.slice(0, slash);
			const modelId = spec.slice(slash + 1);

			// Reached the session's own model: the default flow already uses it.
			if (ctx.model?.provider === providerId && ctx.model?.id === modelId) break;

			const model = ctx.modelRegistry.find(providerId, modelId);
			if (!model) continue;

			try {
				const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
				if (!auth.ok) throw new Error(auth.error);
				const result = await compact(
					event.preparation,
					model,
					auth.apiKey,
					auth.headers,
					// Mixed-language summaries pulled later replies off the user's language.
					[event.customInstructions, "Write the entire summary in English."].filter(Boolean).join("\n\n"),
					event.signal,
					pi.getThinkingLevel(),
					undefined, // streamFn: default
				);
				return { compaction: result };
			} catch (error) {
				if (event.signal.aborted) return { cancel: true };
				failures.push(`${spec}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}

		// Every candidate failed or was unavailable: fall back to the current model.
		if (failures.length > 0 && ctx.hasUI) {
			ctx.ui.notify(
				`compaction-model: falling back to current model (${failures.join("; ")})`,
				"warning",
			);
		}
		return undefined;
	});
}
