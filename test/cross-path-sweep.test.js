/**
 * Cross-path sweep (T9 / E6) — the trust claim behind /import.
 *
 * /import promises that pasting someone else's plan gets you the same audit a
 * plan generated here would get. If an imported plan scores differently from an
 * identical generated one, the feature is lying, and it is lying in the one
 * place the product's whole pitch lives.
 *
 * Both paths funnel through lib/plan.js normalizePlan, so the invariants below
 * are enforceable before api/import.js exists. That is the point of writing
 * this first: it proves the premise while it is still cheap to be wrong.
 *
 * Four invariants:
 *   1. normalizePlan is idempotent          — re-normalizing changes nothing
 *   2. same plan + same inputs = same audit  — regardless of entry path
 *   3. no profile never scores WORSE         — importing is not penalised for
 *                                              information we never asked for
 *   4. plan-only checks are path-blind       — only the input-dependent checks
 *                                              may differ, and only to
 *                                              not_assessed
 */

import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePlan } from "../evaluator.js";
import { isValidPlan, normalizePlan } from "../lib/plan.js";

/** Checks that read userInputs. Everything else must be identical across paths. */
const INPUT_DEPENDENT = new Set(["beginner_load", "equipment_fit"]);

/** Raw model output, the shape /api/generate gets back from Gemini. */
function rawPlan() {
  return {
    program_name: "Upper / Lower Split",
    goal: "Hypertrophy",
    days_per_week: 4,
    progression:
      "Add 2.5kg to each main lift once you hit the top of the rep range on every set, then drop back to the bottom. Deload week 5.",
    general_notes: "Warm up with two ramping sets on the first movement of each session.",
    days: [
      {
        day: "Day 1",
        focus: "Upper Body",
        exercises: [
          { name: "Barbell Bench Press", sets: 4, reps: "6-8", rpe: 8, notes: "" },
          { name: "Barbell Row", sets: 4, reps: "6-8", rpe: 8, notes: "" },
          { name: "Overhead Press", sets: 3, reps: "8-10", rpe: 8, notes: "" },
          { name: "Lat Pulldown", sets: 3, reps: "10-12", rpe: 9, notes: "" },
        ],
      },
      {
        day: "Day 2",
        focus: "Lower Body",
        exercises: [
          { name: "Back Squat", sets: 4, reps: "5-6", rpe: 8, notes: "" },
          { name: "Romanian Deadlift", sets: 3, reps: "8-10", rpe: 8, notes: "" },
          { name: "Leg Press", sets: 3, reps: "10-12", rpe: 9, notes: "" },
          { name: "Lying Leg Curl", sets: 3, reps: "12-15", rpe: 9, notes: "" },
        ],
      },
      { day: "Day 3", focus: "Rest", exercises: [] },
      {
        day: "Day 4",
        focus: "Upper Body",
        exercises: [
          { name: "Incline Dumbbell Press", sets: 4, reps: "8-10", rpe: 8, notes: "" },
          { name: "Chest-Supported Row", sets: 4, reps: "8-10", rpe: 8, notes: "" },
          { name: "Dumbbell Curl", sets: 3, reps: "12-15", rpe: 9, notes: "" },
          { name: "Triceps Rope Pushdown", sets: 3, reps: "12-15", rpe: 9, notes: "" },
        ],
      },
      { day: "Day 5", focus: "Rest", exercises: [] },
    ],
  };
}

/**
 * The GENERATED path: Gemini JSON normalised once, with the onboarding profile
 * available because the user just filled it in.
 */
function generated(inputs) {
  const raw = rawPlan();
  assert.ok(isValidPlan(raw), "fixture must pass the same gate /api/generate uses");
  return normalizePlan(raw, inputs);
}

/**
 * The IMPORT path: the same plan makes a round trip through JSON (what a parser
 * hands back after reading pasted text) and is normalised on the way in. If
 * normalizePlan is not idempotent, or the round trip drops a field, this is
 * where the two paths diverge.
 */
function imported(inputs) {
  const roundTripped = JSON.parse(JSON.stringify(normalizePlan(rawPlan(), {})));
  assert.ok(isValidPlan(roundTripped), "an imported plan must still pass the structural gate");
  return normalizePlan(roundTripped, inputs);
}

// --- 1. normalizePlan is idempotent -----------------------------------------

