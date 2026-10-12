# Global Guidelines

## Conversation

- A question gets an answer; read-only lookups are fine, but don't modify anything unless asked.
- When responding to feedback or an analysis, say explicitly whether you agree or disagree, and why.

## Git & Secrets

- Keep real secrets out of code and config — reference them via environment variables (e.g. `$AGNES_API_KEY`) or a `!cat ~/path` indirection, never inline literals.

## Python Environment

Use **uv** (`/usr/local/bin/uv`) for Python versions and venvs. Do NOT use system pip, pyenv, or conda.

## Web Access

Before any web task (search, URL, YouTube/GitHub/login platforms, browser clicks), read the "Web routing" section of `~/.pi/agent/skills/tavily-search/SKILL.md`: it picks the tool and the fallbacks.

## Subagents

Read-only, via the `subagent` tool: `Explore` for noisy searches, `critic-deepseek` for high-stakes review. All writes stay in the main context; verify an agent's key claims before relying on them.
