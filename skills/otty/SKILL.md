---
name: otty
description: Drive Otty, the terminal this session runs inside — see its windows, tabs and panes, split one to work in, run commands there, read back what happened, start a second coding agent and hand it a task or send another pane a message, wait for a command / pane / agent session to finish, open a file or URL in a split or tab. Use when the user types `/otty …`, names Otty or one of its panes / tabs / windows, or asks to "run this in a split", "get another agent on X", "tell the agent in tab 2 to …", "wait for the build", "open X next to me", "do these two in parallel", "keep working while that builds". Requires $OTTY_PANE_ID.
---

# Otty

The instructions for driving Otty ship with Otty itself, so they always match
the CLI that is installed. Load them first, every time this skill is used:

    otty skill show

Then follow what it prints.

If `otty` is not found, you are not running inside Otty — say so and stop. If
it reports `skill` as an unknown command, this Otty predates the bundled
instructions: tell the user to update Otty.

## Local note: waiting on a Pi agent

`otty watch:<agent>` only accepts claude / codex / opencode (checked on Otty
1.6.2). `otty watch:pi` does NOT error: it runs `pi --help` under `otty watch`.
To wait on a Pi (or omp) agent, use its pane instead:

    otty pane wait --pane <pane id>

Find the pane id in `otty pane list --json` (row with `"agent": "Pi"`).
