import test from "node:test";
import assert from "node:assert/strict";

import { openItems, catchUpSummary, OPEN_AFTER, BODYWEIGHT_STALE_DAYS, MAX_ITEMS } from "../catch-up.js";

/** A fully logged evening: nothing should be open. */
const clean = {
  hour: 21,
  hasPlan: true,
  trainingDayDue: true,
  workoutsToday: 1,
  nutritionToday: 4,
  workoutsYesterday: 1,
  nutritionYesterday: 3,
  daysSinceBodyweight: 1,
};

const ids = (snapshot) => openItems(snapshot).map((i) => i.id);

test("a fully logged day shows nothing at all", () => {
  assert.deepEqual(openItems(clean), []);
  assert.equal(catchUpSummary([]), "");
});

test("nothing is open early in the day", () => {
  const morning = { ...clean, hour: 7, workoutsToday: 0, nutritionToday: 0 };
  assert.deepEqual(ids(morning), [], "an 7am lifter has not missed anything yet");
});

test("the workout row waits until the evening", () => {
  const base = { ...clean, workoutsToday: 0 };
  assert.ok(!ids({ ...base, hour: OPEN_AFTER.workout - 1 }).includes("workout"));
  assert.ok(ids({ ...base, hour: OPEN_AFTER.workout }).includes("workout"));
});

test("no workout row on a rest day, however late it gets", () => {
  const restDay = { ...clean, hour: 23, workoutsToday: 0, trainingDayDue: false };
  assert.ok(!ids(restDay).includes("workout"), "a rest day is not an unlogged day");
});

test("no workout row without a plan", () => {
  const noPlan = { ...clean, hour: 23, workoutsToday: 0, hasPlan: false };
  assert.ok(!ids(noPlan).includes("workout"));
});

test("nutrition opens after lunch and closes on the first entry", () => {
  const base = { ...clean, nutritionToday: 0 };
  assert.ok(!ids({ ...base, hour: OPEN_AFTER.nutrition - 1 }).includes("nutrition"));
  assert.ok(ids({ ...base, hour: OPEN_AFTER.nutrition }).includes("nutrition"));
  // Counts, not calories: a logged zero-kcal drink still means you did not forget.
  assert.ok(!ids({ ...base, hour: 20, nutritionToday: 1 }).includes("nutrition"));
});

test("bodyweight is stale after a week, and missing counts as stale", () => {
  assert.ok(!ids({ ...clean, daysSinceBodyweight: BODYWEIGHT_STALE_DAYS - 1 }).includes("bodyweight"));
  assert.ok(ids({ ...clean, daysSinceBodyweight: BODYWEIGHT_STALE_DAYS }).includes("bodyweight"));

  const never = openItems({ ...clean, daysSinceBodyweight: null });
  const row = never.find((i) => i.id === "bodyweight");
  assert.ok(row);
  assert.equal(row.label, "No bodyweight on record");
});

test("yesterday is only flagged when BOTH workouts and food are empty", () => {
  // A rest day with meals logged is a normal day, not a gap.
  assert.ok(!ids({ ...clean, workoutsYesterday: 0, nutritionYesterday: 2 }).includes("yesterday"));
  assert.ok(!ids({ ...clean, workoutsYesterday: 1, nutritionYesterday: 0 }).includes("yesterday"));
  assert.ok(ids({ ...clean, workoutsYesterday: 0, nutritionYesterday: 0 }).includes("yesterday"));
});

test("the yesterday row is a backfill action, scoped to yesterday", () => {
  const row = openItems({ ...clean, workoutsYesterday: 0, nutritionYesterday: 0 }).find((i) => i.id === "yesterday");
  assert.equal(row.act, "backfill");
  assert.equal(row.scope, "yesterday");
});

test("the list is capped so the card stays a nudge, not a chore list", () => {
  const everything = {
    hour: 23,
    hasPlan: true,
    trainingDayDue: true,
    workoutsToday: 0,
    nutritionToday: 0,
    workoutsYesterday: 0,
    nutritionYesterday: 0,
    daysSinceBodyweight: null,
  };
  assert.equal(openItems(everything).length, MAX_ITEMS);
});

test("no row ever shames the user", () => {
  const everything = {
    hour: 23, hasPlan: true, trainingDayDue: true,
    workoutsToday: 0, nutritionToday: 0,
    workoutsYesterday: 0, nutritionYesterday: 0, daysSinceBodyweight: null,
  };
  // Same discipline coachNote and weekTwoSuggestion already hold themselves to.
  const banned = ["missed", "failed", "fail", "you didn't", "you did not", "slacking", "lazy", "behind", "streak lost", "broke"];
  const rows = [...openItems(everything), ...openItems({ ...everything, workoutsToday: 1, nutritionToday: 1, daysSinceBodyweight: 1 })];
  for (const row of rows) {
    const text = `${row.label} ${row.hint}`.toLowerCase();
    for (const word of banned) assert.ok(!text.includes(word), `"${word}" is shaming language: ${text}`);
  }
});

test("the summary counts, it does not grade", () => {
  assert.equal(catchUpSummary([{ id: "a" }]), "One thing still open.");
  assert.equal(catchUpSummary([{ id: "a" }, { id: "b" }]), "2 things still open.");
});

test("an empty snapshot does not throw and opens only what it can judge", () => {
  assert.doesNotThrow(() => openItems());
  assert.doesNotThrow(() => openItems({}));
  // hour defaults to 0, so only the two rules that do not gate on the hour apply.
  assert.deepEqual(ids({}), ["yesterday"]);
});
