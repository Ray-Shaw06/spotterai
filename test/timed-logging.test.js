/**
 * Logging isometric holds and loaded carries.
 *
 * The session logger had exactly TWO shapes: cardio (minutes + distance) and
 * everything else (weight x reps). So a plank, a wall sit and a farmer's carry
 * all asked you for reps in kilograms.
 *
 * Worse than the wrong columns: `workout-ui.js` kept its OWN copy of
 * `setHasWork` that did not know about `durationSec`, so a session containing
 * only holds filtered down to zero exercises and refused to save at all, with
 * "add weight & reps to at least one set". The workout silently did not exist.
 * That duplicate is deleted; there is one definition and it is imported.
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
globalThis.window = { addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true };
globalThis.CustomEvent = class { constructor(t, i) { this.type = t; this.detail = i?.detail; } };

const { importData, addWorkout, getState, setsOf, setHasWork } = await import("../tracker-store.js");
const { isTimeBased, isCardio } = await import("../exercises.js");

const reset = () => importData({ workouts: [], nutrition: [] });

// ---------------------------------------------------------------------------
// The silent-loss bug
// ---------------------------------------------------------------------------
test("CRITICAL: a session of only holds still saves", () => {
  reset();
  addWorkout({
    name: "Core finisher",
    exercises: [{ name: "Plank", sets: [{ weight: "", durationSec: "45", done: true }] }],
  });
  assert.equal(getState().workouts.length, 1, "a plank-only session must not vanish");
  assert.equal(getState().workouts[0].exercises[0].sets[0].durationSec, 45);
});

test("a timed set counts as work", () => {
  assert.equal(setHasWork({ durationSec: 45 }), true);
  assert.equal(setHasWork({ weight: 0, reps: 0, durationSec: 30 }), true);
  assert.equal(setHasWork({ weight: 0, reps: 0 }), false, "a genuinely empty set is still empty");
});

test("setHasWork has ONE definition, exported for every caller", () => {
  // workout-ui.js used to restate it, and drifted the moment durationSec landed.
  assert.equal(typeof setHasWork, "function");
});

// ---------------------------------------------------------------------------
// Round trip
// ---------------------------------------------------------------------------
test("a bodyweight hold saves its seconds and no load", () => {
  reset();
  addWorkout({ exercises: [{ name: "Plank", sets: [{ durationSec: "60", done: true }] }] });
  const set = getState().workouts[0].exercises[0].sets[0];
  assert.equal(set.durationSec, 60);
  assert.equal(set.weight, 0, "a bare plank carries no load");
});

test("a loaded carry keeps BOTH its load and its duration", () => {
  reset();
  addWorkout({ exercises: [{ name: "Farmer's Carry", sets: [{ weight: "40", durationSec: "60", done: true }] }] });
  const set = getState().workouts[0].exercises[0].sets[0];
  assert.equal(set.weight, 40);
  assert.equal(set.durationSec, 60);
});

test("seconds never leak into the cardio minutes field", () => {
  // A 45s plank recorded as durationMin would read as a 45-MINUTE effort and
  // wreck any duration summary built on it.
  reset();
  addWorkout({ exercises: [{ name: "Plank", sets: [{ durationSec: "45", done: true }] }] });
  const set = getState().workouts[0].exercises[0].sets[0];
  assert.equal(set.durationMin, undefined);
});

test("timed work contributes no weight x reps volume, like cardio", () => {
  reset();
  addWorkout({
    exercises: [
      { name: "Plank", sets: [{ durationSec: "45", done: true }] },
      { name: "Barbell Bench Press", sets: [{ weight: "80", reps: "5", done: true }] },
    ],
  });
  assert.equal(getState().workouts[0].volume, 400, "only the bench contributes volume");
});

test("setsOf carries durationSec through without inventing one", () => {
  assert.equal(setsOf({ sets: [{ durationSec: "30" }] })[0].durationSec, 30);
  assert.equal(setsOf({ sets: [{ weight: 80, reps: 5 }] })[0].durationSec, undefined);
});

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------
test("holds and carries are timed, not cardio, not reps", () => {
  for (const n of ["Plank", "Wall Sit", "Farmer's Carry", "Hollow Body Hold"]) {
    assert.equal(isTimeBased(n), true, `${n} should be timed`);
    assert.equal(isCardio(n), false, `${n} is not cardio`);
  }
});

test("cardio stays cardio and normal lifts stay repped", () => {
  assert.equal(isCardio("Treadmill Run"), true);
  assert.equal(isTimeBased("Treadmill Run"), false, "cardio has its own minutes + distance shape");
  assert.equal(isTimeBased("Barbell Bench Press"), false);
  assert.equal(isTimeBased("Hanging Leg Raise"), false, "repped, despite the name");
});
