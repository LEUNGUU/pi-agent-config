#!/usr/bin/env node
// Classify-and-act: a classifier agent picks the task type, then we route to the
// matching handler agent. (The post: "Use a classifier agent to decide on the
// type of task, and then route to different agents or behavior.")
import { runAgent, MODEL } from "./lib.mjs";

export async function classifyAndAct({ task, routes, model = MODEL }) {
  const labels = Object.keys(routes);
  const label = (await runAgent({
    model,
    task: `Classify this task into exactly one label from [${labels.join(", ")}]. Reply with ONLY the label.\n\nTask: ${task}`,
  })).trim();
  const chosen = labels.find((l) => label.toLowerCase().includes(l.toLowerCase())) ?? labels[0];
  const out = await runAgent({ model, task: routes[chosen](task) });
  return { label: chosen, output: out };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const task = process.argv[2];
  if (!task) { console.error('usage: node classify-and-act.mjs "<task>"'); process.exit(1); }
  // Demo routes: each value builds the prompt for that branch.
  const routes = {
    bug: (t) => `Diagnose this bug and propose a fix:\n${t}`,
    feature: (t) => `Outline an implementation plan for this feature:\n${t}`,
    question: (t) => `Answer this question concisely:\n${t}`,
  };
  classifyAndAct({ task, routes })
    .then((r) => console.log(`[${r.label}]\n${r.output}`))
    .catch((e) => { console.error(e.message); process.exit(1); });
}
