// adhd: per-turn ADHD-friendly output rules.
//
// Rules: extensions/adhd.md, copied verbatim from github.com/ayghri/i-have-adhd
// (skills/i-have-adhd/SKILL.md @ 723af7d, MIT, (c) 2026 Ayoub Ghriss).
//
// Why not the upstream package: it injects the ruleset once at session start
// (and again after compaction), so in a long session it sits far up the
// context and gets diluted. Here the rules are appended to the tail of the
// system prompt on every turn — the mechanism concise-opus used — so they stay
// the last thing the model reads, for every model.
//
// Default ON. /adhd toggles it; "stop adhd mode" / "normal mode" turns it off
// for the session. State is in-memory: a new session starts ON again.
import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const RULES = readFileSync(new URL("./adhd.md", import.meta.url), "utf8")
	// Strip the YAML frontmatter; keep the ruleset body.
	.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")
	.trim();

const BLOCK = `

<adhd_mode>
ADHD MODE ACTIVE. The ruleset below applies to every response until turned off. "stop adhd mode" or "normal mode" turns it off for this session.

${RULES}
</adhd_mode>`;

const STOP_PHRASES = new Set(["stop adhd mode", "normal mode"]);

export default function (pi: ExtensionAPI) {
	let enabled = true;

	pi.on("before_agent_start", async (event) => {
		if (!enabled) return undefined;
		return { systemPrompt: event.systemPrompt + BLOCK };
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
