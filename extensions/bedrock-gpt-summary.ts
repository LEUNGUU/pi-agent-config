import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type Block = { reasoningContent?: { reasoningText?: unknown } } & Record<string, unknown>;
type Message = { role?: string; content?: Block[] } & Record<string, unknown>;
type Payload = {
	modelId?: string;
	messages?: Message[];
	additionalModelRequestFields?: { reasoning?: Record<string, unknown> } & Record<string, unknown>;
} & Record<string, unknown>;

export default function (pi: ExtensionAPI) {
	pi.on("before_provider_request", (event, ctx) => {
		if (ctx.model?.api !== "bedrock-converse-stream") return;
		const payload = event.payload as Payload | null;
		const id = payload?.modelId;
		if (typeof id !== "string" || !id.includes("openai.gpt-") || id.includes("openai.gpt-oss")) return;

		// Bedrock GPT rejects readable reasoning in assistant history; only encrypted blocks can be replayed.
		const messages = payload.messages?.map((m) => {
			if (m.role !== "assistant" || !Array.isArray(m.content)) return m;
			if (!m.content.some((b) => b.reasoningContent?.reasoningText)) return m;
			const content = m.content.filter((b) => !b.reasoningContent?.reasoningText);
			return { ...m, content: content.length > 0 ? content : [{ text: "<empty>" }] };
		});

		// Bedrock returns readable GPT reasoning only when a summary is requested.
		const fields = payload.additionalModelRequestFields;
		const reasoning = fields?.reasoning;
		return {
			...payload,
			...(messages ? { messages } : {}),
			...(reasoning?.effort
				? { additionalModelRequestFields: { ...fields, reasoning: { ...reasoning, summary: reasoning.summary ?? "auto" } } }
				: {}),
		};
	});
}
