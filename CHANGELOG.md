# Changelog

Changes to this pi config that affect behavior or prompt size. History before
2026-10-11 is in `git log`. Token figures are first-request input tokens in
print mode (`pi --mode json --no-session "reply ok"`), measured on Bedrock.

## [Unreleased]

First request: 19,539 -> 9,756 tokens.

### Changed

- Default model is Bedrock `global.anthropic.claude-opus-5-5` (was kiro
  `claude-opus-5`). Also enabled on Bedrock: Sonnet 5.5, Opus 4.8, Haiku 5.5,
  Fable 5.1, Fable 5; `models.json` gives each a display name ("internal
  Claude Code, Bedrock"). No guard on Fable in the main session.
- Subagents: replaced `npm:@tintinweb/pi-subagents` with pi's own example
  extension, copied to `extensions/subagent/` (tool `subagent`, foreground
  only: no background, resume or steer). Saves about 2.1k tokens.
- Subagents are read-only. Only `Explore` (now Bedrock Haiku 5.5, was
  `kiro/claude-haiku-4.5`) and `critic-deepseek` remain;
  `/review` runs the one critic and verifies its findings in the main context.
- ADHD rules shortened (7,201 -> 3,799 chars) and written to their own
  `adhd_mode` section; a ~55-token reminder is appended after each user
  message.
- hindsight recall/retain/reflect are codemode-only (no direct tools);
  recall defaults to `max_tokens: 1024` and `world`/`observation` types, and
  results are trimmed to type, date and text (~20.4k -> ~1.1k per recall).
- `AGENTS.md` Web Access routing moved to the "Web routing" section of
  `skills/tavily-search/SKILL.md` (-570 tokens).
- Compaction summarizer chain: Bedrock Haiku 5.5, then `kiro/glm-5` (was
  `kiro/claude-sonnet-5.5`, then `kiro/glm-5`); summaries are always written
  in English (a mixed-language summary pulled replies off the user's language).
- ponytail package loads only `ponytail-review` and `ponytail-audit` skills.
- `AGENTS.md` cut to five short sections (Conversation, Git & Secrets,
  Python, Web Access, Subagents). Dropped: no-emoji rule, Workflow ceremony
  rules (ponytail covers them), model tiers and the Fable rule, Python version
  list.
- `AGENTS.override.md`: changes that affect behavior or prompt size are
  logged here in the same commit.

### Removed

- kiro models (unused): claude-opus-4.7, claude-opus-5, claude-sonnet-4.6,
  claude-sonnet-5, claude-haiku-4.5, minimax-m2.1, minimax-m2.5, deepseek-3.2.
- Agents: builder, builder-frontier, critic-agnes, critic-glm, critic-minimax,
  general-purpose, plan; the Prewalk rule in `AGENTS.md`.
- `extensions/permission-gate.ts` Fable check: it gated the old `Agent` tool;
  the `subagent` tool takes no model argument, so subagents cannot pick Fable.
- `npm:@juicesharp/rpiv-ask-user-question` (~1.5k tokens). Re-add the package
  line in `settings.json` to restore.
- `subagents.json` and `agent-tool-description.md` (pi-subagents config).
- From the skills list (`disable-model-invocation: true`, still usable via
  `/skill:name`): brave-search, web-access, youtube-transcript, agnes-media,
  baoyu-imagine, baoyu-article-illustrator, gemini-imagegen, onboarding, otty,
  python-dev-guidelines, shell-script-guidelines, and `~/.agents/skills/agent-reach`
  (outside this repo; a reinstall may undo it).

### Fixed

- `models.json` seed held the real kiro gateway address; now a placeholder
  (`YOUR-KIRO-GATEWAY`) in every commit on `main`: history rewritten and
  force-pushed on 2026-10-12, so older hashes changed. GitHub's read-only
  `refs/pull/13/head` still holds the old commits.
- `extensions/adhd.ts` replaced the whole system prompt, dropping later
  sections (ponytail, mcp_servers).
- `extensions/subagent/index.ts` (local changes, marked `Local change`):
  signal-killed children were reported as success; SIGKILL escalation after
  abort never fired; multibyte characters split across stdout chunks turned
  into U+FFFD.

### Upgrading pi

`extensions/subagent/` is a copy of pi 1.1.0
`examples/extensions/subagent/`, so pi updates never overwrite it and never
bring upstream fixes either. After updating pi, diff it against
`~/.n/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/subagent/`
and merge, keeping the `Local change` lines.
