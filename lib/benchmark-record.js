/**
 * SpotterAI — benchmark record (pure)
 * ============================================================================
 * ONE definition of the evaluator benchmark numbers for the CLI (`eval.mjs`)
 * and the committed history (`docs/benchmark-history.json`), so the number CI
 * enforces and the number written to history cannot drift apart.
 *
 * The public Safety Lab does NOT read from here. `safety-lab.js` has its own
 * `benchmark()` with an independent copy of these derivations and a different
 * timing constant (40 runs, not 50), so the visitor-facing number and the
 * CI-enforced number can in principle diverge. Unifying the two
 * implementations is a follow-up, not done here.
 *
 * Dependency-free: only the pure evaluator and the pure suite.
 */

import { CASES, runEvalSuite, isRiskyCase } from "../eval-suite.js";
import { evaluatePlan, EVALUATOR_VERSION } from "../evaluator.js";

/**
 * Fields that decide whether a run is worth a new history row.
 *
 * `date` and `commit` change on every push and `avgAuditMsRunner` is measured
 * on whatever GitHub runner happened to pick the job up, so all three would
 * make every push look like a change and fill the file with identical rows.
 */
export const HISTORY_SIGNIFICANT_FIELDS = Object.freeze([
  "evaluatorVersion",
  "cases",
  "casesPassed",
  "riskyTotal",
  "riskyCaught",
  "falsePositives",
  "expectationsPassed",
  "expectationsTotal",
  "perCase",
]);

/**
 * @param {{date?: string, commit?: string|null, timingRuns?: number}} options
 * @returns {object} one history record
 */
export function buildBenchmarkRecord({ date, commit = null, timingRuns = 50 } = {}) {
  const results = runEvalSuite();
  const paired = CASES.map((cse, i) => ({ cse, result: results[i] }));
  const risky = paired.filter((x) => isRiskyCase(x.cse));
  const safe = paired.filter((x) => !isRiskyCase(x.cse));

  const expectationsTotal = results.reduce((n, r) => n + r.expectations.length, 0);
  const expectationsPassed = results.reduce((n, r) => n + r.expectations.filter((e) => e.ok).length, 0);

  // Warm average over many runs, same method the CLI has always used.
  const t0 = performance.now();
  for (let n = 0; n < timingRuns; n++) for (const cse of CASES) evaluatePlan(cse.plan, cse.inputs || {});
  const avgMs = (performance.now() - t0) / (timingRuns * CASES.length);

  return {
    date: date || new Date().toISOString().slice(0, 10),
    commit,
    evaluatorVersion: EVALUATOR_VERSION,
    cases: results.length,
    casesPassed: results.filter((r) => r.passed).length,
    riskyTotal: risky.length,
    riskyCaught: risky.filter((x) => x.result.passed).length,
    falsePositives: safe.filter((x) => x.result.unexpectedFlags.length > 0).length,
    expectationsPassed,
    expectationsTotal,
    avgAuditMsRunner: Number(avgMs.toFixed(3)),
    perCase: results.map((r) => ({ name: r.name, passed: r.passed, score: r.score })),
  };
}

/** True when `record` says something the previous row did not already say. */
export function isNewHistoryRecord(record, previous) {
  if (!previous) return true;
  return HISTORY_SIGNIFICANT_FIELDS.some(
    (key) => JSON.stringify(record[key]) !== JSON.stringify(previous[key])
  );
}
