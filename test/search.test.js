/**
 * Tests for the token-based exercise/food search — the fix that lets you find
 * library items regardless of word order, equipment prefixes, and plurals.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { searchExercises, findExercise, isCardio } from "../exercises.js";
import { searchFoods } from "../foods.js";

const names = (list) => list.map((x) => x.name);

test("equipment prefix + plural still finds the library exercise", () => {
  // The original bug: "machine preacher curls" matched nothing.
  const res = searchExercises("machine preacher curls");
  assert.ok(names(res).includes("Preacher Curl"), names(res).slice(0, 5).join(", "));
});

test("word order doesn't matter (token AND search)", () => {
  // Same words, scrambled order — token-AND search should still find it.
  const res = searchExercises("press incline dumbbell");
  assert.ok(names(res).includes("Incline Dumbbell Press"));
});

test("a single token matches by prefix", () => {
  const res = searchExercises("squat");
  assert.ok(names(res).includes("Back Squat"));
});

test("custom 'extra' entries are merged into search results", () => {
  const res = searchExercises("iso row", 30, [{ name: "Hammer Strength Iso Row", muscle: "Back", cardio: false }]);
  assert.ok(names(res).includes("Hammer Strength Iso Row"));
});

test("empty query returns a non-empty starter set, capped to the limit", () => {
  const res = searchExercises("", 10);
  assert.ok(res.length > 0 && res.length <= 10);
});

test("findExercise + isCardio classify library items", () => {
  assert.equal(findExercise("back squat").muscle, "Quads");
  assert.equal(isCardio("Treadmill Run"), true);
  assert.equal(isCardio("Back Squat"), false);
});

test("food search is order-independent", () => {
  const a = searchFoods("greek yogurt");
  const b = searchFoods("yogurt greek");
  assert.ok(a.length > 0 && b.length > 0);
  assert.equal(a[0].name, b[0].name);
});

test("food search merges custom foods", () => {
  const res = searchFoods("nonna lasagne", 25, [{ name: "Nonna's Lasagne", serving: "1 plate", kcal: 600, protein: 30, carbs: 50, fat: 28 }]);
  assert.ok(names(res).includes("Nonna's Lasagne"));
});
