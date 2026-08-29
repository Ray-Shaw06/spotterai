/**
 * tracker-store — backfill, catch-up counts, and the saved-routine cardio bug.
 *
 * These exist because SpotterAI cannot remind you: Web Push was retired on
 * 2026-07-22 for a $0 operator bill, and the hard rule is no notification after
 * the app is closed. If forgetting has to be survivable, filling a past day in
 * has to be exactly as reliable as logging a live one.
 *
 * tracker-store is a browser module, so localStorage and window are stubbed
 * before it is imported (same pattern as tracker-store-sync.test.js).
 */
import test from "node:test";
import assert from "node:assert/strict";

class MemoryStorage {
  #map = new Map();
  getItem(k) { return this.#map.has(k) ? this.#map.get(k) : null; }
  setItem(k, v) { this.#map.set(k, String(v)); }
  removeItem(k) { this.#map.delete(k); }
  clear() { this.#map.clear(); }
}
globalThis.localStorage = new MemoryStorage();
globalThis.window = { addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } };
globalThis.CustomEvent = class CustomEvent {
  constructor(type, init) { this.type = type; this.detail = init?.detail; }
};

const store = await import("../tracker-store.js");
const {
  getState, importData, addWorkout, addNutrition, addBodyweight, addRoutine,
  dateDaysAgo, backfillDates, isBackfillDate, dayCounts, daysSinceBodyweight,
  repeatLastWorkout, BACKFILL_MAX_DAYS,
} = store;

function reset() {
  importData({ workouts: [], nutrition: [], bodyweight: [], painReports: [], routines: [], mealTemplates: [], customExercises: [], customFoods: [], water: {}, achievements: [] });
}

const bench = (weight = 60, reps = 8) => ({ name: "Bench Press", muscle: "Chest", sets: [{ weight, reps }, { weight, reps }] });

// ---------------------------------------------------------------------------
// The backfill window
// ---------------------------------------------------------------------------

test("dateDaysAgo walks backwards in whole local days", () => {
  const [today, yesterday] = [dateDaysAgo(0), dateDaysAgo(1)];
  assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
  assert.notEqual(today, yesterday);
  const gap = (new Date(today + "T12:00:00") - new Date(yesterday + "T12:00:00")) / 86400000;
  assert.equal(Math.round(gap), 1);
});

test("the window is today plus the last 14 days, and excludes the future", () => {
  const dates = backfillDates();
  assert.equal(dates.length, BACKFILL_MAX_DAYS + 1);
  assert.equal(dates[0], dateDaysAgo(0), "newest first");
  assert.equal(dates.at(-1), dateDaysAgo(BACKFILL_MAX_DAYS));

  assert.ok(isBackfillDate(dateDaysAgo(0)));
  assert.ok(isBackfillDate(dateDaysAgo(BACKFILL_MAX_DAYS)));
  assert.ok(!isBackfillDate(dateDaysAgo(BACKFILL_MAX_DAYS + 1)), "too old");
  assert.ok(!isBackfillDate("2099-01-01"), "the future is not a thing you forgot to log");
  assert.ok(!isBackfillDate("not-a-date"));
  assert.ok(!isBackfillDate(""));
  assert.ok(!isBackfillDate(null));
});

// ---------------------------------------------------------------------------
// Counts the catch-up card reads
// ---------------------------------------------------------------------------

test("dayCounts counts entries per day, not totals", () => {
  reset();
  const y = dateDaysAgo(1);
  addWorkout({ name: "Push", exercises: [bench()], date: y });
  addNutrition({ name: "Water", meal: "snacks", kcal: 0, protein: 0, date: y });
  addNutrition({ name: "Eggs", meal: "breakfast", kcal: 180, protein: 14, date: y });

  const counts = dayCounts(y);
  assert.equal(counts.workouts, 1);
  // A zero-calorie entry is still an entry. Summing kcal here would read a
  // logged glass of water as a forgotten day.
  assert.equal(counts.nutrition, 2);

  const today = dayCounts(dateDaysAgo(0));
  assert.equal(today.workouts, 0);
  assert.equal(today.nutrition, 0);
});

test("daysSinceBodyweight is null when there has never been a weigh-in", () => {
  reset();
  assert.equal(daysSinceBodyweight(), null);

  addBodyweight({ value: 78, date: dateDaysAgo(3) });
  assert.equal(daysSinceBodyweight(), 3);

  // The most recent one wins, not the last one pushed.
  addBodyweight({ value: 77, date: dateDaysAgo(9) });
  assert.equal(daysSinceBodyweight(), 3);
});

// ---------------------------------------------------------------------------
// Backdated writes
// ---------------------------------------------------------------------------

test("addWorkout honours an explicit date", () => {
  reset();
  const target = dateDaysAgo(4);
  const { workout } = addWorkout({ name: "Legs", exercises: [bench()], date: target });
  assert.equal(workout.date, target);
  assert.equal(dayCounts(target).workouts, 1);
  assert.equal(dayCounts(dateDaysAgo(0)).workouts, 0);
});

test("repeatLastWorkout clones the last session, weights intact, onto a past date", () => {
  reset();
  addWorkout({ name: "Push A", exercises: [bench(72.5, 6)], date: dateDaysAgo(3) });

  const target = dateDaysAgo(1);
  const result = repeatLastWorkout({ date: target });
  assert.ok(result);
  assert.equal(result.workout.date, target);
  assert.equal(result.workout.name, "Push A");
  assert.equal(result.workout.exercises[0].sets[0].weight, 72.5);
  assert.equal(result.workout.exercises[0].sets[0].reps, 6);
  assert.equal(result.workout.volume, 72.5 * 6 * 2);
  assert.notEqual(result.workout.id, getState().workouts[0].id, "a copy, not the same record");
  assert.equal(getState().workouts.length, 2);
});

test("repeatLastWorkout refuses a date outside the window, and an empty log", () => {
  reset();
  assert.equal(repeatLastWorkout({ date: dateDaysAgo(1) }), null, "nothing to repeat");

  addWorkout({ name: "Push", exercises: [bench()], date: dateDaysAgo(1) });
  assert.equal(repeatLastWorkout({ date: "2099-06-01" }), null, "cannot log the future");
  assert.equal(repeatLastWorkout({ date: dateDaysAgo(BACKFILL_MAX_DAYS + 5) }), null, "cannot log 2019");
  assert.equal(getState().workouts.length, 1, "a refused repeat writes nothing");
});

test("repeatLastWorkout carries cardio sets, which have no weight or reps at all", () => {
  reset();
  addWorkout({
    name: "Easy run",
    exercises: [{ name: "Jog", muscle: "Cardio", sets: [{ durationMin: 32, distance: 5.4 }] }],
    date: dateDaysAgo(2),
  });

  const result = repeatLastWorkout({ date: dateDaysAgo(1) });
  assert.ok(result, "a run is a workout");
  const set = result.workout.exercises[0].sets[0];
  assert.equal(set.durationMin, 32);
  assert.equal(set.distance, 5.4);
});

// ---------------------------------------------------------------------------
// The saved-routine cardio bug this work uncovered
// ---------------------------------------------------------------------------

test("addRoutine keeps duration and distance, so a saved run is not empty", () => {
  reset();
  const routine = addRoutine({
    name: "Zone 2",
    exercises: [
      { name: "Jog", muscle: "Cardio", sets: [{ durationMin: 40, distance: 6.2 }] },
      { name: "Plank", muscle: "Core", sets: [{ durationSec: 45 }] },
    ],
  });

  // It used to rebuild every set as { weight, reps } only, so both of these
  // came back as zeroes and setHasWork filtered the whole routine away.
  assert.equal(routine.exercises[0].sets[0].durationMin, 40);
  assert.equal(routine.exercises[0].sets[0].distance, 6.2);
  assert.equal(routine.exercises[1].sets[0].durationSec, 45);

  // And a barbell routine is unchanged by the fix.
  const lifting = addRoutine({ name: "Push", exercises: [bench(80, 5)] });
  assert.equal(lifting.exercises[0].sets[0].weight, 80);
  assert.equal(lifting.exercises[0].sets[0].reps, 5);
  assert.equal(lifting.exercises[0].sets[0].durationMin, undefined, "no empty cardio fields on a lift");
});

// ---------------------------------------------------------------------------
// Logged cardio, as the adapt engine reads it
// ---------------------------------------------------------------------------

test("recentCardio reports logged runs, newest first, with minutes summed", () => {
  reset();
  const { recentCardio } = store;
  addWorkout({ name: "Intervals", exercises: [{ name: "Sprint", muscle: "Cardio", sets: [{ durationMin: 12, distance: 2 }, { durationMin: 10, distance: 1.8 }] }], date: dateDaysAgo(1) });
  addWorkout({ name: "Easy", exercises: [{ name: "Jog", muscle: "Cardio", sets: [{ durationMin: 30, distance: 5 }] }], date: dateDaysAgo(3) });
  addWorkout({ name: "Push", exercises: [bench()], date: dateDaysAgo(2) });

  const out = recentCardio(7);
  assert.equal(out.length, 2, "the bench session is not cardio");
  assert.equal(out[0].name, "Sprint");
  assert.equal(out[0].durationMin, 22, "both sets of the interval session count");
  assert.equal(out[0].distance, 3.8);
  assert.equal(out[1].name, "Jog");
});

test("recentCardio recognises cardio by name when the muscle field is blank", () => {
  reset();
  const { recentCardio } = store;
  // Quick Log and free-typed exercises do not always carry a muscle.
  addWorkout({ name: "Run", exercises: [{ name: "Treadmill Run", muscle: "", sets: [{ durationMin: 35 }] }], date: dateDaysAgo(1) });
  assert.equal(recentCardio(7).length, 1);
});

test("recentCardio honours its window", () => {
  reset();
  const { recentCardio } = store;
  addWorkout({ name: "Old run", exercises: [{ name: "Jog", muscle: "Cardio", sets: [{ durationMin: 30 }] }], date: dateDaysAgo(10) });
  assert.equal(recentCardio(7).length, 0);
  assert.equal(recentCardio(14).length, 1);
});

test("buildAdaptContext carries cardio, so the engine reads logs and not a guess", () => {
  reset();
  const { buildAdaptContext } = store;
  addWorkout({ name: "Push", exercises: [bench()], date: dateDaysAgo(2) });
  addWorkout({ name: "Intervals", exercises: [{ name: "Sprint", muscle: "Cardio", sets: [{ durationMin: 25 }] }], date: dateDaysAgo(1) });

  const ctx = buildAdaptContext({ days: [{ focus: "Push", exercises: [{ name: "Bench Press", sets: 3, reps: "8" }] }] });
  assert.ok(ctx.cardio);
  assert.equal(ctx.cardio.weeklyMinutes, 25);
  assert.equal(ctx.cardio.recent[0].name, "Sprint");
  assert.equal(ctx.cardio.today, dateDaysAgo(0), "the engine needs today to measure how stale a session is");
});
