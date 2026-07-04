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

test("floor/apparatus exercises leave the generic standing rig", async () => {
  const { animationSpec } = await import("../exercise-anim.js");
  const spec = (name, movementPattern, equipment = ["bodyweight"]) => animationSpec({ name, movementPattern, equipment });
  // Prone on the floor — never a standing press / standing brace.
  assert.deepEqual([spec("Push-up", "horizontal_push").anim, spec("Push-up", "horizontal_push").pose], ["pushup", "prone"]);
  assert.deepEqual([spec("Plank", "isometric").anim, spec("Plank", "isometric").pose], ["plank", "prone"]);
  // Suspended on apparatus.
  assert.equal(spec("Dips", "vertical_push").apparatus, "dipbar");
  assert.equal(spec("Hanging Leg Raise", "isolation").apparatus, "pullupbar");
  assert.equal(spec("Hanging Leg Raise", "isolation").anim, "hangraise");
  // Supine bridges — hip thrust gets the bench + bar, glute bridge the floor.
  const thrust = spec("Hip Thrust", "hinge", ["barbell"]);
  assert.deepEqual([thrust.anim, thrust.pose, thrust.apparatus, thrust.gear], ["bridge", "thrust", "hipbench", "hipbar"]);
  assert.deepEqual([spec("Glute Bridge", "hinge").anim, spec("Glute Bridge", "hinge").pose], ["bridge", "supinefloor"]);
  // Kneeling / seated core & machine work.
  assert.equal(spec("Cable Crunch", "isolation", ["cable"]).pose, "kneel");
  assert.equal(spec("Ab Wheel Rollout", "isolation").anim, "rollout");
  assert.equal(spec("Nordic Curl", "isolation").pose, "kneel");
  assert.equal(spec("Russian Twist", "isolation").pose, "vsit");
  assert.equal(spec("Leg Press", "squat", ["machine"]).pose, "recline");
  assert.equal(spec("Seated Cable Row", "horizontal_pull", ["cable"]).pose, "longsit");
  assert.equal(spec("Seated Leg Curl", "isolation", ["machine"]).anim, "legcurlseat");
});

test("no isolation move falls back to a generic biceps curl unless it is one", async () => {
  const { animationSpec } = await import("../exercise-anim.js");
  const spec = (name, equipment) => animationSpec({ name, movementPattern: "isolation", equipment });
  assert.equal(spec("Barbell Shrug", ["barbell"]).anim, "shrug");
  assert.equal(spec("Skullcrusher", ["barbell"]).anim, "skullcrusher");
  assert.equal(spec("Skullcrusher", ["barbell"]).pose, "supine");
  assert.equal(spec("Overhead Triceps Extension", ["dumbbell"]).anim, "ohext");
  assert.equal(spec("Triceps Kickback", ["dumbbell"]).anim, "kickback");
  assert.equal(spec("Pec Deck", ["machine"]).anim, "raise");
  assert.equal(spec("Straight-Arm Pulldown", ["cable"]).anim, "raise");
  assert.equal(spec("Hip Abduction", ["machine"]).anim, "kickleg");
  assert.equal(spec("Rear-Delt Fly", ["dumbbell"]).anim, "bentraise");
  // …but actual curls still curl.
  assert.equal(spec("Dumbbell Curl", ["dumbbell"]).anim, "isolation");
});

test("barbell rows hinge over; cable rows stay upright with a plain handle", async () => {
  const { animationSpec } = await import("../exercise-anim.js");
  const bb = animationSpec({ name: "Bent-Over Row", movementPattern: "horizontal_pull", equipment: ["barbell"] });
  assert.deepEqual([bb.anim, bb.gear], ["row", "handbar"]);
  const cable = animationSpec({ name: "Chest-Supported Row", movementPattern: "horizontal_pull", equipment: ["machine"] });
  assert.deepEqual([cable.anim, cable.gear], ["horizontal_pull", "cablebar"]);
  assert.equal(animationSpec({ name: "Lat Pulldown", movementPattern: "vertical_pull", equipment: ["cable"] }).gear, "cablebar");
});
