#!/usr/bin/env node
// Adversarial verification: produce an output, then a SEPARATE agent adversarially
// checks it against a rubric. (The post: "For each spawned agent, run a separate
// spawned agent to adversarially verify its output against a rubric or criteria.")
import { runAgent, MODEL } from "./lib.mjs";

export async function verify({ task, rubric, model = MODEL }) {
  const output = await runAgent({ model, task });
  const verdict = await runAgent({
    model,
    task: `You are an adversarial reviewer. Check the OUTPUT against the RUBRIC. Try to find flaws. End with a line "VERDICT: PASS" or "VERDICT: FAIL".\n\nRUBRIC:\n${rubric}\n\nTASK:\n${task}\n\nOUTPUT:\n${output}`,
  });
  return { output, verdict, passed: /VERDICT:\s*PASS/i.test(verdict) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [task, rubric] = process.argv.slice(2);
  if (!task || !rubric) { console.error('usage: node adversarial-verify.mjs "<task>" "<rubric>"'); process.exit(1); }
  verify({ task, rubric })
    .then((r) => console.log(`OUTPUT:\n${r.output}\n\n--- REVIEW (${r.passed ? "PASS" : "FAIL"}) ---\n${r.verdict}`))
    .catch((e) => { console.error(e.message); process.exit(1); });
}
