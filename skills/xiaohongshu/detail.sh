#!/bin/bash
# Get xiaohongshu post details and comments
FEED_ID="$1"
XSEC_TOKEN="$2"
[ -z "$FEED_ID" ] || [ -z "$XSEC_TOKEN" ] && { echo "Usage: detail.sh <feed_id> <xsec_token>"; exit 1; }
DIR="$(dirname "$0")"
"$DIR/call-tool.sh" get_feed_detail "{\"feed_id\":\"$FEED_ID\",\"xsec_token\":\"$XSEC_TOKEN\"}"
