#!/usr/bin/env bash
# boo-interact: one deterministic send -> wait -> peek round against a boo session.
# Usage: boo-interact <session> <text-to-send> [--wait-text <str>] [--timeout <dur>]
# Reads the rendered screen as JSON after output settles. No sleep, no polling.
set -euo pipefail

session=${1:?usage: boo-interact <session> <text> [--wait-text <str>] [--timeout <dur>]}
text=${2:?missing text to send}
shift 2

wait_mode="--idle"
timeout="30s"
while [ $# -gt 0 ]; do
  case "$1" in
    --wait-text) wait_mode="--text $2"; shift 2 ;;
    --timeout)   timeout="$2";          shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# 1. send literal text and submit with Enter
boo send "$session" --text "$text" --enter

# 2. wait until output settles (or contains target text); bounded by timeout
# shellcheck disable=SC2086
if ! boo wait "$session" $wait_mode --timeout "$timeout"; then
  rc=$?
  [ "$rc" -eq 4 ] && echo "boo-interact: wait timed out after $timeout" >&2
  exit "$rc"
fi

# 3. read the rendered screen as structured JSON
boo peek "$session" --json
