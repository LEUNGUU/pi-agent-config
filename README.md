# Pi Coding Agent Config

Personal configuration for [pi-coding-agent](https://github.com/badlogic/pi-mono).

## Setup

```bash
git clone --recursive <this-repo-url> ~/pi-agent-config
cd ~/pi-agent-config
./setup.sh
```

## Structure

```
├── AGENTS.md          # Global context/guidelines
├── settings.json      # Pi settings
├── models.json        # Custom model providers
├── presets.json       # Mode presets (plan/implement/fast)
├── extensions/        # Custom extensions
├── prompts/           # Prompt templates
├── themes/            # Custom themes
└── skills/            # Skills (submodule)
```

## Post-Setup

1. Create `~/.pi/agent/auth.json` with your API keys:
   ```json
   {
     "anthropic": { "type": "api_key", "key": "sk-ant-..." }
   }
   ```

2. Install skill dependencies:
   ```bash
   cd ~/.pi/agent/skills/pi-skills/brave-search && npm install
   cd ~/.pi/agent/skills/pi-skills/youtube-transcript && npm install
   ```
