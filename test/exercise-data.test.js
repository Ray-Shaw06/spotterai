/**
 * Tests for the structured exercise knowledge layer and its use by the
 * evaluator's injury check (structured contraindications, keyword fallback).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { lookupExercise, isContraindicated } from "../exercise-data.js";
import { evaluatePlan } from "../evaluator.js";

const ex = (name, sets, reps, rpe = null) => ({ name, sets, reps, rpe, notes: "" });
const day = (focus, exs) => ({ day: focus, focus, exercises: exs });

test("lookup finds entries exactly and via forgiving partial match", () => {
  assert.equal(lookupExercise("Back Squat")?.movementPattern, "squat");
  assert.equal(lookupExercise("Barbell Back Squat")?.name, "Back Squat"); // partial
  assert.equal(lookupExercise("Some Made-up Lift"), null);
});

test("contraindications are curated, not just any joint stress", () => {
  assert.equal(isContraindicated("Walking Lunge", "knee"), true);
  assert.equal(isContraindicated("Leg Extension", "knee"), true);
  // knee-stressing but knee-friendly — must NOT be contraindicated
  assert.equal(isContraindicated("Leg Press", "knee"), false);
  assert.equal(isContraindicated("Step-up", "knee"), false);
});

test("the evaluator trusts the structured DB over the keyword list", () => {
  // 'step-up' IS a knee risky-keyword, but the DB knows step-ups are knee-friendly,
  // so an all-knee-friendly lower day must not raise a knee injury flag.
  const plan = {
    program_name: "Knee-friendly", goal: "General", days_per_week: 2,
    days: [
      day("Lower", [ex("Leg Press", 3, "10-12", 7), ex("Hip Thrust", 3, "10", 7), ex("Step-up", 3, "10", 7), ex("Lying Leg Curl", 3, "12", 8)]),
      day("Rest", []),
    ],
  };
  const audit = evaluatePlan(plan, { goal: "General", injuries: ["knee"] });
  assert.equal(audit.checks.find((c) => c.id === "injury_knee").status, "pass");
});
