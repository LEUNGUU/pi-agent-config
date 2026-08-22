# Pi Coding Agent Config

Personal configuration and pi package for [pi-coding-agent](https://github.com/badlogic/pi-mono).

## Install as Pi Package

```bash
pi install git:git@github.com:LEUNGUU/pi-agent-config
```

This loads extensions, skills, prompts, and themes automatically.

## Full Personal Setup

```bash
git clone git@github.com:LEUNGUU/pi-agent-config.git ~/pi-agent-config
cd ~/pi-agent-config
./setup.sh
```

What `setup.sh` does:

- **Symlinks** `settings.json`, `AGENTS.md`, and `agents/*.md` into `~/.pi/agent/`.
  The repo working tree IS the live config: pi writes settings through the
  symlink, so runtime changes (`/settings`, changelog bumps) show up as a dirty
  working tree here — commit them. Pre-existing real files are backed up as
  `*.bak` before being replaced.
- **Seeds** `models.json` (copy, once — never symlinked): the live file holds
  machine-specific endpoints and this repo is public. If `~/.pi/agent/models.json`
  already exists it is left untouched.
- Installs the repo as a local pi package (extensions, skills, prompts, themes).
- Installs [pi-diff-review](https://github.com/badlogic/pi-diff-review) (native
  `/diff-review` window via Glimpse + Monaco), patching its broken `prepare`
  script so the install completes.

> pi-diff-review builds a native host during install. Ensure the platform toolchain is present first: **macOS** Xcode Command Line Tools (`swiftc`), **Linux** Rust + GTK4/WebKit dev packages, **Windows** .NET 8 SDK + WebView2. The review window also loads Monaco/Tailwind from CDNs, so it needs internet at open time.

### New machine checklist

1. Install pi, clone this repo, run `./setup.sh` (see above).
2. Create `~/.pi/agent/auth.json` — credentials are never in this repo:
   ```json
   {
     "anthropic": { "type": "api_key", "key": "sk-ant-..." }
   }
   ```
3. Edit `~/.pi/agent/models.json` — replace the seeded placeholders with this
   machine's real endpoints and keys (kiro gateway `baseUrl`, API keys).
4. Optional: web skills setup below.

## Structure

```
├── package.json       # Pi package manifest
├── setup.sh           # Personal config setup script (symlinks + package install)
├── AGENTS.md          # Global context/guidelines (symlinked as ~/.pi/agent/AGENTS.md)
├── AGENTS.override.md # Repo-local override so guidelines aren't loaded twice here
├── settings.json      # Pi settings (symlinked; live — commit runtime changes)
├── models.json        # Custom model providers (seed copy; live file is machine-specific)
├── agents/            # Custom subagents (symlinked)
├── extensions/        # Custom extensions
├── prompts/           # Prompt templates
├── themes/            # Custom themes
└── skills/            # Skills
```

> `skills/web-access/UPGRADING.md` documents how to sync that skill from upstream.

## Web Skills Setup

Search/fetch skills need a couple of extra steps:

- **API keys** (export in your shell, e.g. `~/.env.zsh` sourced by `.zshrc`):
  - `TAVILY_API_KEY` — default search/extract ([app.tavily.com](https://app.tavily.com), free 1,000/mo)
  - `BRAVE_API_KEY` — search fallback when Tavily quota is hit
- **Tavily CLI**: `uv tool install tavily-cli` (provides the `tvly` command)
- **web-access (browser/CDP)**: on-demand, not persistent. Chrome 136+ refuses
  remote debugging on the default profile, so use a copied profile:
  ```bash
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    --remote-debugging-port=9222 --user-data-dir="$HOME/.cdp-chrome-profile" &
  node skills/web-access/scripts/cdp-proxy.mjs &
  ```
  See `skills/web-access/UPGRADING.md` for details.
