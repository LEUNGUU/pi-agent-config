// walkthrough: deterministic 伴读 harness.
//
// Problem: asking the model to "open files beside the user" via AGENTS.md is a
// soft rule — in long sessions the model stops following it. Same motivation
// as simpledlc: move the guarantee from prompt to code.
//
// Mechanism: while reading mode is ON, every `read` tool call automatically
// mirrors the file into a read-only Otty split (`otty view <path> --right`).
// The model needs zero cooperation: it must read a file before discussing it,
// and the harness turns that read into an open pane. Each file opens once per
// session (deduped) so repeated chunked reads don't spam panes.
//
// Usage:
//   /reading <file or topic>  — start a guided walkthrough (expands prompts/walkthrough.md)
//   /reading                  — toggle auto-open on/off without a directive
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const OTTY_CANDIDATES = ["/usr/local/bin/otty", "/Applications/Otty.app/Contents/MacOS/otty-cli"];

function ottyBin(): string | null {
	for (const p of OTTY_CANDIDATES) if (existsSync(p)) return p;
	return null;
}

// Skip files a human wouldn't want popping up while being walked through code.
const SKIP = /\.(png|jpe?g|gif|webp|bmp|ico|pdf|zip|gz|tar|jsonl|lock|min\.js|map)$/i;

export default function (pi: ExtensionAPI) {
	let enabled = false;
	const opened = new Set<string>();

	pi.on("tool_call", async (event, ctx) => {
		if (!enabled || event.toolName !== "read") return;
		const raw = (event.input as { path?: string }).path;
		if (!raw) return;
		const path = isAbsolute(raw) ? raw : resolve(ctx.cwd, raw);
		if (opened.has(path) || SKIP.test(path) || !existsSync(path)) return;
		opened.add(path);
		const bin = ottyBin();
		if (!bin) return;
		try {
			const proc = spawn(bin, ["view", path, "--right", "-q"], {
				stdio: "ignore",
				detached: true,
			});
			proc.on("error", () => {});
			proc.unref();
		} catch {}
	});

	pi.registerCommand("reading", {
		description: "伴读 harness: auto-open every file the agent reads in an Otty split (/reading <target> to start, bare /reading to toggle)",
		handler: async (args: string, ctx) => {
			const target = args.trim();
			if (target) {
				// The directive lives in prompts/walkthrough.md (same package); if it
				// was renamed/removed, "/walkthrough ..." would go to the model verbatim.
				const template = new URL("../prompts/walkthrough.md", import.meta.url).pathname;
				if (!existsSync(template)) {
					ctx.ui.notify(`prompts/walkthrough.md missing — /reading needs it (${template})`, "error");
					return;
				}
				enabled = true;
				opened.clear();
				ctx.ui.notify("Reading mode ON — files the agent reads will open in an Otty split", "info");
				// Expand prompts/walkthrough.md so the directive lives in one place.
				pi.sendUserMessage(`/walkthrough ${target}`, { expandPromptTemplates: true });
				return;
			}
			enabled = !enabled;
			if (enabled) opened.clear();
			ctx.ui.notify(`Reading mode ${enabled ? "ON" : "OFF"}`, "info");
		},
	});
}
