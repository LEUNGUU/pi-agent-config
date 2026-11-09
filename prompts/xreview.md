---
description: Give one task to Claude Code, Codex and Kiro (Claude, GPT), one Otty tab each, then merge and check their answers
argument-hint: "<task> [--uncommitted | --commit <sha> | --base <ref> | --range <a>..<b>]"
---
Run this task across several coding agents: $@

1. Write the task, in the user's words plus any context the agents need, to a
   temp file. If the task is about a git change, also pick the matching diff
   scope flag. Then run, from the working directory, and let it block (allow
   up to 35 minutes):

       node ~/development/github.com/LEUNGUU/pi-agent-config/otty/xreview.mjs [scope flag] --task-file <file>

   With a scope flag and no task file, the agents do a bug-focused code review.
   It opens one Otty tab per agent (`xreview: <name>`), gives each the same
   task read-only, waits for all, and prints each agent's status, reply file
   and `otty://` link, plus `summary.json`.
2. Say which agents failed and why (throttled, needs an answer in its tab, no
   reply). Never answer an agent's question for the user.
3. Read every reply. Merge what they agree on, and show where they disagree
   and which agent said what.
4. Check each claim you can check yourself (against the code, docs or a quick
   command) before you rely on it. Drop what does not hold up, and say what
   you dropped and why. For a review, rank findings critical/high/medium/low
   with file:line.
5. Give your own conclusion, with the agents' tab links for the points that
   came from them.
6. End with next steps. The tabs stay open: the user can keep talking to every
   agent there, including the two Kiro tabs. Close the tabs only when the user
   asks.
