#!/usr/bin/env bash
# subagent-watch: spawn a pi subagent inside a boo session so a human can
# `boo attach` and watch the full live workflow, while the orchestrator drives
# it headlessly (send task -> wait -> peek for the result).
#
# Usage:
#   subagent-watch spawn <name> <task> [--model M] [--agent critic-agnes] [--cwd DIR]
#   subagent-watch result <name>            # print the rendered screen (scrollback)
#   subagent-watch wait <name> [--timeout 5m]
#   subagent-watch list
#   subagent-watch kill <name>
#
# After `spawn`, tell the human:  boo attach <name>   (detach with Ctrl-A d)
set -euo pipefail

BOO=${BOO_BIN:-boo}
AGENTS_DIR="${PI_AGENTS_DIR:-$HOME/.pi/agent/agents}"

die() { echo "subagent-watch: $*" >&2; exit 1; }
need() { command -v "$BOO" >/dev/null 2>&1 || die "boo not found on PATH (set BOO_BIN)"; }

cmd=${1:-}; shift || true
need

case "$cmd" in
  spawn)
    name=${1:?usage: spawn <name> <task> [flags]}; shift
    task=${1:?missing task}; shift
    model=""; agent=""; cwd="$PWD"
    while [ $# -gt 0 ]; do
      case "$1" in
        --model) model=$2; shift 2 ;;
        --agent) agent=$2; shift 2 ;;
        --cwd)   cwd=$2;   shift 2 ;;
        *) die "unknown flag: $1" ;;
      esac
    done

    # Build the pi command. Interactive (full TUI) so the human can watch.
    pi_args=(pi)
    [ -n "$model" ] && pi_args+=(--model "$model")

    # If --agent given, load that agent-type's .md as an appended system prompt
    # and adopt its model when none was supplied. We reuse the same definitions
    # the pi-subagents extension uses, so critics behave identically.
    if [ -n "$agent" ]; then
      def="$AGENTS_DIR/$agent.md"
      [ -f "$def" ] || die "agent definition not found: $def"
      # Strip YAML frontmatter -> the body is the system prompt.
      body=$(awk 'BEGIN{f=0} /^---[[:space:]]*$/{f++; next} f>=2{print}' "$def")
      tmp=$(mktemp -t "subagent-$agent.XXXX")
      printf '%s\n' "$body" >"$tmp"
      pi_args+=(--append-system-prompt "$tmp")
      if [ -z "$model" ]; then
        m=$(awk -F': *' '/^model:/{print $2; exit}' "$def")
        [ -n "$m" ] && pi_args+=(--model "$m")
      fi
    fi

    # Launch headless in boo, in the requested working dir.
    ( cd "$cwd" && "$BOO" new "$name" -d -- "${pi_args[@]}" ) >/dev/null
    "$BOO" wait "$name" --idle --timeout 30s >/dev/null 2>&1 || true
    # Send the task and submit.
    "$BOO" send "$name" --text "$task" --enter
    echo "spawned '$name' — watch it live with:  boo attach $name   (detach: Ctrl-A d)"
    ;;

  result)
    name=${1:?usage: result <name>}
    "$BOO" peek "$name" --scrollback
    ;;

  wait)
    name=${1:?usage: wait <name> [--timeout DUR]}; shift || true
    to="5m"; [ "${1:-}" = "--timeout" ] && to=$2
    "$BOO" wait "$name" --idle --timeout "$to"
    ;;

  list) "$BOO" ls --json ;;
  kill) name=${1:?usage: kill <name>}; "$BOO" kill "$name" ;;
  *) die "usage: subagent-watch {spawn|result|wait|list|kill} ..." ;;
esac
