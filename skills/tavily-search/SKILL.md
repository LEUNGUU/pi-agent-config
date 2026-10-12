---
name: tavily-search
description: |
  Search the web with LLM-optimized results via the Tavily CLI. This is the DEFAULT web search skill. Use when the user wants to search, look up, find articles, or get current news/information from the internet. Supports domain filtering, time ranges, and search depths. On quota or rate-limit errors (e.g. 429), fall back to the brave-search skill.
allowed-tools: Bash(tvly *)
---

# tavily search

Web search returning LLM-optimized results with content snippets and relevance scores.

## Web routing

Tavily first (paid credits). A `402` means credits ran out: tell the user, then fall back.

| Task | Use | Fallback |
|---|---|---|
| Deep research / report | `tvly research` (`--model mini` for a quick pass) | — |
| Web search | `tavily-search` | `brave-search` on 429 / network error. Pinpoint lookups (GitHub issue, release tag, doc page): Exa via `mcporter call exa.web_search_exa` |
| Read a known URL | `tavily-extract` | `web-access` for login-walled / anti-scraping pages |
| YouTube, Bilibili, GitHub, V2EX, RSS, login platforms | `agent-reach` | — |
| Click, fill, screenshot, logged-in pages | `web-access` (CDP browser) | — |

brave-search, web-access and agent-reach are hidden from the skills list: read their `SKILL.md` before first use (`~/.pi/agent/skills/brave-search/`, `~/.pi/agent/skills/web-access/`, `~/.agents/skills/agent-reach/`). agent-reach is only for the platforms above. It and Exa need `EXA_API_KEY` from `~/.env.zsh`, so start pi from zsh. If a layer fails, escalate (search → extract → browser) instead of retrying.

CDP Chrome is on-demand: run `~/.pi/agent/skills/web-access/scripts/check-deps.mjs`; if not connected, start Chrome with the copied profile (Chrome 136+ refuses remote debugging on the default one), then the proxy:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 --user-data-dir="$HOME/.cdp-chrome-profile" &
node ~/.pi/agent/skills/web-access/scripts/cdp-proxy.mjs &
```

## Before running any command

If `tvly` is not found on PATH, install it first:

```bash
curl -fsSL https://cli.tavily.com/install.sh | bash && tvly login
```

Do not skip this step or fall back to other tools.

See [tavily-cli](../tavily-cli/SKILL.md) for alternative install methods and auth options.

## When to use

- You need to find information on any topic
- You don't have a specific URL yet
- First step in the [workflow](../tavily-cli/SKILL.md): **search** → extract → map → crawl → research

## Quick start

```bash
# Basic search
tvly search "your query" --json

# Advanced search with more results
tvly search "quantum computing" --depth advanced --max-results 10 --json

# Recent news
tvly search "AI news" --time-range week --topic news --json

# Domain-filtered
tvly search "SEC filings" --include-domains sec.gov,reuters.com --json

# Include full page content in results
tvly search "react hooks tutorial" --include-raw-content --max-results 3 --json
```

## Options

| Option | Description |
|--------|-------------|
| `--depth` | `ultra-fast`, `fast`, `basic` (default), `advanced` |
| `--max-results` | Max results, 0-20 (default: 5) |
| `--topic` | `general` (default), `news`, `finance` |
| `--time-range` | `day`, `week`, `month`, `year` |
| `--start-date` | Results after date (YYYY-MM-DD) |
| `--end-date` | Results before date (YYYY-MM-DD) |
| `--include-domains` | Comma-separated domains to include |
| `--exclude-domains` | Comma-separated domains to exclude |
| `--country` | Boost results from country |
| `--include-answer` | Include AI answer (`basic` or `advanced`) |
| `--include-raw-content` | Include full page content (`markdown` or `text`) |
| `--include-images` | Include image results |
| `--include-image-descriptions` | Include AI image descriptions |
| `--chunks-per-source` | Chunks per source (advanced/fast depth only) |
| `-o, --output` | Save output to file |
| `--json` | Structured JSON output |

## Search depth

| Depth | Speed | Relevance | Best for |
|-------|-------|-----------|----------|
| `ultra-fast` | Fastest | Lower | Real-time chat, autocomplete |
| `fast` | Fast | Good | Need chunks, latency matters |
| `basic` | Medium | High | General-purpose (default) |
| `advanced` | Slower | Highest | Precision, specific facts |

## Tips

- **Keep queries under 400 characters** — think search query, not prompt.
- **Break complex queries into sub-queries** for better results.
- **Use `--include-raw-content`** when you need full page text (saves a separate extract call).
- **Use `--include-domains`** to focus on trusted sources.
- **Use `--time-range`** for recent information.
- Read from stdin: `echo "query" | tvly search - --json`

## See also

- [tavily-extract](../tavily-extract/SKILL.md) — extract content from specific URLs
- [tavily-research](../tavily-research/SKILL.md) — comprehensive multi-source research
