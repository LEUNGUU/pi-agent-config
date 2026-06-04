#!/usr/bin/env node
// Tournament: N agents each attempt the same task with different approaches, then
// a judge agent compares them pairwise until one winner remains. (The post: "Spawn
// N agents that each attempt the same task using different approaches. Prompts or
// models then judge the results in a pairwise fashion using a judging agent.")
import { runAgent, mapLimit, MODEL } from "./lib.mjs";

const CONCURRENCY = 4;

// Pairwise judge: return the index (0 or 1) of the better contender.
async function judge(task, a, b, model) {
  const v = await runAgent({
    model,
    task: `Two attempts at the same task. Pick the better one. Reply with ONLY "A" or "B".\n\nTASK:\n${task}\n\nA:\n${a}\n\nB:\n${b}`,
  });
  return /\bB\b/i.test(v) && !/\bA\b/i.test(v) ? 1 : 0;
}

export async function tournament({ task, n = 4, model = MODEL }) {
  // Each contender attempts the task with a distinct approach hint.
  let field = await mapLimit(Array.from({ length: n }), CONCURRENCY, (_x, i) =>
    runAgent({ model, task: `${task}\n\n(Use approach #${i + 1}, distinct from other attempts.)` }),
  );
  // Single-elimination: deterministic bracket held in code; only judging is delegated.
  while (field.length > 1) {
    const next = [];
    for (let i = 0; i < field.length; i += 2) {
      if (i + 1 >= field.length) { next.push(field[i]); continue; }
      next.push(field[i + (await judge(task, field[i], field[i + 1], model))]);
    }
    field = next;
  }
  return field[0];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const task = process.argv[2];
  if (!task) { console.error('usage: node tournament.mjs "<task>"'); process.exit(1); }
  tournament({ task }).then((r) => console.log(r)).catch((e) => { console.error(e.message); process.exit(1); });
}
