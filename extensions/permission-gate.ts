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

			// Auto-deny after 30 seconds
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 30000);

			// Let the Otty integration flip the pane badge to "awaiting" while this
			// dialog blocks, so a backgrounded tab shows it needs attention rather
			// than silently timing out.
			pi.events.emit("otty:awaiting", {});

			let choice: string | undefined;
			try {
				choice = await ctx.ui.select(
					`⚠️ Dangerous command:\n\n  ${command}\n\nAllow? (auto-deny in 30s)`,
					["Yes", "No"],
					{ signal: controller.signal }
				);
			} finally {
				clearTimeout(timeoutId);
				pi.events.emit("otty:awaiting-done", {});
			}

			if (choice !== "Yes") {
				const reason = controller.signal.aborted ? "Timed out" : "Blocked by user";
				return { block: true, reason };
			}
		}

		return undefined;
	});
}
