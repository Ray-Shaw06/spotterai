/**
 * Tests for the split & workout effectiveness analyzer. Deterministic volume
 * heuristics → weekly sets, balance, frequency, flags + a score.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { analyzeSplit, analyzeWorkout } from "../split-analyzer.js";

// A reasonable upper/lower split run as 4 workouts/week.
const upper = { name: "Upper", exercises: [
  { name: "Bench Press", sets: [1, 2, 3] }, { name: "Barbell Row", sets: [1, 2, 3] },
  { name: "Overhead Press", sets: [1, 2, 3] }, { name: "Lat Pulldown", sets: [1, 2, 3] },
  { name: "Bicep Curl", sets: [1, 2] }, { name: "Tricep Pushdown", sets: [1, 2] },
] };
const lower = { name: "Lower", exercises: [
  { name: "Back Squat", sets: [1, 2, 3] }, { name: "Romanian Deadlift", sets: [1, 2, 3] },
  { name: "Leg Press", sets: [1, 2, 3] }, { name: "Leg Curl", sets: [1, 2, 3] },
  { name: "Calf Raise", sets: [1, 2, 3] },
] };

test("computes weekly volume, frequency and an effectiveness score", () => {
  const a = analyzeSplit([upper, lower, upper, lower]);
  assert.equal(a.workoutCount, 4);
  assert.ok(a.weeklySetsByMuscle.chest > 0 && a.weeklySetsByMuscle.quads > 0);
  assert.equal(a.frequencyByMuscle.chest, 2); // upper twice
  assert.ok(a.score > 0 && a.score <= 100);
  assert.ok(["Strong", "Solid", "Needs work", "Unbalanced"].includes(a.grade));
});

test("flags a missing major muscle group", () => {
  const pushOnly = { name: "Push", exercises: [{ name: "Bench Press", sets: [1, 2, 3] }, { name: "Overhead Press", sets: [1, 2, 3] }] };
  const a = analyzeSplit([pushOnly]);
  assert.ok(a.flags.some((f) => /no direct (back|quads|hamstrings) work/i.test(f.title)));
});

test("flags a push/pull imbalance", () => {
  const allPush = { name: "Press day", exercises: [
    { name: "Bench Press", sets: [1, 2, 3, 4] }, { name: "Incline Dumbbell Press", sets: [1, 2, 3, 4] },
    { name: "Overhead Press", sets: [1, 2, 3, 4] }, { name: "Tricep Pushdown", sets: [1, 2, 3] },
  ] };
  const a = analyzeSplit([allPush]);
  assert.ok(a.flags.some((f) => /push\/pull imbalance/i.test(f.title)));
});

test("flags junk volume when a muscle is hammered", () => {
  const tooMuchChest = { name: "Chest x5", exercises: Array.from({ length: 9 }, (_, i) => ({ name: `Bench Variation ${i}`, sets: [1, 2, 3] })) };
  const a = analyzeSplit([tooMuchChest]);
  assert.ok(a.flags.some((f) => /very high/i.test(f.title)));
});

test("empty input scores 0 and explains what to do", () => {
  const a = analyzeSplit([]);
  assert.equal(a.workoutCount, 0);
  assert.equal(a.score, 0);
  assert.match(a.summary, /save|build a plan/i);
});

test("analyzeWorkout rates size + focus without crashing on empties", () => {
  assert.equal(analyzeWorkout({ name: "Empty", exercises: [] }).rating, "empty");
  const long = analyzeWorkout({ name: "Marathon", exercises: Array.from({ length: 12 }, (_, i) => ({ name: `Bench ${i}`, sets: [1, 2, 3] })) });
  assert.equal(long.rating, "too-long");
  assert.equal(analyzeWorkout(lower).rating, "balanced");
});
