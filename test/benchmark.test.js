/**
 * Tests for the Safety Lab benchmark logic — the same computations the panel
 * shows (expectation counts, risky caught, false positives, guards).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { runEvalSuite, CASES, caseType } from "../eval-suite.js";

const isRisky = (c) => c.expect.some((e) => (e.status && e.status !== "pass") || "scoreAtMost" in e);

test("every benchmark case passes its expectations", () => {
  for (const r of runEvalSuite()) assert.ok(r.passed, `case failed: ${r.name}`);
});

test("expectation pass/total counts are consistent and complete", () => {
  const results = runEvalSuite();
  const totalExp = results.reduce((n, r) => n + r.expectations.length, 0);
  const passExp = results.reduce((n, r) => n + r.expectations.filter((e) => e.ok).length, 0);
  assert.ok(totalExp > 0);
  assert.equal(passExp, totalExp, "all expectations should currently pass");
});

test("risky plans are caught and good/guard plans are not over-flagged", () => {
  const results = runEvalSuite();
  const paired = CASES.map((c, i) => ({ c, r: results[i] }));
  const risky = paired.filter((x) => isRisky(x.c));
  const safe = paired.filter((x) => !isRisky(x.c));
  assert.equal(risky.filter((x) => x.r.passed).length, risky.length, "all risky plans caught");
  assert.equal(safe.filter((x) => !x.r.passed).length, 0, "no false positives");
});

test("false-positive guard cases exist and pass", () => {
  const guards = runEvalSuite().filter((r) => caseType(r.name) === "guard");
  assert.ok(guards.length >= 2, "at least two false-positive guards");
  for (const g of guards) assert.ok(g.passed, `guard over-flagged: ${g.name}`);
});

test("each result carries a scenario type and the flags it triggered", () => {
  for (const r of runEvalSuite()) {
    assert.ok(["good", "risky", "edge", "guard"].includes(r.type));
    assert.ok(Array.isArray(r.flagged));
  }
});
