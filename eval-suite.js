/**
 * SpotterAI — evaluator "red-team" suite (pure)
 * ============================================================================
 * A battery of known-good and intentionally-bad training plans, each with an
 * EXPECTED outcome, run through evaluator.js. It powers two things from one
 * source of truth:
 *   - the in-app Evals page (a visible model-eval-style report), and
 *   - a CI test (test/eval-suite.test.js) that fails if the evaluator ever stops
 *     catching what it promises.
 *
 * Dependency-free (only imports the pure evaluator) so it runs under Node too.
 */

import { evaluatePlan } from "./evaluator.js";

const ex = (name, sets, reps, rpe = null) => ({ name, sets, reps, rpe, notes: "" });
const day = (focus, exercises) => ({ day: "Day", focus, exercises });
const plan = (days, extra = {}) => ({ program_name: "Case", goal: "Hypertrophy", days_per_week: days.length, days, progression: "", general_notes: "", ...extra });

function balancedWeek() {
  return plan([
    day("Upper Body", [ex("Barbell Bench Press", 4, "6-8", 8), ex("Barbell Row", 4, "6-8", 8), ex("Overhead Press", 3, "8-10", 8), ex("Lat Pulldown", 3, "10-12", 9), ex("Dumbbell Curl", 3, "12-15", 9), ex("Triceps Rope Pushdown", 3, "12-15", 9)]),
    day("Lower Body", [ex("Back Squat", 4, "5-6", 8), ex("Romanian Deadlift", 3, "8-10", 8), ex("Leg Press", 3, "10-12", 9), ex("Lying Leg Curl", 3, "12-15", 9), ex("Standing Calf Raise", 4, "12-15", 9)]),
    day("Rest", []),
    day("Upper Body", [ex("Incline Dumbbell Press", 4, "8-10", 8), ex("Seated Cable Row", 4, "10-12", 8), ex("Dumbbell Lateral Raise", 3, "12-15", 9), ex("Pull-up", 3, "8-10", 9), ex("Hammer Curl", 3, "12-15", 9), ex("Overhead Triceps Extension", 3, "12-15", 9)]),
    day("Lower Body", [ex("Front Squat", 3, "6-8", 8), ex("Hip Thrust", 3, "8-10", 8), ex("Walking Lunge", 3, "10-12", 8), ex("Seated Leg Curl", 3, "12-15", 9), ex("Seated Calf Raise", 4, "15-20", 9)]),
    day("Rest", []),
    day("Rest", []),
  ]);
}

/** Each case: a plan + inputs + expectations the auditor must satisfy. */
export const CASES = [
  {
    name: "Balanced hypertrophy week",
    desc: "A sensible 4-day upper/lower split — should pass cleanly with a high score.",
    inputs: { goal: "Hypertrophy", experience: "Intermediate" },
    plan: balancedWeek(),
    expect: [{ scoreAtLeast: 85 }, { check: "rest_days", status: "pass" }, { check: "muscle_balance", status: "pass" }, { check: "weekly_volume", status: "pass" }],
  },
  {
    name: "No rest days",
    desc: "Seven straight training days — recovery check must fail.",
    inputs: { goal: "General" },
    plan: plan(Array.from({ length: 7 }, () => day("Full Body", [ex("Goblet Squat", 3, "10", 7), ex("Push-up", 3, "12", 7)]))),
    expect: [{ check: "rest_days", status: "fail" }],
  },
  {
    name: "Beginner maxing out (RPE 10)",
    desc: "Prescribing max-effort work to a beginner — load sanity must fail.",
    inputs: { goal: "Strength", experience: "Beginner" },
    plan: plan([day("Full Body", [ex("Back Squat", 5, "5", 10), ex("Bench Press", 5, "5", 10), ex("Barbell Row", 4, "6", 9)]), day("Rest", [])]),
    expect: [{ check: "beginner_load", status: "fail" }],
  },
  {
    name: "All push, no pull",
    desc: "Pressing with zero pulling volume — push/pull balance must fail.",
    inputs: { goal: "Hypertrophy" },
    plan: plan([day("Push", [ex("Barbell Bench Press", 4, "8", 8), ex("Overhead Press", 4, "8", 8), ex("Incline Dumbbell Press", 4, "10", 8), ex("Triceps Rope Pushdown", 3, "12", 9)]), day("Rest", [])]),
    expect: [{ check: "muscle_balance", status: "fail" }],
  },
  {
    name: "Knee injury, risky movements",
    desc: "A reported knee issue plus contraindicated lifts — injury check must fail.",
    inputs: { goal: "General", injuries: ["knee"] },
    plan: plan([day("Lower Body", [ex("Walking Lunge", 3, "12", 8), ex("Leg Extension", 3, "15", 9), ex("Jump Squat", 3, "10", 8)]), day("Rest", [])]),
    expect: [{ check: "injury_knee", status: "fail" }],
  },
  {
    name: "Junk volume",
    desc: "36 hard sets for chest in a week — weekly-volume sanity must fail.",
    inputs: { goal: "Hypertrophy" },
    plan: plan([day("Chest", Array.from({ length: 12 }, () => ex("Barbell Bench Press", 3, "10", 8))), day("Rest", [])]),
    expect: [{ check: "weekly_volume", status: "fail" }],
  },
  {
    name: "Strength goal, endurance reps",
    desc: "A strength goal trained entirely in the 12–15 range — goal-fit should warn.",
    inputs: { goal: "Strength", experience: "Intermediate" },
    plan: plan([day("Full Body A", [ex("Back Squat", 3, "12-15", 8), ex("Bench Press", 3, "12-15", 8), ex("Barbell Row", 3, "12-15", 8)]), day("Rest", []), day("Full Body B", [ex("Deadlift", 3, "12-15", 8), ex("Overhead Press", 3, "12-15", 8), ex("Lat Pulldown", 3, "12-15", 8)]), day("Rest", [])]),
    expect: [{ check: "goal_fit", status: "warn" }],
  },
  {
    name: "Malformed plan",
    desc: "An unreadable plan must never crash — it scores 0 and says so.",
    inputs: {},
    plan: { program_name: "Broken", days: "not-an-array" },
    expect: [{ check: "invalid_plan", status: "fail" }, { scoreAtMost: 0 }],
  },
];

function evalExpectation(e, res) {
  if ("scoreAtLeast" in e) return { desc: `Score ≥ ${e.scoreAtLeast}`, ok: res.score >= e.scoreAtLeast };
  if ("scoreAtMost" in e) return { desc: `Score ≤ ${e.scoreAtMost}`, ok: res.score <= e.scoreAtMost };
  const c = res.checks.find((x) => x.id === e.check);
  return { desc: `${c?.label || e.check} → ${e.status}`, ok: !!c && c.status === e.status };
}

/** Run every case; returns rich results for rendering / asserting. */
export function runEvalSuite() {
  return CASES.map((cse) => {
    const res = evaluatePlan(cse.plan, cse.inputs || {});
    const expectations = cse.expect.map((e) => evalExpectation(e, res));
    return { name: cse.name, desc: cse.desc, score: res.score, checks: res.checks, expectations, passed: expectations.every((x) => x.ok) };
  });
}
