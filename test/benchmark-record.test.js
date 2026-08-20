import test from "node:test";
import assert from "node:assert/strict";
import { buildBenchmarkRecord, isNewHistoryRecord, HISTORY_SIGNIFICANT_FIELDS } from "../lib/benchmark-record.js";
import { EVALUATOR_VERSION } from "../evaluator.js";

test("the record carries every documented field with the right type", () => {
  const r = buildBenchmarkRecord({ date: "2026-08-18", commit: "abc1234", timingRuns: 2 });
  assert.equal(r.date, "2026-08-18");
  assert.equal(r.commit, "abc1234");
  assert.equal(r.evaluatorVersion, EVALUATOR_VERSION);
  for (const k of ["cases", "casesPassed", "riskyTotal", "riskyCaught", "falsePositives", "expectationsPassed", "expectationsTotal"]) {
    assert.equal(Number.isInteger(r[k]), true, `${k} must be an integer`);
  }
  assert.equal(typeof r.avgAuditMsRunner, "number");
  assert.equal(r.perCase.length, r.cases);
  for (const c of r.perCase) {
    assert.equal(typeof c.name, "string");
    assert.equal(typeof c.passed, "boolean");
    assert.equal(typeof c.score, "number");
  }
});

test("the suite is currently green, so the record says so", () => {
  const r = buildBenchmarkRecord({ timingRuns: 2 });
  assert.equal(r.casesPassed, r.cases);
  assert.equal(r.riskyCaught, r.riskyTotal);
  assert.equal(r.falsePositives, 0);
  assert.equal(r.expectationsPassed, r.expectationsTotal);
});

test("commit defaults to null and date defaults to today", () => {
  const r = buildBenchmarkRecord({ timingRuns: 2 });
  assert.equal(r.commit, null);
  assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
});

test("a first record is always new", () => {
  const r = buildBenchmarkRecord({ timingRuns: 2 });
  assert.equal(isNewHistoryRecord(r, null), true);
});

test("a different commit and date on identical numbers is not new", () => {
  const a = buildBenchmarkRecord({ date: "2026-08-18", commit: "aaaaaaa", timingRuns: 2 });
  const b = buildBenchmarkRecord({ date: "2026-08-19", commit: "bbbbbbb", timingRuns: 2 });
  assert.equal(isNewHistoryRecord(b, a), false);
});

test("timing drift alone is not new", () => {
  const a = buildBenchmarkRecord({ timingRuns: 2 });
  const b = { ...a, avgAuditMsRunner: a.avgAuditMsRunner + 99 };
  assert.equal(isNewHistoryRecord(b, a), false);
});

test("a changed risky-caught count is new", () => {
  const a = buildBenchmarkRecord({ timingRuns: 2 });
  const b = { ...a, riskyCaught: a.riskyCaught - 1 };
  assert.equal(isNewHistoryRecord(b, a), true);
});

test("a changed evaluator version is new", () => {
  const a = buildBenchmarkRecord({ timingRuns: 2 });
  const b = { ...a, evaluatorVersion: "v9.9.9" };
  assert.equal(isNewHistoryRecord(b, a), true);
});

test("date, commit and runner timing are excluded from the significance check", () => {
  assert.equal(HISTORY_SIGNIFICANT_FIELDS.includes("date"), false);
  assert.equal(HISTORY_SIGNIFICANT_FIELDS.includes("commit"), false);
  assert.equal(HISTORY_SIGNIFICANT_FIELDS.includes("avgAuditMsRunner"), false);
  assert.ok(Object.isFrozen(HISTORY_SIGNIFICANT_FIELDS));
});
