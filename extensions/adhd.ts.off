// adhd: per-turn ADHD-friendly output rules.
//
// Rules: extensions/adhd.md, condensed from github.com/ayghri/i-have-adhd
// (skills/i-have-adhd/SKILL.md @ 723af7d, MIT, (c) 2026 Ayoub Ghriss).
//
// Two layers, both cache-safe:
// 1. The full ruleset is set as the `adhd_mode` system-prompt section every
//    turn. Use the structured section, never `return { systemPrompt }`: a
//    returned string replaces the whole prompt and silently drops sections
//    other extensions add later (ponytail, mcp_servers). The text is
//    identical each turn, so the cached prefix holds, and it survives
//    compaction. But the system prompt sits at the HEAD of the context, so in
//    a long session it ends up far from the latest turn.
// 2. A short reminder is persisted as a hidden custom message right after each
//    user prompt. Being in the transcript, it never changes the prefix (no
//    cache miss), and the newest one is always near the tail. Cost: ~50
//    tokens per turn, accumulating.
// Do NOT inject request-locally (the `context` event): the text would vanish
// from history next turn, and with pi's cache points (system + last user
// message) no cached prefix would ever match again.
//
// Default ON. /adhd toggles it; "stop adhd mode" / "normal mode" turns it off
// for the session. State is in-memory: a new session starts ON again.
import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const RULES = readFileSync(new URL("./adhd.md", import.meta.url), "utf8")
	// Strip the YAML frontmatter; keep the ruleset body.
	.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")
	.trim();

const BLOCK = `<adhd_mode>
ADHD MODE ACTIVE. The ruleset below applies to every response until turned off. "stop adhd mode" or "normal mode" turns it off for this session.

${RULES}
</adhd_mode>`;

const REMINDER =
	"<adhd_reminder>ADHD mode on; full rules are in the system prompt. First line: the next action or the answer. Numbered steps, restate state, end with one concrete next action. No preamble, recap, or pleasantries.</adhd_reminder>";

const STOP_PHRASES = new Set(["stop adhd mode", "normal mode"]);

export default function (pi: ExtensionAPI) {
	let enabled = true;

	pi.on("before_agent_start", async (event) => {
		const sections = event.systemPromptOptions.sections;
		if (!enabled) {
			// Sections persist across turns; clear ours so it does not linger.
			delete sections.adhd_mode;
			return undefined;
		}
		sections.adhd_mode = BLOCK;
		return {
			message: { customType: "adhd-reminder", content: REMINDER, display: false },
		};
	});

	pi.on("input", async (event, ctx) => {
		if (!enabled || !STOP_PHRASES.has(event.text.trim().toLowerCase())) {
			return { action: "continue" };
		}
		enabled = false;
		ctx.ui.notify("ADHD mode OFF for this session (/adhd to turn back on)", "info");
		return { action: "handled" };
	});

	pi.registerCommand("adhd", {
		description: "Toggle ADHD-friendly output rules (default ON)",
		handler: async (_args, ctx) => {
			enabled = !enabled;
			ctx.ui.notify(`ADHD mode ${enabled ? "ON" : "OFF"}`, "info");
		},
	});
}
