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
		`escape_hatch_offered: ${state.escape_hatch_offered}`,
		`history_events: ${state.history.length}`,
	].join("\n");
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
		`   short note. STOP and show me the plan (read plan.md for the detail). Do NOT proceed`,
		`   to build until I approve. If I ask for changes, re-spawn planner with my feedback (it`,
		`   overwrites plan.md) and record \`plan_saved\` again.`,
		``,
		`3. **Build.** Only after I approve the plan: spawn \`Agent({ subagent_type: "builder",`,
		`   ... })\`, telling it the slug \`${slug}\`. It reads plan.md and, on revision rounds,`,
		`   existing review.md; it implements and writes/appends \`simpledlc/${slug}/build-log.md\``,
		`   itself. Record \`build_started\` before spawning and \`build_done\` after it finishes.`,
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
		resume ? `Resume now at ${phaseToStep[phase]}.` : `Begin at step 1 now.`,
	].join("\n");
}

const stateToolParameters = Type.Object({
	action: Type.Union(
		[
			Type.Literal("plan_saved"),
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
			appendHistory(state, "PLAN_SAVED", note);
			return { ok: true };
		case "build_started":
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
	pi.registerTool({
		name: "simpledlc_state",
		label: "simpledlc state",
		description:
			"Record a deterministic simpledlc workflow state transition (plan_saved, build_started, build_done, review_saved, complete, abort). Returns the resulting state summary; watch for an ESCAPE HATCH notice on review_saved.",
		parameters: stateToolParameters,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
			const { action, slug, verdict, note } = params;
			const state = readState(ctx.cwd, slug);
			const result = applyTransition(state, action, verdict ?? null, note);
			if (!result.ok) {
				// Reject illegal/unknown transitions without mutating state on disk.
				return { content: [{ type: "text", text: `ERROR: ${result.error}\n\n${summarizeState(state)}` }] };
			}
			writeState(ctx.cwd, state);
			const text = result.notice ? `${result.notice}\n\n${summarizeState(state)}` : summarizeState(state);
			return { content: [{ type: "text", text }] };
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
