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

1. Install pi (needs Node.js):
   ```bash
   npm install -g --ignore-scripts @earendil-works/pi-coding-agent
   ```
2. Clone this repo and run `./setup.sh` (see above).
3. Create `~/.pi/agent/auth.json` — credentials are never in this repo:
   ```json
   {
     "anthropic": { "type": "api_key", "key": "sk-ant-..." }
   }
   ```
4. Edit `~/.pi/agent/models.json` — replace the seeded placeholders with this
   machine's real endpoints and keys (kiro gateway `baseUrl`, API keys).
5. Start `pi` anywhere and sanity-check: `/model` lists the custom providers,
   `/agents` lists the subagents, and a `read` of any file renders normally.
6. Optional: web skills setup below.
7. Optional (macOS): Otty terminal setup below.

## Otty Setup (macOS)

[Otty](https://otty.app) is the terminal this config is tuned for. `setup.sh`
**copies** `otty/config.toml` to `~/.config/otty/config.toml` (backing up a
differing existing file as `*.bak`).

Unlike `settings.json`, this one is *not* symlinked and the flow is one-way
(repo → machine). Otty rewrites its config from GUI state via temp-file +
rename, which both replaces a symlink with a regular file and clobbers repo
values (background, selection colour, `theme` case). So:

- **Quit Otty before running `setup.sh`** — a running Otty overwrites the file
  on quit. The script skips the copy and warns if Otty is running.
- To change config, edit `otty/config.toml` in the repo and re-run `setup.sh`;
  don't tune it in Otty's settings UI and expect it to persist here.
- No restart needed to apply: `otty-cli config reload`
  (`/Applications/Otty.app/Contents/MacOS/otty-cli`) hot-reloads a running Otty.
  A newly added *theme file* may still need a restart, since Otty scans
  `themes/` at launch. Useful checks: `otty-cli config show` (normalized
  config), `otty-cli config get <key>` (effective value), `otty-cli theme list`
  (confirms a user theme is installed).

On a new machine:

1. Install Otty and launch it once (creates `~/.config/otty/`), then quit it.
2. Run `./setup.sh` (or re-run it) to copy the config.
3. Install the font the config expects: **Maple Mono NF CN**
   (`brew install --cask font-maple-mono-nf-cn`) — otherwise Otty falls back
   to the default font.
4. Start Otty. Sanity-check: paper background (`#F0E4C2`), tabs on top, and a
   paper-coloured card (not white).

### Themes

`otty/themes/*.ottytheme` are copied to `~/.config/otty/themes/` by `setup.sh`.
`config.toml` sets `theme = "paper-card"`, which resolves to our own
`paper-card.ottytheme` — the theme file must be installed or Otty falls back to
a stock theme and the card renders white.

Why a custom theme at all: the flat `background` key only colours the terminal
grid. The visible card is `[container].background` (plus `[panel]`), which *only*
a theme can set. `paper-card` is Otty's stock Floating Card with those
backgrounds set to the paper colour.

Not managed here: Otty's stock themes/fonts directories, and
`extensions/otty-integration.ts` (Otty overwrites it on every "Install Pi
Integration" — see `.gitignore`; our own additions live in
`extensions/otty-custom-states.ts`).

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
├── otty/              # Otty terminal config (config.toml copied to ~/.config/otty/)
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
