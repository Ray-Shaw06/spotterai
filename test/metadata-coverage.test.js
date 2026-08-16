/**
 * What the structured checks can actually see.
 *
 * 229 of 383 catalog lifts had no curated safety metadata. For those, the
 * evaluator fell back to keyword matching — deliberate and load-bearing, but
 * strictly weaker: a Cuban Press or a Behind-the-Neck Press is genuinely hostile
 * to an injured shoulder and neither name contains a keyword that says so, so a
 * shoulder-injured lifter got no warning at all.
 *
 * The 2026-08-15 drafting pass closed it to 21, all of them cardio by design.
 * These tests hold that line and, more importantly, hold the RULE that made the
 * bulk import safe: contraindications must stay coherent with each other.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { CATALOG, resolveExercise } from "../exercise-catalog.js";
import { lookupExercise } from "../exercise-data.js";
import { evaluatePlan } from "../evaluator.js";

const curated = CATALOG.filter((e) => e.hasSafetyData);
const uncurated = CATALOG.filter((e) => !e.hasSafetyData);

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------
test("CRITICAL: every liftable exercise is curated; only cardio is not", () => {
  const nonCardio = uncurated.filter((e) => e.muscle !== "Cardio");
  assert.deepEqual(
    nonCardio.map((e) => e.name),
    [],
    `${nonCardio.length} liftable exercises are invisible to the structured checks`
  );
  // Cardio stays out on purpose: the metadata shape describes lifting. A
  // treadmill run has no movement pattern and no primary movers worth scoring.
  assert.ok(uncurated.length > 0, "cardio got curated; the shape does not describe it");
});

test("the audit sees a plan built from lifts it used to guess at", () => {
  const plan = { days: [{ day: "Mon", focus: "Upper", exercises: [
    { name: "Meadows Row", sets: 3, reps: "10" },
    { name: "Cuban Press", sets: 3, reps: "12" },
    { name: "Lu Raise", sets: 3, reps: "15" },
    { name: "Behind-the-Neck Press", sets: 3, reps: "8" },
  ]}]};
  const r = evaluatePlan(plan, { goal: "muscle gain", experience: "intermediate", daysPerWeek: 1, equipment: ["Full gym"], injuries: ["shoulder"] });
  assert.equal(r.checks.find((c) => c.id === "coverage").status, "pass");
  assert.match(r.checks.find((c) => c.id === "coverage").detail, /4\/4/);
  // The point of the whole exercise: these three were unwarnable before.
  const injury = r.checks.filter((c) => c.id.includes("injur")).map((c) => c.detail).join(" ");
  for (const n of ["Cuban Press", "Lu Raise", "Behind-the-Neck Press"]) assert.match(injury, new RegExp(n));
});

test("no substitution anywhere in the catalog dangles", () => {
  // 208 entries arrived at once, each with up to seven cross-references. The
  // repair engine once shipped 28 that resolved to nothing.
  const dangling = [];
  for (const e of curated) {
    const m = lookupExercise(e.name);
    if (!m) continue;
    for (const key of ["commonSubstitutions", "regressionOptions", "progressionOptions"]) {
      for (const alt of m[key] || []) if (!resolveExercise(alt)) dangling.push(`${e.name}.${key} -> ${alt}`);
    }
  }
  assert.deepEqual(dangling, []);
});

// ---------------------------------------------------------------------------
// Coherence — the rule that made a 208-entry bulk import safe
// ---------------------------------------------------------------------------
/**
 * A variant and its parent must agree on contraindications UNLESS the variant
 * differs on the axis the flag is about. Loading a pull-up does not change the
 * shoulder position; adding a deficit to an RDL does change lumbar range under
 * load. The drafts got this wrong 19 times out of 28 and were adjudicated
 * against the hand-written entries before import.
 */
const MUST_AGREE = [
  ["Dead Hang", "Pull-up"],
  ["Wide-Grip Pull-up", "Pull-up"],
  ["Weighted Pull-up", "Pull-up"],
  ["Weighted Chin-up", "Chin-up"],
  ["Hanging Knee Raise", "Hanging Leg Raise"],
  ["Lying Leg Raise", "Hanging Leg Raise"],
  ["Machine Fly", "Cable Fly"],
  ["Incline Cable Fly", "Cable Fly"],
  ["Low Cable Fly", "Cable Fly"],
  ["High Cable Fly", "Cable Fly"],
  ["Weighted Push-up", "Push-up"],
  ["Push-up (Deficit)", "Push-up"],
  ["Standing Overhead Press", "Overhead Press"],
  ["Kroc Row", "One-Arm Dumbbell Row"],
  ["Gorilla Row", "One-Arm Dumbbell Row"],
  ["Crunch", "Russian Twist"],
];

test("CRITICAL: a variant does not warn where its parent stays silent", () => {
  // Incoherence is what makes an audit ignorable: "your dead hang is bad for
  // your shoulder but your pull-up is fine" teaches people to stop reading.
  for (const [variant, parent] of MUST_AGREE) {
    const v = lookupExercise(variant);
    const p = lookupExercise(parent);
    assert.ok(v, `${variant} lost its metadata`);
    assert.ok(p, `${parent} lost its metadata`);
    assert.deepEqual(
      [...v.contraindications].sort(),
      [...p.contraindications].sort(),
      `${variant} and ${parent} disagree on contraindications`
    );
  }
});

test("variants that DO differ on the flagged axis keep their own answer", () => {
  // The counter-rule, so the guard above is not read as "always copy the
  // parent". A straighter leg or a deficit genuinely changes lumbar range.
  for (const name of ["Stiff-Leg Deadlift", "Deficit RDL", "Snatch-Grip Romanian Deadlift"]) {
    assert.ok(
      lookupExercise(name).contraindications.includes("lower_back"),
      `${name} lost its lower-back flag; it loads lumbar flexion further than a plain RDL`
    );
  }
  assert.deepEqual(lookupExercise("Romanian Deadlift").contraindications, [], "the plain RDL's own call has changed");
});

test("the flag rate stayed in the range the hand-written data set", () => {
  // A bulk import is the moment a warning set turns into noise. The hand-written
  // entries flag ~29%; the drafts wanted 35% and were adjudicated down.
  const flagged = curated.filter((e) => lookupExercise(e.name)?.contraindications.length).length;
  const pct = (flagged / curated.length) * 100;
  assert.ok(pct >= 15 && pct <= 33, `${pct.toFixed(0)}% of lifts carry a contraindication, outside the 15-33% band`);
});

test("contraindication keys are only ever the four the evaluator matches", () => {
  // "ankle" is a legal jointStress and NOT a contraindication key. A value here
  // that the injury check never matches is a warning that can never fire.
  const legal = new Set(["knee", "lower_back", "shoulder", "wrist"]);
  for (const e of curated) {
    for (const k of lookupExercise(e.name)?.contraindications || []) {
      assert.ok(legal.has(k), `${e.name} carries contraindication "${k}", which no injury check matches`);
    }
  }
});
