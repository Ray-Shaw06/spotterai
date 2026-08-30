/**
 * Tests for the onboarding → generator-input mapping. The intake must feed plan
 * generation (goal/experience/days/equipment), safety (injuries/notes), and
 * nutrition (bodyweight) correctly.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mapOnboardingToInputs,
  LEG_DAY_PREFS, bodyweightKg, ONBOARDING_STEPS } from "../onboarding.js";
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
  assert.ok(i.daysPerWeek >= 2);
  assert.ok(i.sessionLength >= 20);
  assert.equal(i.injuryNotes, "");
});

// ============================================================================
// Skipped questions must stay blank, not become invented answers.
//
// Found by /qa on 2026-08-03: walking onboarding and skipping the two optional
// steps produced an audit reading "14 exercises exceed RPE 8, which is
// aggressive for a beginner" and "21 exercises need equipment you didn't list".
// Neither was true of the user. mapOnboardingToInputs filled experience
// "Beginner" and equipment ["Bodyweight"], and the evaluator reported those
// invented answers as assessed findings.
//
// The generator still gets a conservative default: api/generate.js buildPrompt
// already does `inputs.experience || "Beginner"` and falls back to
// "bodyweight only" for empty equipment, so nothing downstream needs the lie.
// ============================================================================

test("REGRESSION: skipping the experience question leaves it blank, not 'Beginner'", () => {
  assert.equal(mapOnboardingToInputs({ goal: "muscle" }).experience, "");
  assert.equal(mapOnboardingToInputs({ goal: "muscle", trainingAge: "new" }).experience, "Beginner");
});

test("REGRESSION: skipping the equipment question leaves it empty, not ['Bodyweight']", () => {
  assert.deepEqual(mapOnboardingToInputs({ goal: "muscle" }).equipment, []);
  assert.deepEqual(mapOnboardingToInputs({ goal: "muscle", equipment: ["Bodyweight"] }).equipment, ["Bodyweight"]);
});

test("REGRESSION: a skipped step is audited as not-assessed, never as a flag", async () => {
  const { evaluatePlan } = await import("../evaluator.js");
  const ex = (name, sets, reps, rpe) => ({ name, sets, reps, rpe, notes: "" });
  const plan = {
    program_name: "P",
    goal: "Hypertrophy",
    days_per_week: 3,
    progression: "Add 2.5kg to the main lift when you hit the top of the rep range on every set.",
    general_notes: "",
    days: [
      { day: "Day", focus: "Push", exercises: [ex("Barbell Bench Press", 4, "6-8", 9), ex("Overhead Press", 3, "8-10", 9)] },
      { day: "Day", focus: "Pull", exercises: [ex("Barbell Row", 4, "6-8", 9), ex("Lat Pulldown", 3, "10-12", 9)] },
      { day: "Day", focus: "Legs", exercises: [ex("Back Squat", 4, "6-8", 9), ex("Romanian Deadlift", 3, "8-10", 9)] },
      { day: "Rest", focus: "Rest", exercises: [] },
    ],
  };

  // RPE 9 throughout: this WOULD trip beginner_load if we claimed beginner.
  const skipped = evaluatePlan(plan, mapOnboardingToInputs({ goal: "muscle" }));
  const bl = skipped.checks.find((c) => c.id === "beginner_load");
  const ef = skipped.checks.find((c) => c.id === "equipment_fit");
  assert.equal(bl.tier, "not_assessed", "never said we were a beginner, so do not judge us as one");
  assert.equal(ef.tier, "not_assessed", "never listed equipment, so do not judge the plan against a guess");
  assert.ok(skipped.summary.not_assessed >= 2);

  // Answering the question turns the gap into a real finding.
  const declared = evaluatePlan(plan, mapOnboardingToInputs({ goal: "muscle", trainingAge: "new" }));
  assert.equal(declared.checks.find((c) => c.id === "beginner_load").status, "warn");
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

// ---------------------------------------------------------------------------
// Leg days: a runner's leg day IS the run
// ---------------------------------------------------------------------------

test("the leg-day answer reaches the plan inputs, and an unanswered one does not", () => {
  for (const pref of LEG_DAY_PREFS) {
    assert.equal(mapOnboardingToInputs({ goal: "muscle", legDays: pref }).legDays, pref);
  }
  // Same doctrine as experience, equipment and cardio: never assert back an
  // answer the user did not give.
  assert.equal(Object.hasOwn(mapOnboardingToInputs({ goal: "muscle" }), "legDays"), false);
  assert.equal(Object.hasOwn(mapOnboardingToInputs({ goal: "muscle", legDays: "whatever" }), "legDays"), false);
});

test("the generator drops heavy leg days but keeps the posterior chain", async () => {
  const { buildPrompt } = await import("../api/generate.js");
  const base = { goal: "Strength", experience: "Intermediate", daysPerWeek: 4, sessionLength: 60, equipment: ["Full gym"], injuries: [] };

  assert.ok(!buildPrompt(base).includes("LOWER BODY"), "silent when never asked");
  assert.ok(!buildPrompt({ ...base, legDays: "Lift them" }).includes("LOWER BODY"), "silent for a normal lifter");

  const runs = buildPrompt({ ...base, legDays: "Runs instead" });
  assert.match(runs, /Do NOT program heavy lower-body strength days/);
  // Deliberately NOT zero legs. Running is quad-dominant, and checkLegBalance
  // already flags quad volume far outweighing direct hamstring work, so a plan
  // with no posterior chain would trip the app's own rubric every time.
  assert.match(runs, /HAMSTRING and GLUTE/);
  assert.match(runs, /Do not replace it with squats, leg press or lunges/);

  assert.match(buildPrompt({ ...base, legDays: "Both" }), /Keep ONE lower-body strength day/);
});

test("choosing runs does not silence the audit", async () => {
  const { evaluatePlan } = await import("../evaluator.js");
  // The preference changes what is PRESCRIBED. It must not change what is
  // REPORTED: the product's thesis is telling the truth about a program, and a
  // preference is not a reason to stop.
  const plan = {
    program_name: "Runner",
    goal: "Strength",
    days_per_week: 3,
    days: [
      { day: "Day 1", focus: "Upper", exercises: [{ name: "Barbell Bench Press", sets: 4, reps: "6-8", rpe: 8, notes: "" }, { name: "Barbell Row", sets: 4, reps: "6-8", rpe: 8, notes: "" }] },
      { day: "Day 2", focus: "Run", exercises: [{ name: "Jog", sets: 1, reps: "40 min", rpe: null, notes: "", type: "cardio", durationMin: 40, intensity: "easy" }] },
      { day: "Day 3", focus: "Rest", exercises: [] },
    ],
    progression: "Add 2.5kg when you hit the top of the range.",
    general_notes: "",
  };
  const audit = evaluatePlan(plan, mapOnboardingToInputs({ goal: "muscle", trainingAge: "some", legDays: "Runs instead" }));
  const volume = audit.checks.find((c) => c.id === "weekly_volume");
  assert.notEqual(volume.status, "pass", "a week with no quad or hamstring work must still be reported");
});
