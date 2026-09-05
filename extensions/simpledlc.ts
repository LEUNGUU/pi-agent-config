// ABOUTME: /simpledlc <task> — stepwise plan→build→review workflow with durable state.
// ABOUTME: Keeps the lightweight simpledlc orchestration recoverable across sessions.

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MAX_REVIEW_ROUNDS = 3;

const SIMPLE_DLC_DIR = "simpledlc";
const STATE_FILE = ".state.json";

const PHASES = ["plan", "build", "review", "done", "aborted"] as const;

const EVENT_TYPES = new Set([
	"WORKFLOW_STARTED",
	"PLAN_SAVED",
	"PLAN_APPROVED",
	"BUILD_STARTED",
	"BUILD_DONE",
	"REVIEW_SAVED",
	"REVISION_REQUESTED",
	"ESCAPE_HATCH_OFFERED",
	"ESCAPE_HATCH_ACCEPTED",
	"WORKFLOW_COMPLETED",
	"WORKFLOW_ABORTED",
]);

type Phase = (typeof PHASES)[number];
type Verdict = "APPROVED" | "NEEDS_CHANGES" | null;

interface HistoryEntry {
	ts: string;
	event: string;
	phase: Phase;
	round: number;
	note: string;
}

interface SimpleDlcState {
	slug: string;
	task: string;
	phase: Phase;
	review_round: number;
	verdict: Verdict;
	plan_approved: boolean;
	escape_hatch_offered: boolean;
	history: HistoryEntry[];
}

function isoTimestamp(): string {
	return new Date().toISOString();
}

function hashString(input: string): string {
	let hash = 5381;
	for (let i = 0; i < input.length; i++) hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
	return (hash >>> 0).toString(36).slice(0, 6);
}

function isPhase(value: unknown): value is Phase {
	return PHASES.includes(value as Phase);
}

function baseSlug(task: string): string {
	const base = task
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48)
		.replace(/-+$/g, "");
	return base || `task-${hashString(task)}`;
}

function workflowDir(cwd: string, slug: string): string {
	return join(cwd, SIMPLE_DLC_DIR, slug);
}

function statePath(cwd: string, slug: string): string {
	return join(workflowDir(cwd, slug), STATE_FILE);
}

function initialState(slug: string, task: string): SimpleDlcState {
	return {
		slug,
		task,
		phase: "plan",
		review_round: 0,
		verdict: null,
		plan_approved: false,
		escape_hatch_offered: false,
		history: [],
	};
}

function normalizeState(raw: unknown, slug: string, task: string): SimpleDlcState {
	const input = raw && typeof raw === "object" ? (raw as Partial<SimpleDlcState>) : {};
	const parsedRound = Number.isFinite(Number(input.review_round)) ? Math.max(0, Math.trunc(Number(input.review_round))) : 0;
	const phase: Phase = isPhase(input.phase) ? input.phase : "plan";
	const verdict: Verdict = input.verdict === "APPROVED" || input.verdict === "NEEDS_CHANGES" ? input.verdict : null;
	const history = Array.isArray(input.history)
		? input.history.filter(Boolean).map((entry: any) => {
				// "UNKNOWN" is an intentional tombstone: any event not in the allowlist
				// (corrupt/hand-edited state) is preserved as a placeholder rather than
				// dropped, so the audit trail keeps its length and ordering. No downstream
				// logic branches on history event names, so the tombstone is inert.
				const event = typeof entry.event === "string" && EVENT_TYPES.has(entry.event) ? entry.event : "UNKNOWN";
				return {
					ts: typeof entry.ts === "string" ? entry.ts : isoTimestamp(),
					event,
					phase: isPhase(entry.phase) ? entry.phase : phase,
					round: Number.isFinite(Number(entry.round)) ? Math.max(0, Math.trunc(Number(entry.round))) : parsedRound,
					note: typeof entry.note === "string" ? safeNote(entry.note) : "",
				};
			})
		: [];
	return {
		slug: typeof input.slug === "string" && input.slug ? input.slug : slug,
		task: typeof input.task === "string" && input.task ? input.task : task,
		phase,
		review_round: parsedRound,
		verdict,
		plan_approved: Boolean(input.plan_approved),
		escape_hatch_offered: Boolean(input.escape_hatch_offered),
		history,
	};
}

