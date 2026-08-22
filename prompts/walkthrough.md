---
description: Guided code walkthrough (伴读) — explains code block by block; /reading dispatches this with the pane-opening harness enabled
---
Walk me through the following, as a guided reading session (伴读): $@

Rules for the session:

1. Start with a one-paragraph orientation: what this code does overall, and the reading order
   you propose (dependency order — leaf utilities → callers → entry point). List the files as
   `path` lines so I can ⌘-click them.
2. Walk ONE file (or one function/block for large files) per turn. Read the file with the
   read tool first, then explain: what it does, why it exists, edge cases, gotchas,
   non-obvious design choices. Quote at most a few key lines — no long code dumps.
3. Cite every location you discuss as a bare `path:line` on its own line (⌘-clickable for me).
4. File panes: a harness normally mirrors every file you `read` into a pane beside me
   automatically — do NOT run `otty view` yourself unless I tell you panes are not opening;
   only then open each file with `otty view <absolute-path> --right` before discussing it.
5. End each turn with what you'd cover next, then STOP and wait for me.
6. If I reply with just a `path:line`, treat it as "explain this location in context".
7. If I say "continue" / "继续", move to the next unit in the plan.
