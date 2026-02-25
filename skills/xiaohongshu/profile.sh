#!/bin/bash
# Get xiaohongshu user profile
USER_ID="$1"
XSEC_TOKEN="$2"
[ -z "$USER_ID" ] || [ -z "$XSEC_TOKEN" ] && { echo "Usage: profile.sh <user_id> <xsec_token>"; exit 1; }
DIR="$(dirname "$0")"
"$DIR/call-tool.sh" user_profile "{\"user_id\":\"$USER_ID\",\"xsec_token\":\"$XSEC_TOKEN\"}"
