# Global Guidelines

## Conversation

- A question gets an answer; read-only lookups are fine, but don't modify anything unless asked.
- When responding to feedback or an analysis, say explicitly whether you agree or disagree, and why.

## Git & Secrets

- Keep real secrets out of code and config — reference them via environment variables (e.g. `$AGNES_API_KEY`) or a `!cat ~/path` indirection, never inline literals.

## GitHub Research

- Public pages and raw files do not require `gh`. Authenticated GitHub research must use `GITHUB_RESEARCH_TOKEN` (LEUNGUU), not saved personal credentials.
- Prefix every research `gh` command with `GH_TOKEN="${GITHUB_RESEARCH_TOKEN:?Research token is missing}"`. Missing, rejected, or insufficient credentials mean stop and ask; never fall back to another token or the saved login.
- Do not run `gh auth login`, `gh auth logout`, or `gh auth switch`, or globally export `GH_TOKEN`, for research. Never print or store token values.
- Research is read-only. Writes, cloning, or syncing require explicit approval; Git SSH credentials are separate from API tokens.

## Python Environment

Use **uv** (`/usr/local/bin/uv`) for Python versions and venvs. Do NOT use system pip, pyenv, or conda.

## Web Access

Before any web task (search, URL, YouTube/GitHub/login platforms, browser clicks), read the "Web routing" section of `~/.pi/agent/skills/tavily-search/SKILL.md`: it picks the tool and the fallbacks.

Do not read or import browser cookies, start sign-in, or install platform tools without explicit approval. Use only user-authorized browser sessions for login-required content.

## Subagents

Read-only, via the `subagent` tool: `Explore` for noisy searches, `critic` for high-stakes review. All writes stay in the main context; verify an agent's key claims before relying on them.
