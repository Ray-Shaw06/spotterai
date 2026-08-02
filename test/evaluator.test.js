/**
 * Tests for the safety & quality evaluator — the project's trust centerpiece.
 * Pure code, no LLM, no browser: runs under Node's built-in test runner
 * (`node --test`) with zero dependencies.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePlan } from "../evaluator.js";

// --- tiny builders ----------------------------------------------------------
const ex = (name, sets, reps, rpe = null) => ({ name, sets, reps, rpe, notes: "" });
const day = (focus, exercises) => ({ day: "Day", focus, exercises });
const plan = (days, extra = {}) => ({
  program_name: "Test Program",
  goal: "Hypertrophy",
  days_per_week: days.length,
  days,
  progression: "",
  general_notes: "",
  ...extra,
});
const check = (audit, id) => audit.checks.find((c) => c.id === id);

// A balanced, sensible intermediate hypertrophy week (push≈pull, 1+ rest days).
function goodPlan() {
  return plan([
    day("Upper Body", [
      ex("Barbell Bench Press", 4, "6-8", 8),
      ex("Barbell Row", 4, "6-8", 8),
      ex("Overhead Press", 3, "8-10", 8),
      ex("Lat Pulldown", 3, "10-12", 9),
      ex("Dumbbell Curl", 3, "12-15", 9),
      ex("Triceps Rope Pushdown", 3, "12-15", 9),
    ]),
    day("Lower Body", [
      ex("Back Squat", 4, "5-6", 8),
      ex("Romanian Deadlift", 3, "8-10", 8),
      ex("Leg Press", 3, "10-12", 9),
      ex("Lying Leg Curl", 3, "12-15", 9),
      ex("Standing Calf Raise", 4, "12-15", 9),
    ]),
    day("Rest", []),
    day("Upper Body", [
      ex("Incline Dumbbell Press", 4, "8-10", 8),
      ex("Seated Cable Row", 4, "10-12", 8),
      ex("Dumbbell Lateral Raise", 3, "12-15", 9),
      ex("Pull-up", 3, "8-10", 9),
      ex("Hammer Curl", 3, "12-15", 9),
      ex("Overhead Triceps Extension", 3, "12-15", 9),
    ]),
    day("Lower Body", [
      ex("Front Squat", 3, "6-8", 8),
      ex("Hip Thrust", 3, "8-10", 8),
      ex("Walking Lunge", 3, "10-12", 8),
      ex("Seated Leg Curl", 3, "12-15", 9),
      ex("Seated Calf Raise", 4, "15-20", 9),
    ]),
    day("Rest", []),
    day("Rest", []),
  ]);
}

test("a balanced, sensible plan scores high with passing core checks", () => {
  const audit = evaluatePlan(goodPlan(), { goal: "Hypertrophy", experience: "Intermediate" });
  assert.ok(audit.score >= 85, `expected a high score, got ${audit.score}`);
  assert.equal(check(audit, "rest_days").status, "pass");
  assert.equal(check(audit, "muscle_balance").status, "pass");
  assert.equal(check(audit, "weekly_volume").status, "pass");
});

test("score is always within 0–100", () => {
  const audit = evaluatePlan(goodPlan(), { goal: "Hypertrophy" });
  assert.ok(audit.score >= 0 && audit.score <= 100);
});

test("seven training days (no rest) fails the recovery check", () => {
  const p = plan(Array.from({ length: 7 }, () => day("Full Body", [ex("Goblet Squat", 3, "10", 7)])));
  const audit = evaluatePlan(p, { goal: "General" });
  assert.equal(check(audit, "rest_days").status, "fail");
});

test("prescribing RPE 10 to a beginner is flagged", () => {
  const p = plan([day("Full Body", [ex("Back Squat", 5, "5", 10), ex("Bench Press", 5, "5", 9)])]);
  const audit = evaluatePlan(p, { goal: "Strength", experience: "Beginner" });
  assert.equal(check(audit, "beginner_load").status, "fail");
});

test("an all-push plan with no pulling fails push/pull balance", () => {
  const p = plan([
    day("Push", [
      ex("Barbell Bench Press", 4, "8", 8),
      ex("Overhead Press", 4, "8", 8),
      ex("Incline Dumbbell Press", 4, "10", 8),
      ex("Triceps Rope Pushdown", 3, "12", 9),
    ]),
    day("Rest", []),
  ]);
  const audit = evaluatePlan(p, { goal: "Hypertrophy" });
  assert.equal(check(audit, "muscle_balance").status, "fail");
});

test("knee injury + multiple risky movements raises an injury flag", () => {
  const p = plan([
    day("Lower Body", [
      ex("Walking Lunge", 3, "12", 8),
      ex("Leg Extension", 3, "15", 9),
      ex("Jump Squat", 3, "10", 8),
    ]),
    day("Rest", []),
  ]);
  const audit = evaluatePlan(p, { goal: "General", injuries: ["knee"] });
  const injury = check(audit, "injury_knee");
  assert.ok(injury, "expected a knee injury check");
  assert.equal(injury.status, "fail");
});

test("excessive weekly volume for one muscle is flagged", () => {
  const p = plan([
    day("Chest", Array.from({ length: 12 }, () => ex("Barbell Bench Press", 3, "10", 8))),
    day("Rest", []),
  ]);
  const audit = evaluatePlan(p, { goal: "Hypertrophy" });
  assert.equal(check(audit, "weekly_volume").status, "fail");
});

test("a malformed plan never throws, it returns score 0 and an invalid-plan flag", () => {
  for (const bad of [null, undefined, {}, { days: "nope" }]) {
    const audit = evaluatePlan(bad, {});
    assert.equal(audit.score, 0);
    assert.ok(audit.checks.some((c) => c.id === "invalid_plan"));
  }
});

test("every check exposes the public shape and never leaks the internal penalty", () => {
  const audit = evaluatePlan(goodPlan(), { goal: "Hypertrophy" });
  for (const c of audit.checks) {
    assert.ok(["pass", "warn", "fail", "not_assessed"].includes(c.status));
    assert.equal(typeof c.label, "string");
    assert.equal(typeof c.detail, "string");
    assert.equal(c.penalty, undefined);
  }
});

test("every check carries a severity tier and the audit returns a summary", () => {
  const audit = evaluatePlan(goodPlan(), { goal: "Hypertrophy", experience: "Intermediate" });
  for (const c of audit.checks) {
    assert.ok(["critical", "warning", "suggestion", "pass", "not_assessed"].includes(c.tier), `bad tier: ${c.tier}`);
  }
  const s = audit.summary;
  assert.equal(s.total, audit.checks.length);
  assert.equal(s.critical + s.warning + s.suggestion + s.passed + s.not_assessed, audit.checks.length);
});

// ============================================================================
// Evaluator v1.3.0 — coverage gap found 2026-08-02
//
// The product's founding example (a ChatGPT plan with no progressive overload
// and inflated rep ranges) could not be detected by the evaluator:
//   - no progressive-overload check existed at all
//   - checkGoalFit returned an unconditional pass for the `general` bucket,
//     which lib/plan.js defaults a goal-less plan into
// These cases fail before that work and pass after.
// ============================================================================

/** A directionless "general fitness" week: every lift at 4x12, no progression. */
function directionlessPlan() {
  return plan(
    [
      day("Push", [
        ex("Barbell Bench Press", 4, "12", 8),
        ex("Overhead Press", 4, "12", 8),
        ex("Triceps Rope Pushdown", 4, "12", 8),
      ]),
      day("Pull", [
        ex("Barbell Row", 4, "12", 8),
        ex("Lat Pulldown", 4, "12", 8),
        ex("Dumbbell Curl", 4, "12", 8),
      ]),
      day("Legs", [
        ex("Back Squat", 4, "12", 8),
        ex("Romanian Deadlift", 4, "12", 8),
        ex("Standing Calf Raise", 4, "12", 8),
      ]),
      day("Rest", []),
      day("Rest", []),
    ],
    { goal: "General fitness", progression: "" }
  );
}

