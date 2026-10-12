/**
 * Permission Gate Extension
 *
 * Prompts for confirmation before dangerous bash commands (rm -rf).
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const DANGEROUS_BASH = [/\brm\s+(-rf?|--recursive)/i];

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

		return undefined;
	});
}
