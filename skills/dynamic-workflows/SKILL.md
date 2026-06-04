---
name: dynamic-workflows
description: "Orchestrate multiple pi subagents with deterministic control flow — the plan lives in code, judgment is delegated to fresh-context subagents. Use when a task is long-running, massively parallel, or adversarial and benefits from isolated subagent contexts: fan-out-and-synthesize (split a task into parallel steps then merge), classify-and-act (route by task type), adversarial verification (a separate agent checks each output against a rubric), generate-and-filter (many candidates, keep the best), tournament (N approaches compete, judged pairwise), loop-until-done (spawn until a stop condition), and deep-research (compose fan-out + verify + synthesize). Mitigates agentic laziness, self-preferential bias, and goal drift."
---

# Dynamic Workflows

Implements the six orchestration patterns from Thariq Shihipar's "A harness for every
task: dynamic workflows in Claude Code", ported to pi.
Source: https://x.com/trq212/status/2061907337154367865

The idea: instead of one Claude
planning and executing in a single context window (prone to **agentic laziness**,
**self-preferential bias**, **goal drift**), the *plan lives in deterministic code* and
each step is a fresh-context subagent that returns only its result.

All patterns share one primitive in `lib.mjs`:
- `runAgent({ task, model?, cwd?, systemPrompt? })` — spawns one `pi --mode json -p --no-session`
  process (isolated context), resolves to its final assistant text. `model` chooses the
  model per spawn; `cwd` points the subagent at a directory (e.g. a git worktree).
- `mapLimit(items, limit, fn)` — bounded-concurrency map = the deterministic barrier.

Each script is both a CLI (run directly) and an ES module (`export`ed for composition).
Requires `pi` on PATH. Set `PI_MODEL=<model>` to override the model (provider must be configured).

## Patterns

| Script | Pattern | CLI |
|--------|---------|-----|
| `fanout-synthesize.mjs` | Split into parallel steps → barrier → merge | `node fanout-synthesize.mjs "<goal>" "<step>"...` |
| `classify-and-act.mjs` | Classifier picks type → route to handler | `node classify-and-act.mjs "<task>"` |
| `adversarial-verify.mjs` | Output → separate agent checks vs rubric (PASS/FAIL) | `node adversarial-verify.mjs "<task>" "<rubric>"` |
| `generate-and-filter.mjs` | Parallel N candidates → dedupe, keep top K by rubric | `node generate-and-filter.mjs "<topic>" "<rubric>"` |
| `tournament.mjs` | N approaches compete → judge pairwise to a winner | `node tournament.mjs "<task>"` |
| `loop-until-done.mjs` | Spawn until "DONE" (capped by maxIters) | `node loop-until-done.mjs "<task>"` |
| `deep-research.mjs` | Composition: fan-out + verify-each + synthesize | `node deep-research.mjs "<question>" "<sub-q>"...` |

## Composition

Patterns nest — that's the point. `deep-research.mjs` imports `verify` from
`adversarial-verify.mjs` and runs it inside a `mapLimit` fan-out, then synthesizes.
Build your own by importing the exported functions:

```js
import { fanoutSynthesize } from "./fanout-synthesize.mjs";
import { verify } from "./adversarial-verify.mjs";
```

## Worktree isolation

To run subagents in isolated git worktrees (for parallel edits/refactors), create a
worktree with the `git-worktree` skill and pass its path as `cwd` to `runAgent`:

```bash
bash skills/git-worktree/scripts/worktree-manager.sh create <branch>
# then: runAgent({ task, cwd: ".worktrees/<branch>" })
```

## When NOT to use

These spawn many subagents and use significantly more tokens. Most ordinary coding
tasks don't need a panel of reviewers — only reach for a workflow when the task is
genuinely long-running, parallel, or adversarial.
