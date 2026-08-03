/**
 * Tests for the plan Trust Report confidence logic (extracted from app.js).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { planConfidence } from "../trust.js";
import { evaluatePlan } from "../evaluator.js";
import { CASES } from "../eval-suite.js";

test("clean plan with no limitations is High confidence", () => {
  const c = planConfidence({ critical: 0, warning: 0, suggestion: 0 }, { hasInjuries: false });
  assert.equal(c.level, "High");
});

test("warnings (no criticals) are Medium confidence", () => {
  assert.equal(planConfidence({ critical: 0, warning: 2 }, {}).level, "Medium");
});

test("critical issues are Low confidence", () => {
  assert.equal(planConfidence({ critical: 1, warning: 0 }, {}).level, "Low");
});

test("declared injuries pull confidence down to Low even when clean", () => {
  assert.equal(planConfidence({ critical: 0, warning: 0 }, { hasInjuries: true }).level, "Low");
});

test("every confidence result carries a plain-English reason", () => {
  for (const args of [[{ critical: 0, warning: 0 }, {}], [{ critical: 0, warning: 1 }, {}], [{ critical: 1 }, {}]]) {
    assert.equal(typeof planConfidence(...args).why, "string");
  }
});

// ============================================================================
// v1.3.0 — the Trust Report is a second consumer of the evaluator summary.
//
// `not_assessed` was added to evaluator.js so the product stops claiming a plan
// is fine on questions it never asked. planConfidence was not updated with it,
// so the Trust Report kept printing "High ... inputs look complete" on exactly
// the audits the new tier exists to be honest about.
// ============================================================================

test("REGRESSION: unassessed checks are never reported as High confidence", () => {
  const c = planConfidence({ critical: 0, warning: 0, suggestion: 0, not_assessed: 2 }, { hasInjuries: false });
  assert.notEqual(c.level, "High", "checks we never ran cannot support a High-confidence verdict");
});

test("REGRESSION: the confidence reason never claims complete inputs when checks were skipped", () => {
  const c = planConfidence({ critical: 0, warning: 0, suggestion: 0, not_assessed: 2 }, {});
  assert.doesNotMatch(c.why, /inputs look complete/i);
  assert.match(c.why, /assess/i, "the reason must name the gap, not hide it");
});

test("REGRESSION: a real zero-input audit does not produce a High-confidence Trust Report", () => {
  // The suite's own known-good fixture, audited the way an imported plan is:
  // no profile, so equipment and experience are never collected.
  const known = CASES.find((c) => c.name === "Balanced hypertrophy week");
  assert.ok(known, "expected the balanced hypertrophy fixture");
  const audit = evaluatePlan(known.plan, {});
  assert.ok(audit.summary.not_assessed > 0, "fixture must exercise the unassessed path");
  assert.equal(audit.summary.flags, 0, "fixture must otherwise be clean, or this proves nothing");
  assert.notEqual(planConfidence(audit.summary, { hasInjuries: false }).level, "High");
});

test("a fully assessed clean plan is still High confidence", () => {
  const c = planConfidence({ critical: 0, warning: 0, suggestion: 1, not_assessed: 0 }, {});
  assert.equal(c.level, "High", "optional suggestions must not downgrade a fully assessed plan");
});
