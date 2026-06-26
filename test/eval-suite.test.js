/**
 * The red-team suite as a CI gate: every case's expectations must hold, so the
 * evaluator can never silently stop catching what the Evals page advertises.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { runEvalSuite } from "../eval-suite.js";

test("every red-team case meets its expectations", () => {
  for (const r of runEvalSuite()) {
    for (const e of r.expectations) {
      assert.ok(e.ok, `${r.name}: expected ${e.desc} (score was ${r.score})`);
    }
  }
});

test("the suite covers a healthy mix of pass and fail cases", () => {
  const results = runEvalSuite();
  assert.ok(results.length >= 6);
  assert.ok(results.every((r) => r.passed));
});
