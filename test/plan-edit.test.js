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

// ---------------------------------------------------------------------------
// Coach edit quality
//
// From a real transcript: asked to bring every session up to 5 exercises, the
// coach added Plank to three separate days. Two things were wrong underneath
// the padding, and both were invisible in the chat summary (which only said
// "Added Plank"):
//   1. addExercise defaulted every exercise to 3 x "8-12" @ RPE 8, so the plan
//      literally prescribed a plank for 8-12 reps.
//   2. nothing stopped it adding a lift a day already had.
// ---------------------------------------------------------------------------

test("an isometric hold is prescribed in time, not reps", () => {
  const { plan, changed } = addExercise(base(), { name: "Plank", day: "Day 1" });
  assert.equal(changed, 1);
  const added = plan.days[0].exercises.at(-1);
  assert.equal(added.name, "Plank");
  assert.equal(added.reps, "30s", "a plank prescribed for 8-12 reps is not a thing");
});

test("a loaded carry is time-based too", () => {
  const { plan } = addExercise(base(), { name: "Farmer's Carry", day: "Day 2" });
  assert.equal(plan.days[1].exercises.at(-1).reps, "30s");
});

test("a rep-based lift keeps a rep range", () => {
  const { plan } = addExercise(base(), { name: "Face Pull", day: "Day 1" });
  assert.equal(plan.days[0].exercises.at(-1).reps, "8-12");
});

test("names that only LOOK like holds stay rep-based", () => {
  // The tempting shortcut is a /hold|sit|hang/ regex, which sweeps up all three
  // of these. They are all repped.
  for (const name of ["Hanging Leg Raise", "GHD Sit-up", "Hang Clean"]) {
    const { plan } = addExercise(base(), { name, day: "Day 2" });
    assert.equal(plan.days[1].exercises.at(-1).reps, "8-12", `${name} must stay rep-based`);
  }
});

test("an explicit prescription still wins over the default", () => {
  const { plan } = addExercise(base(), { name: "Plank", day: "Day 1", sets: 2, reps: "45s" });
  const added = plan.days[0].exercises.at(-1);
  assert.equal(added.sets, 2);
  assert.equal(added.reps, "45s");
});

test("a lift the day already has is refused, not duplicated", () => {
  const { plan, changed } = addExercise(base(), { name: "Bench Press", day: "Day 1" });
  assert.equal(changed, 0);
  assert.equal(plan.days[0].exercises.length, 2, "the day must be left alone");
});

test("the duplicate check resolves aliases, not just exact strings", () => {
  const withFacePull = addExercise(base(), { name: "Face Pull", day: "Day 1" }).plan;
  const { changed } = addExercise(withFacePull, { name: "face pulls", day: "Day 1" });
  assert.equal(changed, 0, "'face pulls' is the same exercise as 'Face Pull'");
});

test("a refusal explains itself so the UI need not guess", () => {
  const { reason } = addExercise(base(), { name: "Bench Press", day: "Day 1" });
  assert.match(String(reason), /already/i);
});

test("the same lift may still be added to a DIFFERENT day", () => {
  // Core work or face pulls several times a week is legitimate programming.
  // The guard is about duplicates within one session, not across the week.
  const day1 = addExercise(base(), { name: "Plank", day: "Day 1" }).plan;
  const { changed } = addExercise(day1, { name: "Plank", day: "Day 2" });
  assert.equal(changed, 1, "this is normal programming and must not be blocked");
});
