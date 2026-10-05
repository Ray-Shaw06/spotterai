import test from "node:test";
import assert from "node:assert/strict";

import { buildPlan, maintenanceFor, prefillFromInputs } from "../nutrition-plan.js";
import { MINOR_NOTICE } from "../lib/nutrition-targets.js";

const STATS = { heightCm: 178, ageRange: "18–29", sex: "Male", dailyActivity: "some", daysPerWeek: 4, sessionLength: 60, intent: "cut" };
const BANNED = ["missed", "failed", "fail", "behind", "lost", "broke", "clean", "junk", "bad", "cheat", "lazy", "slacking", "guilty", "you didn't"];

const strings = (plan) => [plan.basis, plan.limitations, plan.notice, plan.confidence, plan.intent].filter(Boolean);

test("no weight or no height means no plan, not a wrong one", () => {
  assert.equal(buildPlan({ bodyStats: STATS, kg: 0 }), null);
  assert.equal(buildPlan({ bodyStats: STATS, kg: null }), null);
  assert.equal(buildPlan({ bodyStats: { ...STATS, heightCm: 0 }, kg: 80 }), null);
  assert.equal(buildPlan({ bodyStats: null, kg: 80 }), null);
});

test("the plan carries the targets, the reasoning and protein per kg", () => {
  const p = buildPlan({ bodyStats: STATS, kg: 80 });
  assert.deepEqual(Object.keys(p.targets), ["kcal", "protein", "carbs", "fat"]);
  assert.ok(Math.abs(p.proteinPerKg - p.targets.protein / 80) < 0.05);
  assert.match(p.basis, /maintenance/i);
  assert.equal(typeof p.tdee, "number");
  assert.equal(p.intent, "cut");
  assert.equal(typeof p.effectiveDeficitKcal, "number");
});

test("confidence is Medium when sex was skipped and High when given", () => {
  assert.equal(buildPlan({ bodyStats: { ...STATS, sex: "" }, kg: 80 }).confidence, "Medium");
  assert.equal(buildPlan({ bodyStats: STATS, kg: 80 }).confidence, "High");
  assert.equal(buildPlan({ bodyStats: { ...STATS, sex: "Female" }, kg: 80 }).confidence, "High");
});

test("the limitations line says these are estimates and points to the trend", () => {
  const p = buildPlan({ bodyStats: STATS, kg: 80 });
  assert.match(p.limitations, /estimates/i);
  assert.match(p.limitations, /trend/i);
});

test("under 18 gets maintenance, the notice, and keeps what was asked for", () => {
  const p = buildPlan({ bodyStats: { ...STATS, ageRange: "Under 18" }, kg: 60 });
  assert.equal(p.intent, "recomp");
  assert.equal(p.requestedIntent, "cut");
  assert.equal(p.notice, MINOR_NOTICE);
  assert.equal(p.effectiveDeficitKcal, 0);
});

test("maintenanceFor is the plan's own maintenance, and null when there is no plan", () => {
  assert.equal(maintenanceFor(STATS, 80), buildPlan({ bodyStats: STATS, kg: 80 }).tdee);
  assert.equal(maintenanceFor(null, 80), null);
  assert.equal(maintenanceFor(STATS, 0), null);
});

test("prefillFromInputs reads the plan inputs and never guesses someone into a deficit", () => {
  assert.deepEqual(prefillFromInputs({ goal: "Fat loss", daysPerWeek: 4, sessionLength: 60 }), { daysPerWeek: 4, sessionLength: 60, intent: "cut" });
  assert.equal(prefillFromInputs({ goal: "Hypertrophy" }).intent, "bulk");
  assert.equal(prefillFromInputs({ goal: "Strength" }).intent, "recomp");
  assert.deepEqual(prefillFromInputs({}), { daysPerWeek: 3, sessionLength: 45, intent: "recomp" });
  assert.deepEqual(prefillFromInputs(null), { daysPerWeek: 3, sessionLength: 45, intent: "recomp" });
  assert.equal(prefillFromInputs({ goal: "something odd" }).intent, "recomp");
});

test("every string a plan can show is free of shaming words and em dashes", () => {
  let checked = 0;
  for (const intent of ["cut", "recomp", "bulk"]) {
    for (const ageRange of ["Under 18", "18–29", "60+"]) {
      for (const sex of ["", "Female"]) {
        for (const kg of [45, 80, 130]) {
          const p = buildPlan({ bodyStats: { ...STATS, intent, ageRange, sex }, kg });
          if (!p) continue;
          for (const text of strings(p)) {
            const lower = text.toLowerCase();
            for (const w of BANNED) assert.ok(!new RegExp(`\\b${w}\\b`).test(lower), `"${w}" in: ${text}`);
            assert.ok(!text.includes("—"), `em dash in: ${text}`);
            checked++;
          }
        }
      }
    }
  }
  assert.ok(checked > 100, "the sweep is not vacuous");
});
