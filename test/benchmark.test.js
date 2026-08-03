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
  assert.equal(safe.filter((x) => x.r.unexpectedFlags.length > 0).length, 0, "no false positives");
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

// ============================================================================
// The false-positive counter has to be able to reach a non-zero value.
//
// Found during /qa on 2026-08-03: eval.mjs, safety-lab.js and this file all
// computed "Safe plans incorrectly flagged" as `safe.filter(x => !x.r.passed)`
// — the number of safe cases whose own `expect` list failed. It never looked at
// `flagged`, so a known-good fixture could light up and the public number on the
// landing page still read 0. Two fixtures were doing exactly that.
// ============================================================================

test("REGRESSION: an unsanctioned flag on a safe plan is actually counted", async () => {
  const { unexpectedFlags } = await import("../eval-suite.js");
  const cse = { allowedFlags: ["Push / pull balance"] };

  assert.deepEqual(unexpectedFlags(cse, { flagged: ["Push / pull balance"] }), [], "sanctioned flags are not false positives");
  assert.deepEqual(
    unexpectedFlags(cse, { flagged: ["Push / pull balance", "Rest days"] }),
    ["Rest days"],
    "an unsanctioned flag must surface, or the counter can never leave zero"
  );
  assert.deepEqual(unexpectedFlags({}, { flagged: ["Rest days"] }), ["Rest days"], "no allowlist means every flag counts");
});

test("every sanctioned flag is one the fixture really raises", async () => {
  // Stops an allowlist from quietly growing into a blindfold: an entry that no
  // longer fires is either a fixed bug or a typo, and either way it would let a
  // future real false positive through under the same label.
  const { CASES, runEvalSuite } = await import("../eval-suite.js");
  const results = runEvalSuite();
  CASES.forEach((cse, i) => {
    for (const label of cse.allowedFlags || []) {
      assert.ok(
        results[i].flagged.includes(label),
        `"${cse.name}" allows "${label}" but no longer raises it — drop it from allowedFlags`
      );
    }
  });
});