function readState(cwd: string, slug: string, task = ""): SimpleDlcState {
	const path = statePath(cwd, slug);
	if (!existsSync(path)) return initialState(slug, task);
	try {
		return normalizeState(JSON.parse(readFileSync(path, "utf-8")), slug, task);
	} catch {
		return initialState(slug, task);
	}
}

function writeState(cwd: string, state: SimpleDlcState): void {
	const dir = workflowDir(cwd, state.slug);
	mkdirSync(dir, { recursive: true });
	writeFileSync(statePath(cwd, state.slug), `${JSON.stringify(state, null, 2)}\n`, "utf-8");
}

function safeNote(note: string | undefined): string {
	return String(note ?? "").replace(/\r?\n/g, "\\n");
}

// Tool-result shape required by registerTool (details is mandatory).
function toolText(text: string) {
	return { content: [{ type: "text" as const, text }], details: undefined };
}

function appendHistory(state: SimpleDlcState, event: string, note?: string): void {
	if (!EVENT_TYPES.has(event)) throw new Error(`Invalid simpledlc event: ${event}`);
	state.history.push({
		ts: isoTimestamp(),
		event,
		phase: state.phase,
		round: state.review_round,
		note: safeNote(note),
	});
}

function latestStatePath(cwd: string): string | undefined {
	const root = join(cwd, SIMPLE_DLC_DIR);
	if (!existsSync(root)) return undefined;
	const candidates: { path: string; mtimeMs: number }[] = [];
	for (const name of readdirSync(root)) {
		const path = join(root, name, STATE_FILE);
		if (!existsSync(path)) continue;
		try {
			candidates.push({ path, mtimeMs: statSync(path).mtimeMs });
		} catch {
			// Unreadable candidate: skip but keep scanning others.
		}
	}
	return candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.path;
}

// Resolve the slug for a /simpledlc invocation, avoiding clobbering unrelated
// or finished workflows that happen to hash to the same base slug.
function resolveSlug(cwd: string, task: string): { slug: string; resume: boolean } {
	const base = baseSlug(task);
	if (!existsSync(statePath(cwd, base))) return { slug: base, resume: false };
	const existing = readState(cwd, base);
	// Same task, still in progress → resume the existing workflow in place.
	if (existing.task === task && existing.phase !== "done" && existing.phase !== "aborted") {
		return { slug: base, resume: true };
	}
	// Different task, or a finished workflow → allocate a fresh, non-colliding slug.
	const suffix = hashString(`${task}:${Date.now()}`);
	let candidate = `${base}-${suffix}`;
	let n = 1;
	while (existsSync(statePath(cwd, candidate))) candidate = `${base}-${suffix}-${n++}`;
	return { slug: candidate, resume: false };
}

function summarizeState(state: SimpleDlcState): string {
	return [
		`simpledlc/${state.slug}`,
		`phase: ${state.phase}`,
		`review_round: ${state.review_round}`,
		`verdict: ${state.verdict ?? "none"}`,
		`plan_approved: ${state.plan_approved}`,
		`escape_hatch_offered: ${state.escape_hatch_offered}`,
		`history_events: ${state.history.length}`,
	].join("\n");
}

// Latest workflow in this project that is still in flight (not done/aborted).
function latestInProgress(cwd: string): SimpleDlcState | undefined {
	const latest = latestStatePath(cwd);
	if (!latest) return undefined;
	try {
		const raw = JSON.parse(readFileSync(latest, "utf-8"));
		const state = normalizeState(raw, raw.slug ?? "unknown", raw.task ?? "");
		return state.phase === "done" || state.phase === "aborted" ? undefined : state;
	} catch {
		return undefined;
	}
}

function statusText(state: SimpleDlcState): string {
	const pending = state.phase === "plan" && !state.plan_approved ? " (awaiting plan approval)" : "";
	return `simpledlc/${state.slug} · ${state.phase}${pending} · round ${state.review_round}`;
}

