/**
 * Tests for the plan Trust Report confidence logic (extracted from app.js).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { planConfidence } from "../trust.js";

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
