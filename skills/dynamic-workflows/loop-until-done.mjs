#!/usr/bin/env node
// Loop until done: keep spawning agents until a stop condition is met (no new
// findings), not a fixed number of passes. (The post: "For tasks with an unknown
// amount of work, loop spawning agents until a stop condition is met.")
import { runAgent, MODEL } from "./lib.mjs";

const MAX_ITERS = 10; // safety cap so an unmet condition can't loop forever.

export async function loopUntilDone({ task, model = MODEL, maxIters = MAX_ITERS }) {
  const found = [];
  for (let i = 0; i < maxIters; i++) {
    const prior = found.length ? `\n\nAlready found (do NOT repeat):\n${found.join("\n")}` : "";
    const out = await runAgent({
      model,
      task: `${task}\n\nReport only NEW findings not listed below. If there are none, reply with exactly "DONE".${prior}`,
    });
    if (/^\s*DONE\s*$/i.test(out)) break;
    found.push(out.trim());
  }
  return found;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const task = process.argv[2];
  if (!task) { console.error('usage: node loop-until-done.mjs "<task>"'); process.exit(1); }
  loopUntilDone({ task })
    .then((r) => console.log(r.map((f, i) => `[pass ${i + 1}]\n${f}`).join("\n\n")))
    .catch((e) => { console.error(e.message); process.exit(1); });
}
