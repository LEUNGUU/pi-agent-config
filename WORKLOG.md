# Work Log

## 2026-06-04 — Add Work Logging rule to AGENTS.md
- **What**: Added a "Work Logging" section requiring a structured `WORKLOG.md`, appended incrementally as each step completes (to survive context compaction), with a per-task judgment on whether logging is warranted.
- **Files**: AGENTS.md, WORKLOG.md (new)
- **Why**: User wants every meaningful task step recorded in-repo, structured for traceability, written automatically and step-by-step so nothing is lost to compaction.
- **Verified**: Not verified by build/test (docs/config change). Created this file as the first entry to validate the format end-to-end.
- **Next**: Rule applies going forward; consider whether other repos should adopt the same convention.

## 2026-06-04 — Add WORKLOG read-on-start rule + sync to ~/.pi
- **What**: Added a rule to check/skim `WORKLOG.md` at task start. Copied AGENTS.md to `~/.pi/agent/AGENTS.md` so the local (global) config takes effect immediately.
- **Files**: AGENTS.md, ~/.pi/agent/AGENTS.md (synced copy)
- **Why**: User wants the agent aware of WORKLOG.md (read it on start), and the local config to activate now. `~/.pi/agent/AGENTS.md` is a standalone file kept in sync manually, not a symlink.
- **Verified**: `diff` confirms repo and ~/.pi copies are identical.
- **Next**: Remember to re-sync ~/.pi/agent/AGENTS.md whenever the repo AGENTS.md changes.
