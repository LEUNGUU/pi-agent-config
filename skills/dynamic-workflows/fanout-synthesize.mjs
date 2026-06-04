#!/usr/bin/env node
// Fan-out-and-synthesize: split a task into steps, run one agent per step in
// parallel, then a synthesis agent merges all results at a barrier.
import { runAgent, mapLimit, MODEL } from "./lib.mjs";

const CONCURRENCY = 4;

export async function fanoutSynthesize({ goal, steps, model = MODEL, synthModel }) {
  const results = await mapLimit(steps, CONCURRENCY, (task) => runAgent({ task, model }));
  const merged = steps.map((s, i) => `## Step ${i + 1}: ${s}\n${results[i]}`).join("\n\n");
  return runAgent({
    model: synthModel ?? model,
    task: `Goal: ${goal}\n\nMerge these ${steps.length} sub-results into one coherent result. Resolve overlaps, keep only what serves the goal.\n\n${merged}`,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [goal, ...steps] = process.argv.slice(2);
  if (!goal || !steps.length) {
    console.error('usage: node fanout-synthesize.mjs "<goal>" "<step>" ["<step>" ...]');
    process.exit(1);
  }
  fanoutSynthesize({ goal, steps }).then((r) => console.log(r)).catch((e) => { console.error(e.message); process.exit(1); });
}
