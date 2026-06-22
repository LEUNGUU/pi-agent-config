---
name: boo-terminal
description: >
  Drive interactive terminal programs (REPLs, TUIs, long-running CLIs)
  through Boo, a screen-style terminal multiplexer with a faithful
  libghostty terminal emulator. Use this when you need to start an
  interactive program, send it input, and read its rendered screen
  deterministically — instead of guessing with sleep or losing output
  on detach/reattach. Triggers: "run this TUI", "interact with this
  REPL", "drive an interactive prompt", "program needs a real terminal".
metadata:
  source: github.com/LEUNGUU (migrated from EC2 vault .claude/skills)
---

# Driving interactive terminals with Boo

Boo runs programs in detached sessions whose output is parsed through
Ghostty's VT core, so it always knows the exact screen state. You send
input and read the *rendered* screen back — no real TTY, no sleep-poll.
Everything except `attach` works headless.

## Setup

This skill requires the `boo` binary on `PATH`. Verify before first use:

```bash
command -v boo || echo "boo not installed — install it before using this skill"
```

If `boo` is missing, install/build it (libghostty-based multiplexer) and
ensure it is on `PATH`, then re-check with `boo --help`.

The helper lives at `scripts/boo-interact.sh` (relative to this skill dir).

## The rule that matters

Every interaction follows: send -> wait -> peek. Never peek without
waiting first (you'll catch a half-rendered frame). Never use `sleep` —
`wait` is the deterministic replacement.

The bundled `scripts/boo-interact.sh` does one full round in a single call
and guarantees the order. Prefer it:

    ./scripts/boo-interact.sh <session> '<input>' [--wait-text <str>] [--timeout 30s]

It sends the text, waits for output to settle (or for --wait-text to
appear), then prints the screen as JSON.

## Lifecycle (manual primitives)

1. Start headless:        boo new <session> -d -- <command...>
                          e.g. boo new repl -d -- python3
2. Send + submit:         boo send <session> --text '<input>' --enter
   (--text is LITERAL: no escapes, no implicit newline. Use --enter to
    submit, or --key Enter,C-c,Up to send named control keys.)
3. Wait:                  boo wait <session> --idle --timeout 30s
   or wait for content:   boo wait <session> --text '<expected>' --timeout 30s
4. Read screen as JSON:   boo peek <session> --json
   (--scrollback to include history. This is the reconstructed screen,
    not a raw byte log — parse the JSON, never cat a pty/log file.)
5. Tear down:             boo kill <session>

## Exit codes (check these)

0 success · 1 error · 2 usage · 3 no such session · 4 wait timed out.
On 4, the program is still running but slow — raise --timeout or use
--wait-text to wait for a specific prompt instead of idle.

## Notes / limits

- One window per session: no splits/tabs. One session per task.
- Sessions run with TERM=xterm-256color.
- For heavily-repainting full-screen TUIs, re-peek after each wait;
  don't assume earlier output persists.

## Don'ts

- Don't sleep between send and read — use wait.
- Don't read raw output streams — use peek --json.
- Don't leave sessions running — kill them when done.
- Don't use Boo for simple non-interactive commands; run those with
  Bash directly. Boo is for programs that need a live terminal.
