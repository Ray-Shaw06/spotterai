/**
 * Tests that every evaluator rule has a plain-English explanation and that audit
 * flags can map back to one (used by the Safety Lab + the "Why this rule exists"
 * link inside each flag).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { RULE_EXPLANATIONS, ruleForCheck, TRAINING_PRINCIPLES } from "../rule-explanations.js";
import { evaluatePlan } from "../evaluator.js";

const ex = (name, sets, reps, rpe = null) => ({ name, sets, reps, rpe, notes: "" });
const day = (focus, exs) => ({ day: focus, focus, exercises: exs });

test("every rule explanation has the required fields", () => {
  for (const r of RULE_EXPLANATIONS) {
    for (const k of ["id", "name", "checks", "why", "action", "limitations"]) {
      assert.equal(typeof r[k], "string", `${r.id} missing ${k}`);
      assert.ok(r[k].length > 0, `${r.id}.${k} empty`);
    }
  }
});

test("every check an audit can produce maps to a rule explanation", () => {
  // A plan that triggers many checks at once, plus an injury.
  const plan = {
    program_name: "Trigger", goal: "Strength", days_per_week: 6,
    days: [
      ...Array.from({ length: 6 }, () => day("Push", [ex("Barbell Bench Press", 6, "12-15", 8), ex("Overhead Press", 5, "12-15", 8), ex("Walking Lunge", 4, "15", 9)])),
    ],
  };
  const audit = evaluatePlan(plan, { goal: "Strength", experience: "Beginner", injuries: ["knee"] });
  for (const c of audit.checks) {
    if (c.id === "invalid_plan") continue;
    assert.ok(ruleForCheck(c.id), `no rule explanation for check id: ${c.id}`);
  }
});

test("injury checks map to the injury rule", () => {
  assert.equal(ruleForCheck("injury_knee")?.id, "injury");
  assert.equal(ruleForCheck("injury_shoulder")?.id, "injury");
});

test("training principles are present", () => {
  assert.ok(TRAINING_PRINCIPLES.length >= 5);
});
