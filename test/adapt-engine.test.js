import test from "node:test";
import assert from "node:assert/strict";

import { adaptPlan } from "../adapt-engine.js";
import { evaluatePlan } from "../evaluator.js";

// A reasonably clean 3-day plan (one rest day, balanced push/pull, low volume).
function basePlan() {
  return {
    name: "Test Plan",
    goal: "hypertrophy",
    version: "v1",
    days_per_week: 3,
    days: [
      {
        day: "Mon",
        focus: "Push",
        exercises: [
          { name: "Barbell Bench Press", sets: 3, reps: "6-8", rpe: 8 },
          { name: "Overhead Press", sets: 3, reps: "8-10", rpe: 8 },
          { name: "Triceps Pushdown", sets: 3, reps: "10-12", rpe: 8 },
        ],
      },
      {
        day: "Wed",
        focus: "Pull",
        exercises: [
          { name: "Barbell Row", sets: 3, reps: "6-8", rpe: 8 },
          { name: "Lat Pulldown", sets: 3, reps: "10-12", rpe: 8 },
          { name: "Biceps Curl", sets: 3, reps: "10-12", rpe: 8 },
        ],
      },
      {
        day: "Fri",
        focus: "Legs",
        exercises: [
          { name: "Back Squat", sets: 3, reps: "6-8", rpe: 8 },
          { name: "Romanian Deadlift", sets: 3, reps: "8-10", rpe: 8 },
          { name: "Leg Curl", sets: 3, reps: "10-12", rpe: 8 },
        ],
      },
      { day: "Sun", focus: "Rest", exercises: [] },
    ],
  };
}

const inputs = { goal: "hypertrophy", experience: "intermediate", daysPerWeek: 3 };

function findExercise(plan, name) {
  for (const d of plan.days) {
    const ex = (d.exercises || []).find((e) => e.name.toLowerCase().startsWith(name.toLowerCase()));
    if (ex) return ex;
  }
  return null;
}

// A context that neither triggers a deload nor flags low adherence.
function steadyContext(exercises = {}) {
  return {
    workoutsLogged: 9,
    thisWeek: { sessions: 3, target: 3, volume: 5000 },
    weeklySessions: [3, 3, 3, 3, 3, 3, 3, 3],
    weeklyVolume: [1200, 1200, 1200, 1200], // flat → no deload
    activeLimitations: [],
    recentPain: [],
    unit: "kg",
    exercises,
  };
}

test("no logged signal → returns the plan untouched", () => {
  const plan = basePlan();
  const out = adaptPlan(plan, { workoutsLogged: 0, exercises: {} }, inputs);
  assert.equal(out.adapted, false);
  assert.equal(out.changes.length, 0);
  assert.deepEqual(out.plan, plan);
});

test("progression: 2+ sessions at/above target adds a set and suggests the next load", () => {
  const ctx = steadyContext({
    "barbell bench press": { sessions: 3, latest: { weight: 60, reps: 8 }, recentTopReps: [8, 8, 6] },
  });
  const out = adaptPlan(basePlan(), ctx, inputs);
  assert.equal(out.adapted, true);
  const bench = findExercise(out.plan, "Barbell Bench Press");
  assert.equal(bench.sets, 4, "bench set added");
  assert.match(bench.notes || "", /62\.5kg/, "concrete next load annotated");
  const joined = out.changes.join(" ");
  assert.match(joined, /Barbell Bench Press/);
  assert.match(joined, /62\.5kg/);
  assert.match(joined, /8\+ reps/);
});

test("progression skips time-based targets (30s hold)", () => {
  const plan = basePlan();
  plan.days[0].exercises.push({ name: "Plank", sets: 3, reps: "30s", rpe: 7 });
  const ctx = steadyContext({
    plank: { sessions: 4, latest: { weight: 0, reps: 60 }, recentTopReps: [60, 45, 40] },
  });
  const out = adaptPlan(plan, ctx, inputs);
  const plank = findExercise(out.plan, "Plank");
  assert.equal(plank.sets, 3, "no set added to a timed hold");
  assert.equal(out.changes.some((c) => /Plank/.test(c)), false);
});

test("adherence pullback: missed sessions ease accessory volume", () => {
  const ctx = {
    workoutsLogged: 5,
    thisWeek: { sessions: 1, target: 3, volume: 1200 },
    weeklySessions: [3, 3, 1, 1, 1, 2], // recent completed weeks avg 1 << 3
    weeklyVolume: [1200, 1200, 1200, 1200],
    activeLimitations: [],
    recentPain: [],
    unit: "kg",
    exercises: {}, // no per-exercise history → isolate the pullback
  };
  const out = adaptPlan(basePlan(), ctx, inputs);
  assert.equal(out.adapted, true);
  assert.match(out.changes.join(" "), /Eased back .* of 3 planned/);
  // Total working sets went down.
  const before = basePlan().days.reduce((s, d) => s + d.exercises.reduce((x, e) => x + e.sets, 0), 0);
  const after = out.plan.days.reduce((s, d) => s + (d.exercises || []).reduce((x, e) => x + e.sets, 0), 0);
  assert.ok(after < before, "accessory sets trimmed");
});

