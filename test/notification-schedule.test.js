import test from "node:test";
import assert from "node:assert/strict";
import { nextNotification } from "../functions/notification-schedule.js";

const mondayInKolkata = {
  enabled: true,
  paused: false,
  timezone: "Asia/Kolkata",
  schedule: [{ weekday: 1, time: "18:00" }],
  quietHours: { start: "22:00", end: "08:00" },
  categories: { workout: true, followUp: true, streak: true, recovery: true },
  lastWorkoutCompletionDate: null,
  dailyDeliveryDate: null,
  dailyDeliveryCount: 0,
  lastSentByCategory: {},
};

function record(overrides = {}) {
  return structuredClone({ ...mondayInKolkata, ...overrides });
}

test("workout reminders use the confirmed weekday and local time", () => {
  const result = nextNotification(record(), Date.parse("2026-07-20T11:00:00.000Z"));

  assert.equal(result.category, "workout");
  assert.equal(result.localDate, "2026-07-20");
  assert.equal(new Date(result.dueAt).toISOString(), "2026-07-20T12:30:00.000Z");
});

test("the fixed workout payload contains only the gentle public fields", () => {
  const result = nextNotification(record(), Date.parse("2026-07-20T12:30:00.000Z"));

  assert.deepEqual(result.payload, {
    title: "Your SpotterAI workout is ready",
    body: "Your planned session is waiting when you're ready.",
    category: "workout",
    url: "/#/today",
    tag: "spotterai-workout",
    icon: "/icons/spotterai-192.png",
  });
});

test("follow-up is exactly two hours later only while the workout is unlogged", () => {
  const unlogged = nextNotification(record({
    lastSentByCategory: { workout: "2026-07-20" },
  }), Date.parse("2026-07-20T14:30:00.000Z"));
  assert.equal(unlogged.category, "follow_up");
  assert.equal(new Date(unlogged.dueAt).toISOString(), "2026-07-20T14:30:00.000Z");

  const logged = nextNotification(record({
    lastWorkoutCompletionDate: "2026-07-20",
  }), Date.parse("2026-07-20T14:30:00.000Z"));
  assert.notEqual(logged?.category, "workout");
  assert.notEqual(logged?.category, "follow_up");
});

test("streak replaces follow-up when completion was the previous local day", () => {
  const result = nextNotification(record({
    lastWorkoutCompletionDate: "2026-07-19",
    lastSentByCategory: { workout: "2026-07-20" },
    categories: { workout: true, followUp: true, streak: true, recovery: false },
  }), Date.parse("2026-07-20T14:30:00.000Z"));

  assert.equal(result.category, "streak");
  assert.equal(result.localDate, "2026-07-20");
});

test("recovery is next local morning and moves to quiet-hours end", () => {
  const result = nextNotification(record({
    lastWorkoutCompletionDate: "2026-07-19",
    schedule: [{ weekday: 2, time: "18:00" }],
    quietHours: { start: "22:00", end: "09:00" },
  }), Date.parse("2026-07-20T02:00:00.000Z"));

  assert.equal(result.category, "recovery");
  assert.equal(result.localDate, "2026-07-20");
  assert.equal(new Date(result.dueAt).toISOString(), "2026-07-20T03:30:00.000Z");
});

test("quiet hours that cross midnight roll a late reminder into the next morning", () => {
  const result = nextNotification(record({
    schedule: [{ weekday: 1, time: "23:00" }],
    categories: { workout: true, followUp: false, streak: false, recovery: false },
  }), Date.parse("2026-07-20T12:00:00.000Z"));

  assert.equal(result.localDate, "2026-07-20");
  assert.equal(new Date(result.dueAt).toISOString(), "2026-07-21T02:30:00.000Z");
});

test("DST spring-forward resolves a nonexistent local reminder deterministically", () => {
  const result = nextNotification(record({
    timezone: "America/New_York",
    schedule: [{ weekday: 7, time: "02:30" }],
    quietHours: { start: "23:00", end: "00:00" },
    categories: { workout: true, followUp: false, streak: false, recovery: false },
  }), Date.parse("2026-03-08T05:00:00.000Z"));

  assert.equal(result.localDate, "2026-03-08");
  assert.equal(new Date(result.dueAt).toISOString(), "2026-03-08T07:30:00.000Z");
});

test("DST fall-back duplicate wall time cannot create a second category/date send", () => {
  const base = record({
    timezone: "America/New_York",
    schedule: [{ weekday: 7, time: "01:30" }],
    quietHours: { start: "23:00", end: "00:00" },
    categories: { workout: true, followUp: false, streak: false, recovery: false },
  });
  const first = nextNotification(base, Date.parse("2026-11-01T04:00:00.000Z"));
  const afterSend = nextNotification({
    ...base,
    lastSentByCategory: { workout: first.localDate },
  }, Date.parse("2026-11-01T07:00:00.000Z"));

  assert.equal(first.localDate, "2026-11-01");
  assert.equal(afterSend.localDate, "2026-11-08");
});

test("the local two-delivery cap suppresses every category", () => {
  assert.equal(nextNotification(record({
    dailyDeliveryDate: "2026-07-20",
    dailyDeliveryCount: 2,
  }), Date.parse("2026-07-20T12:30:00.000Z")), null);
});

test("paused, disabled, category-disabled, and malformed records fail closed", () => {
  const now = Date.parse("2026-07-20T12:30:00.000Z");
  assert.equal(nextNotification(record({ paused: true }), now), null);
  assert.equal(nextNotification(record({ enabled: false }), now), null);
  assert.equal(nextNotification(record({ categories: {
    workout: false, followUp: false, streak: false, recovery: false,
  } }), now), null);
  assert.equal(nextNotification(record({ timezone: "Not/AZone" }), now), null);
  assert.equal(nextNotification(record({ schedule: [{ weekday: 9, time: "25:00" }] }), now), null);
});

test("a category already sent for its local date advances to the next eligible candidate", () => {
  const result = nextNotification(record({
    lastSentByCategory: { workout: "2026-07-20", follow_up: "2026-07-20" },
  }), Date.parse("2026-07-20T15:00:00.000Z"));

  assert.equal(result.category, "workout");
  assert.equal(result.localDate, "2026-07-27");
});
