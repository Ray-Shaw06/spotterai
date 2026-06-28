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

test("a malformed plan never throws — it returns score 0 and an invalid-plan flag", () => {
  for (const bad of [null, undefined, {}, { days: "nope" }]) {
    const audit = evaluatePlan(bad, {});
    assert.equal(audit.score, 0);
    assert.ok(audit.checks.some((c) => c.id === "invalid_plan"));
  }
});

test("every check exposes the public shape and never leaks the internal penalty", () => {
  const audit = evaluatePlan(goodPlan(), { goal: "Hypertrophy" });
  for (const c of audit.checks) {
    assert.ok(["pass", "warn", "fail"].includes(c.status));
    assert.equal(typeof c.label, "string");
    assert.equal(typeof c.detail, "string");
    assert.equal(c.penalty, undefined);
  }
});

test("every check carries a severity tier and the audit returns a summary", () => {
  const audit = evaluatePlan(goodPlan(), { goal: "Hypertrophy", experience: "Intermediate" });
  for (const c of audit.checks) {
    assert.ok(["critical", "warning", "suggestion", "pass"].includes(c.tier), `bad tier: ${c.tier}`);
  }
  const s = audit.summary;
  assert.equal(s.total, audit.checks.length);
  assert.equal(s.critical + s.warning + s.suggestion + s.passed, audit.checks.length);
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
