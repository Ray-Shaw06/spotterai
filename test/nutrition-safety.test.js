/**
 * Tests for nutrition guardrails — conservative, one-directional: flag aggressive
 * targets, never prescribe one, and never over-flag reasonable ones.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { evaluateNutrition, saferTargets, screenNutritionText, NUTRITION_DISCLAIMER, NUTRITION_WONT_DO } from "../nutrition-safety.js";

test("an extremely low calorie target is a critical flag with low confidence", () => {
  const { flags, trust } = evaluateNutrition({ targets: { kcal: 900, protein: 120, fat: 40 }, bodyweight: 75, unit: "kg" });
  assert.ok(flags.some((f) => f.tier === "critical" && /calorie/i.test(f.label)));
  assert.equal(trust.confidence, "Low");
});

test("an aggressive deficit vs maintenance is flagged", () => {
  const { flags } = evaluateNutrition({ targets: { kcal: 1300, protein: 150, fat: 45 }, bodyweight: 90, unit: "kg", goal: "Fat loss" });
  assert.ok(flags.some((f) => /deficit/i.test(f.label)));
});

test("low protein per kg is flagged", () => {
  const { flags } = evaluateNutrition({ targets: { kcal: 2400, protein: 80, fat: 70 }, bodyweight: 95, unit: "kg" });
  assert.ok(flags.some((f) => /protein/i.test(f.label)));
});

test("reasonable targets are not over-flagged and read as high confidence", () => {
  const { flags, trust } = evaluateNutrition({ targets: { kcal: 2400, protein: 160, fat: 75 }, bodyweight: 80, unit: "kg", goal: "Hypertrophy" });
  assert.equal(flags.length, 0);
  assert.equal(trust.confidence, "High");
});

test("missing bodyweight lowers confidence and is listed as missing data", () => {
  const { trust } = evaluateNutrition({ targets: { kcal: 2400, protein: 160, fat: 75 }, bodyweight: null });
  assert.notEqual(trust.confidence, "High");
  assert.ok(trust.dataMissing.some((d) => /bodyweight/i.test(d)));
});

test("a non-empty 'not medical advice' disclaimer is exported", () => {
  assert.match(NUTRITION_DISCLAIMER, /registered dietitian|medical/i);
});

test("the trust report includes a fat target and a safer-suggestion field", () => {
  const { trust } = evaluateNutrition({ targets: { kcal: 2200, protein: 150, fat: 70 }, bodyweight: 80, unit: "kg", goal: "Fat loss" });
  assert.equal(trust.fatTarget, 70);
  assert.match(trust.saferSuggestion, /moderate target/i);
});

test("saferTargets gives a conservative range (deficit for fat loss) and null without bodyweight", () => {
  const fl = saferTargets({ bodyweight: 100, unit: "kg", goal: "Fat loss" });
  assert.ok(fl.kcalHigh < 100 * 31, "fat-loss range sits below maintenance");
  assert.ok(fl.proteinLow >= 150 && fl.proteinHigh <= 230);
  assert.equal(saferTargets({ bodyweight: null }), null);
});

test("nutrition language screen blocks starvation/purging/ED, allows ordinary food text", () => {
  for (const t of ["I want to starve myself to lose weight", "how do I purge after eating", "lose 30 lbs in a month by not eating"]) {
    assert.equal(screenNutritionText(t), "block", `should block: ${t}`);
  }
  for (const t of ["chicken, rice and broccoli", "add a banana and oats", "2 eggs and toast"]) {
    assert.equal(screenNutritionText(t), "ok", `should allow: ${t}`);
  }
});

test("the 'what we won't do' list covers extreme restriction + rapid weight loss", () => {
  assert.ok(NUTRITION_WONT_DO.some((x) => /extreme calorie/i.test(x)));
  assert.ok(NUTRITION_WONT_DO.some((x) => /rapid weight loss/i.test(x)));
});
