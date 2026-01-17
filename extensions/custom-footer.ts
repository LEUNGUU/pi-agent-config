/**
 * Custom Footer Extension
 *
 * Demonstrates ctx.ui.setFooter() for replacing the built-in footer
 * with a custom component showing session context usage.
 */

import type { AssistantMessage, Model } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

export default function (pi: ExtensionAPI) {
	let isCustomFooter = false;
	let cachedBranch = "";
	let currentModel: Model<any> | undefined;

	// Update branch periodically
	async function updateBranch() {
		try {
			const result = await pi.exec("git", ["branch", "--show-current"], { timeout: 1000 });
			cachedBranch = result.stdout.trim();
		} catch {
			cachedBranch = "";
		}
	}

	// Track model changes via turn_start event
	pi.on("turn_start", (_event, ctx) => {
		currentModel = ctx.model;
	});

	// Enable footer on session start
	pi.on("session_start", async (_event, ctx) => {
		await updateBranch();
		isCustomFooter = true;
		currentModel = ctx.model;

		ctx.ui.setFooter((_tui, theme) => {
			return {
				render(width: number): string[] {
					// Calculate usage from branch entries
					let totalInput = 0;
					let totalOutput = 0;
					let totalCost = 0;
					let lastAssistant: AssistantMessage | undefined;

					for (const entry of ctx.sessionManager.getBranch()) {
						if (entry.type === "message" && entry.message.role === "assistant") {
							const msg = entry.message as AssistantMessage;
							totalInput += msg.usage.input;
							totalOutput += msg.usage.output;
							totalCost += msg.usage.cost.total;
							lastAssistant = msg;
						}
					}

					// Use tracked currentModel, or derive from last assistant message
					const model = currentModel ?? (lastAssistant
						? ctx.modelRegistry.find(lastAssistant.provider, lastAssistant.model)
						: ctx.model);

					// Context percentage from last assistant message
					const contextTokens = lastAssistant
						? lastAssistant.usage.input +
							lastAssistant.usage.output +
							lastAssistant.usage.cacheRead +
							lastAssistant.usage.cacheWrite
						: 0;
					const contextWindow = model?.contextWindow || 0;
					const contextPercent = contextWindow > 0 ? (contextTokens / contextWindow) * 100 : 0;

					// Format tokens
					const fmt = (n: number) => (n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`);

					// Build footer line
					const left = [
						theme.fg(contextPercent > 90 ? "error" : contextPercent > 70 ? "warning" : "success", `📊${contextPercent.toFixed(1)}%`),
						theme.fg("dim", `↑${fmt(totalInput)}`),
						theme.fg("dim", `↓${fmt(totalOutput)}`),
						theme.fg("dim", `$${totalCost.toFixed(3)}`),
					].join(" ");

					// Get thinking level and folder
					const thinkingLevel = pi.getThinkingLevel();
					const folder = ctx.cwd.split("/").pop() || ctx.cwd;

					const right = [
						theme.fg("accent", `📁${folder}`),
						cachedBranch ? theme.fg("success", `🌿${cachedBranch}`) : "",
						thinkingLevel !== "off" ? theme.fg("warning", `🧠${thinkingLevel}`) : "",
						theme.fg("dim", `🤖${model?.id || "no model"}`),
					].filter(Boolean).join(" ");
					const padding = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));

					return [truncateToWidth(left + padding + right, width)];
				},
				invalidate() {},
			};
		});
	});

	// Toggle custom footer with /footer command
	pi.registerCommand("footer", {
		description: "Toggle custom footer showing context usage",
		handler: async (_args, ctx) => {
			isCustomFooter = !isCustomFooter;

			if (isCustomFooter) {
				await updateBranch();

				ctx.ui.setFooter((_tui, theme) => {
					return {
						render(width: number): string[] {
							// Calculate usage from branch entries
							let totalInput = 0;
							let totalOutput = 0;
							let totalCost = 0;
							let lastAssistant: AssistantMessage | undefined;

							for (const entry of ctx.sessionManager.getBranch()) {
								if (entry.type === "message" && entry.message.role === "assistant") {
									const msg = entry.message as AssistantMessage;
									totalInput += msg.usage.input;
									totalOutput += msg.usage.output;
									totalCost += msg.usage.cost.total;
									lastAssistant = msg;
								}
							}

							// Use tracked currentModel, or derive from last assistant message
							const model = currentModel ?? (lastAssistant
								? ctx.modelRegistry.find(lastAssistant.provider, lastAssistant.model)
								: ctx.model);

							// Context percentage from last assistant message
							const contextTokens = lastAssistant
								? lastAssistant.usage.input +
									lastAssistant.usage.output +
									lastAssistant.usage.cacheRead +
									lastAssistant.usage.cacheWrite
								: 0;
							const contextWindow = model?.contextWindow || 0;
							const contextPercent = contextWindow > 0 ? (contextTokens / contextWindow) * 100 : 0;

							// Format tokens
							const fmt = (n: number) => (n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`);

							// Build footer line
							const left = [
								theme.fg(contextPercent > 90 ? "error" : contextPercent > 70 ? "warning" : "success", `📊${contextPercent.toFixed(1)}%`),
								theme.fg("dim", `↑${fmt(totalInput)}`),
								theme.fg("dim", `↓${fmt(totalOutput)}`),
								theme.fg("dim", `$${totalCost.toFixed(3)}`),
							].join(" ");

							// Get thinking level and folder
							const thinkingLevel = pi.getThinkingLevel();
							const folder = ctx.cwd.split("/").pop() || ctx.cwd;

							const right = [
								theme.fg("accent", `📁${folder}`),
								cachedBranch ? theme.fg("success", `🌿${cachedBranch}`) : "",
								thinkingLevel !== "off" ? theme.fg("warning", `🧠${thinkingLevel}`) : "",
								theme.fg("dim", `🤖${model?.id || "no model"}`),
							].filter(Boolean).join(" ");
							const padding = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));

							return [truncateToWidth(left + padding + right, width)];
						},
						invalidate() {},
					};
				});
				ctx.ui.notify("Custom footer enabled", "info");
			} else {
				ctx.ui.setFooter(undefined);
				ctx.ui.notify("Built-in footer restored", "info");
			}
		},
	});

	// Update branch on turn end
	pi.on("turn_end", async () => {
		if (isCustomFooter) {
			await updateBranch();
		}
	});
}
