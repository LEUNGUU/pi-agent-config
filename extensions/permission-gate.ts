/**
 * Permission Gate Extension
 *
 * Prompts for confirmation before running potentially dangerous bash commands.
 * Patterns checked: rm -rf (recursive removal)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	const dangerousPatterns = [/\brm\s+(-rf?|--recursive)/i];

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return undefined;

		const command = event.input.command as string;
		const isDangerous = dangerousPatterns.some((p) => p.test(command));

		if (isDangerous) {
			if (!ctx.hasUI) {
				// In non-interactive mode, block by default
				return { block: true, reason: "Dangerous command blocked (no UI for confirmation)" };
			}

			// Let the Otty integration flip the pane badge to "awaiting" while this
			// dialog blocks, so a backgrounded tab shows it needs attention.
			pi.events.emit("otty:awaiting", {});

			let choice: string | undefined;
			try {
				// No timeout: wait indefinitely for the user's decision.
				choice = await ctx.ui.select(
					`⚠️ Dangerous command:\n\n  ${command}\n\nAllow?`,
					["Yes", "No"]
				);
			} finally {
				pi.events.emit("otty:awaiting-done", {});
			}

			if (choice !== "Yes") {
				return { block: true, reason: "Blocked by user" };
			}
		}

		return undefined;
	});
}