test("deload: a rising-volume peak backs off ~40% and blocks progression", () => {
  const ctx = {
    workoutsLogged: 12,
    thisWeek: { sessions: 3, target: 3, volume: 1600 },
    weeklySessions: [3, 3, 3, 3, 3, 3],
    weeklyVolume: [1000, 1100, 1200, 1300], // rising into a fresh peak → deload
    activeLimitations: [],
    recentPain: [],
    unit: "kg",
    exercises: {
      "barbell bench press": { sessions: 3, latest: { weight: 60, reps: 8 }, recentTopReps: [8, 8, 8] },
    },
  };
  const out = adaptPlan(basePlan(), ctx, inputs);
  assert.equal(out.adapted, true);
  assert.match(out.changes.join(" "), /Deload week/);
  const bench = findExercise(out.plan, "Barbell Bench Press");
  assert.ok(bench.sets < 3, "sets reduced, not progressed");
  assert.equal(out.changes.some((c) => /added a .* set/.test(c)), false, "no progression during a deload");
});

test("active injuries swap a contraindicated movement in the safety close", () => {
  const plan = basePlan();
  // Walking Lunge is knee-contraindicated in the evaluator's injury rules.
  plan.days[2].exercises.unshift({ name: "Walking Lunge", sets: 3, reps: "10-12", rpe: 8 });
  const ctx = steadyContext();
  ctx.activeLimitations = ["knee"];

  const kneeBefore = evaluatePlan(plan, { ...inputs, injuries: ["knee"] }).checks.find((c) => c.id === "injury_knee");
  assert.equal(kneeBefore.status, "warn", "the lunge is a real knee conflict to begin with");

  const out = adaptPlan(plan, ctx, inputs);
  assert.equal(out.adapted, true);
  // The lunge is gone and the knee conflict is resolved.
  const legNames = out.plan.days.find((d) => d.focus === "Legs").exercises.map((e) => e.name.toLowerCase());
  assert.equal(legNames.some((n) => n.includes("lunge")), false, "lunge swapped out");
  const kneeAfter = evaluatePlan(out.plan, { ...inputs, injuries: ["knee"] }).checks.find((c) => c.id === "injury_knee");
  assert.equal(kneeAfter.status, "pass", "knee conflict resolved");
  assert.match(out.changes.join(" "), /Replaced with/);
});

test("SAFETY INVARIANT: output never carries more critical/warning flags than baseline", () => {
  const contexts = [
    steadyContext({ "barbell bench press": { sessions: 3, latest: { weight: 60, reps: 8 }, recentTopReps: [8, 8, 8] } }),
    (() => { const c = steadyContext(); c.activeLimitations = ["knee", "shoulder"]; return c; })(),
    (() => { const c = steadyContext(); c.weeklySessions = [3, 3, 1, 1, 1, 1]; c.thisWeek = { sessions: 1, target: 3, volume: 900 }; return c; })(),
    { workoutsLogged: 12, thisWeek: { sessions: 3, target: 3, volume: 1600 }, weeklySessions: [3, 3, 3, 3], weeklyVolume: [1000, 1100, 1200, 1300], activeLimitations: [], recentPain: [], unit: "kg", exercises: {} },
  ];
  for (const ctx of contexts) {
    const plan = basePlan();
    const injuries = Array.from(new Set([...(inputs.injuries || []), ...(ctx.activeLimitations || [])]));
    const effInputs = { ...inputs, injuries };
    const baseline = evaluatePlan(plan, effInputs).summary;
    const out = adaptPlan(plan, ctx, inputs);
    const after = evaluatePlan(out.plan, effInputs).summary;
    assert.ok(after.critical <= baseline.critical, `critical ${after.critical} > baseline ${baseline.critical}`);
    assert.ok(after.warning <= baseline.warning, `warning ${after.warning} > baseline ${baseline.warning}`);
  }
});

test("end-to-end: bumps version and produces a summary when it changes", () => {
  const ctx = steadyContext({
    "barbell bench press": { sessions: 3, latest: { weight: 60, reps: 8 }, recentTopReps: [8, 8, 8] },
  });
  const out = adaptPlan(basePlan(), ctx, inputs);
  assert.equal(out.adapted, true);
  assert.notEqual(out.plan.version, "v1", "version bumped");
  assert.ok(out.summary.length > 0);
  assert.ok(out.changes.length > 0);
});
