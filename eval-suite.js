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

  // --- Expanded battery: more risky plans + false-positive guards ----------
  {
    name: "Quad-dominant, no hamstrings",
    desc: "Heavy quad work with zero direct hamstring volume — leg-balance must flag.",
    inputs: { goal: "Hypertrophy", experience: "Intermediate" },
    plan: plan([day("Legs", [ex("Back Squat", 4, "6-8", 8), ex("Leg Press", 4, "10-12", 8), ex("Bulgarian Split Squat", 3, "10", 8), ex("Leg Extension", 3, "15", 9)]), day("Upper", [ex("Bench Press", 4, "8", 8), ex("Barbell Row", 4, "8", 8)]), day("Rest", [])]),
    expect: [{ check: "leg_balance", status: "warn" }],
  },
  {
    name: "Marathon session",
    desc: "One workout with 40+ working sets — session-length sanity must fail.",
    inputs: { goal: "Hypertrophy" },
    plan: plan([day("Everything", Array.from({ length: 14 }, (_, i) => ex(["Bench Press", "Barbell Row", "Overhead Press", "Lat Pulldown", "Back Squat", "Romanian Deadlift", "Leg Press"][i % 7], 3, "10", 8))), day("Rest", [])]),
    expect: [{ check: "session_load", status: "fail" }],
  },
  {
    name: "Lower-back injury, heavy hinging",
    desc: "A reported lower-back issue plus deadlifts and good mornings — injury check must fail.",
    inputs: { goal: "Strength", injuries: ["lower_back"] },
    plan: plan([day("Pull", [ex("Conventional Deadlift", 4, "5", 8), ex("Barbell Row", 4, "8", 8), ex("Good Morning", 3, "10", 8)]), day("Rest", [])]),
    expect: [{ check: "injury_lower_back", status: "fail" }],
  },
  {
    name: "Shoulder injury, overhead pressing",
    desc: "A reported shoulder issue plus overhead presses, dips, and upright rows — injury check must fail.",
    inputs: { goal: "Hypertrophy", injuries: ["shoulder"] },
    plan: plan([day("Push", [ex("Overhead Press", 4, "8", 8), ex("Dips", 3, "10", 8), ex("Upright Row", 3, "12", 8)]), day("Rest", [])]),
    expect: [{ check: "injury_shoulder", status: "fail" }],
  },
  {
    name: "Wrist injury, straight-bar work",
    desc: "A reported wrist issue plus barbell bench and barbell curls — injury check must flag.",
    inputs: { goal: "Hypertrophy", injuries: ["wrist"] },
    plan: plan([day("Upper", [ex("Barbell Bench Press", 4, "6-8", 8), ex("Barbell Curl", 3, "10", 8), ex("Seated Cable Row", 4, "10", 8)]), day("Rest", [])]),
    expect: [{ check: "injury_wrist", status: "fail" }],
  },
  {
    name: "Six training days",
    desc: "Six sessions, one rest day — recovery should warn (works only if well managed).",
    inputs: { goal: "Hypertrophy", experience: "Advanced" },
    plan: plan([...Array.from({ length: 6 }, () => day("Full Body", [ex("Goblet Squat", 3, "10", 7), ex("Dumbbell Bench Press", 3, "10", 7), ex("One-Arm Dumbbell Row", 3, "10", 7)])), day("Rest", [])]),
    expect: [{ check: "rest_days", status: "warn" }],
  },
  {
    name: "Knee-aware plan (false-positive guard)",
    desc: "Knee injury declared, but every lift is knee-friendly — the injury check must NOT fire.",
    inputs: { goal: "Hypertrophy", injuries: ["knee"] },
    plan: plan([day("Lower", [ex("Leg Press", 3, "12", 7), ex("Hip Thrust", 3, "10", 7), ex("Seated Leg Curl", 3, "12", 8), ex("Step-up", 3, "10", 7)]), day("Rest", [])]),
    expect: [{ check: "injury_knee", status: "pass" }],
  },
  {
    name: "Balanced full-body (false-positive guard)",
    desc: "A sensible 3-day full-body week — must pass cleanly with a high score.",
    inputs: { goal: "Hypertrophy", experience: "Intermediate" },
    plan: plan([
      day("Full Body A", [ex("Back Squat", 3, "6-8", 8), ex("Bench Press", 3, "8-10", 8), ex("Barbell Row", 3, "8-10", 8), ex("Romanian Deadlift", 3, "10", 8), ex("Lat Pulldown", 3, "10-12", 8)]),
      day("Rest", []),
      day("Full Body B", [ex("Leg Press", 3, "10-12", 8), ex("Overhead Press", 3, "8-10", 8), ex("Seated Cable Row", 3, "10-12", 8), ex("Lying Leg Curl", 3, "12", 8), ex("Dumbbell Curl", 3, "12", 8)]),
      day("Rest", []),
      day("Full Body C", [ex("Front Squat", 3, "8", 8), ex("Incline Dumbbell Press", 3, "10", 8), ex("Pull-up", 3, "8", 8), ex("Hip Thrust", 3, "10", 8), ex("Triceps Pushdown", 3, "12", 8)]),
      day("Rest", []),
      day("Rest", []),
    ]),
    expect: [{ scoreAtLeast: 85 }, { check: "muscle_balance", status: "pass" }, { check: "leg_balance", status: "pass" }, { check: "weekly_volume", status: "pass" }],
  },
];

// Scenario type per case, for the Safety Lab filters/labels.
const CASE_TYPES = {
  "Balanced hypertrophy week": "good",
  "Balanced full-body (false-positive guard)": "guard",
  "Knee-aware plan (false-positive guard)": "guard",
  "Malformed plan": "edge",
};
export function caseType(name) {
  return CASE_TYPES[name] || "risky";
}

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
    const flagged = res.checks.filter((c) => c.tier && c.tier !== "pass").map((c) => c.label);
    return { name: cse.name, desc: cse.desc, type: caseType(cse.name), score: res.score, checks: res.checks, flagged, expectations, passed: expectations.every((x) => x.ok) };
  });
}
