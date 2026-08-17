# simpledlc build log

Implementation log for `simpledlc-plan.md`.

## Phase 1 — 状态文件 + 返工计数

Completed.

Key points:
- Rewrote `simpledlc.ts` around a durable `simpledlc/<slug>/.state.json` state file.
- Added deterministic state helpers: `readState`, `writeState`, `appendHistory`, state normalization, slug derivation, and latest-state lookup.
- Added event allowlist and newline escaping for history notes, mirroring AIDLC's audit-entry hardening.
- Added `simpledlc_state` tool for deterministic transitions: `plan_saved`, `build_started`, `build_done`, `review_saved`, `complete`, `abort`.
- `review_saved` with `NEEDS_CHANGES` increments `review_round` in code rather than relying on prompt memory.
- Added `/simpledlc-status [slug]` for inspecting latest or named workflow state.
- Validation: `bun build simpledlc.ts --target=node --outfile=/tmp/simpledlc-phase1.js` passed.

Implementation note:
- Avoided `@sinclair/typebox` because this global extension context did not resolve it during `bun build`; used a plain JSON schema object for the tool parameters instead.

## Phase 2 — 逃生舱止损

Completed.

Key points:
- Added deterministic escape-hatch handling inside the `review_saved` transition.
- When `review_saved` records `NEEDS_CHANGES`, `review_round` is incremented in code.
- At `review_round == MAX_REVIEW_ROUNDS - 1`, history records the AIDLC-style warning that one more failed review will expose the escape hatch.
- At `review_round >= MAX_REVIEW_ROUNDS` and no prior escape hatch, the tool records `ESCAPE_HATCH_OFFERED` and asks the human via `ctx.ui.select`:
  - Continue fixing → phase moves to `build`, records `REVISION_REQUESTED`
  - Accept as-is → phase moves to `done`, verdict becomes `APPROVED`, records `ESCAPE_HATCH_ACCEPTED` + `WORKFLOW_COMPLETED`
  - Abort workflow → phase moves to `aborted`, records `WORKFLOW_ABORTED`
- If UI is unavailable, the tool records a stop-and-ask note instead of silently continuing.
- Validation: `bun build simpledlc.ts --target=node --outfile=/tmp/simpledlc-phase2.js` passed.

## Phase 3 — 前进循环（半机制）

Completed.

Key points:
- Added an `agent_end` observer that scans the latest project-local simpledlc state.
- If the latest workflow is not `done` or `aborted`, the observer computes a durable progress signature: `phase::review_round::verdict`.
- Added a persisted `guard` counter in `.state.json`, mirroring AIDLC's NO-PROGRESS guard but adapted to simpledlc's JSON state.
- On no-progress observations, the extension records `NO_PROGRESS_OBSERVED` and injects a phase-specific continuation reminder via `pi.sendUserMessage(..., { deliverAs: "followUp" })`.
- Added `NO_PROGRESS_CAP = 2`; after the cap, the extension records the cap event and stops injecting reminders to avoid a stuck loop.
- Validation: `bun build simpledlc.ts --target=node --outfile=/tmp/simpledlc-phase3.js` passed.

Known limitation:
- This is a half-mechanism only. pi `agent_end` / `turn_end` handlers return void and cannot hard-block the turn like AIDLC's Stop hook `{decision:"block"}` contract.

## Phase 4 — 路径注入 + agent 联动

Completed.

Key points:
- Updated `/simpledlc`'s injected directive to use the concrete slug and concrete artifact paths instead of relying on agent memory.
- Updated continuation reminders to include concrete paths for `plan.md`, `build-log.md`, and `review.md`.
- Builder continuation now instructs revision rounds to read existing `review.md` and append `## Fix round N` to `build-log.md`.
- Reviewer continuation now instructs reviews to append under `## Review round N` and compare prior review findings when present.
- `review_saved` with verdict `APPROVED` now deterministically transitions the workflow to `done` and records `WORKFLOW_COMPLETED`.
- Updated global `builder.md` prompt so revision work reads `review.md`, handles Critical/High findings first, and records fixes under `## Fix round N`.
- Updated global `reviewer.md` prompt so revision reviews read prior `review.md`, classify prior Critical/High findings as RESOLVED / STILL OPEN / SUPERSEDED, and start with `## Review round N`.
- Validation: `bun build simpledlc.ts --target=node --outfile=/tmp/simpledlc-phase4.js` passed.

