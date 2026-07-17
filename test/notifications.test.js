import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeNotificationPreferences,
  prefillNotificationPreferences,
  validateNotificationPreferences,
} from "../notifications.js";

test("plan frequency prefills editable local reminder days", () => {
  assert.deepEqual(prefillNotificationPreferences(4, "Asia/Kolkata").schedule, [
    { weekday: 1, time: "18:00" },
    { weekday: 2, time: "18:00" },
    { weekday: 4, time: "18:00" },
    { weekday: 5, time: "18:00" },
  ]);
});

test("schedule presets cover each supported training frequency", () => {
  assert.deepEqual(prefillNotificationPreferences(2, "UTC").schedule.map(({ weekday }) => weekday), [1, 4]);
  assert.deepEqual(prefillNotificationPreferences(3, "UTC").schedule.map(({ weekday }) => weekday), [1, 3, 5]);
  assert.deepEqual(prefillNotificationPreferences(5, "UTC").schedule.map(({ weekday }) => weekday), [1, 2, 3, 4, 5]);
  assert.deepEqual(prefillNotificationPreferences(6, "UTC").schedule.map(({ weekday }) => weekday), [1, 2, 3, 4, 5, 6]);
});

test("normalization keeps only the exact privacy-safe preference shape", () => {
  const normalized = normalizeNotificationPreferences({
    timezone: "Asia/Kolkata",
    schedule: [
      { weekday: 5, time: "19:30", note: "hard day" },
      { weekday: 1, time: "07:15" },
      { weekday: 5, time: "18:00" },
      { weekday: 8, time: "18:00" },
    ],
    quietHours: { start: "21:00", end: "09:00", reason: "sleep" },
    categories: { workout: false, followUp: true, streak: false, recovery: true, freeText: "hello" },
    paused: true,
    profile: { name: "private" },
    plan: { workouts: [] },
    nutrition: { calories: 2100 },
    measurements: { weight: 75 },
    injury: "knee pain",
    note: "do not retain",
  });

  assert.deepEqual(normalized, {
    timezone: "Asia/Kolkata",
    schedule: [{ weekday: 1, time: "07:15" }, { weekday: 5, time: "19:30" }],
    quietHours: { start: "21:00", end: "09:00" },
    categories: { workout: false, followUp: true, streak: false, recovery: true },
    paused: true,
  });
  assert.doesNotMatch(JSON.stringify(normalized), /private|workouts|calories|weight|pain|retain|note|reason|freeText/);
});

test("normalization supplies only safe defaults for malformed values", () => {
  const normalized = normalizeNotificationPreferences({
    timezone: "Not/AZone",
    schedule: [{ weekday: 9, time: "25:00" }],
    quietHours: { start: "9:00", end: "24:00" },
    categories: { workout: "yes", followUp: false },
    paused: "no",
  });

  assert.equal(normalized.timezone, Intl.DateTimeFormat().resolvedOptions().timeZone);
  assert.deepEqual(normalized.schedule, []);
  assert.deepEqual(normalized.quietHours, { start: "22:00", end: "08:00" });
  assert.deepEqual(normalized.categories, { workout: true, followUp: false, streak: true, recovery: true });
  assert.equal(normalized.paused, false);
});

test("normalization caps schedules at seven unique valid weekdays", () => {
  const rows = [
    { weekday: 7, time: "18:00" }, { weekday: 6, time: "18:00" },
    { weekday: 5, time: "18:00" }, { weekday: 4, time: "18:00" },
    { weekday: 3, time: "18:00" }, { weekday: 2, time: "18:00" },
    { weekday: 1, time: "18:00" }, { weekday: 1, time: "19:00" },
  ];
  assert.deepEqual(normalizeNotificationPreferences({ schedule: rows }).schedule, [
    { weekday: 1, time: "18:00" }, { weekday: 2, time: "18:00" },
    { weekday: 3, time: "18:00" }, { weekday: 4, time: "18:00" },
    { weekday: 5, time: "18:00" }, { weekday: 6, time: "18:00" },
    { weekday: 7, time: "18:00" },
  ]);
});

test("normalization preserves privacy-safe controls and rejects bad zones/times", () => {
  const result = validateNotificationPreferences({
    timezone: "Not/AZone",
    schedule: [{ weekday: 9, time: "25:00" }],
    quietHours: { start: "22:00", end: "08:00" },
    categories: { workout: true, followUp: true, streak: true, recovery: true },
    paused: false,
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.timezone);
  assert.ok(result.errors.schedule);
});

test("validation requires every preference control to have a strict type", () => {
  const result = validateNotificationPreferences({
    timezone: "UTC",
    schedule: [{ weekday: 1, time: "9:00" }, { weekday: 1, time: "18:00" }],
    quietHours: { start: "22:00", end: "8:00" },
    categories: { workout: true, followUp: true, streak: true },
    paused: 0,
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.schedule);
  assert.ok(result.errors.quietHours);
  assert.ok(result.errors.categories);
  assert.ok(result.errors.paused);
  assert.deepEqual(Object.keys(result.value).sort(), ["categories", "paused", "quietHours", "schedule", "timezone"]);
});
