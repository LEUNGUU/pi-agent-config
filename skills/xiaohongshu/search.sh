#!/bin/bash
# Search xiaohongshu posts
KEYWORD="$1"
[ -z "$KEYWORD" ] && { echo "Usage: search.sh <keyword>"; exit 1; }
DIR="$(dirname "$0")"
"$DIR/call-tool.sh" search_feeds "{\"keyword\":\"$KEYWORD\"}"
