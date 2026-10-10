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

## Workflow

Default to plain conversation: no pipelines, no gates. Scale ceremony with vagueness and blast radius.

- Clear, scoped task: just do it. Vague or large: discuss first or write a plan to `PLAN.md` / `spec.md`, get a nod, then execute in the same conversation.
- Verification over review: tests, typecheck, lint, diff inspection are the quality gate. A critic subagent is for high-stakes changes only.
- When the human corrects a recurring mistake, propose a line here or a check script so it can't recur.
- Subagents: read-only fan-out (investigation, research, triage, parallel critics) and prewalk. Other build work stays in the main context. Don't delegate what a handful of tool calls would finish, and don't spawn subagents to verify your own work.
- Prewalk (automatic): a build task with 3+ similar steps gets `builder-frontier` for the first one plus pattern notes, then `builder` for the rest.
- Model tiers: every agent type pins a cheap default, so set `model` only to go up. Mid `kiro/claude-sonnet-5.5` for implementation against a plan; frontier `kiro/claude-opus-5.5` for planning, architecture, critique, user-facing prose; `kiro/claude-fable-5.1` only when explicitly asked, never customer data, ITAR or PII. Run gofmt after `minimax-m2.1` writes; no `deepseek-3.2` for factual summaries.
