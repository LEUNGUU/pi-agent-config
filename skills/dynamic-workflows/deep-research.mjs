#!/usr/bin/env node
// Composition example — the post's "deep research" pattern, built by nesting
// existing patterns: fan-out (one agent per sub-question) → adversarial verify
// (a separate agent checks each answer) → synthesize (merge into one report).
// Shows that the six patterns compose; nothing new is needed beyond the primitive.
import { runAgent, mapLimit, MODEL } from "./lib.mjs";
import { verify } from "./adversarial-verify.mjs";

const CONCURRENCY = 4;
const RUBRIC = "The answer must directly address the sub-question and be factually defensible. No hand-waving.";

export async function deepResearch({ question, subQuestions, model = MODEL }) {
  // Fan-out + adversarial verify per sub-question.
  const findings = await mapLimit(subQuestions, CONCURRENCY, async (q) => {
    const { output, passed } = await verify({ task: q, rubric: RUBRIC, model });
    return { q, output, passed };
  });

  // Synthesize barrier: merge verified findings into one report.
  const body = findings
    .map((f, i) => `## ${i + 1}. ${f.q} ${f.passed ? "" : "(⚠ unverified)"}\n${f.output}`)
    .join("\n\n");
  return runAgent({
    model,
    task: `Write a concise report answering: "${question}"\nBase it only on the verified findings below; flag any marked unverified.\n\n${body}`,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [question, ...subs] = process.argv.slice(2);
  if (!question || !subs.length) {
    console.error('usage: node deep-research.mjs "<question>" "<sub-question>" ["<sub-question>" ...]');
    process.exit(1);
  }
  deepResearch({ question, subQuestions: subs })
    .then((r) => console.log(r)).catch((e) => { console.error(e.message); process.exit(1); });
}
