---
description: Cross-review a change with Claude Code, Codex, Kiro and Pi (Grok), one Otty tab each
argument-hint: "<--uncommitted | --commit <sha> | --base <ref> | a..b> [focus]"
---
Cross-review this change: $@

1. Run, from the repository root, and let it block (allow up to 35 minutes):

       node ~/development/github.com/LEUNGUU/pi-agent-config/otty/xreview.mjs $@

   It opens one Otty tab per reviewer (`xreview: <name>`), sends each the same
   diff and prompt read-only, waits for all, and prints each reviewer's status,
   reply file and `otty://` link, plus `summary.json`.
2. Say which reviewers failed and why (throttled, needs an answer in its tab,
   no reply). Never answer a reviewer's question for the user.
3. Read every reply file. Merge duplicate findings and note which reviewers
   raised each one.
4. Verify each finding yourself against the code before keeping it. Drop false
   positives and say which ones you dropped and why.
5. Report the findings ranked critical/high/medium/low, each with file:line,
   the reviewers that raised it, and the reviewer's tab link.
6. End with next steps. The tabs stay open: the user can keep talking to
   Claude, Codex and Grok there. For Kiro, run
   `kiro-cli chat --no-interactive --resume --trust-tools=fs_read "<question>"`
   in its tab. Close the tabs only when the user asks.
