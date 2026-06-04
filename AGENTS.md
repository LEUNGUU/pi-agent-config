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

- **Search the web** (discover URLs / info from a query): use `tavily-search` by default. On a quota/credit/rate-limit error (e.g. 429), fall back to `brave-search`. Don't switch back and forth within one task.
- **Read a known URL**: use `web-access` directly — do NOT spend Tavily/Brave credits on extraction. For a static page, `web-access` can fetch cheaply via `curl` / `r.jina.ai` (no browser needed); for JS-rendered, login-walled, or anti-scraping pages (小红书/微信/Twitter etc.) it uses the browser via CDP. Use `tavily-extract` only as a last-resort fetch fallback.
- **Interactive / logged-in / JS-heavy** (click, fill, screenshot, scrape dynamic content, "the page I was just looking at"): use `web-access`.

For any `web-access` task that needs the browser (CDP), the debug Chrome and CDP proxy are **on-demand, not persistent** — they don't survive a reboot or Chrome quit. Before such a task, run `skills/web-access/scripts/check-deps.mjs`; if Chrome isn't connected, start it with the copied debug profile, then the proxy:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 --user-data-dir="$HOME/.cdp-chrome-profile" &
node skills/web-access/scripts/cdp-proxy.mjs &
```

Chrome 136+ refuses remote debugging on the default profile, so the copied profile at `~/.cdp-chrome-profile` (which carries login state) is required. Static fetches (curl / Jina) do not need Chrome or the proxy.

**Escalate, don't blindly retry**: search → extract → browser. If a layer fails, move up the chain rather than re-running the same call — a search miss may mean the target doesn't exist, not "try again."

## Dynamic Workflows

When a task is long-running, massively parallel, or adversarial, proactively consider the `dynamic-workflows` skill (orchestrates many fresh-context subagents; plan in code, judgment delegated). Watch for these signals and suggest the matching pattern before grinding through it in one context:

- "do this for many items / steps" → fan-out-and-synthesize, or loop-until-done if the count is unknown
- "I don't trust this result / verify this claim" → adversarial verification (or deep-research to verify each claim)
- "give me options, pick the best" → generate-and-filter or tournament
- "route by type first" → classify-and-act

Don't over-apply: most ordinary coding tasks don't need it (it uses far more tokens). See `skills/dynamic-workflows/SKILL.md`.