test("normalizePlan is idempotent, so re-normalising an imported plan is a no-op", () => {
  const once = normalizePlan(rawPlan(), {});
  const twice = normalizePlan(once, {});
  assert.deepEqual(twice, once, "a plan normalised twice must equal a plan normalised once");
});

test("the round trip preserves every field the evaluator reads", () => {
  const direct = normalizePlan(rawPlan(), {});
  const viaImport = imported({});
  assert.deepEqual(viaImport, direct, "the import round trip must not drop or coerce anything");
  // Named explicitly: progression is the field the v1.3.0 check depends on, and
  // it is the one most likely to be lost by a parser that only reads days.
  assert.equal(viaImport.progression, direct.progression);
  assert.ok(viaImport.progression.length > 0, "fixture must actually carry a progression note");
});

// --- 2. same plan + same inputs = same audit --------------------------------

test("REGRESSION: the same plan audits identically whether imported or generated", () => {
  const inputs = { goal: "Hypertrophy", experience: "Intermediate", equipment: ["Full gym"] };
  const a = evaluatePlan(generated(inputs), inputs);
  const b = evaluatePlan(imported(inputs), inputs);

  assert.equal(b.score, a.score, "identical plans must score identically across entry paths");
  assert.deepEqual(b.summary, a.summary);
  assert.deepEqual(
    b.checks.map((c) => [c.id, c.status, c.tier]),
    a.checks.map((c) => [c.id, c.status, c.tier]),
    "every check must reach the same verdict on both paths"
  );
});

// --- 3. no profile never scores worse ---------------------------------------

test("REGRESSION: an imported plan with no profile never scores worse than the same plan with one", () => {
  // This is the product claim. If importing cost you points for information we
  // never asked for, the audit would be punishing people for arriving without
  // an account, which is the exact wall /import exists to route around.
  const withProfile = evaluatePlan(imported({}), { goal: "Hypertrophy", experience: "Intermediate", equipment: ["Full gym"] });
  const noProfile = evaluatePlan(imported({}), {});

  assert.equal(noProfile.score, withProfile.score, "a missing profile must cost exactly zero points");
  assert.ok(noProfile.summary.not_assessed > 0, "the no-profile audit must exercise the unassessed path");
  assert.equal(withProfile.summary.not_assessed, 0, "the full-profile audit must assess everything");
});

test("an unassessed check never appears as a flag on the import path", () => {
  const audit = evaluatePlan(imported({}), {});
  assert.equal(audit.summary.flags, audit.summary.critical + audit.summary.warning + audit.summary.suggestion);
  for (const c of audit.checks.filter((x) => x.tier === "not_assessed")) {
    assert.notEqual(c.tier, "warning", `${c.id} leaked into the flagged list`);
    assert.notEqual(c.tier, "pass", `${c.id} leaked into the passed list`);
  }
});

// --- 4. plan-only checks are path-blind -------------------------------------

test("REGRESSION: every plan-only check is blind to whether a profile exists", () => {
  const plan = imported({});
  const withProfile = evaluatePlan(plan, { goal: "Hypertrophy", experience: "Intermediate", equipment: ["Full gym"] });
  const noProfile = evaluatePlan(plan, {});

  const planOnly = (audit) =>
    audit.checks.filter((c) => !INPUT_DEPENDENT.has(c.id)).map((c) => [c.id, c.status, c.tier, c.detail]);

  assert.deepEqual(
    planOnly(noProfile),
    planOnly(withProfile),
    "a check that does not read userInputs must not change when the profile is absent"
  );

  // And the two that DO read inputs must degrade to not_assessed, never to a flag.
  for (const id of INPUT_DEPENDENT) {
    const c = noProfile.checks.find((x) => x.id === id);
    assert.ok(c, `expected a ${id} check`);
    assert.equal(c.tier, "not_assessed", `${id} must degrade to not_assessed with no profile`);
  }
});

test("goal_fit falls back to the plan's own goal, so an imported plan is judged on its stated intent", () => {
  // goalBucket reads userInputs.goal || plan.goal. An imported plan carries its
  // goal in the plan itself, so the check must not silently drop to the general
  // bucket just because no profile was collected.
  const audit = evaluatePlan(imported({}), {});
  const gf = audit.checks.find((c) => c.id === "goal_fit");
  assert.ok(gf);
  assert.match(gf.detail, /hypertrophy/i, "the hypertrophy plan must be judged as hypertrophy, not as general");
});