function buildDirective(task: string, slug: string, resume: boolean, phase: Phase, escapeOffered: boolean): string {
	const phaseToStep: Record<Phase, string> = {
		plan: "step 2 (Plan)",
		build: "step 3 (Build)",
		review: "step 4 (Review)",
		done: "nothing — this workflow is already done",
		aborted: "nothing — this workflow was aborted",
	};
	const header = resume
		? [
				`RESUMING the **simpledlc** workflow for slug \`${slug}\` (current phase: ${phase}).`,
				`Read \`simpledlc/${slug}/${STATE_FILE}\` and continue from ${phaseToStep[phase]} — do NOT restart from step 1.`,
				...(escapeOffered
					? [`The escape hatch is ALREADY OFFERED: STOP and ask the human to keep fixing, accept as-is (\`complete\`), or abort (\`abort\`).`]
					: []),
				``,
				`> ${task}`,
				``,
			]
		: [
				`Run the **simpledlc** stepwise plan→build→review workflow for this task:`,
				``,
				`> ${task}`,
				``,
			];
	return [
		...header,
		`The deterministic workflow state is in \`simpledlc/${slug}/${STATE_FILE}\`.`,
		`Use the \`simpledlc_state\` tool to record every transition; do not hand-edit the state file.`,
		``,
		`You are the orchestrator; planner, builder, and reviewer are global custom agents you`,
		`spawn with the Agent tool. Each agent writes its OWN artifact file under`,
		`\`simpledlc/${slug}/\` (planner → plan.md, builder → build-log.md + code, reviewer →`,
		`review.md); you do NOT relay their markdown to disk. planner/reviewer are limited to`,
		`their one doc; builder writes project code. Stop for my review between steps.`,
		``,
		`1. **Slug.** Use this exact slug: \`${slug}\`. All artifacts live in \`simpledlc/${slug}/\``,
		`   relative to the project root.`,
		``,
		`2. **Plan.** Spawn \`Agent({ subagent_type: "planner", ... })\`, telling it the task and`,
		`   the slug \`${slug}\`. It writes \`simpledlc/${slug}/plan.md\` itself and returns a short`,
		`   summary. Then call \`simpledlc_state\` with action \`plan_saved\`, slug \`${slug}\`, and a`,
		`   short note. Show me the plan (read plan.md for the detail), then call the`,
		`   \`simpledlc_gate\` tool with slug \`${slug}\` — it renders an approve/changes/abort`,
		`   selector and records \`plan_approved\` on approval. The state machine BLOCKS building`,
		`   until the gate approves. If I request changes, re-spawn planner with my feedback (it`,
		`   overwrites plan.md), record \`plan_saved\` again, and present the gate again. EXCEPTION:`,
		`   for mechanical edits that don't change the plan's substance (translation, wording,`,
		`   formatting, typos), edit plan.md yourself directly — do NOT re-spawn planner — then`,
		`   record \`plan_saved\` and present the gate again.`,
		``,
		`3. **Build.** Only after the gate approves the plan: if the plan has 3+ implementation`,
		`   nodes, use prewalk — first spawn \`Agent({ subagent_type: "builder-frontier", ... })\``,
		`   telling it the slug \`${slug}\` and which node is first; it implements ONLY that node`,
		`   and writes pattern notes into build-log.md. Then spawn \`Agent({ subagent_type:`,
		`   "builder", ... })\` for the remaining nodes, telling it to follow the exemplar and`,
		`   pattern notes in build-log.md. For small plans (1–2 nodes) or revision rounds, spawn`,
		`   just \`builder\`. Builders read plan.md and, on revision rounds, existing review.md;`,
		`   they write/append \`simpledlc/${slug}/build-log.md\` themselves. Record \`build_started\``,
		`   before the first builder spawn and \`build_done\` after the last one finishes.`,
		`   STOP and summarize what changed. Wait for me before review.`,
		``,
		`4. **Review.** Spawn \`Agent({ subagent_type: "reviewer", ... })\`, telling it the slug`,
		`   \`${slug}\`. It reads plan.md + build-log.md + existing review.md + \`git diff\`, and`,
		`   writes/appends \`simpledlc/${slug}/review.md\` itself (\`## Review round N\`). From its`,
		`   summary, record \`review_saved\` with verdict APPROVED or NEEDS_CHANGES. STOP and show`,
		`   me the review.`,
		``,
		`5. **Iterate.** If the verdict is NEEDS_CHANGES and I want a fix, re-spawn builder`,
		`   (recording \`build_started\` before and \`build_done\` after), then re-spawn reviewer`,
		`   (recording \`review_saved\` with a verdict). Always pass slug \`${slug}\` to every`,
		`   \`simpledlc_state\` call. If \`simpledlc_state\` reports the escape hatch is offered,`,
		`   STOP and ask me to choose: keep fixing, accept as-is (call \`simpledlc_state\` action`,
		`   \`complete\` with slug \`${slug}\`), or abort (action \`abort\` with slug \`${slug}\`).`,
		`   Otherwise we're done when the verdict is APPROVED.`,
		``,
		`6. **Promote (optional).** After APPROVED, offer to spawn \`Agent({ subagent_type:`,
		`   "promoter", ... })\` with the slug \`${slug}\`; it reads the artifacts + diff and`,
		`   writes \`simpledlc/${slug}/promote.md\` (PR description, changelog entry). Skip if I`,
		`   decline. Then record \`complete\`.`,
		``,
		resume ? `Resume now at ${phaseToStep[phase]}.` : `Begin at step 1 now.`,
	].join("\n");
}

