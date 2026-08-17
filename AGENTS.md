# Global Guidelines

## Repo Overview

If an `ONBOARDING.md` file exists at the repo root, read it first for a code-derived overview before exploring.

If a `TERRAFORM_NOTES.md` file exists at the repo root (e.g. the `AWS_Accounts` /
`AWS_Accounts-crm` worktrees), read it first — it holds that estate's layer layout,
terraform version constraints, git rules, and pointers to per-topic docs.

## Conversational Style

- Keep answers short, concise, and technical. No fluff, no cheerful filler, no emojis in commits, issues, PR comments, or code.
- When the user asks a question, answer it first — before making edits or running implementation commands.
- When responding to user feedback or an analysis, explicitly say whether you agree or disagree before saying what you changed. Don't agree by default; if something is wrong, say so and why.

## Code Quality

- Read files in full before wide-ranging changes, before editing files you have not fully inspected, and when asked to investigate or audit. Don't rely on search snippets for broad changes — agentic search has low recall in large repos.
- Keep complexity low. Inline single-use helpers rather than factoring out a function with one call site; don't introduce abstractions until they're needed; no copy-paste duplication.
- Match the existing style and conventions of the file you're editing.
- Always ask before removing functionality or code that appears intentional.
- Where a rule can be enforced deterministically (linter, type-checker, formatter, shellcheck), run that after changes and fix all errors — soft guidance in this file alone gets ignored over long sessions.

## Git & Secrets

- Before any commit, make sure no secret is exposed. Scan the staged diff (`git diff --cached`) for API keys, tokens, passwords, private keys, and `.env`-style values. If anything looks like a credential, stop and ask before committing.
- Never stage files that typically hold secrets (`.env`, `*.pem`, `*_token`, credential/key files) unless the user explicitly says to. Stage specific files rather than `git add .`.
- Keep real secrets out of code and config — reference them via environment variables (e.g. `$AGNES_API_KEY`) or a `!cat ~/path` indirection, never inline literals.

## Python Environment

Use **uv** (`/usr/local/bin/uv`) for Python versions and venvs. Do NOT use system pip, pyenv, or conda.

- **Create venvs**: `uv venv` or `uv venv --python 3.13` to pin a version
- **Install deps**: `uv pip install -r requirements.txt`
- **Run scripts**: `uv run python script.py`
- **Installed Pythons**: 3.14.3, 3.13.12, 3.12.12, 3.11.14, 3.9.6 (system) — check with `uv python list --only-installed`
- **Install new Python**: `uv python install 3.x`

## Web Access

**Default to Tavily first** for any networked task — the account has paid credits, so use it freely.

- **Search the web** (discover URLs / info from a query): use `tavily-search` first. On a rate-limit or network error (e.g. 429), fall back to `brave-search`. Don't switch back and forth within one task.
- **Read a known URL**: use `tavily-extract` first — LLM-optimized markdown, handles JS-rendered pages. Fall back to `web-access` (`curl` / `r.jina.ai`, or the CDP browser) for login-walled or anti-scraping pages (小红书/微信/Twitter etc.) where Tavily fails.
- **Interactive / logged-in / JS-heavy** (click, fill, screenshot, scrape dynamic content, "the page I was just looking at"): use `web-access` — Tavily can't drive a browser.
- **Escalate, don't blindly retry**: search → extract → browser. If a layer fails, move up the chain — a search miss may mean the target doesn't exist, not "try again."

For browser-based `web-access` (CDP), Chrome and the proxy are on-demand. Run `skills/web-access/scripts/check-deps.mjs` first; if Chrome isn't connected, start it with the copied profile (Chrome 136+ refuses remote debugging on the default profile), then the proxy:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 --user-data-dir="$HOME/.cdp-chrome-profile" &
node skills/web-access/scripts/cdp-proxy.mjs &
```

## Interactive Terminals

To drive an *interactive* terminal program (REPL, TUI, prompt-driven installer, repainting CLI), use the `boo-terminal` skill instead of guessing with `sleep`/pipes. boo (`/usr/local/bin/boo`) runs the program in a detached PTY that survives disconnects; read the rendered screen via `peek --json` after `wait`. See `skills/boo-terminal/SKILL.md`.

- **Use boo when**: sending input to an interactive program and reading its screen back; the program needs a real TTY; or a long-running/remote session must survive detaching (e.g. `boo new s -d -- ssh host`, then drive it).
- **Don't use boo for**: simple non-interactive commands — run those directly with bash/ssh.
- The human uses tmux for their own work; the agent uses boo headlessly (`new -d` / `send` / `wait` / `peek --json` / `kill` — the prefix key never matters for automation).

## Subagents — use the `Agent` tool (DEFAULT)

Spawn subagents with the built-in `Agent` tool (backed by the `@tintinweb/pi-subagents` extension). It already gives the human live visibility, so there is no need to route subagents through boo.

- **Pass `run_in_background: true`** for anything the human may want to watch — that keeps the agent in the live widget above the editor (animated spinner, current tool activity, token/context counts). Foreground calls collapse the widget as soon as they finish.
- The human watches via two native entry points:
  - **Widget** (above the editor) — one glance shows every running subagent and what it is doing.
  - **`/agents` → conversation viewer** — select an agent to open a live-scrolling overlay of its full transcript; scroll up to pause follow, press `x` `x` to stop it mid-run.
- **`steer_subagent`** injects a message into a running agent to redirect it without restarting; the injected message and the agent's response are visible in the conversation viewer.
- Run several in parallel as separate background `Agent` calls (the extension queues them, default concurrency 4).
- Delegate only large, genuinely independent tracks of work (e.g. a wide multi-file investigation). Don't delegate what you can finish yourself in a handful of tool calls, and don't spawn subagents to verify or double-check your own work. If one subagent can do it, use one.
- boo is **not** for subagents anymore — keep it for interactive terminal programs and long-lived/detachable sessions only (see the boo-terminal skill).

## Dynamic Workflows

For long-running, massively parallel, or adversarial tasks, consider the `dynamic-workflows` skill (orchestrates fresh-context subagents; plan in code, judgment delegated). Suggest the matching pattern before grinding through it in one context:

- "do this for many items / steps" → fan-out-and-synthesize, or loop-until-done if the count is unknown
- "I don't trust this result / verify this claim" → adversarial verification (or deep-research to verify each claim)
- "give me options, pick the best" → generate-and-filter or tournament
- "route by type first" → classify-and-act

Don't over-apply: most ordinary coding tasks don't need it (it uses far more tokens). See `skills/dynamic-workflows/SKILL.md`.