/**
 * A textbook novice linear-progression week: every lift at 5 reps, on purpose,
 * with a concrete rule for adding load. Uniform reps here is the design, not a
 * defect — this is the false-positive guard for the new goal_fit branch.
 */
function linearProgressionPlan() {
  return plan(
    [
      day("Workout A", [ex("Back Squat", 5, "5", 8), ex("Barbell Bench Press", 5, "5", 8), ex("Barbell Row", 5, "5", 8)]),
      day("Rest", []),
      day("Workout B", [ex("Back Squat", 5, "5", 8), ex("Overhead Press", 5, "5", 8), ex("Deadlift", 1, "5", 8)]),
      day("Rest", []),
    ],
    { goal: "General fitness", progression: "Add 2.5kg to every lift each session. On the third failed session, deload 10% and work back up." }
  );
}

test("FALSE-POSITIVE GUARD: a 5x5 linear-progression week is not flagged for uniform reps", () => {
  // Uniform LOW reps is a strength template with a load-based progression.
  // Uniform MODERATE-to-HIGH reps is the directionless-chatbot signature. Only
  // the second one should flag, and the advice attached to the flag ("vary the
  // main lifts from the accessories") is actively wrong for a 5x5 program.
  const audit = evaluatePlan(linearProgressionPlan(), {});
  assert.equal(check(audit, "goal_fit").status, "pass", "5x5 must not be told to vary its rep ranges");
  assert.equal(check(audit, "progressive_overload").status, "pass", "5x5 states a concrete load progression");
});