const gateToolParameters = Type.Object({
	slug: Type.String({ description: "The simpledlc task slug" }),
	summary: Type.Optional(
		Type.String({ description: "One-line plan summary shown above the choices (optional)" }),
	),
});

const stateToolParameters = Type.Object({
	action: Type.Union(
		[
			Type.Literal("plan_saved"),
			Type.Literal("plan_approved"),
			Type.Literal("build_started"),
			Type.Literal("build_done"),
			Type.Literal("review_saved"),
			Type.Literal("complete"),
			Type.Literal("abort"),
		],
		{ description: "The workflow transition to record" },
	),
	slug: Type.String({ description: "The simpledlc task slug" }),
	verdict: Type.Optional(
		Type.Union([Type.Literal("APPROVED"), Type.Literal("NEEDS_CHANGES")], {
			description: "Required for review_saved: the reviewer's verdict",
		}),
	),
	note: Type.Optional(Type.String({ description: "Short human-readable note for the audit trail" })),
});

// Legal source phases per action. The state machine REJECTS any transition whose
// current phase is not listed here, so a mis-driven orchestrator cannot skip build/
// review (e.g. `complete` straight from `plan`) or mutate a finished workflow.
// Terminal phases (done, aborted) accept nothing — re-run /simpledlc for new work.
const LEGAL_FROM: Record<string, Phase[]> = {
	plan_saved: ["plan"],
	plan_approved: ["plan"],
	build_started: ["plan", "build", "review"],
	build_done: ["build"],
	review_saved: ["review"],
	complete: ["review"],
	abort: ["plan", "build", "review"],
};

type TransitionResult = { ok: false; error: string } | { ok: true; notice?: string };

function applyTransition(state: SimpleDlcState, action: string, verdict?: Verdict, note?: string): TransitionResult {
	const legalFrom = LEGAL_FROM[action];
	if (!legalFrom) return { ok: false, error: `Unknown transition "${action}".` };
	if (!legalFrom.includes(state.phase)) {
		return {
			ok: false,
			error: `Illegal transition "${action}" from phase "${state.phase}". Legal source phases: ${legalFrom.join(", ")}. State unchanged.`,
		};
	}
	if (action === "review_saved" && verdict !== "APPROVED" && verdict !== "NEEDS_CHANGES") {
		return { ok: false, error: `review_saved requires verdict APPROVED or NEEDS_CHANGES. State unchanged.` };
	}
	switch (action) {
		case "plan_saved":
			state.phase = "plan";
			state.verdict = null;
			// A (re)saved plan always needs a fresh human approval.
			state.plan_approved = false;
			appendHistory(state, "PLAN_SAVED", note);
			return { ok: true };
		case "plan_approved":
			if (state.plan_approved) return { ok: false, error: `Plan is already approved. State unchanged.` };
			state.plan_approved = true;
			appendHistory(state, "PLAN_APPROVED", note);
			return { ok: true };
		case "build_started":
			if (state.phase === "plan" && !state.plan_approved) {
				return {
					ok: false,
					error: `The plan has not been approved by the human. Present the plan with the simpledlc_gate tool (or ask directly) and record plan_approved first. State unchanged.`,
				};
			}
			state.phase = "build";
			appendHistory(state, "BUILD_STARTED", note);
			return { ok: true };
		case "build_done":
			state.phase = "review";
			appendHistory(state, "BUILD_DONE", note);
			return { ok: true };
		case "review_saved": {
			state.verdict = verdict ?? null;
			if (verdict === "NEEDS_CHANGES") state.review_round += 1;
			appendHistory(state, "REVIEW_SAVED", `${verdict ?? "no verdict"}${note ? ` — ${note}` : ""}`);
			if (verdict === "APPROVED") {
				state.phase = "done";
				appendHistory(state, "WORKFLOW_COMPLETED", "Review approved the implementation.");
				return { ok: true };
			}
			if (state.review_round === MAX_REVIEW_ROUNDS - 1) {
				appendHistory(state, "REVISION_REQUESTED", "After one more failed review, the escape hatch becomes available.");
			}
			if (state.review_round >= MAX_REVIEW_ROUNDS) {
				if (!state.escape_hatch_offered) {
					state.escape_hatch_offered = true;
					appendHistory(state, "ESCAPE_HATCH_OFFERED", `Review round ${state.review_round} reached the escape-hatch threshold.`);
				}
				return {
					ok: true,
					notice:
						`ESCAPE HATCH OFFERED after ${state.review_round} NEEDS_CHANGES rounds. STOP and ask the human to choose:\n` +
						`  - keep fixing (re-spawn builder, recording build_started then build_done, then reviewer), or\n` +
						`  - accept as-is (call simpledlc_state action "complete" with this slug), or\n` +
						`  - abort (call simpledlc_state action "abort" with this slug).`,
				};
			}
			return { ok: true };
		}
		case "complete":
			if (state.escape_hatch_offered && state.verdict === "NEEDS_CHANGES") {
				appendHistory(state, "ESCAPE_HATCH_ACCEPTED", `Accepted as-is after ${state.review_round} review rounds.`);
			}
			state.phase = "done";
			state.verdict = "APPROVED";
			appendHistory(state, "WORKFLOW_COMPLETED", note);
			return { ok: true };
		case "abort":
			state.phase = "aborted";
			appendHistory(state, "WORKFLOW_ABORTED", note);
			return { ok: true };
		default:
			return { ok: false, error: `Unknown transition "${action}".` };
	}
}

