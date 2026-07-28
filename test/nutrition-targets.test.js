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

import { calculateTargets, MINOR_NOTICE } from "../lib/nutrition-targets.js";
import { macroKcal } from "../lib/nutrition-math.js";
import { NUTRITION_THRESHOLDS } from "../nutrition-safety.js";

const BASE = { kg: 80, cm: 178, ageRange: "18–29", sex: "Male", dailyActivity: "sitting", daysPerWeek: 4, sessionLength: 60 };

test("SAFETY: under 18 never gets a deficit, whatever intent was asked for", () => {
  const t = calculateTargets({ ...BASE, ageRange: "Under 18", intent: "cut" });
  assert.equal(t.intent, "recomp", "the applied intent is forced to maintenance");
  assert.equal(t.requestedIntent, "cut", "what the user asked for is still reported");
  assert.equal(t.notice, MINOR_NOTICE);
  const maintenance = calculateTargets({ ...BASE, ageRange: "Under 18", intent: "recomp" });
  assert.equal(t.kcal, maintenance.kcal, "a requested cut yields maintenance calories");
});

test("adults get no minor notice", () => {
  assert.equal(calculateTargets({ ...BASE, intent: "cut" }).notice, null);
});

test("the worked example from the spec reproduces exactly", () => {
  const cut = calculateTargets({ ...BASE, intent: "cut" });
  assert.deepEqual(
    { kcal: cut.kcal, protein: cut.protein, carbs: cut.carbs, fat: cut.fat },
    { kcal: 2075, protein: 144, carbs: 245, fat: 58 }
  );
  const recomp = calculateTargets({ ...BASE, intent: "recomp" });
  assert.deepEqual(
    { kcal: recomp.kcal, protein: recomp.protein, carbs: recomp.carbs, fat: recomp.fat },
    { kcal: 2600, protein: 144, carbs: 344, fat: 72 }
  );
  const bulk = calculateTargets({ ...BASE, intent: "bulk" });
  assert.deepEqual(
    { kcal: bulk.kcal, protein: bulk.protein, carbs: bulk.carbs, fat: bulk.fat },
    { kcal: 2850, protein: 128, carbs: 406, fat: 79 }
  );
});

test("cut is below recomp is below bulk for identical stats", () => {
  const k = (intent) => calculateTargets({ ...BASE, intent }).kcal;
  assert.ok(k("cut") < k("recomp"), "cut under recomp");
  assert.ok(k("recomp") < k("bulk"), "recomp under bulk");
});

test("calories never fall below the greater of the safety floor and BMR", () => {
  const t = calculateTargets({ ...BASE, kg: 45, cm: 150, ageRange: "60+", sex: "Female", intent: "cut" });
  assert.ok(t.kcal >= NUTRITION_THRESHOLDS.LOW_KCAL, `${t.kcal} >= ${NUTRITION_THRESHOLDS.LOW_KCAL}`);
  assert.ok(t.kcal >= t.bmr - 25, `${t.kcal} not below BMR ${t.bmr} beyond rounding`);
});

test("macros reconstruct the calorie total within 2%", () => {
  for (const intent of ["cut", "recomp", "bulk"]) {
    const t = calculateTargets({ ...BASE, intent });
    const drift = Math.abs(macroKcal(t) / t.kcal - 1);
    assert.ok(drift < 0.02, `${intent} drifted ${(drift * 100).toFixed(2)}%`);
  }
});

test("an unstated sex is reported as Medium confidence, a stated one as High", () => {
  assert.equal(calculateTargets({ ...BASE, intent: "cut" }).confidence, "High");
  assert.equal(calculateTargets({ ...BASE, sex: "Prefer not to say", intent: "cut" }).confidence, "Medium");
  assert.equal(calculateTargets({ ...BASE, sex: null, intent: "cut" }).confidence, "Medium");
});

test("null without height or weight, so callers can fall back", () => {
  assert.equal(calculateTargets({ ...BASE, cm: null, intent: "cut" }), null);
  assert.equal(calculateTargets({ ...BASE, kg: null, intent: "cut" }), null);
});

test("an unknown or missing intent falls back to recomp", () => {
  assert.equal(calculateTargets({ ...BASE, intent: "nonsense" }).intent, "recomp");
  assert.equal(calculateTargets({ ...BASE }).intent, "recomp");
});

test("the basis line explains the number without an em dash", () => {
  const t = calculateTargets({ ...BASE, intent: "cut" });
  assert.match(t.basis, /maintenance/i);
  assert.match(t.basis, /20%/);
  assert.ok(!t.basis.includes("—"), "no em dashes in user-facing copy");
});

import { intentForGoal, targetsDrift, DRIFT_KCAL } from "../lib/nutrition-targets.js";

test("every training goal maps to a default eating intent", () => {
  assert.equal(intentForGoal("fatloss"), "cut");
  assert.equal(intentForGoal("muscle"), "bulk");
  assert.equal(intentForGoal("strength"), "recomp");
  assert.equal(intentForGoal("general"), "recomp");
  assert.equal(intentForGoal("consistency"), "recomp");
});

test("an unknown goal defaults to recomp rather than guessing a deficit", () => {
  assert.equal(intentForGoal("something-else"), "recomp");
  assert.equal(intentForGoal(undefined), "recomp");
});

test("drift fires at the threshold and not one calorie under it", () => {
  assert.equal(targetsDrift({ kcal: 2000 }, { kcal: 2000 + DRIFT_KCAL }).drifted, true);
  assert.equal(targetsDrift({ kcal: 2000 }, { kcal: 2000 + DRIFT_KCAL - 1 }).drifted, false);
  assert.equal(targetsDrift({ kcal: 2000 }, { kcal: 2000 - DRIFT_KCAL }).drifted, true, "drops count too");
});

test("drift reports a signed delta so the UI can say up or down", () => {
  assert.equal(targetsDrift({ kcal: 2000 }, { kcal: 2150 }).deltaKcal, 150);
  assert.equal(targetsDrift({ kcal: 2000 }, { kcal: 1850 }).deltaKcal, -150);
});

test("drift is inert when either side is missing", () => {
  assert.deepEqual(targetsDrift(null, { kcal: 2000 }), { drifted: false, deltaKcal: 0 });
  assert.deepEqual(targetsDrift({ kcal: 2000 }, null), { drifted: false, deltaKcal: 0 });
});
