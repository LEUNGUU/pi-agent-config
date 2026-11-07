import { expect, test } from "bun:test";
import { turnText } from "../extensions/hindsight-mcp/index";

const user = (text: string) => ({ role: "user", content: [{ type: "text", text }] });
const reply = (text: string, stopReason = "stop") => ({ role: "assistant", content: [{ type: "text", text }], stopReason });

test("pairs the prompt with the final reply of the run", () => {
	const messages = [user("fix the bug"), reply("Looking."), { role: "toolResult", content: "ok" }, reply("Fixed it.")];
	expect(turnText(messages, "fix the bug")).toBe("User: fix the bug\n\nAssistant: Fixed it.");
});

test("a retry keeps one question and the real answer", () => {
	// First low-level run fails, Pi retries with agent.continue(): no new prompt.
	const messages = [user("hi"), { role: "assistant", content: [], stopReason: "error" }, reply("Hello.")];
	expect(turnText(messages, "hi")).toBe("User: hi\n\nAssistant: Hello.");
});

test("a follow-up queued during the run keeps its own answer", () => {
	const messages = [user("use light theme"), reply("Switching."), user("no, dark"), reply("Dark theme set.")];
	expect(turnText(messages, "use light theme")).toBe(
		"User: use light theme\n\nAssistant: Switching.\n\nUser: no, dark\n\nAssistant: Dark theme set.",
	);
});

test("adds the prompt when the run messages lack it, and drops custom messages", () => {
	const messages = [{ role: "custom", customType: "explain-reminder", content: "<explain_reminder>x</explain_reminder>" }, reply("Done.")];
	expect(turnText(messages, "do it")).toBe("User: do it\n\nAssistant: Done.");
});

test("an aborted reply is not saved as the answer", () => {
	expect(turnText([user("long task"), reply("Half of an ans", "aborted")], "long task")).toBe("User: long task");
});
