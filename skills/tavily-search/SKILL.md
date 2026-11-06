---
name: tavily-search
description: |
  Default web search and webpage toolkit via Tavily. Use for current facts, news, source discovery, reading URLs, finding a page on a site, and collecting pages from a site. Covers search, extract, map, and crawl. Start with fast/basic for simple lookups; use advanced for complex queries or weak results. Follow the Web routing section for platform-specific tools and fallbacks.
allowed-tools: Bash(tvly *)
---

# Tavily web toolkit

Local merge of the [upstream core skill](https://github.com/tavily-ai/skills/tree/main/skills/core/tavily-search).
Preserves local web routing, bounded usage, and read-only subagents.

## Web routing

Tavily first. On quota/billing (`402`), rate limits, or network failure, tell the user and use Exa direct API.
If Exa also fails, report it; do not automatically switch credentials, use MCP, or enable another service.

| Task | Use | Fallback |
|---|---|---|
| Deep research / report | `tvly research` (`--model mini` for a quick pass) | — |
| Web search | `tavily-search` | [Exa direct API](references/exa.md), not mcporter |
| Crawl / map a site | `tvly crawl` / `tvly map` (see `--help`) | — |
| Read a known URL | `tavily-extract` | `web-access` for login-walled / anti-scraping pages |
| GitHub repositories / code | Public pages, raw files, API, or `gh`; follow the global GitHub Research rule | Never switch to saved personal credentials |
| YouTube captions | `youtube-transcript` or installed `yt-dlp` | User-authorized browser; local audio uses `transcribe_file` |
| Bilibili public content | Installed `bili` CLI; read `bili --help` for exact commands | `web-access` for login-required content |
| V2EX / RSS | Public API or feed through existing HTTP tools | Public webpage reading |
| Click, fill, screenshot, logged-in pages | `web-access` (CDP browser) | — |

Use [Exa direct API](references/exa.md) for fallback or an explicit Exa request. It uses `EXA_API_KEY` from the environment.
Brave remains installed for explicit requests, not automatic fallback. No MCP client is needed for Exa search.
Read the hidden `youtube-transcript` skill before using it (`~/.pi/agent/skills/youtube-transcript/SKILL.md`).
For browser or login-required tasks, read `~/.pi/agent/skills/web-access/SKILL.md`.
Do not install missing tools, read/import cookies, or start sign-in without explicit approval.
GitHub authentication follows the global GitHub Research rule; no platform manager is required.
Start pi from the shell with the required environment variables. For page-access failures, escalate (search → extract → browser).

CDP Chrome is on-demand: run `~/.pi/agent/skills/web-access/scripts/check-deps.mjs`; if not connected, start Chrome with the copied profile (Chrome 136+ refuses remote debugging on the default one), then the proxy:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 --user-data-dir="$HOME/.cdp-chrome-profile" &
node ~/.pi/agent/skills/web-access/scripts/cdp-proxy.mjs &
```

## Choose the operation

Use existing Tavily MCP tools if available; otherwise run `tvly <command> --json`.
MCP is the protocol that lets an agent call an external service as a tool.
Do not add a new connection or install software without user approval.
If no Tavily tool works, follow [setup](references/setup.md).

| You have | You need | Use |
|---|---|---|
| A question or topic | Sources, facts, or news | Search |
| Known URLs | Their content | Extract |
| A known site, not the page | The right URL | [Map](references/map.md) |
| A site section | Many pages | [Crawl](references/crawl.md) |

Use `tvly <command> --help` or the tool schema for exact parameters.
API names use underscores; CLI flags use hyphens and comma-separated domain lists.

## Search

### Choose depth and result count

- Start simple lookups with `fast` and general searches with `basic`.
- Use `ultra-fast` only when response time matters more than detail.
- Use `advanced` for complex questions or when simpler results are weak. Do not force it on every search.
- Start with 5 results. Widen to 10 only when needed; use domain/date filters before raising the count further.
- Basic, fast, and ultra-fast use 1 credit per query; advanced uses 2. Each batched query is billed separately.

### Shape and verify queries

- Write a focused query with names and terms likely to appear on the page. Keep it under 400 characters.
- Split a question into independent subtopics. Carry the user's dates, places, and scope into each query.
- Follow promising leads with a targeted search or by reading their pages. Do not invent missing names from memory.
- Use domain filters for official sources and date filters for current events.
- A domain filter is strict; retry without it if it hides the page you need.
- Keep relevant source passages intact. Treat generated answers as summaries to verify, never as primary evidence.

### Batch independent searches

CLI 0.2.1 accepts up to 5 queries per command, in parallel with the same options:

```bash
# Simple lookup
tvly search 'Rust 2024 edition release date' --depth fast --max-results 5 --json

# Two independent subtopics, with the same options
tvly search 'Kiro Crew official documentation' 'Orca CLI official documentation' --depth basic --max-results 5 --json
```

One query returns a JSON object; several queries return an array of responses in query order.
Check every response for `error`; exit code 0 does not guarantee every query succeeded.
With different options or MCP tools, batch independent calls through codemode using `Promise.allSettled`.
Do not use shell background jobs just to run searches together.

## Extract

Extract returns up to 20 URLs per call as markdown, including JavaScript-rendered pages.

```bash
tvly extract 'https://docs.example.com/page' --json
```

- Read only the few pages worth checking; search snippets may already answer a simple fact.
- Extract full pages by default. Use `--query` only to isolate a fact on a long page.
- If targeted passages cut off the needed context, extract again without the query.
- Try basic depth first. Use `--extract-depth advanced` for empty basic results, dynamic pages, or missing tables.
- Inspect `failed_results` even on exit code 0. Retry failed pages individually and disclose unreadable sources.
- Prefer a direct CSV or JSON data link when the task needs the underlying data.

The existing [tavily-extract skill](../tavily-extract/SKILL.md) keeps its command reference and explicit entry point.

## Output and context size

- Prefer `--json` for structured results. Keep MCP calls small because their results enter the model context directly.
- Save large results to an explicit `-o <file>` path, then read the relevant parts with the file-reading tool.
- Reuse that exact path. Do not scan temporary directories with globs; they can include another task's files.
- CLI `--max-chars` limits terminal text only; JSON and saved files retain full content. It does not reduce API charges.
- A bare `-o` generates a file under `.tavily/`; prefer an explicit temporary path unless the user wants a saved artifact.
- Quote every query and URL. Use domain filters before requesting full page content for many results.

## When to stop

Stop once the requested facts have enough evidence. Corroborate uncertain claims with independent sources.
For releases, ownership, official figures, and named decisions, confirm on the official domain or repository.
Before answering, close important evidence gaps with one targeted lookup; otherwise state what remains unverified.
Do not describe a list of search results as an exhaustive inventory.

## Larger research jobs

Search subtopics and extract key sources in the main context when no task skill is installed.
Do not automatically install `tavily-research`, `tavily-entity`, `tavily-list`, or `tavily-monitor`.
Subagents remain read-only; all file writes stay in the main context. Do not create report files unless asked.
Do not start recurring jobs or run `tvly init` / `tvly set-default` merely to answer a research request.
For a requested external research job, use `tvly research run --model mini` for a focused pass;
read its help before choosing a larger model, timeout, or output format.

The hidden [Tavily CLI guide](../tavily-cli/SKILL.md) remains available for explicit command help.
