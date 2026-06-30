/**
 * Tests for the post-workout completion summary: it surfaces PRs + difficulty +
 * a next action, flags pain, and never estimates calories burned.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkoutSummary, NEXT_ACTION } from "../workout-summary.js";

const workout = {
  name: "Upper Body", durationSec: 2400, volume: 5400, xp: 120, difficulty: "just_right",
  exercises: [
    { name: "Bench Press", sets: [{ weight: 80, reps: 5 }, { weight: 82.5, reps: 4 }] },
    { name: "Barbell Row", sets: [{ weight: 70, reps: 8 }] },
  ],
};

test("counts exercises/sets and reports volume + xp (no calories burned)", () => {
  const s = buildWorkoutSummary({ workout });
  assert.equal(s.exerciseCount, 2);
  assert.equal(s.setCount, 3);
  assert.equal(s.volume, 5400);
  assert.equal(s.xp, 120);
  assert.ok(!("calories" in s) && !("caloriesBurned" in s));
});

test("flags a PR only when the top set beats the prior best", () => {
  const s = buildWorkoutSummary({ workout, priorPRs: { "Bench Press": 80, "Barbell Row": 75 } });
  assert.equal(s.prs.length, 1);
  assert.equal(s.prs[0].name, "Bench Press");
  assert.equal(s.prs[0].weight, 82.5);
});

test("difficulty drives a conservative next action", () => {
  assert.match(buildWorkoutSummary({ workout: { ...workout, difficulty: "easy" } }).nextAction, /small|gradual|add a little/i);
  assert.match(buildWorkoutSummary({ workout: { ...workout, difficulty: "hard" } }).nextAction, /keep the load|ease off/i);
  assert.equal(buildWorkoutSummary({ workout: { exercises: [] } }).nextAction, NEXT_ACTION.default);
});

test("pain reported today raises a flag; the nudge is recovery-positive", () => {
  const s = buildWorkoutSummary({ workout, painToday: [{ location: "knee", severity: "mild" }] });
  assert.equal(s.painFlag, true);
  assert.match(s.recoveryNudge, /protein|water|sleep/i);
  assert.doesNotMatch(s.recoveryNudge, /calories burned|burned \d/i);
});
