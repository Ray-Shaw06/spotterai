/**
 * Tests for plan editing primitives — shared by the plan editor + coach actions.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { swapExercise, removeExercise, addExercise, retuneExercise, replaceDay, applyPlanAction, findDayIndex } from "../plan-edit.js";

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

// --- replaceDay: the day's LABEL is editable, not just its exercises ---------

const fullBody = () => ({
  program_name: "Test", days: [
    { day: "Day 1", focus: "Full Body", exercises: [{ name: "Back Squat", sets: 3, reps: "8-10", rpe: 8 }, { name: "Bench Press", sets: 3, reps: "8-10", rpe: 8 }] },
    { day: "Day 2", focus: "Lower Body", exercises: [{ name: "Deadlift", sets: 3, reps: "5", rpe: 8 }] },
  ],
});

test("replaceDay retitles a day (the bug: 'make Day 1 upper, not full body')", () => {
  const p = fullBody();
  const { plan, changed } = replaceDay(p, { day: "Day 1", focus: "Upper Body" });
  assert.equal(changed, 1);
  assert.equal(plan.days[0].focus, "Upper Body");
  assert.equal(p.days[0].focus, "Full Body"); // original untouched
});

test("replaceDay swaps the label AND the exercises in one atomic edit", () => {
  const { plan, changed } = replaceDay(fullBody(), {
    day: "Full Body",
    focus: "Upper Body",
    exercises: [{ name: "Overhead Press", sets: 4, reps: "6-8", rpe: 8 }, { name: "Pull-up", sets: 3, reps: "8-12" }],
  });
  assert.equal(changed, 1);
  assert.equal(plan.days[0].focus, "Upper Body");
  assert.deepEqual(plan.days[0].exercises.map((e) => e.name), ["Overhead Press", "Pull-up"]);
  assert.equal(plan.days[0].exercises[1].sets, 3);
  assert.equal(plan.days[1].focus, "Lower Body"); // other days untouched
});

test("replaceDay fills sane defaults for a sparse exercise list", () => {
  const { plan } = replaceDay(fullBody(), { day: 0, exercises: [{ name: "Lat Pulldown" }] });
  const ex = plan.days[0].exercises[0];
  assert.equal(ex.name, "Lat Pulldown");
  assert.ok(Number(ex.sets) > 0 && String(ex.reps).length);
});

test("replaceDay refuses to relabel a day full of work as 'Rest'", () => {
  // focus text drives rest-day detection in repair.js/evaluator.js, so this
  // would hide two working days from the training-day count.
  const { plan, changed } = replaceDay(fullBody(), { day: "Day 1", focus: "Rest / active recovery" });
  assert.equal(changed, 0);
  assert.equal(plan.days[0].focus, "Full Body");
});

test("replaceDay is a no-op on an unknown day or an empty edit", () => {
  assert.equal(replaceDay(fullBody(), { day: "Day 9", focus: "Upper Body" }).changed, 0);
  assert.equal(replaceDay(fullBody(), { day: "Day 1" }).changed, 0);
  assert.equal(replaceDay(fullBody(), { day: "Day 1", exercises: [] }).changed, 0);
});

test("applyPlanAction routes replace_day", () => {
  const { plan, changed } = applyPlanAction(fullBody(), { type: "replace_day", day: "Day 1", focus: "Push" });
  assert.equal(changed, 1);
  assert.equal(plan.days[0].focus, "Push");
});
