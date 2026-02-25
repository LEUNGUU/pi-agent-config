#!/bin/bash
# Generic MCP tool caller for xiaohongshu-mcp

TOOL="$1"
shift
ARGS="$*"

if [ -z "$TOOL" ]; then
  echo "Usage: call-tool.sh <tool_name> [json_args]"
  echo "Tools: search_feeds, get_feed_detail, list_feeds, user_profile, like_feed, unfavorite"
  exit 1
fi

[ -z "$ARGS" ] && ARGS="{}"

# Initialize and capture session ID
SESSION_ID=$(curl -s -D - http://localhost:18060/mcp -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"skill","version":"1.0"}}}' \
  | grep -i "Mcp-Session-Id" | cut -d' ' -f2 | tr -d '\r')

# Call tool with session
curl -s http://localhost:18060/mcp -X POST \
  -H "Content-Type: application/json" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"$TOOL\",\"arguments\":$ARGS}}"
