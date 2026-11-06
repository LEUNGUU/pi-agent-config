---
description: Independent review by critic, verified in the main context
---
Ask one critic to review the following:

$@

subagent({ agent: "critic", task: "<the review task, with file paths or the diff command>" })

When it returns:
- Verify each finding yourself against the code before including it
- Discard false positives and say which ones you dropped
- Produce a final ranked report (critical/high/medium/low)
- End with actionable next steps
