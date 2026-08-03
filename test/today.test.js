/**
 * Tests for the Today-screen decision logic (pure): which workout is "today's",
 * and the supportive, non-shaming coach note.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { weekStrip, todaysWorkout, coachNote, trainingDays } from "../today.js";

const day = (focus, exs = [{ name: "Bench", sets: 3, reps: "8" }]) => ({ day: focus, focus, exercises: exs });
const plan = (days) => ({ program_name: "P", goal: "Hypertrophy", days });

test("trainingDays excludes rest/recovery days", () => {
  const p = plan([day("Upper"), { day: "Rest", focus: "Rest", exercises: [] }, day("Lower")]);
  assert.equal(trainingDays(p).length, 2);
});

test("todaysWorkout advances through training days by sessions logged", () => {
  const p = plan([day("Upper A"), day("Lower A"), day("Upper B")]);
  assert.equal(todaysWorkout(p, 0).focus, "Upper A");
  assert.equal(todaysWorkout(p, 1).focus, "Lower A");
  assert.equal(todaysWorkout(p, 2).focus, "Upper B");
  assert.equal(todaysWorkout(p, 3), null); // week complete → honest rest, no wrap
});

test("a plan with no training days (all rest) has no workout today", () => {
  assert.equal(todaysWorkout(plan([{ day: "Rest", focus: "Rest", exercises: [] }]), 0), null);
  assert.equal(todaysWorkout(null, 0), null);
});

test("an active injury produces a limitation-aware coach note", () => {
  const n = coachNote({ sessions: 1, target: 4, injuries: ["knee"] });
  assert.equal(n.tone, "warn");
  assert.match(n.text, /knee/i);
  assert.match(n.text, /check in if anything hurts/i);
  assert.doesNotMatch(n.text, /caps related volume|automatically swaps/i);
  assert.match(n.text, /audit|flag|limitation/i);
});

test("hitting the weekly target is celebrated; being behind is encouraged without shame", () => {
  assert.equal(coachNote({ sessions: 4, target: 4 }).tone, "ok");
  const behind = coachNote({ sessions: 1, target: 4 });
  assert.equal(behind.tone, "info");
  assert.doesNotMatch(behind.text, /never miss|no excuses|lazy|failed/i);
});

test("easy completion last week suggests a small progression, not a big jump", () => {
  const n = coachNote({ sessions: 0, target: 4, lastWeekSessions: 4 });
  assert.match(n.text, /small|gradual progression/i);
});

test("a completed week yields REST (null), not an endless rotation", () => {
  const plan = { days: [
    { day: "Day 1", focus: "Upper", exercises: [{ name: "Bench", sets: 3 }] },
    { day: "Day 2", focus: "Lower", exercises: [{ name: "Squat", sets: 3 }] },
  ] };
  assert.ok(todaysWorkout(plan, 0)); // week starts → session 1
  assert.ok(todaysWorkout(plan, 1)); // session 2
  assert.equal(todaysWorkout(plan, 2), null); // all done → rest, honestly
  assert.equal(todaysWorkout(plan, 5), null);
});

test("weekStrip marks done / today / upcoming in order", () => {
  const plan = { days: [
    { day: "Day 1", focus: "Push", exercises: [] },
    { day: "Day 2", focus: "Pull", exercises: [] },
    { day: "Day 3", focus: "Legs", exercises: [] },
  ] };
  const strip = weekStrip(plan, 1);
  assert.deepEqual(strip.map((s) => s.state), ["done", "today", "upcoming"]);
  assert.equal(strip[1].label, "Pull");
});
