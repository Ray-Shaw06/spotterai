import test from "node:test";
import assert from "node:assert/strict";

import { evaluatePlan } from "../evaluator.js";
import { equipmentCapabilities, canPerform } from "../exercise-data.js";

const ex = (name, sets = 3, reps = "8-10", rpe = 8) => ({ name, sets, reps, rpe, notes: "" });
const day = (focus, exercises) => ({ day: focus, focus, exercises });
const plan = (days) => ({ program_name: "T", goal: "Hypertrophy", days_per_week: days.length, days });
const check = (audit, id) => audit.checks.find((c) => c.id === id);

test("equipmentCapabilities maps coarse choices to DB tags", () => {
  assert.equal(equipmentCapabilities([]), null, "empty -> no constraint");
  assert.equal(equipmentCapabilities(["Something odd"]), null, "unrecognized -> no constraint");

  const gym = equipmentCapabilities(["Full gym"]);
  assert.ok(gym.has("machine") && gym.has("barbell") && gym.has("cable"));

  const db = equipmentCapabilities(["Dumbbells"]);
  assert.ok(db.has("dumbbell") && db.has("bodyweight"));
  assert.equal(db.has("machine"), false, "dumbbells don't unlock machines");

  const bw = equipmentCapabilities(["Bodyweight"]);
  assert.deepEqual([...bw], ["bodyweight"]);
});

test("canPerform respects the capability set", () => {
  const bw = equipmentCapabilities(["Bodyweight"]);
  assert.equal(canPerform("Push-up", bw), true);
  assert.equal(canPerform("Leg Press", bw), false, "machine not available");
  const gym = equipmentCapabilities(["Full gym"]);
  assert.equal(canPerform("Leg Press", gym), true);
  assert.equal(canPerform("Totally Unknown Lift", bw), true, "unknown exercise assumed doable");
});

test("equipment_fit flags gym lifts for a bodyweight user (suggestion, zero score)", () => {
  const p = plan([
    day("Full body", [ex("Leg Press"), ex("Barbell Bench Press"), ex("Lat Pulldown"), ex("Push-up")]),
    day("Rest", []),
  ]);
  const audit = evaluatePlan(p, { goal: "Hypertrophy", equipment: ["Bodyweight"] });
  const c = check(audit, "equipment_fit");
  assert.equal(c.status, "warn");
  assert.equal(c.tier, "suggestion");
  assert.match(c.detail, /Leg Press/);
  assert.doesNotMatch(c.detail, /Push-up/, "the bodyweight move is fine");
});

test("equipment_fit passes when equipment is unspecified", () => {
  const p = plan([day("Full body", [ex("Leg Press"), ex("Barbell Bench Press")]), day("Rest", [])]);
  const audit = evaluatePlan(p, { goal: "Hypertrophy" });
  assert.equal(check(audit, "equipment_fit").status, "pass");
});

test("equipment_fit passes for a full-gym user", () => {
  const p = plan([day("Full body", [ex("Leg Press"), ex("Barbell Bench Press"), ex("Lat Pulldown")]), day("Rest", [])]);
  const audit = evaluatePlan(p, { goal: "Hypertrophy", equipment: ["Full gym"] });
  assert.equal(check(audit, "equipment_fit").status, "pass");
});

test("equipment_fit distinguishes dumbbell-available from machine-only lifts", () => {
  const p = plan([
    day("Upper", [ex("Dumbbell Bench Press"), ex("Leg Press")]),
    day("Rest", []),
  ]);
  const audit = evaluatePlan(p, { goal: "Hypertrophy", equipment: ["Dumbbells"] });
  const c = check(audit, "equipment_fit");
  assert.equal(c.status, "warn");
  assert.match(c.detail, /Leg Press/);
  assert.doesNotMatch(c.detail, /Dumbbell Bench Press/, "dumbbell lift is available");
});

test("the newly added machines are recognized (not keyword fallback)", () => {
  // A machine plan for a full-gym user: all recognized, so no coverage warning.
  const p = plan([
    day("Push", [ex("Machine Shoulder Press"), ex("Assisted Dip")]),
    day("Pull", [ex("Machine Row"), ex("Assisted Pull-up"), ex("Reverse Pec Deck")]),
    day("Legs", [ex("Smith Machine Squat")]),
    day("Rest", []),
  ]);
  const audit = evaluatePlan(p, { goal: "Hypertrophy", equipment: ["Full gym"] });
  assert.equal(check(audit, "coverage").status, "pass");
  assert.equal(check(audit, "equipment_fit").status, "pass");
});