## Final validation

Completed.

Checks:
- `bun build simpledlc.ts --target=node --outfile=/tmp/simpledlc-phase4.js` passed after all code and prompt changes.
- Runtime smoke test with a fake pi API passed:
  - `/simpledlc add a test resource` created `simpledlc/add-a-test-resource/.state.json` and injected the directive.
  - `simpledlc_state` transitions worked for `plan_saved`, `build_started`, `build_done`, and three `review_saved NEEDS_CHANGES` calls.
  - `review_round` reached 3.
  - `escape_hatch_offered` became true.
  - `ESCAPE_HATCH_OFFERED` was recorded in history.
  - Newlines in history notes were escaped as `\\n`.
- Temporary smoke-test files/workspace were removed.

## Phase 3 adjustment — do not inject while waiting for human review

Completed.

Key points:
- Added `latestEvent()` and `isWaitingForHuman()` guards.
- The `agent_end` observer now skips continuation injection after waiting-point events: `WORKFLOW_STARTED`, `PLAN_SAVED`, `BUILD_DONE`, `REVIEW_SAVED`, and `ESCAPE_HATCH_OFFERED`.
- This preserves the chosen simpledlc interaction model: plan → stop for approval → build → stop → review → stop.
- Validation: final `bun build simpledlc.ts --target=node --outfile=/tmp/simpledlc-final.js` passed.

## Final runtime smoke after Phase 3 adjustment

Completed.

Checks:
- Imported `simpledlc.ts` with a fake pi API.
- Verified extension registration: `agent_end`, `simpledlc_state`, `/simpledlc`, `/simpledlc-status`.
- Ran `/simpledlc add a test resource` and all key `simpledlc_state` transitions.
- Verified final state after three NEEDS_CHANGES reviews: `review_round=3`, `escape_hatch_offered=true`.
- Removed temporary smoke-test workspace and script.

## Post-review rewrite (critic findings addressed)

Two critics (deepseek, glm) plus my own source verification found real bugs. Fixed:

