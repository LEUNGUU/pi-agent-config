---
name: pi-skill-developer
description: Create and manage pi-coding-agent skills. Use when creating new skills, understanding skill structure, writing SKILL.md files, or debugging skill loading. Covers skill format, frontmatter, directory structure, and best practices.
---

# Pi Skill Developer Guide

## Purpose

Guide for creating skills in pi-coding-agent following the Agent Skills standard.

## When to Use

- Creating new skills
- Understanding skill structure
- Debugging skill loading issues
- Migrating skills from Claude Code

---

## Skill Structure

```
~/.pi/agent/skills/
└── my-skill/
    ├── SKILL.md           # Required: frontmatter + instructions
    ├── scripts/           # Optional: helper scripts
    │   └── process.sh
    ├── resources/         # Optional: detailed docs
    │   └── reference.md
    └── assets/            # Optional: templates, configs
```

## SKILL.md Format

```markdown
---
name: my-skill
description: What this skill does. Include keywords that help the LLM decide when to load it. Max 1024 chars.
---

# My Skill

## Setup
Run once before first use:
\`\`\`bash
cd ~/.pi/agent/skills/my-skill && npm install
\`\`\`

## Usage
\`\`\`bash
./scripts/process.sh <input>
\`\`\`

## Workflow
1. Step one
2. Step two
```

## Frontmatter Fields

| Field | Required | Notes |
|-------|----------|-------|
| `name` | Yes | Must match directory name. Lowercase, hyphens, max 64 chars |
| `description` | Yes | Max 1024 chars. Determines when LLM loads the skill |
| `license` | No | License name |
| `compatibility` | No | Environment requirements |
| `metadata` | No | Arbitrary key-value pairs |

**Ignored fields** (Claude Code specific): `allowed-tools`, `model`

## Skill Locations

Pi discovers skills from (later wins on collision):

1. `~/.codex/skills/**/SKILL.md` (Codex CLI)
2. `~/.claude/skills/*/SKILL.md` (Claude Code user)
3. `<cwd>/.claude/skills/*/SKILL.md` (Claude Code project)
4. `~/.pi/agent/skills/**/SKILL.md` (Pi user, recursive)
5. `<cwd>/.pi/skills/**/SKILL.md` (Pi project, recursive)

## How Skills Work in Pi

1. At startup, pi scans skill locations and extracts names + descriptions
2. System prompt includes available skills in XML format
3. When task matches, LLM uses `read` tool to load full SKILL.md
4. LLM follows instructions, using relative paths for scripts/assets

**Key difference from Claude Code:** Pi has no `Skill` tool. The LLM reads skills directly via `read` tool.

## Best Practices

### Description (Critical)

The description determines when the LLM loads your skill. Be specific:

✅ Good:
```yaml
description: Web search via Brave Search API. Use for documentation lookups, fact checking, or fetching web content. Requires BRAVE_API_KEY.
```

❌ Poor:
```yaml
description: Search the web.
```

### Keep Under 500 Lines

Use progressive disclosure:
- Main SKILL.md: Overview, quick reference, common patterns
- `resources/*.md`: Detailed documentation, edge cases

Reference with relative paths:
```markdown
See [detailed patterns](resources/patterns.md) for advanced usage.
```

### Relative Paths

Use paths relative to skill directory:
```markdown
Run the script:
\`\`\`bash
./scripts/search.js "query"
\`\`\`
```

### Include Setup Instructions

```markdown
## Setup
\`\`\`bash
cd ~/.pi/agent/skills/my-skill
npm install
\`\`\`

## Environment Variables
- `MY_API_KEY`: Required. Get from https://example.com
```

## Triggering Skills via AGENTS.md

Since pi doesn't have hook-based skill enforcement, use AGENTS.md:

```markdown
# Skill Usage Rules

When working with Python files (*.py), read the python-dev-guidelines skill:
~/.pi/agent/skills/pi-skills/python-dev-guidelines/SKILL.md

When doing web searches, use brave-search:
~/.pi/agent/skills/pi-skills/brave-search/SKILL.md
```

## CLI Options

```bash
pi --no-skills              # Disable all skills
pi --skills "git-*,docker"  # Filter by glob pattern
```

## Settings

```json
// ~/.pi/agent/settings.json
{
  "skills": {
    "enabled": true,
    "ignoredSkills": ["deprecated-*"],
    "includeSkills": ["python-*", "shell-*"]
  }
}
```

## Validation

Pi validates and warns (but still loads) non-compliant skills:
- Name doesn't match directory
- Name > 64 chars or invalid characters
- Missing description or > 1024 chars

## Migrating from Claude Code

1. Copy skill directory to `~/.pi/agent/skills/`
2. Remove Claude-specific references (hooks, skill-rules.json)
3. Remove `allowed-tools` and `model` from frontmatter (ignored)
4. Test: `pi` then ask to use the skill

## Quick Commands

```bash
# List discovered skills
pi --help  # Shows loaded skills at startup

# Test skill loading
pi "use the my-skill skill to do X"
```

---

## Related Docs

- [Pi Skills Documentation](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/skills.md)
- [Agent Skills Standard](https://agentskills.io/specification)
