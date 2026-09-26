/**
 * Which reminders a device wants booked. Rules:
 * docs/superpowers/specs/2026-09-25-reminders-design.md ("Timing rules").
 * Every time here is built with the local-time Date constructor, so the suite
 * reads the same in any time zone.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { plannedReminders, workoutGapDays, DEFAULT_MEAL_TIMES } from "../reminder-plan.js";

const at = (month, day, h, m = 0, s = 0) => new Date(2026, month - 1, day, h, m, s).getTime();
const OFF = { workout: false, meals: false, water: false };

function plan(input) {
  return plannedReminders({
    now: at(9, 25, 9),
    enabled: OFF,
    mealTimes: DEFAULT_MEAL_TIMES,
    plan: null,
    workouts: [],
    nutrition: [],
    water: {},
    waterTargetMl: 2500,
    lastWaterAt: null,
    enabledAt: at(9, 25, 9),
    ...input,
  });
}
const keys = (list) => list.map((r) => r.key);

test("the workout gap comes from the plan's training days, 3 with no plan", () => {
  assert.equal(workoutGapDays(null), 3);
  assert.equal(workoutGapDays({ days_per_week: 4 }), 2);
  assert.equal(workoutGapDays({ days_per_week: 3 }), 3);
  assert.equal(workoutGapDays({ days_per_week: 2 }), 4);
  assert.equal(workoutGapDays({ days_per_week: 1 }), 7);
  assert.equal(workoutGapDays({ days_per_week: 6 }), 2, "never nags every single day");
  assert.equal(workoutGapDays({ days: [{}, {}, {}, {}, {}] }), 2, "falls back to the number of plan days");
});

test("workout nudges repeat every gap days after the last workout, inside 7 days less an hour", () => {
  const list = plan({ enabled: { ...OFF, workout: true }, plan: { days_per_week: 4 }, workouts: [{ date: "2026-09-24" }, { date: "2026-09-20" }] });
  assert.deepEqual(keys(list), ["workout::2026-09-26T18:00", "workout::2026-09-28T18:00", "workout::2026-09-30T18:00"]);
  assert.ok(list.every((r) => r.kind === "workout" && r.detail === ""));
});

test("with no workouts yet, nudges count from the day reminders were turned on", () => {
  const list = plan({ enabled: { ...OFF, workout: true }, enabledAt: at(9, 25, 7) });
  assert.deepEqual(keys(list), ["workout::2026-09-28T18:00", "workout::2026-10-01T18:00"]);
});

test("nudges already in the past are skipped, not sent late", () => {
  const list = plan({ enabled: { ...OFF, workout: true }, plan: { days_per_week: 4 }, workouts: [{ date: "2026-09-20" }] });
  assert.deepEqual(keys(list), ["workout::2026-09-26T18:00", "workout::2026-09-28T18:00", "workout::2026-09-30T18:00"]);
});

test("a garbage workout date cannot hang the planner", () => {
  const list = plan({ enabled: { ...OFF, workout: true }, workouts: [{ date: "not-a-date" }] });
  assert.ok(Array.isArray(list));
});

test("meal reminders skip past times and slots already logged today", () => {
  const list = plan({
    now: at(9, 25, 13),
    enabled: { ...OFF, meals: true },
    nutrition: [{ date: "2026-09-25", meal: "lunch" }, { date: "2026-09-24", meal: "dinner" }],
  });
  assert.deepEqual(keys(list), [
    "meal:dinner:2026-09-25T18:30",
    "meal:breakfast:2026-09-26T08:30",
    "meal:lunch:2026-09-26T12:30",
    "meal:dinner:2026-09-26T18:30",
    "meal:breakfast:2026-09-27T08:30",
    "meal:lunch:2026-09-27T12:30",
    "meal:dinner:2026-09-27T18:30",
  ]);
});

test("meal times are editable, and a broken time falls back to the default", () => {
  const list = plan({ now: at(9, 25, 13), enabled: { ...OFF, meals: true }, mealTimes: { lunch: "13:15", dinner: "25:99" } });
  assert.equal(list[0].key, "meal:lunch:2026-09-25T13:15");
  assert.equal(list[1].key, "meal:dinner:2026-09-25T18:30");
});

test("water: four a day from 10:00 when nothing is logged", () => {
  const list = plan({ now: at(9, 25, 8), enabled: { ...OFF, water: true } });
  assert.deepEqual(keys(list).slice(0, 5), [
    "water::2026-09-25T10:00",
    "water::2026-09-25T13:00",
    "water::2026-09-25T16:00",
    "water::2026-09-25T19:00",
    "water::2026-09-26T10:00",
  ]);
  assert.equal(list.length, 12, "today and the next 2 days");
});

test("water: logging restarts the 3-hour clock, and nothing after 21:00", () => {
  const list = plan({
    now: at(9, 25, 14, 11),
    enabled: { ...OFF, water: true },
    water: { "2026-09-25": 500 },
    lastWaterAt: at(9, 25, 14, 10),
  });
  assert.deepEqual(keys(list).slice(0, 3), ["water::2026-09-25T17:10", "water::2026-09-25T20:10", "water::2026-09-26T10:00"]);
});

test("water: a log at an odd second rounds the next reminder up to the minute", () => {
  const list = plan({ now: at(9, 25, 14, 11), enabled: { ...OFF, water: true }, lastWaterAt: at(9, 25, 14, 10, 30) });
  assert.equal(list[0].key, "water::2026-09-25T17:11");
  assert.equal(new Date(list[0].at).getSeconds(), 0);
});

test("water: none today once the target is met, and yesterday's log does not count", () => {
  const met = plan({ now: at(9, 25, 8), enabled: { ...OFF, water: true }, water: { "2026-09-25": 2500 } });
  assert.equal(met.filter((r) => r.key.includes("2026-09-25")).length, 0);
  assert.equal(met.length, 8);

  const stale = plan({ now: at(9, 25, 8), enabled: { ...OFF, water: true }, lastWaterAt: at(9, 24, 20) });
  assert.equal(stale[0].key, "water::2026-09-25T10:00");
});

test("nothing is planned for kinds that are off, or less than a minute away", () => {
  assert.deepEqual(plan({}), []);
  const list = plan({ now: at(9, 25, 12, 29, 30), enabled: { ...OFF, meals: true } });
  assert.equal(list[0].key, "meal:dinner:2026-09-25T18:30", "lunch at 12:30 is 30 seconds away: too close to book");
});

test("the list is sorted by time, and the same input gives the same keys", () => {
  const input = { now: at(9, 25, 8), enabled: { workout: true, meals: true, water: true }, plan: { days_per_week: 3 }, workouts: [{ date: "2026-09-24" }] };
  const a = plan(input);
  const b = plan(input);
  assert.deepEqual(keys(a), keys(b));
  for (let i = 1; i < a.length; i++) assert.ok(a[i - 1].at <= a[i].at);
  assert.ok(a.every((r) => r.at - at(9, 25, 8) >= 60_000));
});