test("REGRESSION: a general-goal plan with uniform high reps is flagged by goal_fit", () => {
  // Before v1.3.0 checkGoalFit returned an unconditional pass for the `general`
  // bucket, so this plan — the shape of the real ChatGPT plan that motivated the
  // project — was reported as reasonable.
  const audit = evaluatePlan(directionlessPlan(), {});
  const gf = check(audit, "goal_fit");
  assert.ok(gf, "expected a goal_fit check");
  assert.notEqual(gf.status, "pass", "a directionless 4x12 week must not pass goal_fit");
});

test("a plan that states no progression scheme is flagged", () => {
  const audit = evaluatePlan(directionlessPlan(), {});
  const po = check(audit, "progressive_overload");
  assert.ok(po, "expected a progressive_overload check");
  assert.notEqual(po.status, "pass");
  assert.match(po.detail, /\S/, "the flag must carry a plain-English explanation");
});

test("a plan with a concrete progression scheme passes progressive_overload", () => {
  const p = plan(goodPlan().days, {
    goal: "Hypertrophy",
    progression: "Add 2.5kg to the main lift each week. When you hit the top of the rep range on all sets, add weight and drop back to the bottom.",
  });
  const audit = evaluatePlan(p, { goal: "Hypertrophy", experience: "Intermediate" });
  assert.equal(check(audit, "progressive_overload").status, "pass");
});

test("vague encouragement does not count as a progression scheme", () => {
  // REGRESSION (v1.3.0 review): this test originally used only "Train hard and
  // stay consistent!", which happens to contain none of the signal words. That
  // made it pass while the check was waving through the far more likely note
  // "Progress over time." — the bare substring "pr" matched inside the word
  // "progress", so one concept scored two signals and cleared the bar.
  const encouragement = [
    "Train hard and stay consistent!",
    "Progress over time.",
    "Just keep progressing.",
    "Push yourself and improve each week.",
    "Focus on proper form and progress.",
    "Try to press harder every week.",
    "Prepare well and progress steadily.",
    "Go easy on your elbows and progress when it feels right.",
  ];
  for (const progression of encouragement) {
    const p = plan(goodPlan().days, { goal: "Hypertrophy", progression });
    const audit = evaluatePlan(p, { goal: "Hypertrophy", experience: "Intermediate" });
    assert.notEqual(
      check(audit, "progressive_overload").status,
      "pass",
      `encouragement accepted as a concrete rule: "${progression}"`
    );
  }
});

test("concrete progression rules still pass, in the forms people actually write them", () => {
  // The guard against over-tightening: these are real progression instructions
  // and every one of them must survive the boundary matching above.
  const concrete = [
    "Add 2.5kg to the main lift when you hit the top of the rep range on every set.",
    "Increase the load 5 lbs each week on squats and presses.",
    "Add 5% to the bar once all sets hit the top of the range. Deload week 5.",
    "Double progression: add reps to the top of the range, then add weight.",
    "Last set is AMRAP; when you beat the target by 2 reps, microload up.",
  ];
  for (const progression of concrete) {
    const p = plan(goodPlan().days, { goal: "Hypertrophy", progression });
    const audit = evaluatePlan(p, { goal: "Hypertrophy", experience: "Intermediate" });
    assert.equal(
      check(audit, "progressive_overload").status,
      "pass",
      `a concrete rule was rejected: "${progression}"`
    );
  }
});

test("progressive_overload is a suggestion, not a warning about the plan's safety", () => {
  // Zero score weight AND suggestion tier, matching muscle_frequency and
  // equipment_fit. Tier is what the UI sorts on and what trust.js reads: at
  // "warning" a missing progression note silently drops the Trust Report from
  // High to Medium on a plan with no safety concern at all.
  const p = plan(goodPlan().days, { goal: "Hypertrophy", progression: "" });
  const audit = evaluatePlan(p, { goal: "Hypertrophy", experience: "Intermediate" });
  const po = check(audit, "progressive_overload");
  assert.equal(po.status, "warn");
  assert.equal(po.tier, "suggestion");
  assert.equal(audit.summary.warning, 0, "a missing progression note is not a safety warning");
});

/**
 * A single monster quad day: 33 working sets (>= SESSION_SETS_WARN 30), zero
 * direct hamstring work (leg_balance warns when hamstrings are 0), and four
 * unrecognized lift names so recognition drops under COVERAGE_MIN (0.7).
 * Built to actually TRIP leg_balance, session_load and coverage — the three
 * checks that had no REMEDIES entry and so flagged with no advice.
 */
