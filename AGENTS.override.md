# pi-agent-config (repo-local override)

This repo IS the global pi config: `setup.sh` symlinks `settings.json`,
`AGENTS.md`, and `agents/*.md` into `~/.pi/agent/`, and installs the repo as a
pi package (extensions, skills, prompts, themes).

This file exists because the global AGENTS.md is a symlink to `./AGENTS.md` —
without an override, working inside this repo would load the same guidelines
twice (global layer + project layer). Global guidelines still apply.

Repo-specific rules:

- `settings.json` is live config: pi writes through the symlink, so runtime
  changes (`/settings`, changelog bumps) appear as a dirty working tree here.
  Commit them; don't treat the diff as noise.
- `models.json` is a seed copy, NOT symlinked — the live one at
  `~/.pi/agent/models.json` holds machine-specific endpoints. Never commit
  real gateway IPs or keys; the repo is public.
- Extensions are loaded at pi startup; changes here need a new session to
  take effect. Syntax-check with `bun build --no-bundle <file>`.
- `extensions/walkthrough.ts` (`/reading`) depends on `prompts/walkthrough.md`
  via `expandPromptTemplates` — keep the two in sync if renaming either.
