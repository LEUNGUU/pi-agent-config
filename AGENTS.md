# Global Guidelines

## Repo Overview

If an `ONBOARDING.md` file exists at the repo root, read it first for a code-derived overview of the project's purpose, architecture, and conventions before exploring.

## Python Environment

This machine uses **uv** (`/usr/local/bin/uv`) for Python version management and virtual environments. Do NOT use system pip, pyenv, or conda.

- **Create venvs**: `uv venv` or `uv venv --python 3.13` to pin a version
- **Install deps**: `uv pip install -r requirements.txt`
- **Run scripts**: `uv run python script.py`
- **Installed Pythons**: 3.14.3, 3.13.12, 3.12.12, 3.11.14, 3.9.6 (system) — check with `uv python list --only-installed`
- **Install new Python**: `uv python install 3.x`

## Web Access

Choosing the right skill for networked tasks:

- **Search the web** (discover URLs / info from a query): use `tavily-search` by default — the account has paid credits, so use it freely. On a rate-limit or network error (e.g. 429), fall back to `brave-search`. Don't switch back and forth within one task.
- **Read a known URL**: prefer `web-access` for a static page — its `curl` / `r.jina.ai` fetch is faster and cheaper on tokens (no browser needed); for JS-rendered, login-walled, or anti-scraping pages (小红书/微信/Twitter etc.) it uses the browser via CDP. `tavily-extract` is a fine alternative when you want LLM-optimized markdown.
- **Interactive / logged-in / JS-heavy** (click, fill, screenshot, scrape dynamic content, "the page I was just looking at"): use `web-access`.

For any `web-access` task that needs the browser (CDP), the debug Chrome and CDP proxy are **on-demand, not persistent** — they don't survive a reboot or Chrome quit. Before such a task, run `skills/web-access/scripts/check-deps.mjs`; if Chrome isn't connected, start it with the copied debug profile, then the proxy:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 --user-data-dir="$HOME/.cdp-chrome-profile" &
node skills/web-access/scripts/cdp-proxy.mjs &
```

Chrome 136+ refuses remote debugging on the default profile, so the copied profile at `~/.cdp-chrome-profile` (which carries login state) is required. Static fetches (curl / Jina) do not need Chrome or the proxy.

**Escalate, don't blindly retry**: search → extract → browser. If a layer fails, move up the chain rather than re-running the same call — a search miss may mean the target doesn't exist, not "try again."

## Interactive Terminals

When a task needs to drive an *interactive* terminal program — a REPL, a TUI, a prompt-driven installer, or any long-running CLI that repaints and waits for keystrokes — use the `boo-terminal` skill instead of guessing with `sleep`/pipes. boo (`/usr/local/bin/boo`) is a local terminal multiplexer: it runs the program in a detached PTY session, so the process survives client disconnects, and you read the *rendered* screen deterministically via `peek --json` after `wait`. See `skills/boo-terminal/SKILL.md`.

- **Use boo when**: starting an interactive program, sending it input and reading its screen back; the program needs a real TTY; or a long-running/remote interactive session must survive your terminal detaching (e.g. `boo new s -d -- ssh host`, then drive it).
- **Don't use boo for**: simple non-interactive commands — run those directly with bash/ssh. 
- The human uses tmux for their own interactive work; the agent uses boo (driven headlessly via `new -d` / `send` / `wait` / `peek --json` / `kill` — the prefix key never matters for automation).

## Dynamic Workflows

When a task is long-running, massively parallel, or adversarial, proactively consider the `dynamic-workflows` skill (orchestrates many fresh-context subagents; plan in code, judgment delegated). Watch for these signals and suggest the matching pattern before grinding through it in one context:

- "do this for many items / steps" → fan-out-and-synthesize, or loop-until-done if the count is unknown
- "I don't trust this result / verify this claim" → adversarial verification (or deep-research to verify each claim)
- "give me options, pick the best" → generate-and-filter or tournament
- "route by type first" → classify-and-act

Don't over-apply: most ordinary coding tasks don't need it (it uses far more tokens). See `skills/dynamic-workflows/SKILL.md`.
