/**
 * SpotterAI — CLI evaluator benchmark (`npm run eval`)
 * ============================================================================
 * Runs the same red-team suite the Safety Lab and CI use, and prints the
 * benchmark to the terminal. Pure, zero-dependency — no browser needed.
 *
 * `--json` prints the same numbers as one machine-readable record, which is
 * what CI appends to docs/benchmark-history.json. Both modes read from
 * buildBenchmarkRecord, so the printed table and the stored history can never
 * disagree.
 */
import { buildBenchmarkRecord } from "./lib/benchmark-record.js";
import { caseType } from "./eval-suite.js";

const asJson = process.argv.includes("--json");
const record = buildBenchmarkRecord();
const ok = record.casesPassed === record.cases;

if (asJson) {
  console.log(JSON.stringify(record, null, 2));
  process.exit(ok ? 0 : 1);
}

const pad = (s, n) => String(s).padEnd(n);
const ms = record.avgAuditMsRunner;

console.log("\nSpotterAI — Evaluator Benchmark (bundled local suite)");
console.log("=".repeat(56));
console.log(pad("Test cases run", 32), record.cases);
console.log(pad("Expectations passed", 32), `${record.expectationsPassed}/${record.expectationsTotal}`);
console.log(pad("Expectations failed", 32), record.expectationsTotal - record.expectationsPassed);
console.log(pad("Risky plans caught", 32), `${record.riskyCaught}/${record.riskyTotal}`);
console.log(pad("Safe plans incorrectly flagged", 32), record.falsePositives);
console.log(pad("Average audit time", 32), `${ms < 1 ? ms.toFixed(3) : Math.round(ms)} ms`);
console.log(pad("Evaluator version", 32), record.evaluatorVersion);
console.log(pad("Regression status", 32), ok ? "Passing" : "Needs review");
console.log("=".repeat(56));

for (const c of record.perCase) {
  console.log(`${c.passed ? "✓" : "✗"} [${pad(caseType(c.name), 6)}] ${pad(c.name, 36)} score ${c.score}`);
}
console.log("");
process.exit(ok ? 0 : 1);
