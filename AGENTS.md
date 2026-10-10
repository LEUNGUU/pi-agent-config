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

**Default to Tavily first** for any networked task — the account has paid credits, so use it freely. A `402 Payment Required` from Tavily means the credits ran out; tell the user, then fall back.

- **Deep research / 调研 / write a report** (multi-source synthesis with citations): use `tvly research` (default `--model auto`; `--model mini` when a quick pass is enough). Slow (minutes) but thorough; the user prefers it over Exa's `agent_run` for research.
- **Search the web** (discover URLs / info from a query): use `tavily-search` first. On a rate-limit or network error (e.g. 429), fall back to `brave-search`. Don't switch back and forth within one task. For a pinpoint technical lookup (a specific GitHub issue, release tag, doc page) Exa via agent-reach (`mcporter call exa.web_search_exa`) is more precise and may be used directly.
- **Platform-specific content** (YouTube, Bilibili, GitHub, V2EX, RSS, and the login-backed platforms): use the `agent-reach` skill, which routes to the installed upstream CLI. Note: `agent-reach doctor` and Exa need `EXA_API_KEY` in the environment (`~/.env.zsh`, only sourced by interactive zsh — start pi from a zsh terminal).
- **Read a known URL**: use `tavily-extract` first — LLM-optimized markdown, handles JS-rendered pages. Fall back to `web-access` (`curl` / `r.jina.ai`, or the CDP browser) for login-walled or anti-scraping pages (小红书/微信/Twitter etc.) where Tavily fails.
- **Interactive / logged-in / JS-heavy** (click, fill, screenshot, scrape dynamic content, "the page I was just looking at"): use `web-access` — Tavily can't drive a browser.
- **Escalate, don't blindly retry**: search → extract → browser. If a layer fails, move up the chain — a search miss may mean the target doesn't exist, not "try again."

For browser-based `web-access` (CDP), Chrome and the proxy are on-demand. Run `skills/web-access/scripts/check-deps.mjs` first; if Chrome isn't connected, start it with the copied profile (Chrome 136+ refuses remote debugging on the default profile), then the proxy:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 --user-data-dir="$HOME/.cdp-chrome-profile" &
node skills/web-access/scripts/cdp-proxy.mjs &
```

## Workflow Weight

Default to plain conversation — no pipelines, no gates. Scale ceremony with vagueness and blast radius, not uniformly:

- **Clear, scoped task**: just do it.
- **Vague or large task**: discuss first ("give me options") or write a plan to `PLAN.md` / `spec.md` — a visible, editable file the human can touch, not a state machine. Get a nod, then execute in the same conversation.
- **Subagents are for read-only fan-out** (investigation, research, triage, parallel critics) — not for role-separated build pipelines. For build work, stay in the main context.
- **Verification over review**: prefer tests, typecheck, lint, and diff inspection as the quality gate. Spawn a critic only for high-stakes changes.
- **Harness engineering**: when the human corrects a recurring mistake, propose adding a line here or a check script so it can't recur.

## Model Cost Tiers

Match model to task; don't burn frontier tokens on mechanical work. Prefer `kiro/*` models. (Kiro bills in credit multipliers; rates move — re-check with `kiro-cli chat --list-models` before relying on a number here. Last synced 2026-09-13.)

- **Cheap** (`kiro/minimax-m2.1` 0.15x, `kiro/minimax-m2.5` 0.25x, `kiro/deepseek-3.2` 0.25x, `kiro/claude-haiku-4.5` 0.40x, `kiro/glm-5` 0.50x, `kiro/gpt-5.6-luna` 0.60x): mechanical/maintenance work — renames, config tweaks, format fixes, bulk edits, log triage, summarization/rewriting, read-only investigation, and small scoped code changes. **Default for fan-out subagents: `kiro/minimax-m2.1`**; reach for `gpt-5.6-luna` when the task needs the 1M window or image input (m2.x and glm are 196K/200K, text-only). Evaluated 2026-09 on code-trace, cross-file investigation, commit summarization, AND a real feature-with-tests write task: luna and m2.1 both matched sonnet-5 with zero logic defects at a fraction of the rate. Caveats: m2.1 writes correct code but failed gofmt (run gofmt after m2.1 write tasks); avoid `kiro/deepseek-3.2` for factual summaries (ordering errors).
- **Mid** (`kiro/claude-sonnet-5` 1.30x, `kiro/claude-sonnet-5.5` 1.30x): standard implementation against an existing plan or established pattern. Prefer sonnet-5.5 (newer at the same rate). On the write eval terra was the only model with a robustness nit (unguarded index), and it has since risen to 2.20x — no longer a mid-tier option.
- **Frontier** (`kiro/claude-opus-5.5` 2.00x, `kiro/claude-opus-5` 2.20x, `kiro/gpt-5.6-terra` 2.20x, `kiro/gpt-5.6-sol` 4.40x): judgment work only — planning, architecture, first-task pattern-setting (prewalk), critique, user-facing prose. opus-5.5 is the cheapest frontier option; sol at 4.40x is the most expensive general-use model.
- **Restricted** (`kiro/claude-fable-5.1` 6.00x): internal development use only — never for customer data, ITAR, or PII. Most expensive model on the platform; use only when explicitly asked.
- **Prewalk (apply automatically, no need for the human to ask)**: when a build task has 3+ similar steps/nodes, spawn `builder-frontier` (opus) to implement the FIRST one and write pattern notes, then `builder` (sonnet) for the rest following that exemplar. Small tasks: just do them or spawn `builder` alone.

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
