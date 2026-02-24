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

This symlinks config files to `~/.pi/agent/` and installs the repo as a local pi package.

## Structure

```
├── package.json       # Pi package manifest
├── setup.sh           # Personal config setup script
├── AGENTS.md          # Global context/guidelines
├── settings.json      # Pi settings
├── models.json        # Custom model providers
├── presets.json       # Mode presets (plan/implement/fast)
├── extensions/        # Custom extensions
├── prompts/           # Prompt templates
├── themes/            # Custom themes
└── skills/            # Skills
```

## Post-Setup

Create `~/.pi/agent/auth.json` with your API keys:
```json
{
  "anthropic": { "type": "api_key", "key": "sk-ant-..." }
}
```
