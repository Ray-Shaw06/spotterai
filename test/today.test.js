/**
 * Tests for the Today-screen decision logic (pure): which workout is "today's",
 * and the supportive, non-shaming coach note.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { todaysWorkout, coachNote, trainingDays } from "../today.js";

const day = (focus, exs = [{ name: "Bench", sets: 3, reps: "8" }]) => ({ day: focus, focus, exercises: exs });
const plan = (days) => ({ program_name: "P", goal: "Hypertrophy", days });

test("trainingDays excludes rest/recovery days", () => {
  const p = plan([day("Upper"), { day: "Rest", focus: "Rest", exercises: [] }, day("Lower")]);
  assert.equal(trainingDays(p).length, 2);
});

test("todaysWorkout rotates through training days by sessions logged", () => {
  const p = plan([day("Upper A"), day("Lower A"), day("Upper B")]);
  assert.equal(todaysWorkout(p, 0).focus, "Upper A");
  assert.equal(todaysWorkout(p, 1).focus, "Lower A");
  assert.equal(todaysWorkout(p, 3).focus, "Upper A"); // wraps
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