function noRemedyPlan() {
  return plan(
    [
      day("Legs", [
        ex("Back Squat", 5, "10", 8),
        ex("Front Squat", 5, "10", 8),
        ex("Leg Press", 5, "12", 8),
        ex("Leg Extension", 5, "15", 9),
        ex("Hack Squat", 5, "12", 8),
        ex("Zercher Sissy Blaster", 2, "12", 8),
        ex("Reverse Bosu Pistol Hold", 2, "12", 8),
        ex("Cossack Glide Machine", 2, "12", 8),
        ex("Anterior Chain Finisher", 2, "12", 8),
      ]),
      day("Rest", []),
    ],
    { goal: "General fitness", progression: "" }
  );
}

test("leg_balance, session_load and coverage all flag and all carry a suggested fix", () => {
  // remedyFor had no REMEDIES entry for these three, so they rendered as flags
  // with no advice. Assert the checks actually fire first, so this test cannot
  // pass vacuously.
  const audit = evaluatePlan(noRemedyPlan(), {});
  for (const id of ["leg_balance", "session_load", "coverage"]) {
    const c = check(audit, id);
    assert.ok(c, `expected a ${id} check`);
    assert.notEqual(c.status, "pass", `${id} must actually flag for this test to mean anything`);
    assert.equal(typeof c.fix, "string", `${id} was flagged with no suggested fix`);
    assert.match(c.fix, /\S/, `${id} has an empty fix string`);
  }
});

test("no flagged check anywhere is left without a suggested fix", () => {
  for (const p of [directionlessPlan(), noRemedyPlan()]) {
    const audit = evaluatePlan(p, {});
    for (const c of audit.checks) {
      if (c.tier === "pass" || c.tier === "not_assessed") continue;
      assert.equal(typeof c.fix, "string", `${c.id} was flagged with no suggested fix`);
    }
  }
});

// --- "not assessed" is not "passed" -----------------------------------------

test("unknown experience is reported as not assessed, never as a pass", () => {
  // checkBeginnerLoad used to return a pass reading "Not a beginner, advanced
  // intensity is appropriate" when experience was simply unknown.
  const audit = evaluatePlan(goodPlan(), {});
  const bl = check(audit, "beginner_load");
  assert.equal(bl.status, "not_assessed");
  assert.equal(bl.tier, "not_assessed");
});

test("not-assessed checks are counted separately and never as flags", () => {
  const audit = evaluatePlan(goodPlan(), {});
  const s = audit.summary;
  assert.ok(s.not_assessed > 0, "a zero-input audit should have unassessed checks");
  assert.equal(s.flags, s.critical + s.warning + s.suggestion);
  const notAssessed = audit.checks.filter((c) => c.tier === "not_assessed");
  for (const c of notAssessed) {
    assert.notEqual(c.tier, "warning", "not-assessed must not leak into the flagged list");
  }
});

test("not-assessed checks carry no score penalty", () => {
  // REGRESSION (v1.3.0 review): this asserted only `withoutInputs <= withInputs`,
  // which stays true even if not_assessed carried a penalty — so it could not
  // fail for the reason its name gives. Assert the actual invariant: filling in
  // the missing inputs turns those checks from not_assessed to pass and moves
  // the score by nothing.
  const inputs = { goal: "Hypertrophy", experience: "Intermediate", equipment: ["Full gym"] };
  const withInputs = evaluatePlan(goodPlan(), inputs);
  const withoutInputs = evaluatePlan(goodPlan(), { goal: "Hypertrophy" });

  assert.ok(withoutInputs.summary.not_assessed > 0, "the no-input audit must exercise the unassessed path");
  assert.equal(withInputs.summary.not_assessed, 0, "the full-input audit must assess everything");
  assert.equal(withInputs.summary.flags, withoutInputs.summary.flags, "fixture must not change flags, or the score comparison proves nothing");
  assert.equal(
    withoutInputs.score,
    withInputs.score,
    "an unassessed check must cost exactly the same as a passing one: zero"
  );
});

test("a flagged check carries a structured fix and injury flags carry safer alternatives", () => {
  const p = plan([
    day("Lower Body", [ex("Walking Lunge", 3, "12", 8), ex("Leg Extension", 3, "15", 9), ex("Jump Squat", 3, "10", 8)]),
    day("Rest", []),
  ]);
  const audit = evaluatePlan(p, { goal: "General", injuries: ["knee"] });
  const injury = audit.checks.find((c) => c.id === "injury_knee");
  assert.equal(injury.tier, "critical");
  assert.equal(typeof injury.fix, "string");
  assert.ok(Array.isArray(injury.alternatives) && injury.alternatives.length > 0);
});
