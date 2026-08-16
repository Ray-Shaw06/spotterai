/**
 * The equipment-fit check used to pass on plans it could not read.
 *
 * Found while adding band support and worth fixing on its own, because the
 * shape of the bug is "a check that cannot see its input reports success":
 *
 *   checkEquipmentFit gated on `lookupExercise`, which returns null for any
 *   lift without a CURATED metadata entry — 168 of 362 at the time. But
 *   `equipmentTags` is populated for EVERY catalog entry (from curated metadata
 *   when there is any, otherwise derived from the display label). So the
 *   catalog knew "Stiff-Leg Deadlift" was a barbell lift, the check refused to
 *   look, and then the pass message said "Every prescribed exercise fits the
 *   equipment you have available."
 *
 * Two fixes:
 *   1. canPerform reads the catalog, not the curated slice. Checkable lifts go
 *      from 133 to all 362.
 *   2. When part of a plan genuinely cannot be recognized, the check SAYS so
 *      instead of implying the whole plan was cleared.
 *
 * And one bug the widening exposed, guarded at the bottom: EQUIPMENT_MAP listed
 * nine of the catalog's twelve tags, so a "Full gym" user was suddenly being
 * told Sled Push needed equipment they had not listed. Harmless while the check
 * was half-blind; nine false warnings the moment it opened its eyes.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { CATALOG } from "../exercise-catalog.js";
import { equipmentCapabilities, canPerform, hasKnownEquipment, equipmentTagsFor, lookupExercise } from "../exercise-data.js";
import { evaluatePlan } from "../evaluator.js";

const plan = (...names) => ({ days: [{ day: "Mon", focus: "A", exercises: names.map((n) => ({ name: n, sets: 3, reps: "10" })) }] });
const fit = (p, equipment) =>
  evaluatePlan(p, { goal: "general fitness", experience: "beginner", daysPerWeek: 1, equipment, injuries: [] }).checks.find((c) => c.id === "equipment_fit");

// ---------------------------------------------------------------------------
// The bug
// ---------------------------------------------------------------------------
test("CRITICAL: a lift the catalog knows is checked, curated metadata or not", () => {
  // This originally used Stiff-Leg Deadlift, Triceps Rope Pushdown and Dumbbell
  // Shrug — all uncurated at the time — and carried a note to pick fresh ones if
  // they ever gained metadata. They all did, in the 2026-08-15 drafting pass.
  //
  // Cardio is the durable case: those 21 lifts are excluded from curation BY
  // DESIGN (the metadata shape describes lifting, not running), so they will
  // stay uncurated while still having equipment the catalog knows perfectly
  // well. A treadmill needs a treadmill.
  const uncurated = CATALOG.filter((e) => !lookupExercise(e.name) && hasKnownEquipment(e.name));
  assert.ok(uncurated.length >= 5, "no uncurated-but-placeable lifts left; this guard needs a new subject");

  const machineCardio = ["Treadmill Run", "Rowing Machine", "Stationary Bike"];
  for (const name of machineCardio) {
    assert.equal(lookupExercise(name), null, `${name} gained curated metadata; pick another uncurated lift`);
    assert.ok(hasKnownEquipment(name), `${name} has no equipment tags`);
    assert.equal(canPerform(name, equipmentCapabilities(["Bands"])), false, `${name} was waved through for a band-only user`);
  }
  const c = fit(plan(...machineCardio), ["Bands"]);
  assert.equal(c.status, "warn");
  for (const name of machineCardio) assert.match(c.detail, new RegExp(name));
});

test("every catalog lift is now checkable", () => {
  const unknown = CATALOG.filter((e) => !hasKnownEquipment(e.name)).map((e) => e.name);
  assert.deepEqual(unknown, [], `catalog lifts with no readable equipment: ${unknown.slice(0, 5).join(", ")}`);
  // The old gate saw only the curated slice, which is still a minority.
  const curated = CATALOG.filter((e) => lookupExercise(e.name)).length;
  assert.ok(curated < CATALOG.length, "every lift is curated now, so this guard no longer proves anything");
});

// ---------------------------------------------------------------------------
// Honest reporting
// ---------------------------------------------------------------------------
test("CRITICAL: a pass that could only read part of the plan says so", () => {
  const c = fit(plan("Band Squat", "Wibble Press"), ["Bands"]);
  assert.equal(c.status, "pass");
  assert.match(c.detail, /1 of 2/, "the pass still claims to have cleared the whole plan");
  assert.match(c.detail, /Wibble Press/);
  assert.match(c.detail, /not recognized|weren't recognized|wasn't recognized/);
  assert.doesNotMatch(c.detail, /Every prescribed exercise fits/);
});

test("a plan it CAN fully read still gets the clean message", () => {
  // The caveat must not become permanent noise on plans that deserve a clean
  // pass, or it stops meaning anything.
  const c = fit(plan("Band Squat", "Band Chest Press", "Band Biceps Curl"), ["Bands"]);
  assert.equal(c.status, "pass");
  assert.equal(c.detail, "Every prescribed exercise fits the equipment you have available.");
});

test("the warn branch also owns up to what it could not read", () => {
  const c = fit(plan("Barbell Bench Press", "Wibble Press"), ["Bands"]);
  assert.equal(c.status, "warn");
  assert.match(c.detail, /Barbell Bench Press/);
  assert.match(c.detail, /Wibble Press/, "the warn branch hides its blind spot");
});

test("an unrecognized lift is never itself reported as unavailable", () => {
  // The failure mode on the other side: guessing that an unknown name needs
  // equipment the user lacks would invent a constraint out of nothing.
  const c = fit(plan("Wibble Press", "Zonk Curl"), ["Bands"]);
  assert.equal(c.status, "pass");
  assert.doesNotMatch(c.detail, /need.* equipment you didn't list/);
});

test("no equipment selected is still not_assessed, not a silent pass", () => {
  const c = fit(plan("Barbell Bench Press"), []);
  assert.equal(c.status, "not_assessed");
});

// ---------------------------------------------------------------------------
// The false positive the widening exposed
// ---------------------------------------------------------------------------
test("CRITICAL: EQUIPMENT_MAP covers every tag the catalog uses", () => {
  // Nine lifts (plate, sled, medicine ball) were being flagged as unavailable
  // to someone who selected "Full gym". Invisible while the check only read
  // curated lifts; nine false warnings once it read all of them.
  const gym = equipmentCapabilities(["Full gym"]);
  const flagged = CATALOG.filter((e) => !canPerform(e.name, gym)).map((e) => e.name);
  assert.deepEqual(flagged, [], `a full-gym user is told these need equipment they lack: ${flagged.join(", ")}`);

  // Stated as the general rule, so a new tag cannot reintroduce this quietly.
  const allTags = new Set(CATALOG.flatMap((e) => e.equipmentTags || []));
  for (const tag of allTags) {
    assert.ok(gym.has(tag), `catalog uses the "${tag}" tag but a full gym does not claim it`);
  }
});

test("a barbell implies the plates to load it", () => {
  // Assert on the capability set, not on canPerform: every plate lift in the
  // catalog is uncurated, so canPerform used to return true for all of them
  // vacuously and this would have "passed" without the map ever gaining the
  // tag. The same trap the whole file is about.
  const bb = equipmentCapabilities(["Barbell"]);
  assert.ok(bb.has("plate"), "a barbell without plates is not a barbell");
  for (const e of CATALOG.filter((x) => (x.equipmentTags || []).includes("plate"))) {
    assert.ok(canPerform(e.name, bb), `${e.name} is unavailable to someone who has a barbell`);
  }
});

test("widening did not make the check permissive", () => {
  const bands = equipmentCapabilities(["Bands"]);
  for (const name of ["Barbell Bench Press", "Sled Push", "Medicine Ball Slam", "Lat Pulldown", "Leg Press"]) {
    assert.equal(canPerform(name, bands), false, `${name} is available to a band-only user`);
  }
  for (const name of ["Band Squat", "Push-up", "Plank"]) {
    assert.equal(canPerform(name, bands), true, `${name} is NOT available to a band-only user`);
  }
});

test("cardio equipment is judged the same way", () => {
  const bw = equipmentCapabilities(["Bodyweight"]);
  // You do need the treadmill; you do not need one to go for a run.
  assert.equal(canPerform("Treadmill Run", bw), false);
  assert.equal(canPerform("Rowing Machine", bw), false);
  assert.equal(canPerform("Jog", bw), true);
  assert.equal(canPerform("Swimming", bw), true);
});

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------
test("equipmentTagsFor returns null only for lifts we genuinely cannot place", () => {
  assert.equal(equipmentTagsFor("Wibble Press"), null);
  assert.equal(equipmentTagsFor(""), null);
  assert.deepEqual(equipmentTagsFor("Back Squat"), ["barbell", "rack"]);
  assert.deepEqual(equipmentTagsFor("Band Squat"), ["band"]);
  // Resolution is still forgiving, so shorthand places a lift too.
  assert.deepEqual(equipmentTagsFor("rdl"), equipmentTagsFor("Romanian Deadlift"));
});

test("no capability set means no constraint, not a blanket fail", () => {
  assert.equal(canPerform("Barbell Bench Press", null), true);
  assert.equal(canPerform("Wibble Press", null), true);
});
