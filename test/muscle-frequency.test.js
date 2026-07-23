import test from "node:test";
import assert from "node:assert/strict";

import { evaluatePlan, computeWeeklyFrequency } from "../evaluator.js";

const ex = (name, sets, reps = "8-10", rpe = 8) => ({ name, sets, reps, rpe, notes: "" });
const day = (focus, exercises) => ({ day: focus, focus, exercises });
const plan = (days, goal = "Hypertrophy") => ({ program_name: "T", goal, days_per_week: days.length, days });

const check = (audit, id) => audit.checks.find((c) => c.id === id);

test("computeWeeklyFrequency counts distinct training days per muscle", () => {
  const p = plan([
    day("Chest", [ex("Barbell Bench Press", 3)]),
    day("Chest again", [ex("Incline Dumbbell Press", 3)]),
    day("Back", [ex("Barbell Row", 3)]),
    day("Rest", []),
  ]);
  const freq = computeWeeklyFrequency(p);
  assert.equal(freq.chest, 2, "chest trained on two days");
  assert.equal(freq.back, 1, "back trained on one day");
});

test("high weekly volume trained once a week flags a hypertrophy suggestion", () => {
  const p = plan([
    day("Chest", [ex("Barbell Bench Press", 3), ex("Incline Dumbbell Press", 3), ex("Cable Fly", 3), ex("Dumbbell Bench Press", 3)]),
    day("Back", [ex("Barbell Row", 3), ex("Lat Pulldown", 3), ex("Seated Cable Row", 3), ex("Pull-up", 3)]),
    day("Rest", []),
  ]);
  const audit = evaluatePlan(p, { goal: "Hypertrophy" });
  const c = check(audit, "muscle_frequency");
  assert.equal(c.status, "warn");
  assert.equal(c.tier, "suggestion");
  assert.match(c.detail, /chest/);
});

test("the frequency suggestion never moves the score (zero-weight)", () => {
  // A plan whose ONLY issue is once-a-week frequency still scores 100.
  const p = plan([
    day("Chest", [ex("Barbell Bench Press", 3), ex("Incline Dumbbell Press", 3), ex("Cable Fly", 3), ex("Dumbbell Bench Press", 3)]),
    day("Back", [ex("Barbell Row", 3), ex("Lat Pulldown", 3), ex("Seated Cable Row", 3), ex("Pull-up", 3)]),
    day("Rest", []),
  ]);
  const audit = evaluatePlan(p, { goal: "Hypertrophy" });
  assert.equal(check(audit, "muscle_frequency").status, "warn");
  assert.equal(audit.score, 100, "suggestion is informational, score untouched");
});

test("training a muscle twice a week passes even at high volume", () => {
  const p = plan([
    day("Upper A", [ex("Barbell Bench Press", 3), ex("Incline Dumbbell Press", 3), ex("Barbell Row", 3)]),
    day("Upper B", [ex("Dumbbell Bench Press", 3), ex("Cable Fly", 3), ex("Lat Pulldown", 3)]),
    day("Rest", []),
  ]);
  const audit = evaluatePlan(p, { goal: "Hypertrophy" });
  // Chest ~12 sets across two days -> frequency fine.
  assert.equal(check(audit, "muscle_frequency").status, "pass");
});

test("frequency stays quiet for non-hypertrophy goals", () => {
  const p = plan(
    [
      day("Chest", [ex("Barbell Bench Press", 3, "3-5"), ex("Incline Dumbbell Press", 3, "3-5"), ex("Cable Fly", 3, "8"), ex("Dumbbell Bench Press", 3, "5")]),
      day("Back", [ex("Barbell Row", 3, "3-5"), ex("Lat Pulldown", 3, "6"), ex("Seated Cable Row", 3, "6"), ex("Pull-up", 3, "5")]),
      day("Rest", []),
    ],
    "Strength"
  );
  const audit = evaluatePlan(p, { goal: "Strength" });
  assert.equal(check(audit, "muscle_frequency").status, "pass");
});

test("low weekly volume once a week is not nagged", () => {
  const p = plan([
    day("Full body", [ex("Barbell Bench Press", 2), ex("Barbell Row", 2), ex("Back Squat", 2)]),
    day("Rest", []),
  ]);
  const audit = evaluatePlan(p, { goal: "Hypertrophy" });
  assert.equal(check(audit, "muscle_frequency").status, "pass");
});
