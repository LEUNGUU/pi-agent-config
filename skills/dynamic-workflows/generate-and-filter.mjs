#!/usr/bin/env node
// Generate-and-filter: generate many candidates, then a filter agent dedupes and
// keeps only the highest-quality ones by a rubric. (The post: "Generate a number
// of ideas... then filter them by a rubric or by verification, dedupe duplicates
// and return only the highest quality, tested ideas.")
import { runAgent, mapLimit, MODEL } from "./lib.mjs";

const CONCURRENCY = 4;

export async function generateAndFilter({ topic, rubric, n = 6, keep = 3, model = MODEL }) {
  // Generate n candidates in parallel (fresh contexts → more diversity).
  const ideas = await mapLimit(Array.from({ length: n }), CONCURRENCY, (_x, i) =>
    runAgent({ model, task: `Propose ONE distinct idea for: ${topic}. Be specific. (variant ${i + 1})` }),
  );
  const list = ideas.map((x, i) => `${i + 1}. ${x}`).join("\n");
  return runAgent({
    model,
    task: `From the candidate ideas below, dedupe near-duplicates and keep only the top ${keep} by this rubric:\n${rubric}\n\nReturn the ${keep} survivors with a one-line justification each.\n\nCANDIDATES:\n${list}`,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [topic, rubric] = process.argv.slice(2);
  if (!topic || !rubric) { console.error('usage: node generate-and-filter.mjs "<topic>" "<rubric>"'); process.exit(1); }
  generateAndFilter({ topic, rubric })
    .then((r) => console.log(r)).catch((e) => { console.error(e.message); process.exit(1); });
}
