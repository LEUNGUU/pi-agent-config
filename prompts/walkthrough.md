---
description: Guided code walkthrough (伴读) — opens files in Otty panes, explains block by block
---
Walk me through the following code, as a guided reading session (伴读):

$@

Rules for the session:

1. First give a one-paragraph orientation: what this code does overall, and the reading order
   you propose (dependency order — leaf utilities → callers → entry point). List the files as
   `path` lines so I can ⌘-click them.
2. Then walk ONE file (or one function/block for large files) per turn:
   - Open it beside me first: `otty view <absolute-path> --right` (reuse the same split).
   - Cite every location you discuss as a bare `path:line` on its own line — no long code dumps;
     quote at most a few key lines.
   - Explain what it does, why it exists, and anything surprising (edge cases, gotchas,
     non-obvious design choices).
   - End the turn with what you'd cover next, then STOP and wait for me.
3. If I reply with just a `path:line`, treat it as "explain this location in context".
4. If I say "continue" / "继续", move to the next unit in the plan.
