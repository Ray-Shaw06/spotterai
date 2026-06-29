/**
 * SpotterAI — CLI evaluator benchmark (`npm run eval`)
 * ============================================================================
 * Runs the same red-team suite the Safety Lab and CI use, and prints the
 * benchmark to the terminal. Pure, zero-dependency — no browser needed.
 */
import { runEvalSuite, CASES, caseType } from "./eval-suite.js";
import { evaluatePlan, EVALUATOR_VERSION } from "./evaluator.js";

const isRisky = (c) => c.expect.some((e) => (e.status && e.status !== "pass") || "scoreAtMost" in e);

const results = runEvalSuite();
const paired = CASES.map((c, i) => ({ c, r: results[i] }));
const risky = paired.filter((x) => isRisky(x.c));
const safe = paired.filter((x) => !isRisky(x.c));

const expTotal = results.reduce((n, r) => n + r.expectations.length, 0);
const expPass = results.reduce((n, r) => n + r.expectations.filter((e) => e.ok).length, 0);
const casesPass = results.filter((r) => r.passed).length;

// Measure average audit time over warm runs.
const N = 50;
const t0 = performance.now();
for (let n = 0; n < N; n++) for (const c of CASES) evaluatePlan(c.plan, c.inputs || {});
const avgMs = (performance.now() - t0) / (N * CASES.length);

const ok = casesPass === results.length;
const pad = (s, n) => String(s).padEnd(n);

console.log("\nSpotterAI — Evaluator Benchmark (bundled local suite)");
console.log("=".repeat(56));
console.log(pad("Test cases run", 32), results.length);
console.log(pad("Expectations passed", 32), `${expPass}/${expTotal}`);
console.log(pad("Expectations failed", 32), expTotal - expPass);
console.log(pad("Risky plans caught", 32), `${risky.filter((x) => x.r.passed).length}/${risky.length}`);
console.log(pad("Safe plans incorrectly flagged", 32), safe.filter((x) => !x.r.passed).length);
console.log(pad("Average audit time", 32), `${avgMs < 1 ? avgMs.toFixed(3) : Math.round(avgMs)} ms`);
console.log(pad("Evaluator version", 32), EVALUATOR_VERSION);
console.log(pad("Regression status", 32), ok ? "Passing" : "Needs review");
console.log("=".repeat(56));

for (const r of results) {
  const mark = r.passed ? "✓" : "✗";
  console.log(`${mark} [${pad(caseType(r.name), 6)}] ${pad(r.name, 36)} score ${r.score}`);
}
console.log("");
process.exit(ok ? 0 : 1);
