/**
 * Tests for plan editing primitives — shared by the plan editor + coach actions.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { swapExercise, removeExercise, addExercise, retuneExercise, applyPlanAction, findDayIndex } from "../plan-edit.js";

const base = () => ({
  program_name: "Test", days: [
    { day: "Day 1", focus: "Upper Body", exercises: [{ name: "Bench Press", sets: 3, reps: "8-12", rpe: 8 }, { name: "Barbell Row", sets: 3, reps: "8-12" }] },
    { day: "Day 2", focus: "Lower Body", exercises: [{ name: "Back Squat", sets: 4, reps: "5", rpe: 8 }] },
  ],
});

test("findDayIndex resolves index, day label, and focus", () => {
  const p = base();
  assert.equal(findDayIndex(p, 1), 1);
  assert.equal(findDayIndex(p, "Day 2"), 1);
  assert.equal(findDayIndex(p, "upper body"), 0);
  assert.equal(findDayIndex(p, "nope"), -1);
});

test("swapExercise replaces by name without mutating the original", () => {
  const p = base();
  const { plan, changed } = swapExercise(p, { from: "Bench Press", to: "Dumbbell Press" });
  assert.equal(changed, 1);
  assert.equal(plan.days[0].exercises[0].name, "Dumbbell Press");
  assert.match(plan.days[0].exercises[0].notes, /edited/);
  assert.equal(p.days[0].exercises[0].name, "Bench Press"); // original untouched
});

test("removeExercise drops the exercise (optionally scoped to a day)", () => {
  assert.equal(removeExercise(base(), { name: "Barbell Row" }).plan.days[0].exercises.length, 1);
  const scoped = removeExercise(base(), { name: "Back Squat", day: 0 }); // not on day 0
  assert.equal(scoped.changed, 0);
});

test("addExercise appends to the named day (defaults to first day)", () => {
  const { plan, changed } = addExercise(base(), { name: "Face Pull", day: "Upper Body", sets: 3, reps: "15" });
  assert.equal(changed, 1);
  assert.equal(plan.days[0].exercises.at(-1).name, "Face Pull");
  assert.equal(addExercise(base(), { name: "Plank" }).plan.days[0].exercises.at(-1).name, "Plank");
});

test("retuneExercise updates sets/reps/rpe", () => {
  const { plan } = retuneExercise(base(), { name: "Back Squat", sets: 5, reps: "3", rpe: 9 });
  assert.deepEqual([plan.days[1].exercises[0].sets, plan.days[1].exercises[0].reps, plan.days[1].exercises[0].rpe], [5, "3", 9]);
});

test("applyPlanAction routes by type; unknown types are no-ops", () => {
  assert.equal(applyPlanAction(base(), { type: "swap_exercise", from: "Bench Press", to: "Push-up" }).changed, 1);
  assert.equal(applyPlanAction(base(), { type: "nonsense" }).changed, 0);
});
