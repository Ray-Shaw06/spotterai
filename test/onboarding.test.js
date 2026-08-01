/**
 * Tests for the onboarding → generator-input mapping. The intake must feed plan
 * generation (goal/experience/days/equipment), safety (injuries/notes), and
 * nutrition (bodyweight) correctly.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mapOnboardingToInputs, bodyweightKg, ONBOARDING_STEPS } from "../onboarding.js";
import { measurementSystem, switchMeasurementSystem, validateMeasurements } from "../measurements.js";

test("goal + training age map to the generator's goal + experience", () => {
  const i = mapOnboardingToInputs({ goal: "muscle", trainingAge: "new" });
  assert.equal(i.goal, "Hypertrophy");
  assert.equal(i.experience, "Beginner");
  assert.equal(mapOnboardingToInputs({ goal: "strength", trainingAge: "experienced" }).experience, "Advanced");
});

test("mapped injuries only include evaluator-recognised areas; the rest go to notes", () => {
  const i = mapOnboardingToInputs({ goal: "general", safetyAreas: ["knee", "neck"], avoid: "no overhead pressing" });
  assert.deepEqual(i.injuries, ["knee"]); // knee maps; neck does not
  assert.match(i.injuryNotes, /neck/i);
  assert.match(i.injuryNotes, /overhead pressing/i);
});

test("choosing no current pain does not tell the generator that pain exists", () => {
  const noPain = mapOnboardingToInputs({ currentPain: "no" });
  const hasPain = mapOnboardingToInputs({ currentPain: "yes" });
  assert.doesNotMatch(noPain.injuryNotes, /current discomfort/i);
  assert.match(hasPain.injuryNotes, /current discomfort/i);
});

test("'return to consistency' adds a conservative note and a general goal", () => {
  const i = mapOnboardingToInputs({ goal: "consistency", trainingAge: "some" });
  assert.equal(i.goal, "General");
  assert.match(i.injuryNotes, /conservative|consistency/i);
});

test("sensible defaults when fields are skipped (never blocks generation)", () => {
  const i = mapOnboardingToInputs({});
  assert.equal(i.goal, "General");
  assert.equal(i.experience, "Beginner");
  assert.ok(i.daysPerWeek >= 2);
  assert.deepEqual(i.equipment, ["Bodyweight"]);
  assert.equal(i.injuryNotes, "");
});

test("internal measurement correction state never enters mapped plan inputs", () => {
  const marked = switchMeasurementSystem({ units: "kg", weight: "29.99" }, "imperial");
  assert.equal(validateMeasurements(marked).valid, false);
  const internalKeys = Object.keys(marked).filter((key) => key.startsWith("__"));
  assert.ok(internalKeys.length > 0);

  const inputs = mapOnboardingToInputs({ ...marked, goal: "muscle" });
  assert.deepEqual(Object.keys(inputs).sort(), ["daysPerWeek", "equipment", "experience", "goal", "injuries", "injuryNotes", "sessionLength"]);
  for (const key of internalKeys) assert.equal(Object.hasOwn(inputs, key), false);
});

test("bodyweight converts lb→kg for nutrition targets", () => {
  assert.ok(Math.abs(bodyweightKg({ weight: 220, units: "lb" }) - 99.79) < 0.1);
  assert.equal(bodyweightKg({ weight: 80, units: "kg" }), 80);
  assert.equal(bodyweightKg({}), null);
});

test("legacy kg and lb values keep their respective measurement systems", () => {
  assert.equal(measurementSystem({ units: "kg" }), "metric");
  assert.equal(measurementSystem({ units: "lb" }), "imperial");
});

test("there are a small number of intake steps (coach-style, not a giant form)", () => {
  assert.ok(ONBOARDING_STEPS.length >= 4 && ONBOARDING_STEPS.length <= 6);
});
