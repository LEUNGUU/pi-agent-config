// Shared subagent primitive (the post's "spawn one fresh-context agent" building block).
// Every workflow pattern is just this primitive driven by different control flow.
import { spawn } from "node:child_process";

// Spawn one subagent with an isolated context; resolve to its final assistant text.
// Per-spawn knobs the post calls for: model, and cwd (point at a git worktree).
export function runAgent({ task, model, cwd, systemPrompt }) {
  const args = ["--mode", "json", "-p", "--no-session"];
  if (model) args.push("--model", model);
  if (systemPrompt) args.push("--append-system-prompt", systemPrompt);
  args.push(task);

  return new Promise((resolve, reject) => {
    const proc = spawn("pi", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let buf = "", text = "", err = "";
    const onLine = (line) => {
      if (!line.trim()) return;
      let ev;
      try { ev = JSON.parse(line); } catch { return; }
      if (ev.type === "message_end" && ev.message?.role === "assistant")
        for (const p of ev.message.content) if (p.type === "text") text = p.text;
    };
    proc.stdout.on("data", (d) => {
      buf += d;
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const l of lines) onLine(l);
    });
    proc.stderr.on("data", (d) => { err += d; });
    proc.on("close", (code) => {
      if (buf.trim()) onLine(buf);
      code === 0 ? resolve(text) : reject(new Error(err || `exit ${code}`));
    });
    proc.on("error", reject);
  });
}

// Bounded-concurrency map = the deterministic barrier: wait for ALL before continuing.
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    }),
  );
  return out;
}

export const MODEL = process.env.PI_MODEL;
