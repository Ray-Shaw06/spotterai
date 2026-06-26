/**
 * Tests for the pure progression math (e1RM, auto-progression, deload trend).
 * Runs under Node's built-in test runner — zero dependencies.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { epley1RM, suggestNextWeight, deloadFromWeeklyVolume } from "../progression.js";

test("epley1RM: a single returns the weight; reps raise the estimate", () => {
  assert.equal(epley1RM(100, 1), 100);
  assert.ok(Math.abs(epley1RM(100, 5) - 116.67) < 0.1); // 100 * (1 + 5/30)
  assert.ok(epley1RM(100, 10) > epley1RM(100, 5));
});

test("epley1RM: invalid input is 0, never NaN", () => {
  for (const [w, r] of [[0, 5], [100, 0], [-50, 5], [NaN, 3]]) {
    const v = epley1RM(w, r);
    assert.equal(v, 0);
  }
});

test("suggestNextWeight: adds load after a real working set, scaled by load", () => {
  assert.deepEqual(suggestNextWeight({ weight: 60, reps: 5 }), { from: 60, weight: 62.5, reps: 5, increment: 2.5 });
  assert.equal(suggestNextWeight({ weight: 100, reps: 5 }).weight, 105); // ≥80kg → +5
  assert.equal(suggestNextWeight({ weight: 20, reps: 8 }).weight, 21.25); // <40kg → +1.25
});

test("suggestNextWeight: holds after a low-rep/grindy set, and null with no basis", () => {
  const held = suggestNextWeight({ weight: 80, reps: 3 });
  assert.equal(held.weight, 80);
  assert.equal(held.increment, 0);
  assert.equal(suggestNextWeight({ weight: 0, reps: 5 }), null);
  assert.equal(suggestNextWeight(undefined), null);
});

test("deloadFromWeeklyVolume: flags 3 rising weeks into a new peak", () => {
  const d = deloadFromWeeklyVolume([8000, 9000, 10000, 11000]);
  assert.ok(d && d.recommend === true);
  assert.match(d.reason, /deload/i);
});

test("deloadFromWeeklyVolume: stays quiet when not warranted", () => {
  assert.equal(deloadFromWeeklyVolume([11000, 10000, 9000, 8000]), null); // falling
  assert.equal(deloadFromWeeklyVolume([9000, 9000, 9000, 9000]), null); // flat
  assert.equal(deloadFromWeeklyVolume([10000]), null); // not enough data
  assert.equal(deloadFromWeeklyVolume([5000, 6000, 7000, 4000]), null); // current not a peak
});
