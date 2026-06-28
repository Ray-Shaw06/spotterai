/**
 * Tests for the deterministic plan-repair engine. A "fix" must actually move the
 * audit it was derived from — and must never make the plan worse.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { repairPlan } from "../repair.js";

const ex = (name, sets, reps, rpe = null) => ({ name, sets, reps, rpe, notes: "" });
const day = (focus, exs) => ({ day: focus, focus, exercises: exs });

test("repairing a knee-conflict + imbalance plan reduces flags and never worsens the score", () => {
  const plan = {
    program_name: "Push Focus", goal: "Hypertrophy", days_per_week: 2, version: "v1",
    days: [
      day("Push A", [ex("Barbell Bench Press", 4, "8", 8), ex("Overhead Press", 4, "8", 8), ex("Incline Dumbbell Press", 4, "10", 8), ex("Walking Lunge", 3, "12", 8), ex("Leg Extension", 3, "15", 9)]),
      day("Push B", [ex("Dumbbell Bench Press", 4, "8", 8), ex("Triceps Pushdown", 3, "12", 9)]),
    ],
  };
  const r = repairPlan(plan, { goal: "Hypertrophy", injuries: ["knee"] });

  const beforeFlags = r.before.summary.critical + r.before.summary.warning;
  const afterFlags = r.after.summary.critical + r.after.summary.warning;

  assert.ok(r.changes.length > 0, "expected at least one repair change");
  assert.ok(afterFlags < beforeFlags, `expected fewer flags after repair (${beforeFlags} -> ${afterFlags})`);
  assert.ok(r.after.score >= r.before.score, "repair must not lower the quality score");
  assert.equal(r.plan.version, "v2", "repaired plan should bump version");

  // The knee-risky movements should be gone from the repaired plan.
  const names = r.plan.days.flatMap((d) => d.exercises.map((e) => e.name.toLowerCase()));
  assert.ok(!names.some((n) => n.includes("walking lunge") || n.includes("leg extension")), "risky knee movements should be swapped out");
});

test("a clean plan yields no repair changes", () => {
  // Balanced push/pull, a rest day, moderate intensity, General goal (so the
  // under-volume check doesn't apply) — nothing for the engine to fix.
  const plan = {
    program_name: "Balanced", goal: "General", days_per_week: 2, version: "v1",
    days: [
      day("Upper", [
        ex("Bench Press", 3, "8-10", 7), ex("Overhead Press", 3, "8-10", 7),
        ex("Triceps Pushdown", 3, "12-15", 8), ex("Barbell Row", 3, "8-10", 7),
        ex("Lat Pulldown", 3, "10-12", 8), ex("Dumbbell Curl", 3, "12-15", 8),
      ]),
      day("Rest", []),
    ],
  };
  const r = repairPlan(plan, { goal: "General", experience: "Intermediate" });
  assert.equal(r.changes.length, 0, `expected no changes, got: ${r.changes.map((c) => c.fix).join("; ")}`);
});
