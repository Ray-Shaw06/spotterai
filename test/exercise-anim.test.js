/**
 * Tests for the animated movement demos: each known pattern is rigged, unknown
 * patterns fall back to a neutral idle, and the markup is self-contained.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { patternAnimation } from "../exercise-anim.js";

const PATTERNS = ["squat", "lunge", "hinge", "horizontal_push", "vertical_push", "horizontal_pull", "vertical_pull", "isolation", "plyometric", "isometric"];

test("every known movement pattern produces a rigged figure with a caption", () => {
  for (const p of PATTERNS) {
    const html = patternAnimation(p);
    assert.match(html, new RegExp(`data-anim="${p}"`));
    assert.match(html, /class="ex-fig"/);
    assert.match(html, /<figcaption/);
  }
});

test("unknown / missing patterns fall back to a neutral idle (no crash)", () => {
  assert.match(patternAnimation("nonsense"), /data-anim="idle"/);
  assert.match(patternAnimation(undefined), /data-anim="idle"/);
  assert.match(patternAnimation(""), /data-anim="idle"/);
});

test("the demo is decorative for assistive tech (aria-hidden svg + labelled figure)", () => {
  const html = patternAnimation("squat");
  assert.match(html, /aria-label="Animated movement demonstration"/);
  assert.match(html, /aria-hidden="true"/);
});

test("limbs are tapered filled paths shaded by the depth gradient", () => {
  const html = patternAnimation("squat", ["quads"]);
  assert.match(html, /class="ex-limbfill"/);
  assert.match(html, /id="exBody"/); // front-lit depth gradient
});

test("worked muscles get a highlight node; none is added when unknown/empty", () => {
  assert.match(patternAnimation("isolation", ["biceps"]), /class="ex-musc"/);
  assert.match(patternAnimation("squat", ["quads", "glutes"]).match(/ex-musc/g).length >= 2 ? "ok" : "", /ok/);
  assert.doesNotMatch(patternAnimation("squat", []), /class="ex-musc"/);
  assert.doesNotMatch(patternAnimation("squat", ["nonsense"]), /class="ex-musc"/);
});

test("animationSpec differentiates the squat family (the Goblet≠Back≠Front fix)", async () => {
  const { animationSpec } = await import("../exercise-anim.js");
  const back = animationSpec({ name: "Back Squat", movementPattern: "squat", equipment: ["barbell", "rack"] });
  const goblet = animationSpec({ name: "Goblet Squat", movementPattern: "squat", equipment: ["dumbbell"] });
  const front = animationSpec({ name: "Front Squat", movementPattern: "squat", equipment: ["barbell", "rack"] });
  const body = animationSpec({ name: "Sissy Squat", movementPattern: "squat", equipment: ["bodyweight"] });
  assert.equal(back.gear, "backbar");
  assert.equal(goblet.gear, "goblet");
  assert.equal(front.gear, "frontbar");
  assert.equal(body.gear, "");
  assert.notEqual(back.arms, goblet.arms);
});

test("name-level specifics get their own motions and apparatus", async () => {
  const { animationSpec } = await import("../exercise-anim.js");
  assert.deepEqual(
    animationSpec({ name: "Pull-Up", movementPattern: "vertical_pull", equipment: ["bodyweight"] }),
    { anim: "pullup", gear: "", apparatus: "pullupbar", arms: "overhead", pose: "hang" }
  );
  const bench = animationSpec({ name: "Barbell Bench Press", movementPattern: "horizontal_push", equipment: ["barbell", "bench"] });
  assert.equal(bench.anim, "benchpress");
  assert.equal(bench.pose, "supine");
  assert.equal(bench.apparatus, "bench");
  assert.equal(animationSpec({ name: "Standing Calf Raise", movementPattern: "isolation", equipment: ["bodyweight"] }).anim, "calfraise");
  assert.equal(animationSpec({ name: "Lying Leg Curl", movementPattern: "isolation", equipment: ["machine"] }).anim, "legcurl");
  assert.equal(animationSpec({ name: "Lateral Raise", movementPattern: "isolation", equipment: ["dumbbell"] }).anim, "raise");
});

test("equipment drives the implement for hinges, presses and curls", async () => {
  const { animationSpec } = await import("../exercise-anim.js");
  assert.equal(animationSpec({ name: "Romanian Deadlift", movementPattern: "hinge", equipment: ["barbell"] }).gear, "handbar");
  assert.equal(animationSpec({ name: "DB RDL", movementPattern: "hinge", equipment: ["dumbbell"] }).gear, "dbhand");
  assert.equal(animationSpec({ name: "Walking Lunge", movementPattern: "lunge", equipment: ["dumbbell"] }).gear, "dbsides");
  assert.equal(animationSpec({ name: "Barbell Curl", movementPattern: "isolation", equipment: ["barbell"] }).gear, "handbar");
});
