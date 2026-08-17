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

This copies config files to `~/.pi/agent/` and installs the repo as a local pi package. It also installs the [pi-diff-review](https://github.com/badlogic/pi-diff-review) extension (native `/diff-review` window via Glimpse + Monaco), patching its broken `prepare` script so the install completes.

> pi-diff-review builds a native host during install. Ensure the platform toolchain is present first: **macOS** Xcode Command Line Tools (`swiftc`), **Linux** Rust + GTK4/WebKit dev packages, **Windows** .NET 8 SDK + WebView2. The review window also loads Monaco/Tailwind from CDNs, so it needs internet at open time.

## Structure

```
├── package.json       # Pi package manifest
├── setup.sh           # Personal config setup script
├── AGENTS.md          # Global context/guidelines
├── settings.json      # Pi settings
├── models.json        # Custom model providers
├── agents/            # Custom subagents (4 review critics)
├── extensions/        # Custom extensions
├── prompts/           # Prompt templates
├── themes/            # Custom themes
└── skills/            # Skills
```

> `skills/web-access/UPGRADING.md` documents how to sync that skill from upstream.

## Post-Setup

Create `~/.pi/agent/auth.json` with your API keys:
```json
{
  "anthropic": { "type": "api_key", "key": "sk-ant-..." }
}
```

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
