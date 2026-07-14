/**
 * Tests for macro-energy reconciliation — keeping a food estimate's calorie
 * total consistent with its own protein/carbs/fat via Atwater 4/4/9.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { macroKcal, reconcileKcal } from "../lib/nutrition-math.js";

test("macroKcal applies Atwater 4/4/9", () => {
  assert.equal(macroKcal({ protein: 10, carbs: 20, fat: 5 }), 4 * 10 + 4 * 20 + 9 * 5); // 165
  assert.equal(macroKcal({}), 0);
});

test("a self-consistent estimate is left untouched", () => {
  // 50P/40C/16F → 504 kcal, ~within 1% of the stated 500 → keep 500.
  assert.equal(reconcileKcal({ kcal: 500, protein: 50, carbs: 40, fat: 16 }), 500);
});

test("an inconsistent total is pulled to the macro-derived energy", () => {
  // 20P/40C/10F → 330 kcal; stated 500 is 34% too high → trust the macros.
  assert.equal(reconcileKcal({ kcal: 500, protein: 20, carbs: 40, fat: 10 }), 330);
});

test("reconciliation stays inside the model's plausibility range", () => {
  // macros imply 330 but the model's own low is 400 → clamp up to 400.
  assert.equal(reconcileKcal({ kcal: 500, protein: 20, carbs: 40, fat: 10, low: 400, high: 600 }), 400);
});

test("no usable macros → keep the stated total (safe no-op)", () => {
  assert.equal(reconcileKcal({ kcal: 250, protein: 0, carbs: 0, fat: 0 }), 250);
});

test("no stated total → fall back to the macro energy", () => {
  assert.equal(reconcileKcal({ kcal: 0, protein: 10, carbs: 10, fat: 5 }), 4 * 10 + 4 * 10 + 9 * 5); // 125
});

test("never returns a negative number", () => {
  assert.ok(reconcileKcal({ kcal: -100, protein: -5, carbs: 0, fat: 0 }) >= 0);
});
