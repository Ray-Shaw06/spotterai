/**
 * The adapt engine's cardio-fatigue transform.
 *
 * The complaint this answers, in the owner's words: some days you run and then
 * cannot lift as much. Before this, the plan had no idea the run had happened,
 * so Wednesday still prescribed Tuesday's squat volume.
 *
 * Everything here is deterministic. No LLM, and every change bullet has to cite
 * the real session it came from, which is the contract the rest of the engine
 * already holds itself to.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { adaptPlan, recentHardCardio } from "../adapt-engine.js";
import { evaluatePlan } from "../evaluator.js";

const lift = (name, sets, reps, rpe = 8) => ({ name, sets, reps, rpe, notes: "" });
const day = (focus, exercises) => ({ day: focus, focus, exercises });

function legPlan() {
  return {
    program_name: "P",
    version: "v1",
    goal: "Strength",
    days_per_week: 3,
    days: [
      day("Lower Body", [lift("Back Squat", 4, "5"), lift("Leg Press", 4, "10"), lift("Lying Leg Curl", 3, "12")]),
      // Balanced on purpose: an unbalanced upper day makes the safety close fire
      // its push/pull repair, and then the assertions below would be measuring
      // that instead of the cardio transform.
      day("Upper Body", [lift("Barbell Bench Press", 4, "5"), lift("Barbell Row", 4, "5"), lift("Overhead Press", 3, "8"), lift("Lat Pulldown", 3, "10")]),
      day("Rest", []),
    ],
    progression: "Add 2.5kg when you hit the top of the range.",
    general_notes: "",
  };
}

const TODAY = "2026-08-29";
function context({ recent = [], weeklyVolume = [], sessions = 2 } = {}) {
  return {
    workoutsLogged: 8,
    thisWeek: { sessions, target: 3 },
    weeklySessions: [3, 3, 3, sessions],
    weeklyVolume,
    exercises: {},
    unit: "kg",
    activeLimitations: [],
    cardio: { weeklyMinutes: recent.reduce((m, r) => m + r.durationMin, 0), recent, today: TODAY },
  };
}
const inputs = { goal: "Strength", experience: "Intermediate" };
const legWork = (out) => out.plan.days[0].exercises;
const setsOf = (out) => legWork(out).map((e) => e.sets);

// ---------------------------------------------------------------------------
// What counts as cardio worth adapting to
// ---------------------------------------------------------------------------

test("a hard session yesterday counts", () => {
  const found = recentHardCardio(context({ recent: [{ date: "2026-08-28", name: "Sprint", durationMin: 22 }] }));
  assert.ok(found);
  assert.equal(found.age, 1);
  assert.equal(found.reason, "hard");
});

test("a long easy session counts too, because duration is its own tax", () => {
  const found = recentHardCardio(context({ recent: [{ date: "2026-08-29", name: "Jog", durationMin: 60 }] }));
  assert.ok(found);
  assert.equal(found.reason, "long");
});

test("a short easy jog does not count", () => {
  assert.equal(recentHardCardio(context({ recent: [{ date: "2026-08-28", name: "Jog", durationMin: 25 }] })), null);
});

test("a hard session from last week does not count", () => {
  // Logged cardio does not stay in your legs forever, and pretending it does
  // would let one run suppress a whole training block.
  assert.equal(recentHardCardio(context({ recent: [{ date: "2026-08-20", name: "Sprint", durationMin: 30 }] })), null);
});

test("no cardio logged at all is not an error", () => {
  assert.equal(recentHardCardio(context()), null);
  assert.equal(recentHardCardio({}), null);
  assert.equal(recentHardCardio({ cardio: { recent: [] } }), null);
});

// ---------------------------------------------------------------------------
// The adaptation
// ---------------------------------------------------------------------------

test("a hard run yesterday eases leg accessories and flags the main lift", () => {
  const before = legPlan();
  const out = adaptPlan(before, context({ recent: [{ date: "2026-08-28", name: "Sprint", durationMin: 22 }] }), inputs);

  assert.equal(out.adapted, true);
  const after = setsOf(out);
  assert.equal(after[0], 4, "the day's opening lift keeps its sets");
  assert.ok(after[1] < 4 || after[2] < 3, "an accessory came down");

  const note = legWork(out)[0].notes;
  assert.match(note, /legs are still from Sprint/, "the main lift carries the load warning, not a set cut");
});

test("the change bullet cites the real session, per the engine's contract", () => {
  const out = adaptPlan(legPlan(), context({ recent: [{ date: "2026-08-28", name: "Sprint", durationMin: 22 }] }), inputs);
  const bullet = out.changes.find((c) => /Sprint/.test(c));
  assert.ok(bullet);
  assert.match(bullet, /22 min/, "the number is the user's own, not a generalisation");
  assert.match(bullet, /yesterday/);
});

test("upper-body days are untouched by a run", () => {
  const out = adaptPlan(legPlan(), context({ recent: [{ date: "2026-08-28", name: "Sprint", durationMin: 22 }] }), inputs);
  assert.deepEqual(out.plan.days[1].exercises.map((e) => e.sets), [4, 4, 3, 3]);
});

test("one run cannot gut the week", () => {
  const out = adaptPlan(legPlan(), context({ recent: [{ date: "2026-08-28", name: "Hill Sprints", durationMin: 40 }] }), inputs);
  const cut = 11 - setsOf(out).reduce((a, b) => a + b, 0);
  assert.ok(cut <= 2, `trimmed ${cut} sets, the cap is 2`);
});

test("a short easy jog changes nothing", () => {
  const out = adaptPlan(legPlan(), context({ recent: [{ date: "2026-08-28", name: "Jog", durationMin: 20 }] }), inputs);
  assert.deepEqual(setsOf(out), [4, 4, 3]);
  assert.equal(out.changes.some((c) => /Jog/.test(c)), false);
});

test("a deload week skips the cardio ease, so nothing is cut twice", () => {
  // Rising then peaking weekly volume is what deloadFromWeeklyVolume reads.
  const rising = [10000, 12000, 14000, 17000, 21000, 26000];
  const out = adaptPlan(legPlan(), context({ recent: [{ date: "2026-08-28", name: "Sprint", durationMin: 30 }], weeklyVolume: rising }), inputs);

  const deloaded = out.changes.some((c) => /Deload week/.test(c));
  if (deloaded) {
    assert.equal(out.changes.some((c) => /legs are still|Sprint/.test(c)), false, "the deload already backed everything off");
  }
});

test("the safety invariant still holds with cardio in play", () => {
  const out = adaptPlan(legPlan(), context({ recent: [{ date: "2026-08-28", name: "Sprint", durationMin: 22 }] }), inputs);
  // The engine promises never to return more critical or warning flags than it
  // started with. A transform that trims sets is exactly where that could slip.
  const before = evaluatePlan(legPlan(), inputs).summary;
  const after = evaluatePlan(out.plan, inputs).summary;
  assert.ok(after.critical <= before.critical);
  assert.ok(after.warning <= before.warning);
});