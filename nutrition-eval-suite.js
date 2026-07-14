/**
 * SpotterAI — nutrition-estimate benchmark suite (pure)
 * ============================================================================
 * Measures the food estimator, mirroring eval-suite.js for the plan evaluator.
 * Two things run from this one dataset:
 *   - a DETERMINISTIC "anchor coverage" check (does grounding surface the right
 *     DB reference for each query?) — runs anywhere, guards grounding
 *     regressions in CI (test/nutrition-eval-suite.test.js), and
 *   - a LIVE grounded-vs-ungrounded error benchmark (eval-nutrition.mjs), which
 *     needs a GEMINI_API_KEY because the estimator calls the model.
 *
 * TRUTH: each case's `expected` macros are the curated values from foods.js for
 * the `anchor` entry — numbers Rehaan already stands behind. Do NOT invent
 * nutrition facts. To test OUT-OF-DB robustness, add cases under EXTERNAL with a
 * SOURCED reference (label/USDA), not a guess.
 */

import { buildFoodReference } from "./api/estimate.js";

// { query: how a user might type it, anchor: the foods.js entry it should hit,
//   expected: that entry's macros (kcal, protein, carbs, fat) for its serving }
export const NUTRITION_CASES = [
  { query: "cooked chicken breast, 100 g", anchor: "Chicken breast, cooked", expected: { kcal: 165, protein: 31, carbs: 0, fat: 3.6 } },
  { query: "one medium banana", anchor: "Banana", expected: { kcal: 105, protein: 1.3, carbs: 27, fat: 0.4 } },
  { query: "100 g cooked white rice", anchor: "White rice, cooked", expected: { kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 } },
  { query: "a slice of white bread", anchor: "Bread, white", expected: { kcal: 79, protein: 2.7, carbs: 15, fat: 1 } },
  { query: "1 tbsp peanut butter", anchor: "Peanut butter", expected: { kcal: 94, protein: 4, carbs: 3, fat: 8 } },
  { query: "one medium apple", anchor: "Apple", expected: { kcal: 95, protein: 0.5, carbs: 25, fat: 0.3 } },
  { query: "100 g cooked salmon", anchor: "Salmon, cooked", expected: { kcal: 208, protein: 20, carbs: 0, fat: 13 } },
  { query: "0% plain greek yogurt, 170 g", anchor: "Greek yogurt, plain 0%", expected: { kcal: 100, protein: 17, carbs: 6, fat: 0.7 } },
  { query: "30 g almonds", anchor: "Almonds", expected: { kcal: 174, protein: 6, carbs: 6, fat: 15 } },
  { query: "half an avocado", anchor: "Avocado", expected: { kcal: 120, protein: 1.5, carbs: 6, fat: 11 } },
  { query: "40 g dry oats", anchor: "Oats, dry", expected: { kcal: 152, protein: 5, carbs: 27, fat: 3 } },
  { query: "a baked sweet potato", anchor: "Sweet potato, baked", expected: { kcal: 112, protein: 2, carbs: 26, fat: 0.1 } },
  { query: "cooked broccoli, 100 g", anchor: "Broccoli, cooked", expected: { kcal: 35, protein: 2.4, carbs: 7, fat: 0.4 } },
  { query: "one large egg", anchor: "Egg, large", expected: { kcal: 72, protein: 6, carbs: 0.4, fat: 5 } },
  { query: "one scoop of whey protein", anchor: "Whey protein powder", expected: { kcal: 120, protein: 24, carbs: 3, fat: 1.5 } },

  // --- EXTERNAL (out-of-DB) — add SOURCED foods here to test robustness. ---
  // e.g. { query: "a Big Mac", anchor: null, expected: { kcal: 563, ... }, source: "McDonald's label" }
];

/**
 * Deterministic: does the grounding reference for each query surface its DB
 * anchor? Cases with `anchor: null` (external foods) are skipped. No model call.
 */
export function anchorCoverage(cases = NUTRITION_CASES) {
  return cases
    .filter((c) => c.anchor)
    .map((c) => ({ query: c.query, anchor: c.anchor, covered: buildFoodReference(c.query).includes(c.anchor) }));
}

/** Score one estimate against expected: kcal % error + mean macro error (grams). */
export function scoreEstimate(est, exp) {
  const kcalErrPct = exp.kcal > 0 ? Math.abs((est.kcal || 0) - exp.kcal) / exp.kcal : 0;
  const macroMae =
    (Math.abs((est.protein || 0) - exp.protein) + Math.abs((est.carbs || 0) - exp.carbs) + Math.abs((est.fat || 0) - exp.fat)) / 3;
  return { kcalErrPct, macroMae };
}
