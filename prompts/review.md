---
description: Multi-model adversarial review (MiniMax, GLM, Kimi, DeepSeek)
---
Spawn 4 critic agents in background using the Agent tool. Each should review the following:

$@

Spawn all 4 in parallel:

1. Agent({ subagent_type: "critic-minimax", prompt: "<the review task>", description: "MiniMax review", run_in_background: true })
2. Agent({ subagent_type: "critic-glm", prompt: "<the review task>", description: "GLM review", run_in_background: true })
3. Agent({ subagent_type: "critic-kimi", prompt: "<the review task>", description: "Kimi review", run_in_background: true })
4. Agent({ subagent_type: "critic-deepseek", prompt: "<the review task>", description: "DeepSeek review", run_in_background: true })

Once all 4 complete, use get_subagent_result to collect their findings, then synthesize:
- Issues flagged by 2+ models are confirmed problems
- Issues flagged by only 1 model: do your own quick verification before including
- Discard clear false positives
- Produce a final ranked report (critical/high/medium/low)
- For each issue, note which models flagged it
- End with actionable next steps
