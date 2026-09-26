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

test("lifting shorthand expands (db / ohp / rdl / bb)", () => {
  assert.ok(names(searchExercises("db incline press")).includes("Incline Dumbbell Press"));
  assert.ok(names(searchExercises("ohp")).includes("Overhead Press"));
  assert.ok(names(searchExercises("rdl")).includes("Romanian Deadlift"));
  assert.ok(names(searchExercises("bb row")).includes("Barbell Row"));
});

test("food shorthand expands (pb / oj)", () => {
  assert.ok(names(searchFoods("pb")).includes("Peanut butter"));
  assert.ok(names(searchFoods("oj")).includes("Orange juice"));
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

test("Open Food Facts search retries when the browser reports a failed fetch", async () => {
  // OFF's 503 pages carry no CORS header, so the browser surfaces a transient
  // 503 as `TypeError: Failed to fetch`, not a response. The retry loop only
  // looked at response statuses, so one blip ended the search as "offline".
  const { searchOpenFoodFacts } = await import("../foods.js");
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls < 3) throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify({
      products: [{ product_name: "Pad Thai", nutriments: { "energy-kcal_100g": 180, proteins_100g: 7, carbohydrates_100g: 25, fat_100g: 6 } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const results = await searchOpenFoodFacts("pad thai");
    assert.equal(calls, 3);
    assert.deepEqual(names(results), ["Pad Thai"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Open Food Facts search still gives up after three failed fetches", async () => {
  const { searchOpenFoodFacts } = await import("../foods.js");
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new TypeError("Failed to fetch");
  };
  try {
    await assert.rejects(searchOpenFoodFacts("pad thai"), TypeError);
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a failed Open Food Facts search only says offline when the device is", async () => {
  // nutrition-ui.js reads the DOM at module scope, so this is a source guard.
  const { readFileSync } = await import("node:fs");
  const ui = readFileSync(new URL("../nutrition-ui.js", import.meta.url), "utf8");
  assert.match(ui, /navigator\.onLine === false \? "offline" : "unavailable right now"/);
  assert.doesNotMatch(ui, /Open Food Facts <span class="muted">· offline<\/span>/);
});
