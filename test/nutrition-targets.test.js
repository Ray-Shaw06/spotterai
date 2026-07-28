/**
 * Tests for stats-based nutrition targets — Mifflin-St Jeor, a split
 * lifestyle/training activity factor, and macros that stay inside the
 * boundaries nutrition-safety.js enforces.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  estimateBmr,
  activityMultiplier,
  estimateTdee,
  AGE_MIDPOINTS,
  DAILY_ACTIVITY,
} from "../lib/nutrition-targets.js";

test("BMR follows Mifflin-St Jeor for a known male case", () => {
  // 10(80) + 6.25(178) - 5(24) + 5 = 1797.5
  assert.equal(estimateBmr({ kg: 80, cm: 178, age: 24, sex: "Male" }), 1797.5);
});

test("BMR follows Mifflin-St Jeor for a known female case", () => {
  // 10(65) + 6.25(165) - 5(37) - 161 = 1335.25
  assert.equal(estimateBmr({ kg: 65, cm: 165, age: 37, sex: "Female" }), 1335.25);
});

test("unknown sex lands exactly between the male and female results", () => {
  const male = estimateBmr({ kg: 80, cm: 178, age: 24, sex: "Male" });
  const female = estimateBmr({ kg: 80, cm: 178, age: 24, sex: "Female" });
  const unknown = estimateBmr({ kg: 80, cm: 178, age: 24, sex: "Prefer not to say" });
  assert.equal(unknown, (male + female) / 2);
  assert.equal(estimateBmr({ kg: 80, cm: 178, age: 24 }), unknown);
});

test("BMR is null without height, weight, or age", () => {
  assert.equal(estimateBmr({ cm: 178, age: 24, sex: "Male" }), null);
  assert.equal(estimateBmr({ kg: 80, age: 24, sex: "Male" }), null);
  assert.equal(estimateBmr({ kg: 80, cm: 178, sex: "Male" }), null);
  assert.equal(estimateBmr({}), null);
});

test("the activity multiplier is a lifestyle base plus a capped training add-on", () => {
  // desk job, 4 x 60 min = 4 h -> 1.20 + 0.06*4 = 1.44
  assert.equal(activityMultiplier({ dailyActivity: "sitting", daysPerWeek: 4, sessionLength: 60 }), 1.44);
  // on feet all day, no training -> the bare base
  assert.equal(activityMultiplier({ dailyActivity: "onfeet", daysPerWeek: 0, sessionLength: 0 }), 1.5);
});

test("the training add-on caps at 0.35 so huge volume cannot run away", () => {
  const capped = activityMultiplier({ dailyActivity: "sitting", daysPerWeek: 7, sessionLength: 180 });
  assert.equal(capped, 1.2 + 0.35);
});

test("the multiplier clamps to the 1.2 to 1.9 band", () => {
  const max = activityMultiplier({ dailyActivity: "onfeet", daysPerWeek: 7, sessionLength: 240 });
  assert.ok(max <= 1.9, `expected <= 1.9, got ${max}`);
  const min = activityMultiplier({});
  assert.ok(min >= 1.2, `expected >= 1.2, got ${min}`);
});

test("TDEE is BMR times the multiplier, and null when BMR is unavailable", () => {
  const stats = { kg: 80, cm: 178, age: 24, sex: "Male", dailyActivity: "sitting", daysPerWeek: 4, sessionLength: 60 };
  assert.equal(estimateTdee(stats), 1797.5 * 1.44);
  assert.equal(estimateTdee({ cm: 178, age: 24 }), null);
});

test("age midpoints cover every AGE_RANGES chip, using en dashes", () => {
  assert.deepEqual(Object.keys(AGE_MIDPOINTS), ["Under 18", "18–29", "30–44", "45–59", "60+"]);
  assert.equal(AGE_MIDPOINTS["18–29"], 24);
});

test("the three daily-activity options ascend", () => {
  const bases = DAILY_ACTIVITY.map((d) => d.base);
  assert.deepEqual(bases, [1.2, 1.35, 1.5]);
});
