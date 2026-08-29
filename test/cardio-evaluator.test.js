/**
 * Cardio: the plan schema, and the two evaluator checks built on it (v1.4.0).
 *
 * The failure that motivated all of this: run hard on Tuesday and Wednesday's
 * squats are not the same squats, and nothing upstream of logging knew cardio
 * existed. The evaluator, repair engine and generator were all blind to it, and
 * the onboarding cardio question was collected and then dropped on the floor.
 *
 * The tests that matter most here are the ones proving the checks stay QUIET:
 * a lifting-only plan must produce no cardio rows at all, or every audit the
 * app has ever run changes shape.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { normalizePlan, isCardioEntry, cardioMinutes } from "../lib/plan.js";
import { evaluatePlan, computeWeeklyCardio, THRESHOLDS, PENALTY, EVALUATOR_VERSION } from "../evaluator.js";
import { repairPlan } from "../repair.js";

const lift = (name, sets, reps, rpe = 8) => ({ name, sets, reps, rpe, notes: "" });
const run = (name, durationMin, intensity = "moderate") => ({ name, sets: 1, reps: `${durationMin} min`, rpe: null, notes: "", type: "cardio", durationMin, intensity });
const day = (focus, exercises) => ({ day: focus, focus, exercises });
const plan = (days) => ({ program_name: "Case", goal: "Strength", days_per_week: days.length, days, progression: "Add 2.5kg when you hit the top of the range.", general_notes: "" });

const legDay = (focus = "Lower Body") => day(focus, [lift("Back Squat", 5, "5"), lift("Romanian Deadlift", 4, "6"), lift("Leg Press", 3, "10"), lift("Lying Leg Curl", 3, "12")]);
const upperDay = (focus = "Upper Body") => day(focus, [lift("Barbell Bench Press", 4, "5"), lift("Barbell Row", 4, "5"), lift("Overhead Press", 3, "8"), lift("Lat Pulldown", 3, "10")]);

const check = (audit, id) => audit.checks.find((c) => c.id === id);

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

test("normalizePlan infers cardio from the name, so old plans upgrade on read", () => {
  const out = normalizePlan({ program_name: "P", days: [day("Cardio", [{ name: "Treadmill Run", sets: 1, reps: "30 min" }])] });
  const ex = out.days[0].exercises[0];
  assert.equal(ex.type, "cardio", "no migration needed for a plan saved before the field existed");
  assert.equal(ex.durationMin, 30);
});

test("an explicit type wins over the name", () => {
  assert.equal(isCardioEntry({ name: "Back Squat", type: "cardio" }), true);
  assert.equal(isCardioEntry({ name: "Jog", type: "lift" }), false);
});

test("cardio minutes are read from durationMin, then from the reps text", () => {
  assert.equal(cardioMinutes({ durationMin: 45 }), 45);
  assert.equal(cardioMinutes({ reps: "35 min easy" }), 35);
  assert.equal(cardioMinutes({ reps: "20" }), 20, "a bare number on cardio reads as minutes");
  assert.equal(cardioMinutes({ reps: "8-12" }), 0, "a rep range is not a duration");
});

test("lifting entries carry no empty cardio fields", () => {
  const out = normalizePlan({ program_name: "P", days: [day("Push", [lift("Barbell Bench Press", 4, "8")])] });
  const ex = out.days[0].exercises[0];
  assert.equal(Object.hasOwn(ex, "type"), false);
  assert.equal(Object.hasOwn(ex, "durationMin"), false);
});

test("a stray set count on cardio normalizes to one continuous effort", () => {
  const out = normalizePlan({ program_name: "P", days: [day("Run", [{ name: "Jog", sets: 0, reps: "30 min" }])] });
  assert.equal(out.days[0].exercises[0].sets, 1, "zero sets would erase it from per-session set maths");
});

// ---------------------------------------------------------------------------
// The quiet requirement
// ---------------------------------------------------------------------------

test("a lifting-only plan with no cardio question produces NO cardio rows", () => {
  // Full inputs, so nothing here is unassessed for an unrelated reason.
  const inputs = { goal: "Strength", experience: "Intermediate", equipment: ["Full gym"] };
  const audit = evaluatePlan(plan([upperDay(), legDay(), day("Rest", [])]), inputs);

  assert.equal(check(audit, "cardio_load"), undefined);
  assert.equal(check(audit, "cardio_conflict"), undefined);
  assert.equal(audit.checks.filter((c) => c.id.startsWith("cardio")).length, 0);

  // This is the whole reason they are conditional. An unconditional pair would
  // add two rows to summary.total for every audit ever run, and a not_assessed
  // pair would break the two suites asserting a full-input audit has none.
  assert.equal(audit.summary.not_assessed, 0);
});

test("both cardio checks are zero-weight, so they cannot move a score", () => {
  assert.deepEqual(PENALTY.cardio_load, { warn: 0, fail: 0 });
  assert.deepEqual(PENALTY.cardio_conflict, { warn: 0, fail: 0 });

  const conflicted = plan([upperDay(), day("Intervals", [run("Sprint", 25, "hard")]), legDay(), day("Rest", [])]);
  const clean = plan([upperDay(), day("Intervals", [run("Incline Walk", 25, "easy")]), legDay(), day("Rest", [])]);
  const inputs = { goal: "Strength", experience: "Intermediate", cardio: "A little" };
  assert.equal(check(evaluatePlan(conflicted, inputs), "cardio_conflict").status, "warn");
  assert.equal(evaluatePlan(conflicted, inputs).score, evaluatePlan(clean, inputs).score, "a flagged conflict costs no points");
});

test("the rubric version says which rubric ran", () => {
  assert.equal(EVALUATOR_VERSION, "v1.4.0");
});

// ---------------------------------------------------------------------------
// computeWeeklyCardio
// ---------------------------------------------------------------------------

test("weekly cardio counts minutes, sessions, and which days were hard", () => {
  const c = computeWeeklyCardio(plan([
    day("Intervals", [run("Sprint", 25, "hard")]),
    upperDay(),
    day("Easy", [run("Jog", 40, "easy")]),
  ]));
  assert.equal(c.minutes, 65);
  assert.equal(c.sessions, 2);
  assert.equal(c.hardSessions, 1);
  assert.equal(c.days[0].hard, true);
  assert.equal(c.days[1].hard, false);
});

test("intensity beats the name, in both directions", () => {
  // A stated easy pace on an interval-sounding session is taken at its word.
  const easySprint = computeWeeklyCardio(plan([day("C", [run("Sprint", 20, "easy")])]));
  assert.equal(easySprint.hardSessions, 0);

  // And a jog explicitly marked hard counts as hard.
  const hardJog = computeWeeklyCardio(plan([day("C", [run("Jog", 40, "hard")])]));
  assert.equal(hardJog.hardSessions, 1);

  // With no intensity stated at all, the name decides.
  const unstated = computeWeeklyCardio(plan([day("C", [{ name: "Hill Sprints", sets: 1, reps: "20 min", type: "cardio", durationMin: 20 }])]));
  assert.equal(unstated.hardSessions, 1);
});

// ---------------------------------------------------------------------------
// cardio_conflict
// ---------------------------------------------------------------------------

test("hard cardio the day before a leg day is flagged", () => {
  const audit = evaluatePlan(plan([upperDay(), day("Intervals", [run("Sprint", 25, "hard")]), legDay(), day("Rest", [])]), { goal: "Strength", experience: "Intermediate", cardio: "A little" });
  const c = check(audit, "cardio_conflict");
  assert.equal(c.status, "warn");
  assert.equal(c.tier, "warning", "a recovery-order problem, never a critical safety flag");
  assert.match(c.detail, /day before/);
  assert.ok(c.fix, "a flagged check must carry advice");
});

test("hard cardio on the same day as heavy legs is flagged", () => {
  const same = day("Legs + intervals", [...legDay().exercises, run("Sprint", 20, "hard")]);
  const audit = evaluatePlan(plan([upperDay(), same, day("Rest", [])]), { goal: "Strength", experience: "Intermediate", cardio: "A little" });
  assert.equal(check(audit, "cardio_conflict").status, "warn");
});

test("easy cardio next to a leg day is NOT flagged", () => {
  const audit = evaluatePlan(plan([upperDay(), day("Walk", [run("Incline Walk", 40, "easy")]), legDay(), day("Rest", [])]), { goal: "Strength", experience: "Intermediate", cardio: "A little" });
  // Flagging a normal training week is how a check becomes noise nobody reads.
  assert.equal(check(audit, "cardio_conflict").status, "pass");
});

test("hard cardio before an UPPER day is not a conflict", () => {
  const audit = evaluatePlan(plan([legDay(), day("Intervals", [run("Sprint", 25, "hard")]), upperDay(), day("Rest", [])]), { goal: "Strength", experience: "Intermediate", cardio: "A little" });
  assert.equal(check(audit, "cardio_conflict").status, "pass", "running does not compete with bench press for the same legs");
});

test("hard cardio before a light leg day is not a conflict", () => {
  const light = day("Light lower", [lift("Standing Calf Raise", 3, "15"), lift("Seated Leg Curl", 2, "12")]);
  const audit = evaluatePlan(plan([upperDay(), day("Intervals", [run("Sprint", 25, "hard")]), light, day("Rest", [])]), { goal: "Strength", experience: "Intermediate", cardio: "A little" });
  assert.equal(check(audit, "cardio_conflict").status, "pass");
});

test("two collisions escalate the conflict from warn to fail", () => {
  const p = plan([
    day("Intervals", [run("Sprint", 20, "hard")]),
    legDay("Lower A"),
    day("Intervals", [run("Hill Sprints", 20, "hard")]),
    legDay("Lower B"),
    day("Rest", []),
  ]);
  assert.equal(check(evaluatePlan(p, { goal: "Strength", experience: "Intermediate", cardio: "Lots" }), "cardio_conflict").status, "fail");
});

// ---------------------------------------------------------------------------
// cardio_load
// ---------------------------------------------------------------------------

test("asking for cardio and getting none is flagged", () => {
  const audit = evaluatePlan(plan([upperDay(), legDay(), day("Rest", [])]), { goal: "Strength", experience: "Intermediate", cardio: "Lots" });
  const c = check(audit, "cardio_load");
  assert.equal(c.status, "warn");
  assert.match(c.detail, /prescribes none/);
});

test("asking for no cardio and getting some is flagged the other way", () => {
  const audit = evaluatePlan(plan([upperDay(), day("Run", [run("Jog", 40)]), day("Rest", [])]), { goal: "Strength", experience: "Intermediate", cardio: "None" });
  assert.equal(check(audit, "cardio_load").status, "warn");
});

test("cardio volume warns high and fails very high", () => {
  const inputs = { goal: "Strength", experience: "Intermediate", cardio: "Lots" };
  const at = (mins) => plan([upperDay(), day("Run", [run("Jog", mins)]), legDay(), day("Rest", [])]);
  assert.equal(check(evaluatePlan(at(120), inputs), "cardio_load").status, "pass");
  assert.equal(check(evaluatePlan(at(THRESHOLDS.CARDIO_WEEKLY_MIN_WARN), inputs), "cardio_load").status, "warn");
  assert.equal(check(evaluatePlan(at(THRESHOLDS.CARDIO_WEEKLY_MIN_FAIL), inputs), "cardio_load").status, "fail");
});

test("cardio_load stays a suggestion, because it is not a safety flag", () => {
  const audit = evaluatePlan(plan([upperDay(), legDay(), day("Rest", [])]), { goal: "Strength", experience: "Intermediate", cardio: "Lots" });
  assert.equal(check(audit, "cardio_load").tier, "suggestion");
});

// ---------------------------------------------------------------------------
// Repair
// ---------------------------------------------------------------------------

test("repair moves the hard session to a day that can take it", () => {
  const p = plan([day("Intervals", [run("Sprint", 25, "hard")]), legDay(), upperDay(), day("Rest", [])]);
  const inputs = { goal: "Strength", experience: "Intermediate", cardio: "A little" };
  const r = repairPlan(p, inputs);

  assert.equal(check(r.before, "cardio_conflict").status, "warn");
  assert.equal(check(r.after, "cardio_conflict").status, "pass", "the fix has to actually move the audit it came from");
  assert.ok(r.changes.some((c) => /Moved it to/.test(c.fix)));

  const names = r.plan.days.map((d) => (d.exercises || []).map((e) => e.name));
  assert.ok(!names[0].includes("Sprint"), "left the day it collided with");
  assert.ok(names.flat().includes("Sprint"), "and the prescription itself survives");
});

test("a day emptied by the move is relabelled rest, not left blank", () => {
  const p = plan([day("Intervals", [run("Sprint", 25, "hard")]), legDay(), upperDay(), day("Rest", [])]);
  const r = repairPlan(p, { goal: "Strength", experience: "Intermediate", cardio: "A little" });
  assert.match(r.plan.days[0].focus, /rest/i);
  assert.equal(r.plan.days[0].exercises.length, 0);
});

test("with nowhere to move it, repair eases the session and says so", () => {
  // Every non-cardio day is a heavy leg day, so there is no clear slot.
  const p = plan([day("Intervals", [run("Sprint", 25, "hard")]), legDay("Lower A"), legDay("Lower B")]);
  const r = repairPlan(p, { goal: "Strength", experience: "Intermediate", cardio: "A little" });

  assert.equal(check(r.after, "cardio_conflict").status, "pass");
  const changed = r.changes.find((c) => /Swapped it for easy/.test(c.fix));
  assert.ok(changed, "the fallback has to be reported, not applied silently");
  assert.match(changed.tradeoff, /hard conditioning/i, "the tradeoff names what was actually given up");
});

test("repair never touches a plan whose cardio is already placed well", () => {
  const p = plan([upperDay(), day("Walk", [run("Incline Walk", 40, "easy")]), legDay(), day("Rest", [])]);
  const r = repairPlan(p, { goal: "Strength", experience: "Intermediate", cardio: "A little" });
  assert.equal(r.changes.filter((c) => /conditioning/i.test(c.issue || "")).length, 0);
});

// ---------------------------------------------------------------------------
// The two ends of the pipe: the question is asked, and the prompt honours it
// ---------------------------------------------------------------------------

const { mapOnboardingToInputs, CARDIO_PREFS } = await import("../onboarding.js");
const { buildPrompt } = await import("../api/generate.js");

test("the onboarding cardio answer finally reaches the plan inputs", () => {
  // It was collected from the start and then dropped on the floor, so a plan
  // could not honour it and checkCardioLoad had nothing to judge against.
  for (const pref of CARDIO_PREFS) {
    assert.equal(mapOnboardingToInputs({ goal: "muscle", cardio: pref }).cardio, pref);
  }
});

test("an unanswered cardio question stays unanswered", () => {
  // Same doctrine as experience and equipment: never assert back at the user an
  // answer they did not give. It is also what keeps the cardio checks silent.
  assert.equal(Object.hasOwn(mapOnboardingToInputs({ goal: "muscle" }), "cardio"), false);
  assert.equal(Object.hasOwn(mapOnboardingToInputs({ goal: "muscle", cardio: "whatever" }), "cardio"), false);
});

test("the generator prompt asks for cardio only when cardio was asked for", () => {
  const base = { goal: "Strength", experience: "Intermediate", daysPerWeek: 4, sessionLength: 60, equipment: ["Full gym"], injuries: [] };
  assert.ok(!buildPrompt(base).includes("CONDITIONING"), "silent when never asked");
  assert.ok(!buildPrompt({ ...base, cardio: "None" }).includes("CONDITIONING"), "silent when declined");

  const asked = buildPrompt({ ...base, cardio: "Lots" });
  assert.ok(asked.includes("CONDITIONING"));
  // The conflict rule goes in the prompt, not just in the repair engine: a plan
  // that arrives correct beats one edited in front of the user.
  assert.match(asked, /NEVER put hard cardio/);
  assert.match(asked, /day immediately BEFORE/);
  assert.match(asked, /"type": "cardio"/);
});

test("the prompt scales the ask to the answer", () => {
  const base = { goal: "Strength", experience: "Intermediate", daysPerWeek: 4, sessionLength: 60, equipment: ["Full gym"], injuries: [] };
  assert.match(buildPrompt({ ...base, cardio: "A little" }), /1 to 2 conditioning sessions/);
  assert.match(buildPrompt({ ...base, cardio: "Lots" }), /3 to 4 conditioning sessions/);
});

// ---------------------------------------------------------------------------
// Regressions found by the pre-landing review: consumers that predate the
// cardio fields and quietly dropped them.
// ---------------------------------------------------------------------------

const { replaceDay } = await import("../plan-edit.js");
const { buildWorkoutCalendar } = await import("../calendar-export.js");

test("an LLM-supplied duration is clamped, like every other number read off a plan", () => {
  // Everything else this file reads off a model response is bounded. An
  // unbounded durationMin renders straight to the user and sums into the week.
  assert.equal(cardioMinutes({ durationMin: 100000 }), 600);
  assert.equal(cardioMinutes({ reps: "99999 min" }), 600);
  assert.equal(cardioMinutes({ durationMin: 0.2 }), 1, "and it never rounds a real prescription to zero");
  assert.equal(cardioMinutes({ durationMin: 45 }), 45, "a sane number passes through untouched");
});

test("re-focusing a day keeps its cardio a run, not three sets of eight", () => {
  const before = plan([day("Conditioning", [run("Sprint", 25, "hard")]), legDay(), day("Rest", [])]);
  const { plan: after, changed } = replaceDay(before, {
    day: "Conditioning",
    focus: "Intervals",
    exercises: [run("Sprint", 25, "hard")],
  });

  assert.equal(changed, 1);
  const ex = after.days[0].exercises[0];
  // It used to rebuild from a hard-coded lifting field set, so the duration and
  // intensity vanished and the reps default wrote "8-12" onto a sprint.
  assert.equal(ex.type, "cardio");
  assert.equal(ex.durationMin, 25);
  assert.equal(ex.intensity, "hard");
  assert.notEqual(ex.reps, "8-12");
  assert.equal(ex.sets, 1);
  assert.equal(ex.rpe, null);

  // And the conflict check still has the intensity it reads.
  const audit = evaluatePlan(after, { goal: "Strength", experience: "Intermediate", cardio: "A little" });
  assert.equal(check(audit, "cardio_conflict").status, "warn");
});

test("re-focusing a lifting day is unchanged by the cardio branch", () => {
  const before = plan([upperDay(), day("Rest", [])]);
  const { plan: after } = replaceDay(before, { day: "Upper Body", focus: "Push", exercises: [lift("Barbell Bench Press", 4, "6-8")] });
  const ex = after.days[0].exercises[0];
  assert.equal(ex.sets, 4);
  assert.equal(ex.reps, "6-8");
  assert.equal(ex.rpe, 8);
  assert.equal(Object.hasOwn(ex, "type"), false);
});

test("the calendar export writes a run as minutes, not as one set of nothing", () => {
  const ics = buildWorkoutCalendar({
    plan: plan([day("Conditioning", [run("Treadmill Run", 35, "easy")]), day("Rest", [])]),
    startDate: "2026-09-01",
    time: "07:00",
  });
  // Unfolding first: RFC 5545 wraps at 75 octets, so a long DESCRIPTION is
  // split across continuation lines and a naive match would miss it.
  const unfolded = ics.replace(/\r\n /g, "");
  assert.match(unfolded, /Treadmill Run - 35 min easy/);
  assert.doesNotMatch(unfolded, /Treadmill Run - 1×/);
});

test("the calendar export still writes lifts as sets by reps", () => {
  const ics = buildWorkoutCalendar({
    plan: plan([upperDay(), day("Rest", [])]),
    startDate: "2026-09-01",
    time: "07:00",
  });
  assert.match(ics.replace(/\r\n /g, ""), /Barbell Bench Press - 4×5/);
});
