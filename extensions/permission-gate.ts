/**
 * Permission Gate Extension
 *
 * Prompts for confirmation before:
 *   - dangerous bash commands (rm -rf)
 *   - spawning a subagent on a Fable model. Kiro flags Fable as internal
 *     development use only (no customer data, ITAR or PII), so AGENTS.md says
 *     "only when explicitly asked". Code can't check what the user asked for;
 *     a confirm dialog is the enforceable stand-in.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const DANGEROUS_BASH = [/\brm\s+(-rf?|--recursive)/i];
const RESTRICTED_MODEL = /fable/i;

export default function (pi: ExtensionAPI) {
	/** Ask the user; true = allowed. Blocks (false) when there is no UI. */
	async function confirm(ctx: ExtensionContext, question: string): Promise<boolean> {
		if (!ctx.hasUI) return false;
		// Let the Otty integration flip the pane badge to "awaiting" while this
		// dialog blocks, so a backgrounded tab shows it needs attention.
		pi.events.emit("otty:awaiting", {});
		try {
			// No timeout: wait indefinitely for the user's decision.
			return (await ctx.ui.select(question, ["Yes", "No"])) === "Yes";
		} finally {
			pi.events.emit("otty:awaiting-done", {});
		}
	}

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName === "bash") {
			const command = event.input.command as string;
			if (!DANGEROUS_BASH.some((p) => p.test(command))) return undefined;
			if (!ctx.hasUI) return { block: true, reason: "Dangerous command blocked (no UI for confirmation)" };
			if (!(await confirm(ctx, `⚠️ Dangerous command:\n\n  ${command}\n\nAllow?`))) {
				return { block: true, reason: "Blocked by user" };
			}
			return undefined;
		}

		if (event.toolName === "Agent") {
			const model = (event.input as { model?: unknown }).model;
			if (typeof model !== "string" || !RESTRICTED_MODEL.test(model)) return undefined;
			if (!ctx.hasUI) return { block: true, reason: `Restricted model ${model} blocked (no UI for confirmation)` };
			if (!(await confirm(ctx, `⚠️ Subagent on restricted model:\n\n  ${model}\n\nInternal development use only — no customer data, ITAR or PII. Allow?`))) {
				return { block: true, reason: `Restricted model ${model} not approved by user. Use a non-Fable model.` };
			}
		}

		return undefined;
	});
}
