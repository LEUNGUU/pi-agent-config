import { expect, test } from "bun:test";
import type {
	BeforeProviderRequestEvent,
	BeforeProviderRequestEventResult,
	ExtensionAPI,
	ExtensionContext,
	ExtensionHandler,
} from "@earendil-works/pi-coding-agent";
import configure from "../extensions/bedrock-gpt-summary";

let handler: ExtensionHandler<BeforeProviderRequestEvent, BeforeProviderRequestEventResult>;
configure({
	on(event: string, callback: typeof handler) {
		expect(event).toBe("before_provider_request");
		handler = callback;
		return () => {};
	},
} as unknown as ExtensionAPI);

const invoke = (payload: unknown, api = "bedrock-converse-stream") =>
	handler({ type: "before_provider_request", payload }, { model: { api } } as ExtensionContext);

const fields = { reasoning: { effort: "high" }, unrelated: true };

test.each([
	"gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-sol", "gpt-6-luna",
	"gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5",
])("requests a summary for %s without changing other fields", async (model) => {
	const payload = {
		modelId: "global.openai." + model,
		messages: [{ role: "user", content: [{ text: "Hello" }] }],
		additionalModelRequestFields: fields,
	};
	const before = structuredClone(payload);
	expect(await invoke(payload)).toEqual({
		...payload,
		additionalModelRequestFields: { ...fields, reasoning: { effort: "high", summary: "auto" } },
	});
	expect(payload).toEqual(before);
});

test("preserves an explicit summary setting", async () => {
	const payload = {
		modelId: "us.openai.gpt-6-luna",
		additionalModelRequestFields: { reasoning: { effort: "medium", summary: "concise" } },
	};
	expect(await invoke(payload)).toEqual(payload);
});

test.each([
	[null, "bedrock-converse-stream"],
	[{ modelId: 123, additionalModelRequestFields: fields }, "bedrock-converse-stream"],
	[{ modelId: "global.anthropic.claude-opus-5-5", additionalModelRequestFields: fields }, "bedrock-converse-stream"],
	[{ modelId: "openai.gpt-oss-120b", additionalModelRequestFields: fields }, "bedrock-converse-stream"],
	[{ modelId: "global.openai.gpt-6-luna", additionalModelRequestFields: fields }, "openai-responses"],
])("ignores non-Bedrock-GPT requests (%j)", async (payload, api) => {
	expect(await invoke(payload, api)).toBeUndefined();
});

test.each([
	{ modelId: "global.openai.gpt-6-luna" },
	{ modelId: "global.openai.gpt-6-luna", additionalModelRequestFields: {} },
])("does not add a summary when thinking is off (%j)", async (payload) => {
	expect(await invoke(payload)).toEqual(payload);
});

test("removes readable reasoning from assistant history but keeps encrypted reasoning", async () => {
	const encrypted = { reasoningContent: { redactedContent: new Uint8Array([1, 2]) } };
	const payload = {
		modelId: "global.openai.gpt-6.1-sol",
		messages: [
			{ role: "user", content: [{ text: "Q1" }] },
			{
				role: "assistant",
				content: [{ reasoningContent: { reasoningText: { text: "summary" } } }, encrypted, { text: "A1" }],
			},
			{ role: "assistant", content: [{ reasoningContent: { reasoningText: { text: "only summary" } } }] },
			{ role: "user", content: [{ text: "Q2" }] },
		],
		additionalModelRequestFields: { reasoning: { effort: "high" } },
	};
	const result = (await invoke(payload)) as typeof payload;
	expect(result.messages[1].content).toEqual([encrypted, { text: "A1" }]);
	expect(result.messages[2].content).toEqual([{ text: "<empty>" }]);
	expect(result.messages[0]).toBe(payload.messages[0]);
	expect(JSON.stringify(result)).not.toContain("reasoningText");
	expect(payload.messages[1].content).toHaveLength(3);
});

test("cleans history even when thinking is off", async () => {
	const payload = {
		modelId: "global.openai.gpt-5.5",
		messages: [{ role: "assistant", content: [{ reasoningContent: { reasoningText: { text: "s" } } }, { text: "A" }] }],
	};
	expect(await invoke(payload)).toEqual({ ...payload, messages: [{ role: "assistant", content: [{ text: "A" }] }] });
});
