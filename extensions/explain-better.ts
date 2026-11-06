// explain-better: per-turn plain-language output rules (replaces adhd.ts).
// Same two-layer, cache-safe design as adhd.ts: a fixed system-prompt section
// plus a short hidden reminder after each user prompt. See adhd.ts.off for the
// reasoning. Default ON. /explain toggles; "normal mode" turns it off.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const BLOCK = `<explain_better>
Write every reply in about 80% ASD-STE100 (Simplified Technical English), in Chinese too:
- First line is the answer or the action. No opener.
- Short sentences, 20 words or fewer. One idea per sentence. Active voice.
- Plain words. One meaning per word. Define each technical term on first use.
- Number procedures, one action per step.
- End with one concrete next step, then stop. No recap, no closer.
When text alone is not enough, offer a Mermaid diagram or an HTML page
(see ~/.pi/agent/skills/explain-better/SKILL.md).
"normal mode" turns this off for the session.
</explain_better>`;

const REMINDER =
	"<explain_reminder>Plain language: answer first, short sentences, define terms, one next step at the end.</explain_reminder>";

const STOP_PHRASES = new Set(["normal mode", "stop explain mode"]);

export default function (pi: ExtensionAPI) {
	let enabled = true;

	pi.on("before_agent_start", async (event) => {
		const sections = event.systemPromptOptions.sections;
		if (!enabled) {
			delete sections.explain_better;
			return undefined;
		}
		sections.explain_better = BLOCK;
		return {
			message: { customType: "explain-reminder", content: REMINDER, display: false },
		};
	});

	pi.on("input", async (event, ctx) => {
		if (!enabled || !STOP_PHRASES.has(event.text.trim().toLowerCase())) {
			return { action: "continue" };
		}
		enabled = false;
		ctx.ui.notify("Explain mode OFF for this session (/explain to turn back on)", "info");
		return { action: "handled" };
	});

	pi.registerCommand("explain", {
		description: "Toggle plain-language output rules (default ON)",
		handler: async (_args, ctx) => {
			enabled = !enabled;
			ctx.ui.notify(`Explain mode ${enabled ? "ON" : "OFF"}`, "info");
		},
	});
}
