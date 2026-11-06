---
name: tavily-cli
description: |
  Web search, URL content extraction, site crawling, URL discovery, and deep research with citations via the Tavily CLI. Use for umbrella web tasks: "research this topic", "crawl this documentation site", "fetch this page", "find articles about". Not for local files, git, or code editing.
compatibility: Requires the tvly CLI. Search and extract support keyless limits; map, crawl, and research require authentication.
allowed-tools: Bash(tvly *)
disable-model-invocation: true
---

# Tavily CLI

Web search, content extraction, site crawling, URL discovery, and deep research. Returns JSON optimized for LLM consumption.

Run `tvly --help` or `tvly <command> --help` for full option details.

## Prerequisites

Read the [core skill](../tavily-search/SKILL.md) for web routing and bounded search defaults.
Search and extract can run keyless with rate limits. Other operations require authentication.
Use the provided `TAVILY_API_KEY` environment variable; never print keys or put them in command arguments.
If setup is needed, follow [setup](../tavily-search/references/setup.md). Do not run login or init before every command.

## Workflow

Follow this escalation pattern — start simple, escalate when needed:

1. **Search** — No specific URL. Find pages, answer questions, discover sources.
2. **Extract** — Have a URL. Pull its content directly.
3. **Map** — Large site, need to find the right page. Discover URLs first.
4. **Crawl** — Need bulk content from an entire site section.
5. **Research** — Need comprehensive, multi-source analysis with citations.

| Need | Command | When |
|------|---------|------|
| Find pages on a topic | `tvly search` | No specific URL yet |
| Get a page's content | `tvly extract` | Have a URL |
| Find URLs within a site | `tvly map` | Need to locate a specific subpage |
| Bulk extract a site section | `tvly crawl` | Need many pages (e.g., all /docs/) |
| Deep research with citations | `tvly research run` | Need multi-source synthesis |

For search and extract, use the core skill or the existing `tavily-extract` entry point.
See [map](../tavily-search/references/map.md) and [crawl](../tavily-search/references/crawl.md) for bounded workflows.
Run `tvly <command> --help` for exact flags.

## Output

All commands support `--json` for structured, machine-readable output and `-o` to save to a file.

```bash
tvly search "react hooks" --json -o results.json
tvly extract "https://example.com/docs" -o docs.json
tvly crawl "https://docs.example.com" --output-dir ./docs/
```

## Tips

- **Always quote URLs** — shell interprets `?` and `&` as special characters.
- **Use `--json` for agentic workflows** — every command supports it.
- **Read from stdin with `-`** — `echo "query" | tvly search -`
- **Batch searches**: CLI 0.2.1 accepts up to 5 queries with the same options. JSON output is an array; check each response for errors.
- **Output limits**: `--max-chars` affects terminal display, not JSON, saved files, or API charges.
- **Exit codes**: 0 = success, 1 = setup/update failure, 2 = bad input, 3 = auth error, 4 = API error.
