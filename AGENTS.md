# Global Guidelines

## Conversational Style

- No emojis in commits, issues, PR comments, or code.
- When the user asks a question, answer it. Read-only lookups (reading files, read-only commands) to answer are fine; don't modify anything unless the user explicitly asks for action.
- When responding to user feedback or an analysis, explicitly say whether you agree or disagree. Don't agree by default; if something is wrong, say so and why.

## Git & Secrets

- Keep real secrets out of code and config — reference them via environment variables (e.g. `$AGNES_API_KEY`) or a `!cat ~/path` indirection, never inline literals.

## Python Environment

Use **uv** (`/usr/local/bin/uv`) for Python versions and venvs. Do NOT use system pip, pyenv, or conda.

- **Create venvs**: `uv venv` or `uv venv --python 3.13` to pin a version
- **Install deps**: `uv pip install -r requirements.txt`
- **Run scripts**: `uv run python script.py`
- **Installed Pythons**: 3.14.3, 3.13.12, 3.12.12, 3.11.14, 3.9.6 (system) — check with `uv python list --only-installed`
- **Install new Python**: `uv python install 3.x`

## Web Access

Tavily first (paid credits). A `402` means credits ran out: tell the user, then fall back.

| Task | Use | Fallback |
|---|---|---|
| Deep research / report | `tvly research` (`--model mini` for a quick pass) | — |
| Web search | `tavily-search` | `brave-search` on 429 / network error. Pinpoint lookups (GitHub issue, release tag, doc page): Exa via `mcporter call exa.web_search_exa` |
| Read a known URL | `tavily-extract` | `web-access` for login-walled / anti-scraping pages |
| YouTube, Bilibili, GitHub, V2EX, RSS, login platforms | `agent-reach` | — |
| Click, fill, screenshot, logged-in pages | `web-access` (CDP browser) | — |

This table overrides agent-reach's "MUST USE for any research": use it only for the platforms above. It and Exa need `EXA_API_KEY` from `~/.env.zsh`, so start pi from zsh. If a layer fails, escalate (search → extract → browser) instead of retrying.

CDP Chrome is on-demand: run `skills/web-access/scripts/check-deps.mjs`; if not connected, start Chrome with the copied profile (Chrome 136+ refuses remote debugging on the default one), then the proxy:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 --user-data-dir="$HOME/.cdp-chrome-profile" &
node skills/web-access/scripts/cdp-proxy.mjs &
```

## Workflow Weight

Default to plain conversation — no pipelines, no gates. Scale ceremony with vagueness and blast radius, not uniformly:

- **Clear, scoped task**: just do it.
- **Vague or large task**: discuss first ("give me options") or write a plan to `PLAN.md` / `spec.md` — a visible, editable file the human can touch, not a state machine. Get a nod, then execute in the same conversation.
- **Subagents**: read-only fan-out (investigation, research, triage, parallel critics), plus prewalk for repetitive build work (see Model Cost Tiers). Other build work stays in the main context.
- **Verification over review**: prefer tests, typecheck, lint, and diff inspection as the quality gate. Spawn a critic only for high-stakes changes.
- **Harness engineering**: when the human corrects a recurring mistake, propose adding a line here or a check script so it can't recur.

## Model Cost Tiers

When spawning a subagent or workflow agent, set `model` to the cheapest tier that fits. Every agent type (`agents/*.md`, including the overrides of the built-in general-purpose / Plan / Explore) pins a default, so unset is already cheap; set `model` only to go up a tier for a harder task. Spawning on a Fable model triggers a confirm dialog (`permission-gate.ts`).

- Cheap: mechanical work, read-only investigation, small scoped changes. Default `kiro/minimax-m2.1`; `kiro/gpt-5.6-luna` for a 1M window or images. Run gofmt after m2.1 writes; don't use `kiro/deepseek-3.2` for factual summaries.
- Mid: `kiro/claude-sonnet-5.5`, for implementation against a plan or existing pattern.
- Frontier: `kiro/claude-opus-5.5`, for planning, architecture, critique, user-facing prose.
- Restricted: `kiro/claude-fable-5.1`, only when explicitly asked; never customer data, ITAR or PII.
- Prewalk (automatic, no need to ask): a build task with 3+ similar steps gets `builder-frontier` for the first one plus pattern notes, then `builder` for the rest. Smaller build tasks: do them yourself.

## Subagents — use the `Agent` tool (DEFAULT)

Spawn subagents with the built-in `Agent` tool (backed by the `@tintinweb/pi-subagents` extension). It already gives the human live visibility.

- **Pass `run_in_background: true`** for anything the human may want to watch — that keeps the agent in the live widget above the editor (animated spinner, current tool activity, token/context counts). Foreground calls collapse the widget as soon as they finish.
- The human watches via two native entry points:
  - **Widget** (above the editor) — one glance shows every running subagent and what it is doing.
  - **`/agents` → conversation viewer** — select an agent to open a live-scrolling overlay of its full transcript; scroll up to pause follow, press `x` `x` to stop it mid-run.
- **`steer_subagent`** injects a message into a running agent to redirect it without restarting; the injected message and the agent's response are visible in the conversation viewer.
- Run several in parallel as separate background `Agent` calls (the extension queues them, default concurrency 4).
- Delegate only large, genuinely independent tracks of work (e.g. a wide multi-file investigation). Don't delegate what you can finish yourself in a handful of tool calls, and don't spawn subagents to verify or double-check your own work. If one subagent can do it, use one.
- **The Agent tool's `isolation: "worktree"` is unreliable** (observed 2026-09: four "isolated" agents all ran in the main checkout and clobbered each other). For parallel write work, create worktrees manually (`git worktree add /tmp/wt-<name> <ref> --detach`) and hard-code the path in each agent's prompt ("Work ONLY inside /tmp/wt-x; cd there first"). Verify `git status` in the main checkout afterwards.

## Code Walkthroughs (伴读)

Prefer the `/reading <target>` command — it starts a harness that auto-opens every file the
agent reads in an Otty split, so pane-opening is guaranteed by code, not by the model.

When the user asks to be walked through code in plain language ("带我读", "walk me through",
"伴读") without the command, suggest `/reading` once, then follow these rules:

- Cite every code location as a bare `path:line` (e.g. `src/foo.py:87`) on its own line — Otty makes
  these ⌘-clickable. Prefer `path:line` anchors over pasting long code blocks into chat.
- Walk one function/block at a time, in dependency order (leaf utilities → callers → entry point).
  After each unit, stop and wait for questions — do not dump the whole tour in one turn.
- The user may reply with just a `path:line` — treat that as "explain this location": read the
  surrounding code and explain it in context.
- If reading mode is off (no harness), also open each file beside the user before discussing it:
  `otty view <absolute-path> --right` (fall back to just citing paths if the command fails).

## Dynamic Workflows

For long-running, massively parallel, or adversarial tasks, consider the `dynamic-workflows` skill (orchestrates fresh-context subagents; plan in code, judgment delegated). Suggest the matching pattern before grinding through it in one context:

- "do this for many items / steps" → fan-out-and-synthesize, or loop-until-done if the count is unknown
- "I don't trust this result / verify this claim" → adversarial verification (or deep-research to verify each claim)
- "give me options, pick the best" → generate-and-filter or tournament
- "route by type first" → classify-and-act

Don't over-apply: most ordinary coding tasks don't need it (it uses far more tokens). See `skills/dynamic-workflows/SKILL.md`.
