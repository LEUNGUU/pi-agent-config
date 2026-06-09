#!/usr/bin/env node
// Aggregate critic-evals/evals.jsonl into a leaderboard.
// Schema + scoring defined in critic-evals/README.md.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = join(HERE, "evals.jsonl");

const SEV_BONUS = { good: 1, ok: 0, poor: -1 };
function score(c) {
  return (c.real_issues ?? 0) + 2 * (c.unique_finds ?? 0) - 2 * (c.false_positives ?? 0) + (SEV_BONUS[c.severity_accuracy] ?? 0);
}

let lines;
try {
  lines = readFileSync(FILE, "utf8").split("\n").filter((l) => l.trim());
} catch {
  console.error(`No data yet: ${FILE} not found. Append runs first (see README).`);
  process.exit(1);
}

const agg = {}; // name -> { runs, score, real, fp, uniq, rank1 }
const bump = (n) => (agg[n] ??= { runs: 0, score: 0, real: 0, fp: 0, uniq: 0, rank1: 0 });

let parsed = 0;
for (const [i, line] of lines.entries()) {
  let row;
  try { row = JSON.parse(line); } catch { console.error(`skip line ${i + 1}: bad JSON`); continue; }
  parsed++;
  for (const [name, c] of Object.entries(row.critics ?? {})) {
    const a = bump(name);
    a.runs++; a.score += score(c);
    a.real += c.real_issues ?? 0; a.fp += c.false_positives ?? 0; a.uniq += c.unique_finds ?? 0;
  }
  if (Array.isArray(row.your_rank) && row.your_rank[0]) bump(row.your_rank[0]).rank1++;
}

if (!parsed) { console.error("No valid rows."); process.exit(1); }

const rows = Object.entries(agg)
  .map(([name, a]) => ({
    name, runs: a.runs,
    avg: a.score / a.runs,
    total: a.score,
    avgReal: a.real / a.runs,
    avgFP: a.fp / a.runs,
    uniq: a.uniq,
    rank1: a.rank1,
  }))
  .sort((x, y) => y.avg - x.avg);

const pad = (s, n) => String(s).padEnd(n);
const num = (v, d = 2) => v.toFixed(d);
console.log(`Critic leaderboard — ${parsed} run(s)\n`);
console.log(pad("critic", 18) + pad("runs", 6) + pad("avg", 8) + pad("total", 8) + pad("avgReal", 9) + pad("avgFP", 8) + pad("uniq", 6) + "human#1");
console.log("-".repeat(70));
for (const r of rows)
  console.log(pad(r.name, 18) + pad(r.runs, 6) + pad(num(r.avg), 8) + pad(num(r.total, 1), 8) + pad(num(r.avgReal), 9) + pad(num(r.avgFP), 8) + pad(r.uniq, 6) + r.rank1);
