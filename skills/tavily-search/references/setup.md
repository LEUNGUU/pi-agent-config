# Setup

Use an existing Tavily tool or the `tvly` CLI. Do not install another channel without user approval.

## CLI

Search and extract can run without a key, subject to a keyless rate limit.
Map, crawl, and external research require authentication. A configured key uses the account's allowance.
Do not discard a rejected key or change accounts to bypass a billing or authentication failure.

If the CLI is missing, ask before installing it with uv:

```bash
uv tool install tavily-cli
```

Use the actual uv path on this machine. Do not use system pip.
After approval to update, use `tvly update`; `tvly update --check` only checks for updates.

Use `TAVILY_API_KEY` from the environment when the user has provided it.
Never print the key, put it in command arguments, or save it in a skill or public configuration.
Existing processes do not receive later shell environment changes; restart pi from the refreshed shell when needed.

For a user-requested interactive login, `tvly login` opens the browser.
`tvly login --no-browser` prints the link but still needs a local callback; remote sessions may need port forwarding.
Do not start browser sign-in in an unattended agent job. Ask the user to supply authentication instead.
On a keyless limit, report the limit and ask whether to sign in; do not start login without approval.

## Avoid unintended setup changes

`tvly init` authenticates and installs or updates upstream skills through npx.
It can introduce duplicate skills or replace local choices. Do not run it just to verify a search.
If the user requests guided authentication only, `tvly init --skip-skills` avoids skill installation.
`tvly set-default` can disable Claude Code's or Codex's built-in web tools;
only run it when the user explicitly requests that configuration change.

## MCP

MCP lets an agent call an external service as a tool. Tavily's server is `https://mcp.tavily.com/mcp`.
Only configure a new server when asked. Keep credentials in environment references or a private credential store,
not literal API keys in URLs or committed settings. See the [Tavily MCP documentation](https://github.com/tavily-ai/tavily-mcp).
A new server may require a client reload or restart. On authentication failure, ask the user to reconnect.

## Diagnostics

Run `tvly <command> --help` for exact options. Do not run auth checks before every search.
If authentication fails, `tvly --status --json` can diagnose it; do not display credential values.
Exit codes: 0 success, 1 setup/update failure, 2 bad input, 3 authentication failure, 4 API/live-test failure.
For billing, rate limits, and network failures, follow the core skill's Web routing section.