- **C1 (Critical) — wrong registerTool API.** The `simpledlc_state` tool was registered with `handler:` + plain-JSON `parameters` + `{output}` return. Verified against `docs/extensions.md:1320` and `types.d.ts:335`: pi requires `label`, TypeBox `parameters` (`import { Type } from "typebox"`), an `async execute(toolCallId, params, signal, onUpdate, ctx)` method, and a `{content:[{type:"text",text}]}` return. The prior "smoke OK" was a FALSE POSITIVE (it called my object's `.handler`, not pi's `.execute`). Rewrote the tool correctly.
- **C2 (Critical) — agent_end fires for sub-agents.** Verified via `@tintinweb/pi-subagents/dist/agent-runner.js:468`: sub-agents run in-process via `createAgentSession` + `bindExtensions`, so `session_start` re-registers the handler and each planner/builder/reviewer completion fired `agent_end`, corrupting parent state. Decision (user chose A): removed the entire Phase 3 `pi.on("agent_end")` observer. This also eliminated H4 (isWaitingForHuman missing REVISION_REQUESTED). Phase 3 was always a "half-mechanism / accepted structural gap"; deleting it removes the corruption risk with no real loss.
- **H3 — no-UI escape-hatch deadlock.** Replaced the in-tool `ctx.ui.select` (deadlocked without UI, wrote state twice) with a deterministic model: `review_saved` at round>=3 records `ESCAPE_HATCH_OFFERED` and RETURNS an escape notice in the tool output telling the orchestrator to stop and ask the human. Human resolves via existing `complete` (accept as-is → records ESCAPE_HATCH_ACCEPTED) or `abort`. Works with or without UI. (Deviation from the plan's `ctx.ui.select` approach — that path had the deadlock.)
- **M5 — slug collision.** Added `resolveSlug`: same in-progress task reuses its slug (resume); a different task or a finished workflow that hashes to an existing slug gets a fresh non-colliding slug. New `RESUMING` directive variant.
- **M7 — normalizeState allowlist bypass.** normalizeState now coerces any history event not in EVENT_TYPES to "UNKNOWN" and applies safeNote escaping on load, matching appendHistory.
- **L10 — double writeState** in the escape-hatch path is gone (single write per transition).

Also simplified: removed the `guard` field and the `NO_PROGRESS_CAP`/signature machinery (only the deleted observer used them).

### Verification (real pi call path)
- `bun build simpledlc.ts --target=node --packages=external` passes (typebox resolves from pi's node_modules at runtime).
- Detached runtime smoke invoking `tool.execute(...)` and asserting the `{content:[{type:"text"}]}` shape: happy path, escape-hatch (no-UI, resolvable via complete), slug collision → fresh slug, resume in-progress, tampered-history → UNKNOWN. ALL OK. Also asserted `pi.on` is never called (observer removed).
- Test-harness note: this environment has no `timeout` binary and chained shell commands block on non-exiting bun; ran bun detached (`nohup ... &`) and read an append-only logfile.

## Second review round (3 critics) — findings addressed

Three critics (deepseek/state-machine, kimi/prompt-contract, glm/resolveSlug) reviewed the rewrite. Most flagged items were self-retracted in-body or false positives (escape-hatch off-by-one confirmed correct = 3 strikes; Date.now() race is out of scope for single-process; trailing-space slug edge case is harmless). Real issues fixed:

- **Critical — no state-machine guards.** `applyTransition` accepted any action from any phase: `complete` could jump `plan→done` skipping build/review, `review_saved` could run before build, `plan_saved` could mutate a finished workflow, double `complete` re-logged WORKFLOW_COMPLETED. Added a `LEGAL_FROM` transition table; `applyTransition` now returns `{ok:false,error}` for illegal source phases (terminal phases done/aborted accept nothing) and the tool returns an `ERROR:` notice WITHOUT writing state. This upgrades the constraint from "trust the prompt" to state-machine enforcement — the whole point of using a state file over prose.
- **deepseek #4 — unknown action silently no-ops.** `applyTransition` default branch now returns an error instead of silently succeeding with a stale summary.
- **review_saved without verdict** now returns an error (previously stored "no verdict" and left phase in review).
- **kimi (prompt contract) — step 5 + escape hatch under-specified.** Directive step 5 now names the exact transitions to record on a fix loop (`build_started`/`build_done`/`review_saved`) and states that `complete`/`abort` require the slug.
- **kimi/glm — resume under-specified.** `buildDirective` now maps phase→step (build→"step 3"), never says "Begin at step 1" on resume, and surfaces `escape_hatch_offered` in the resume header so a resumed workflow presents the escape choice instead of looping.
- **glm — UNKNOWN tombstone semantics.** Added a comment documenting that non-allowlist history events coerce to an inert `UNKNOWN` tombstone (no downstream logic branches on event names).

Also simplified: `review_saved` no longer redundantly re-assigns `phase="review"` (guard guarantees it), and the escape-hatch condition no longer re-checks `verdict==="NEEDS_CHANGES"` (unreachable otherwise).

### Verification
- `bun build simpledlc.ts --target=node --packages=external` passes.
- Detached runtime smoke (real `tool.execute` path) — ALL OK across: happy path; illegal-transition guard (review before build, complete from plan, build_done from plan, any transition from done — all rejected, state unchanged); verdict-required guard; escape hatch + legal keep-fixing loop; resume directive (phase→step, no "step 1"); resume-with-escape surfaces the hatch; slug collision → fresh slug; tampered history → UNKNOWN. Asserted `pi.on` is never called.



