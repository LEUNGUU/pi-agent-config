import simpledlc from "./simpledlc.ts";
import { rmSync } from "node:fs";

const tools = new Map<string, any>();
const commands = new Map<string, any>();
const sent: string[] = [];
const pi: any = {
	registerTool: (t: any) => tools.set(t.name, t),
	registerCommand: (n: string, o: any) => commands.set(n, o),
	on: () => {
		throw new Error("pi.on should NOT be called — Phase 3 observer was removed");
	},
	sendUserMessage: (m: string) => sent.push(m),
};
simpledlc(pi);

const WS = `${process.cwd()}/.simpledlc-test-ws`;
rmSync(WS, { recursive: true, force: true });
const ctx: any = { cwd: WS, hasUI: false, ui: { notify: () => {}, select: async () => undefined } };

const tool = tools.get("simpledlc_state");
if (!tool) throw new Error("tool not registered");
if (typeof tool.execute !== "function") throw new Error("tool.execute missing");
if (typeof tool.label !== "string") throw new Error("tool.label missing");
if (!tool.parameters || tool.parameters.type !== "object") throw new Error("parameters not a TypeBox object schema");

async function call(params: any) {
	const r = await tool.execute("tc1", params, undefined, undefined, ctx);
	if (!r || !Array.isArray(r.content) || r.content[0]?.type !== "text") {
		throw new Error(`bad tool result shape: ${JSON.stringify(r)}`);
	}
	return r.content[0].text as string;
}

const readState = async (slug: string) => Bun.file(`${WS}/simpledlc/${slug}/.state.json`).json();

// --- happy path: approve on first review ---
await commands.get("simpledlc").handler("Add a VPC module", ctx);
if (!sent[0]?.includes("simpledlc/add-a-vpc-module/.state.json")) throw new Error("directive missing state path");
if (!sent[0]?.includes("Begin at step 1")) throw new Error("fresh directive should say begin at step 1");
await call({ action: "plan_saved", slug: "add-a-vpc-module", note: "plan\nwith newline" });
await call({ action: "build_started", slug: "add-a-vpc-module" });
await call({ action: "build_done", slug: "add-a-vpc-module" });
const approvedText = await call({ action: "review_saved", slug: "add-a-vpc-module", verdict: "APPROVED" });
let s = await readState("add-a-vpc-module");
if (s.phase !== "done") throw new Error(`approved should be done, got ${s.phase}`);
if (s.verdict !== "APPROVED") throw new Error("verdict not APPROVED");
if (approvedText.includes("ESCAPE HATCH")) throw new Error("approve should not offer escape hatch");
if (!s.history.some((e: any) => e.event === "WORKFLOW_COMPLETED")) throw new Error("missing WORKFLOW_COMPLETED");
if (!s.history.some((e: any) => e.note.includes("plan\\nwith newline"))) throw new Error("newline not escaped");
console.log("happy path OK");

// --- escape hatch path: three NEEDS_CHANGES, no UI, resolve via complete ---
rmSync(WS, { recursive: true, force: true });
await commands.get("simpledlc").handler("Fix the broken thing", ctx);
const slug2 = "fix-the-broken-thing";
await call({ action: "plan_saved", slug: slug2 });
await call({ action: "build_started", slug: slug2 });
await call({ action: "build_done", slug: slug2 });
await call({ action: "review_saved", slug: slug2, verdict: "NEEDS_CHANGES" }); // round 1
await call({ action: "review_saved", slug: slug2, verdict: "NEEDS_CHANGES" }); // round 2 (warning)
const r3 = await call({ action: "review_saved", slug: slug2, verdict: "NEEDS_CHANGES" }); // round 3 (escape)
s = await readState(slug2);
if (s.review_round !== 3) throw new Error(`round ${s.review_round}`);
if (!s.escape_hatch_offered) throw new Error("escape hatch not offered");
if (!r3.includes("ESCAPE HATCH OFFERED")) throw new Error("escape notice not returned to orchestrator");
if (s.phase !== "review") throw new Error("phase should still be review while awaiting human choice");
if (!s.history.some((e: any) => e.event === "ESCAPE_HATCH_OFFERED")) throw new Error("missing ESCAPE_HATCH_OFFERED");
// human chooses accept-as-is
await call({ action: "complete", slug: slug2 });
s = await readState(slug2);
if (s.phase !== "done" || s.verdict !== "APPROVED") throw new Error("complete should finish workflow");
if (!s.history.some((e: any) => e.event === "ESCAPE_HATCH_ACCEPTED")) throw new Error("missing ESCAPE_HATCH_ACCEPTED");
console.log("escape hatch (no-UI, resolvable) OK");

// --- slug collision: different task, base already exists as a DONE workflow ---
rmSync(WS, { recursive: true, force: true });
await commands.get("simpledlc").handler("deploy", ctx);
await call({ action: "plan_saved", slug: "deploy" });
await call({ action: "build_started", slug: "deploy" });
await call({ action: "build_done", slug: "deploy" });
await call({ action: "review_saved", slug: "deploy", verdict: "APPROVED" });
sent.length = 0;
await commands.get("simpledlc").handler("deploy", ctx); // same text, but prior is done
const collisionDir = sent[0].match(/simpledlc\/(deploy[^/]*)\//)?.[1];
if (!collisionDir || collisionDir === "deploy") throw new Error(`finished workflow should get fresh slug, got ${collisionDir}`);
console.log("slug collision (fresh slug for finished workflow) OK");

// --- resume: same task, in-progress → reuse slug, resume directive ---
rmSync(WS, { recursive: true, force: true });
await commands.get("simpledlc").handler("build api", ctx);
await call({ action: "plan_saved", slug: "build-api" });
sent.length = 0;
await commands.get("simpledlc").handler("build api", ctx);
if (!sent[0]?.includes("RESUMING")) throw new Error("in-progress same task should resume");
if (!sent[0]?.includes("simpledlc/build-api/")) throw new Error("resume should reuse slug");
console.log("resume in-progress OK");

// --- corrupted history event is dropped to UNKNOWN by normalizeState round-trip ---
rmSync(WS, { recursive: true, force: true });
const { mkdirSync, writeFileSync } = await import("node:fs");
mkdirSync(`${WS}/simpledlc/tampered`, { recursive: true });
writeFileSync(
	`${WS}/simpledlc/tampered/.state.json`,
	JSON.stringify({ slug: "tampered", task: "t", phase: "review", review_round: 1, history: [{ event: "HAXX", note: "x" }] }),
);
// abort reads (normalize) then writes → the tampered event must be coerced to UNKNOWN
await call({ action: "abort", slug: "tampered" });
const tampered = await readState("tampered");
if (tampered.history[0].event !== "UNKNOWN") throw new Error("allowlist bypass: bad event kept");
if (tampered.phase !== "aborted") throw new Error("abort should set phase aborted");
console.log("history allowlist OK");

rmSync(WS, { recursive: true, force: true });
console.log("ALL OK");
process.exit(0);
