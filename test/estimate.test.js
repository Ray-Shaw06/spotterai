/**
 * Tests for the conservative food-calorie correction that curbs the AI
 * photo-logger's tendency to overshoot.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { conservativeEstimate, buildFoodReference } from "../api/estimate.js";

test("reports a point in the lower-middle of the model's range (curbs overshoot)", () => {
  const { kcal, scale } = conservativeEstimate(500, 350, 700);
  assert.ok(kcal < 500, "should reduce the typical estimate");
  assert.ok(kcal >= 350 && kcal <= 500, "stays within [low, typical]");
  assert.ok(scale > 0 && scale <= 1);
});

test("a wider (less certain) range is pulled down more than a tight one", () => {
  const wide = conservativeEstimate(500, 300, 800).scale;
  const tight = conservativeEstimate(500, 470, 540).scale;
  assert.ok(wide < tight, "uncertainty → more conservative");
});

test("never inflates and never cuts by more than 40%", () => {
  assert.equal(conservativeEstimate(400, 500, 900).scale, 1); // model low > typical → clamp to 1
  assert.ok(conservativeEstimate(1000, 100, 200).scale >= 0.6); // absurd range → clamped floor
});

test("zero / invalid input is a safe no-op", () => {
  assert.deepEqual(conservativeEstimate(0, 0, 0), { kcal: 0, scale: 1 });
  assert.equal(conservativeEstimate(300, 0, 0).scale, 1); // no usable range → unchanged
});

test("buildFoodReference anchors a matching query to curated DB values", () => {
  const ref = buildFoodReference("one banana");
  assert.match(ref, /Banana \(1 medium\): 105 kcal/);
  assert.match(ref, /^Curated reference values/);
});

test("buildFoodReference surfaces every overlapping item in a phrase", () => {
  const ref = buildFoodReference("grilled chicken breast and white rice");
  assert.match(ref, /Chicken breast/);
  assert.match(ref, /rice/i);
});

test("buildFoodReference matches simple plurals (the portion-variation case)", () => {
  // "2 bananas" must still anchor to "Banana" — that's the whole point of grounding.
  assert.match(buildFoodReference("2 bananas"), /Banana \(1 medium\): 105 kcal/);
  assert.match(buildFoodReference("scrambled eggs"), /Egg/);
});

test("buildFoodReference returns nothing when the query doesn't overlap the DB", () => {
  assert.equal(buildFoodReference("xyzzy qwerty zzz"), "");
  assert.equal(buildFoodReference(""), "");
});

test("buildFoodReference ignores portion/filler words (no false matches)", () => {
  // "large plate" is all stopwords/short → no food identity → no anchors.
  assert.equal(buildFoodReference("a large plate"), "");
});
