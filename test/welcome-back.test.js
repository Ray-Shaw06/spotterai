import test from "node:test";
import assert from "node:assert/strict";

import {
  rampLevel,
  welcomeBack,
  RAMP_MIN_DAYS,
  DEEP_RAMP_DAYS,
  MIN_WORKOUTS,
  RAMP_CUT,
} from "../welcome-back.js";

test("the thresholds are the ones the card copy promises", () => {
  assert.equal(RAMP_MIN_DAYS, 10);
  assert.equal(DEEP_RAMP_DAYS, 21);
  assert.equal(MIN_WORKOUTS, 3);
  assert.deepEqual({ ...RAMP_CUT }, { light: 0.25, deep: 0.4 });
});

test("a normal week or two off is not a layoff", () => {
  assert.equal(rampLevel(0, 20), null);
  assert.equal(rampLevel(9, 20), null);
});

test("ten days opens the light ramp, twenty-one the deep one", () => {
  assert.equal(rampLevel(10, 20), "light");
  assert.equal(rampLevel(20, 20), "light");
  assert.equal(rampLevel(21, 20), "deep");
  assert.equal(rampLevel(90, 20), "deep");
});

test("no base to ease back toward means no ramp", () => {
  assert.equal(rampLevel(30, 0), null);
  assert.equal(rampLevel(30, MIN_WORKOUTS - 1), null);
  assert.equal(rampLevel(30, MIN_WORKOUTS), "deep");
});

test("unknown or junk input never opens a ramp", () => {
  for (const bad of [null, undefined, NaN, "x", -5]) assert.equal(rampLevel(bad, 20), null);
});

test("the card names the gap and says what the button does", () => {
  const card = welcomeBack({ gapDays: 14, workoutsLogged: 12 });
  assert.equal(card.level, "light");
  assert.equal(card.title, "Back after 14 days");
  assert.match(card.body, /quarter/);
  const deep = welcomeBack({ gapDays: 30, workoutsLogged: 12 });
  assert.equal(deep.level, "deep");
  assert.match(deep.body, /40%/);
});

test("nothing to offer renders nothing", () => {
  assert.equal(welcomeBack({ gapDays: 3, workoutsLogged: 12 }), null);
  assert.equal(welcomeBack({ gapDays: null, workoutsLogged: 0 }), null);
  assert.equal(welcomeBack(), null);
});

test("an offer already applied or turned down is not shown again", () => {
  assert.equal(welcomeBack({ gapDays: 30, workoutsLogged: 12, handled: true }), null);
});

test("no string shames the user", () => {
  const banned = ["missed", "failed", "fail", "you didn't", "you did not", "slacking", "lazy", "behind", "streak lost", "broke", "excuse", "fell off"];
  for (const gapDays of [10, 14, 21, 60]) {
    const card = welcomeBack({ gapDays, workoutsLogged: 12 });
    const text = Object.values(card).join(" ").toLowerCase();
    for (const word of banned) assert.ok(!text.includes(word), `"${word}" in: ${text}`);
  }
});
