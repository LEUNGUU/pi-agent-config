# Critic Agent Evals

Track which of the critic agents (`critic-deepseek`, `critic-glm`, `critic-kimi`,
`critic-minimax`, `critic-agnes`) produce better reviews over time.

## How it works (mode A — semi-automatic)

Whenever **≥2 critic agents review the same target**, append one JSON line to
`evals.jsonl` per run. The main agent fills the **objective** fields (mostly
checkable facts); the human optionally fills `your_rank` (the final subjective call).

The judge is deliberately **not** any of the critics themselves (self-preferential
bias). Objective columns are graded by the orchestrating agent against the rubric;
the human is the final arbiter via `your_rank`.

## Schema (one JSON object per line)

```jsonc
{
  "date": "YYYY-MM-DD",
  "target": "what was reviewed (PR #, file, claim, ...)",
  "critics": {
    "critic-deepseek": {
      "real_issues": 3,      // distinct TRUE problems found (verified, not claimed)
      "false_positives": 1,  // flagged issues that aren't real
      "unique_finds": 1,     // true issues NO other critic caught
      "severity_accuracy": "good|ok|poor", // were severities reasonable?
      "notes": "free text"
    }
    // ... one entry per critic that participated
  },
  "your_rank": ["critic-x", "critic-y", ...], // optional human ranking, best first
  "auto_rank": ["critic-x", ...]              // derived: by score() below
}
```

## Scoring

`stats.mjs` computes a per-run score for each critic:

```
score = real_issues + 2*unique_finds - 2*false_positives + sev_bonus
        (sev_bonus: good=+1, ok=0, poor=-1)
```

Unique finds are rewarded (caught what others missed); false positives are
penalised double (noise is costly in review). Run:

```bash
node critic-evals/stats.mjs
```

It prints, across all logged runs: appearances, total/avg score, avg real issues,
avg false positives, and how often each critic was human-ranked #1.
