---
name: otty
description: Drive Otty, the terminal this session runs inside — see its windows, tabs and panes, split one to work in, run commands there, read back what happened, start a second coding agent and hand it a task, wait for any of it to finish. Use when the user types `/otty …`, names Otty or one of its panes / tabs / windows, or asks to "run this in a split", "get another agent on X", "do these two in parallel", "keep working while that builds". Requires $OTTY_PANE_ID.
---

# Otty

Otty is the terminal you are running inside. Its CLI turns the window around you
into workspace you can lay out, start work in, and read back from — so long work
happens beside the user instead of blocking this conversation.

## Check you are inside Otty first

    test -n "$OTTY_PANE_ID"

If it is empty, say you are not running in an Otty pane and stop. Everything
below drives a running app over its control socket; from outside there is
nothing to drive, and `otty` exits 3.

Over SSH it is empty too, and that is not something to work around. When
`$OTTY_REMOTE` or `$SSH_CONNECTION` is set, you are on a remote host reached
from an Otty pane: nothing here can reach the Otty on the user's computer
except `otty view` / `edit` / `jump` / `learn` / `ignore`, which travel back
over the terminal one way and return nothing. Say that splitting panes,
running commands in them, reading them back and starting other agents need an
agent running on the computer where Otty runs, and stop. Do not try `ssh`
back, port forwarding, or any other route to Otty's socket.

`$OTTY_PANE_ID` is YOUR pane (a selector takes it with or without the `p_`
prefix). Pass it whenever a command should act on this pane — with no `--pane`
the target is whatever the user has focused, which is often somewhere else.

## Map the workspace before you change it

    otty pane list --json
    otty tab list --json
    otty window list --json

One row per pane: `id`, `tab_id`, `window_id`, `index`, `active`, `cwd`,
`process`, `cols` / `rows`, and — when a coding agent occupies it — `agent`
("Claude Code", "Codex", …), `agent_session_id` and `agent_state`:

| `agent_state` | Means |
| --- | --- |
| `processing` | working on a turn |
| `idle` | done, ready for input |
| `awaiting` | stopped on a question or an approval — a human is needed |
| `unknown` | an agent is there but has not reported yet |
| `""` | no agent in this pane at all |

Match the user's words ("the build tab", "the agent next door") against those
fields. Read every id out of the JSON; never guess one from sidebar order or
from an example here.

## Open a pane to work in

    otty pane split --pane "$OTTY_PANE_ID" --direction right \
        --cwd "$PWD" --no-focus --json        # → { "data": { "id": "p_…" } }

| Flag | Meaning |
| --- | --- |
| `--direction` | `right` · `left` · `down` · `up` (required) |
| `--cwd` | a path, or `current` to inherit the anchor pane's |
| `--size` | the NEW pane's share of the split, 10–90 |
| `--command` | typed into the new shell, so the pane outlives the command |
| `--no-focus` | leave the user where they were |
| `--title` | name the pane in the tab and sidebar |

Split a wide pane to the right and a tall or narrow one down — check `cols` /
`rows` from the pane list rather than splitting the same way twice and leaving a
column nothing can be read in. Prefer a sibling pane in the current tab; only
reach for `otty tab new` or `otty window new` when the user asks for a tab or a
window. Keep `--no-focus` on for background work: stealing focus mid-sentence is
the one thing that makes this feel broken.

## Run something in that pane

| You need | Command |
| --- | --- |
| pass / fail, and the exit code | `otty pane run --pane <id> -- <cmd>` |
| the output text, streams apart | `otty pane exec --pane <id> --json -- <cmd>` |
| what is on screen right now | `otty pane capture --pane <id> --lines 200` |