export default function (pi: ExtensionAPI) {
	// -----------------------------------------------------------------------
	// Hard gate: block spawning the builder for a simpledlc task whose plan has
	// not been human-approved. Prose alone ("wait for my approval") drifts; the
	// blocking tool_call event makes it mechanical. Scoped narrowly: only fires
	// when the Agent prompt references this project's in-flight simpledlc slug,
	// so unrelated builder spawns are untouched.
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "Agent") return;
		const input = event.input as { subagent_type?: string; prompt?: string };
		if (input?.subagent_type !== "builder" || typeof input.prompt !== "string") return;
		const state = latestInProgress(ctx.cwd);
		if (!state) return;
		if (!input.prompt.includes(`simpledlc/${state.slug}`) && !input.prompt.includes(state.slug)) return;
		if (state.phase === "plan" && !state.plan_approved) {
			return {
				block: true,
				reason:
					`simpledlc: the plan for \`${state.slug}\` has not been approved by the human. ` +
					`Present it with the simpledlc_gate tool (which records plan_approved on approval) before spawning the builder.`,
			};
		}
	});

	// Recovery: after compaction or session resume the orchestrator loses the
	// slug/phase from its context. Re-inject a one-line status of the in-flight
	// workflow into the system prompt so it picks up where it left off instead
	// of restarting from step 1.
	pi.on("before_agent_start", async (event, ctx) => {
		const state = latestInProgress(ctx.cwd);
		if (!state) return;
		return {
			systemPrompt:
				`${event.systemPrompt}\n\n` +
				`[simpledlc] An in-progress workflow exists in this project:\n${summarizeState(state)}\n` +
				`State file: simpledlc/${state.slug}/${STATE_FILE}. If asked to continue this task, resume from the current phase (do NOT restart from planning).`,
		};
	});

	// Statusline: keep the workflow position visible in the footer.
	pi.on("turn_end", async (_event, ctx) => {
		const state = latestInProgress(ctx.cwd);
		ctx.ui.setStatus("simpledlc", state ? statusText(state) : undefined);
	});

	// Structured approval gate: single-select (approve / changes / abort +
	// free-text via Other). Approval and abort drive the state machine directly,
	// so the human's click IS the transition — no separate bookkeeping call the
	// orchestrator could forget or fake.
	pi.registerTool({
		name: "simpledlc_gate",
		label: "simpledlc plan gate",
		description:
			"Present the simpledlc plan approval gate to the human. On 'Approve' it records plan_approved; on 'Abort' it aborts the workflow. Returns the human's choice. Call this after plan_saved, before building.",
		parameters: gateToolParameters,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
			const state = readState(ctx.cwd, params.slug);
			if (state.phase !== "plan") {
				return toolText(`ERROR: gate applies to phase "plan" only (current: ${state.phase}).\n\n${summarizeState(state)}`);
			}
			if (!ctx.hasUI) {
				// Non-interactive: never auto-approve; the gate holds.
				return toolText("No interactive UI available; the plan gate remains held (no answer).");
			}
			const title = params.summary
				? `simpledlc/${params.slug} — approve this plan?\n${params.summary}`
				: `simpledlc/${params.slug} — approve this plan?`;
			const picked = await ctx.ui.select(title, [
				"Approve — proceed to build",
				"Request changes — revise the plan",
				"Abort — stop this workflow",
				"Other — type feedback",
			]);
			if (picked === undefined) {
				return toolText("User dismissed the gate without answering; the plan gate remains held.");
			}
			if (picked.startsWith("Approve")) {
				const result = applyTransition(state, "plan_approved", null, "Approved via simpledlc_gate.");
				if (!result.ok) return toolText(`ERROR: ${result.error}\n\n${summarizeState(state)}`);
				writeState(ctx.cwd, state);
				return toolText(`Plan APPROVED (plan_approved recorded). Proceed to build.\n\n${summarizeState(state)}`);
			}
			if (picked.startsWith("Abort")) {
				const result = applyTransition(state, "abort", null, "Aborted via simpledlc_gate.");
				if (!result.ok) return toolText(`ERROR: ${result.error}\n\n${summarizeState(state)}`);
				writeState(ctx.cwd, state);
				return toolText(`Workflow ABORTED.\n\n${summarizeState(state)}`);
			}
			let answer = picked;
			if (picked.startsWith("Other")) {
				const typed = await ctx.ui.input("Describe your feedback on the plan", "");
				answer = typed && typed.trim().length > 0 ? `Other: ${typed.trim()}` : picked;
			}
			return toolText(
				`User answered: ${answer}\nThe plan is NOT approved. Revise it (re-spawn planner, record plan_saved) and present the gate again.`,
			);
		},
	});

	pi.registerTool({
		name: "simpledlc_state",
		label: "simpledlc state",
		description:
			"Record a deterministic simpledlc workflow state transition (plan_saved, plan_approved, build_started, build_done, review_saved, complete, abort). plan_approved is normally recorded by the simpledlc_gate tool; build_started is rejected until the plan is approved. Returns the resulting state summary; watch for an ESCAPE HATCH notice on review_saved.",
		parameters: stateToolParameters,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
			const { action, slug, verdict, note } = params;
			const state = readState(ctx.cwd, slug);
			const result = applyTransition(state, action, verdict ?? null, note);
			if (!result.ok) {
				// Reject illegal/unknown transitions without mutating state on disk.
				return toolText(`ERROR: ${result.error}\n\n${summarizeState(state)}`);
			}
			writeState(ctx.cwd, state);
			const text = result.notice ? `${result.notice}\n\n${summarizeState(state)}` : summarizeState(state);
			return toolText(text);
		},
	});

	pi.registerCommand("simpledlc", {
		description: "Stepwise plan→build→review workflow (planner/reviewer=Opus, builder=GPT-5.6 Sol), stops for review at each step",
		handler: async (args: string, ctx) => {
			const task = args.trim();
			if (!task) {
				ctx.ui.notify("Usage: /simpledlc <task description>", "warning");
				return;
			}
			const { slug, resume } = resolveSlug(ctx.cwd, task);
			const state = readState(ctx.cwd, slug, task);
			if (state.history.length === 0) appendHistory(state, "WORKFLOW_STARTED", task);
			writeState(ctx.cwd, state);
			pi.sendUserMessage(buildDirective(task, slug, resume, state.phase, state.escape_hatch_offered));
		},
	});

	pi.registerCommand("simpledlc-status", {
		description: "Show the latest simpledlc workflow state for this project",
		handler: async (args: string, ctx) => {
			const slug = args.trim();
			if (slug) {
				const path = statePath(ctx.cwd, slug);
				if (!existsSync(path)) {
					ctx.ui.notify(`No simpledlc state found for slug: ${slug}`, "warning");
					return;
				}
				ctx.ui.notify(summarizeState(readState(ctx.cwd, slug)), "info");
				return;
			}
			const latest = latestStatePath(ctx.cwd);
			if (!latest) {
				ctx.ui.notify("No simpledlc workflows found in this project.", "info");
				return;
			}
			try {
				const raw = JSON.parse(readFileSync(latest, "utf-8"));
				ctx.ui.notify(summarizeState(normalizeState(raw, raw.slug ?? "unknown", raw.task ?? "")), "info");
			} catch {
				ctx.ui.notify(`Could not read simpledlc state: ${latest}`, "error");
			}
		},
	});
}
