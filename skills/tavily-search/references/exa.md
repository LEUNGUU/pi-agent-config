# Exa API fallback

Tavily remains the default web search. Use Exa direct API when Tavily hits quota, rate limits, or a network failure,
or when the user explicitly requests Exa. Do not use mcporter for this route unless the user requests MCP.

## Run

Use the existing `EXA_API_KEY` environment variable. Do not print, store, or put its value in command arguments.
Resolve `../scripts/exa-search.mjs` relative to this file. For the standard pi installation:

```bash
node "$HOME/.pi/agent/skills/tavily-search/scripts/exa-search.mjs" 'GitHub REST API rate limits official documentation'
```

The helper sends one HTTPS request to `https://api.exa.ai/search` using curl.
It uses `auto`, five results, and query-relevant highlights. It returns JSON, redacting the credential if echoed.
The credential goes through stdin, not process arguments. Curl verifies certificates using the existing trust configuration;
the helper ignores `.curlrc` so custom logging or insecure flags cannot expose credentials.
No Exa SDK, independent skill, platform manager, or MCP client is needed for this search.

## Read the result

- Check the command's exit code. On failure, report it; do not silently fall back to a different credential or MCP.
- Read `results[].url` and `results[].highlights`; a title can be empty.
- Inspect any warnings. Confirm important claims against the original source as the core skill requires.
- Save large output to an explicit temporary file and read the parts needed, rather than truncating evidence.
- Empty results mean no hits, not an error. Refine the query once if needed; do not invent sources.

## Limits and cost

The helper makes one bounded request, with no automatic retries. Missing or malformed keys stop before a request.
Rejected keys produce an HTTP error; they do not trigger another credential or login attempt.
HTTP 401/402/403 needs credential or account attention; do not change billing, start login, or pay through x402.
Each authenticated request uses the Exa account's credits. The tested five-result `auto` call reported $0.007;
check `costDollars` when returned. That figure does not prove whether free or paid credits were consumed.
Do not use the Agent API or other higher-cost products for a fallback search without a separate request.
Never send secrets or private source code as a search query.

API documentation: https://exa.ai/docs/reference/search
Official skill: https://exa.ai/docs/skill.md