`run` submits the command, blocks until the pane is back at a prompt, and exits
with the command's own code — so `otty pane run … && …` composes like any other
command. `exec` is `run` plus captured `stdout` / `stderr` (it redirects stderr,
so that stream is no longer a tty and may lose colour). Both need
[shell integration](https://doc.otty.sh/terminal-features/shell-integration)
(OSC 133) live in the target pane, which an Otty-spawned shell has by default,
and both stop waiting after 10 minutes — pass `--timeout <ms>` for anything
longer:

    otty pane run --pane p_x --timeout 1800000 -- cargo build --release

`capture` reads the rendered grid instead: `--scope viewport` (default) or
`--scope scrollback`, `--lines N` for the last N rows, `--ansi` to keep colour,
`--trim` to drop trailing blanks. Use it for a TUI, a pager, or an agent's
conversation — anything where the screen, not an exit code, is the answer.

## Put a second agent to work

Start it in its own pane, wait until it is really up, then talk to it:

    otty pane split --pane "$OTTY_PANE_ID" --direction right \
        --cwd "$PWD" --no-focus --command claude --json

Then re-read `otty pane show --pane <id> --json` every few seconds until `agent`
and `agent_session_id` are populated — that is the agent's own lifecycle hook
reporting in, and it is the only proof the agent came up rather than a shell
echoing a typo. This is the ONE thing here you have to poll for; give up after
about half a minute.

Don't skip it and `wait` on the pane instead: a shell sitting at its prompt is
already idle, so the wait returns instantly and you conclude the work is done
before it started. If the fields stay empty the agent has no
[integration installed](https://doc.otty.sh/agents/setup) — say so, and read it
with `capture` from then on, because `wait` will never work on it either.

Send the prompt and the Enter as two calls — a trailing newline can land as a
line break inside a TUI composer instead of submitting it:

    otty pane send-text --pane <id> "review the diff and report only real bugs"
    otty pane send-keys --pane <id> key:Enter

Then wait for it and read the reply:

    otty watch:claude <agent_session_id>       # also watch:codex, watch:opencode
    otty pane capture --pane <id> --lines 200

`send-text` interprets C escapes (`\n`, `\x03` for Ctrl-C, `\e` for Esc), so
control keys are just bytes. A deliberately multi-line message needs
`--raw-newlines`, or every newline arrives as Enter and the composer submits at
the first line. Text that must survive backslashes verbatim wants `--no-escape`,
or `--from-file <path>` to sidestep quoting entirely.

## Wait for everything, then report

| Waiting on | Command |
| --- | --- |
| a command you start now | `otty watch -- <cmd>` |
| a command already running in a pane | `otty pane wait --pane <id>` |
| every split in a tab | `otty pane wait --tab <id>` |
| every pane in a window | `otty pane wait --window <id>` |
| a coding-agent session | `otty watch:<agent> <session-id>` |

Each of these is ONE foreground command whose exit IS the signal. Let it block —
never re-implement it as a `sleep` loop that re-checks, which is how a wait
silently becomes a guess.

A pane running an agent counts as idle when the AGENT reports idle: an agent
owns its terminal for its whole life, so the shell's view of it would be "busy
forever". `--settle-ms` (default 400) is how long a pane must stay quiet to
count — raise it when you start waiting the instant after submitting work.
`--timeout-secs` defaults to 0, which waits forever.

An agent that stops on a question reports `awaiting`, not `idle`, and the wait
keeps blocking. If one is taking implausibly long, check `agent_state` before
waiting further: `awaiting` means it needs a human, so tell the user which pane
rather than sitting on the wait.

If your own tool times out mid-wait, re-issue the identical command: these waits
are idempotent and just block again from wherever things now stand.

## Link the user back to a line

    otty pane link --pane <id> --last-command     # → otty://pane/p_x?line=1204
    otty pane link --pane <id> --line 1204
    otty pane link --pane <id>                    # the pane, no particular line

Prints one `otty://` URL and nothing else. Opening it — clicking it, or
`otty pane focus 'otty://pane/p_x?line=1204'` — raises that window, switches to
that tab, focuses that pane and scrolls that line into view with a blink.

Put one in your report whenever the thing you are describing is on screen
somewhere the user would otherwise have to hunt for: the failure 300 lines up,
the build you ran in a background split, the pane the second agent is working
in. "The build failed — otty://pane/p_19f?line=1204" beats a pasted stack trace.

`--last-command` resolves to the newest shell-integration command in that pane,
so you link to the command you just ran without counting lines. It needs OSC 133
live in that pane (same requirement as `run` / `exec`); without it, exit 4.

The line number is the pane's scrollback position as it stands right now, so a
link is a handle on a live pane rather than an archive reference — it drifts
once that buffer overflows or a resize re-wraps the rows above. Hand one over
while it is fresh; don't save it for a later session.

## Clean up

    otty pane close --pane <id> --force

`--force` skips the confirmation dialog a pane with a live process would
otherwise raise, which nothing scripted can dismiss. Close ONLY panes you
opened, and only once you have read what you needed out of them — a closed pane
takes its scrollback with it. Leave the user's panes, tabs and windows alone
unless they asked.

## Permission and refusals

`send-text` and `send-keys` are gated by `ipc-allow-send-keys`, which is OFF by
default; while it is off they exit 7. Point the user at Otty ▸ Settings ▸
Agents ▸ Skills, or at:

    otty config set ipc-allow-send-keys true --reload

Panes Otty considers sensitive — an SSH session, or one in sudo mode — refuse
input regardless unless `ipc-allow-sensitive-sessions` is also on. That refusal
is exit 7 too. `split`, `run`, `capture` and `wait` are not gated.

Exit codes: 0 ok · 2 bad flags · 3 no running Otty · 4 nothing matched the
selector · 5 the selector was ambiguous · 6 the pane cannot report completion ·
7 disabled or refused · 9 timed out.

## Rules

1. Plan the layout before you build it. Say what you are about to open and
   where, in one line, then open it — a user who did not expect a split reads it
   as the terminal misbehaving.
2. Target `$OTTY_PANE_ID` or an id you read from JSON. Relying on the focused
   pane means writing into whatever the user clicked on last.
3. Never send a command into a pane you have not identified. `send-text` is
   indistinguishable from the user typing, and the wrong pane runs it.
4. Report where work is happening ("building in p_19f… on the right"), so a
   mis-aimed split is obvious immediately instead of at the end. When the answer
   is a specific line of that pane, `otty pane link` it rather than describing
   where to scroll.
5. Don't close, kill or reuse a pane you did not create — including the one you
   are in. Killing your own pane kills this conversation with it.
6. When a wait exits 6, or an agent never reports a session id, say so verbatim
   and stop. Both mean the thing you were about to wait for cannot report
   completion; guessing with `sleep` produces confident nonsense.
7. Don't answer another agent's question for it. `awaiting` means it is asking a
   human — surface the question and let the user decide.
