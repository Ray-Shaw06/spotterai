/**
 * The equipment a user can actually declare.
 *
 * Onboarding offered five options against a catalog using twelve equipment
 * tags. The gap that mattered was not sled or medicine ball (nine lifts between
 * them) — it was that a PULL-UP BAR was not equipment at all. Pull-ups,
 * chin-ups, dips and every hanging core movement were filed under "bodyweight",
 * so someone training on a mat with no bar was told a plan full of pull-ups fit
 * their equipment. Fourteen lifts, and the single most common home-training
 * constraint there is.
 *
 * Fixing it exposed the next layer: once a bar stopped counting as bodyweight,
 * floor-only training had ZERO back and ZERO shoulder exercises in the catalog,
 * while the generator was handed that list and told it was "deliberately
 * complete for this equipment". So this file guards three things together —
 * the options, the tags behind them, and the honesty of the vocabulary built
 * from them.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { CATALOG, resolveExercise } from "../exercise-catalog.js";
import { EQUIPMENT_OPTIONS } from "../onboarding.js";
import { equipmentCapabilities, canPerform, exercisesForEquipment, lookupExercise } from "../exercise-data.js";
import { buildPrompt } from "../api/generate.js";
import { isTimeBased } from "../exercises.js";

const TRAINABLE = ["Chest", "Back", "Shoulders", "Biceps", "Triceps", "Quads", "Hamstrings", "Glutes", "Calves", "Core"];
const BAR_LIFTS = [
  "Dips", "Pull-up", "Chin-up", "Hanging Knee Raise", "Hanging Leg Raise", "Weighted Dip",
  "Inverted Row", "Wide-Grip Pull-up", "Toes-to-Bar", "Hanging Windshield Wiper",
  "Weighted Pull-up", "Weighted Chin-up", "Rack Chin", "Dead Hang",
];

// ---------------------------------------------------------------------------
// 1. Every option is a real control
// ---------------------------------------------------------------------------
test("CRITICAL: every onboarding option maps to a capability set", () => {
  // An unmapped label is not inert — equipmentCapabilities returns null for a
  // selection made entirely of unrecognized labels, which means "no constraint",
  // which means the equipment check silently stops running for that user.
  for (const option of EQUIPMENT_OPTIONS) {
    const caps = equipmentCapabilities([option]);
    assert.ok(caps, `"${option}" is offered in onboarding but maps to nothing`);
    // Bodyweight is the one option whose whole meaning is "only bodyweight".
    if (option !== "Bodyweight") assert.ok(caps.size > 1, `"${option}" unlocks nothing beyond bodyweight`);
  }
});

test("every option actually changes what is allowed", () => {
  // A chip that permits exactly what bodyweight permits is decoration. This is
  // why there is no Bench option: every bench-tagged lift also carries dumbbell
  // or barbell, and canPerform is OR over tags, so ticking Bench would change
  // nothing either way.
  const floor = CATALOG.filter((e) => canPerform(e.name, equipmentCapabilities(["Bodyweight"]))).length;
  for (const option of EQUIPMENT_OPTIONS) {
    if (option === "Bodyweight") continue;
    const n = CATALOG.filter((e) => canPerform(e.name, equipmentCapabilities([option]))).length;
    assert.ok(n > floor, `"${option}" unlocks nothing over Bodyweight (${n} vs ${floor})`);
  }
});

test("options a user cannot be expected to own are not offered", () => {
  // plate / sled / medicine ball are 9 lifts between them and are already
  // claimed by Full gym. A chip each would be onboarding clutter for nothing.
  for (const absent of ["Plate", "Plates", "Sled", "Medicine ball", "Bench"]) {
    assert.ok(!EQUIPMENT_OPTIONS.includes(absent), `${absent} is being offered as its own option`);
  }
  const gym = equipmentCapabilities(["Full gym"]);
  for (const tag of ["plate", "sled", "medicine ball"]) {
    assert.ok(gym.has(tag), `Full gym does not cover "${tag}", so those lifts false-flag`);
  }
});

// ---------------------------------------------------------------------------
// 2. The pull-up bar
// ---------------------------------------------------------------------------
test("CRITICAL: a bar is equipment, so floor-only training cannot do pull-ups", () => {
  const floor = equipmentCapabilities(["Bodyweight"]);
  const withBar = equipmentCapabilities(["Bodyweight", "Pull-up bar"]);
  for (const name of BAR_LIFTS) {
    assert.ok(resolveExercise(name), `${name} is no longer in the catalog`);
    assert.equal(canPerform(name, floor), false, `${name} is offered to someone with a mat and no bar`);
    assert.equal(canPerform(name, withBar), true, `${name} is denied to someone who HAS a bar`);
  }
});

test("the retag did not sweep up genuine floor movements", () => {
  const floor = equipmentCapabilities(["Bodyweight"]);
  // A bench dip needs a chair, a push-up needs nothing. Neither is bar work.
  for (const name of ["Bench Dip", "Push-up", "Plank", "Bodyweight Squat", "Glute Bridge", "Superman"]) {
    assert.equal(canPerform(name, floor), true, `${name} now wrongly requires equipment`);
  }
});

test("a full gym has a pull-up bar", () => {
  const gym = equipmentCapabilities(["Full gym"]);
  for (const name of BAR_LIFTS) assert.ok(canPerform(name, gym), `${name} is denied to a full-gym user`);
});

// ---------------------------------------------------------------------------
// 3. The holes the retag exposed
// ---------------------------------------------------------------------------
test("CRITICAL: no equipment option leaves a muscle group unprogrammable", () => {
  // Floor-only had zero Back and zero Shoulders the moment pull-ups moved out.
  // Biceps is the one honest exception: nothing isolates it with no equipment,
  // and the vocabulary declares that rather than hiding it (tested below).
  for (const option of EQUIPMENT_OPTIONS) {
    const byMuscle = exercisesForEquipment(equipmentCapabilities([option]));
    const empty = TRAINABLE.filter((g) => !(byMuscle.get(g) || []).length);
    assert.deepEqual(
      empty.filter((g) => g !== "Biceps"),
      [],
      `"${option}" has no exercises at all for: ${empty.join(", ")}`
    );
  }
});

test("the floor-only additions are real entries, curated on arrival", () => {
  // Added specifically so a floor-only plan is assessable; an entry the
  // equipment check cannot read would defeat the point of adding it.
  for (const name of ["Pike Push-up", "Handstand Push-up", "Superman", "Prone Y Raise", "Towel Row", "Wall Handstand Hold"]) {
    const e = CATALOG.find((x) => x.name === name);
    assert.ok(e, `${name} is missing from the catalog`);
    assert.ok(e.hasSafetyData, `${name} has no curated metadata`);
    assert.deepEqual(lookupExercise(name).equipment, ["bodyweight"]);
  }
  assert.equal(isTimeBased("Wall Handstand Hold"), true, "a handstand hold is logged in seconds, not reps");
});

test("kettlebells can press and curl", () => {
  const kb = equipmentCapabilities(["Kettlebells"]);
  for (const name of ["Kettlebell Overhead Press", "Kettlebell Curl", "Kettlebell Bent-Over Row", "Kettlebell Goblet Squat"]) {
    assert.ok(resolveExercise(name), `${name} is missing`);
    assert.ok(canPerform(name, kb), `${name} is denied to a kettlebell user`);
    assert.ok(lookupExercise(name), `${name} has no curated metadata`);
  }
});

// ---------------------------------------------------------------------------
// 4. The vocabulary tells the truth about itself
// ---------------------------------------------------------------------------
test("CRITICAL: the prompt declares gaps instead of claiming completeness", () => {
  // It used to introduce the list as "deliberately complete for this
  // equipment". Told that and finding nothing under Biceps, a model invents a
  // name — and an invented name is one the equipment and injury checks cannot
  // read, which is the whole failure this vocabulary exists to prevent.
  const bw = buildPrompt({ goal: "General fitness", experience: "Beginner", daysPerWeek: 3, sessionLength: 45, equipment: ["Bodyweight"], injuries: [] });
  assert.ok(!bw.includes("deliberately complete"), "the false completeness claim is back");
  assert.match(bw, /No direct option for: Biceps\./);
  assert.match(bw, /rather than inventing an exercise/);
  // The floor-only list now HAS the groups that were silently missing.
  assert.match(bw, /- Back: .*Superman/);
  assert.match(bw, /- Shoulders: .*Pike Push-up/);
  // ...and does not offer bar work.
  assert.ok(!bw.includes("Pull-up,"), "pull-ups are offered to a floor-only user");
});

test("a complete palette is not given a gap notice", () => {
  // The caveat has to mean something, so it must not appear on every plan.
  for (const equipment of [["Bands"], ["Dumbbells"], ["Kettlebells"], ["Cable machine"]]) {
    const p = buildPrompt({ goal: "General fitness", experience: "Beginner", daysPerWeek: 3, sessionLength: 45, equipment, injuries: [] });
    assert.ok(!p.includes("No direct option for"), `${equipment.join("+")} was told it has gaps it does not have`);
  }
});

test("every name offered for every option round-trips through the catalog", () => {
  for (const option of EQUIPMENT_OPTIONS) {
    const caps = equipmentCapabilities([option]);
    for (const [, names] of exercisesForEquipment(caps)) {
      for (const name of names) {
        assert.equal(resolveExercise(name)?.name, name, `${name} (${option}) does not round-trip`);
        assert.ok(canPerform(name, caps), `${name} is offered to a ${option} user but is not performable`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// 5. Existing profiles
// ---------------------------------------------------------------------------
test("CRITICAL: profiles saved before these options still resolve", () => {
  // Equipment is stored as the label string on the profile. A reworded or
  // removed label turns a saved selection into "unrecognized", which is the
  // no-constraint case — the check would quietly stop running for that user.
  for (const label of ["Full gym", "Dumbbells", "Barbell", "Bodyweight", "Bands"]) {
    const caps = equipmentCapabilities([label]);
    assert.ok(caps, `a profile saved with "${label}" no longer maps to anything`);
  }
  // The old "Bodyweight" selection is the one whose MEANING changed: it no
  // longer implies a pull-up bar. That is the point, and it is deliberate.
  assert.equal(canPerform("Pull-up", equipmentCapabilities(["Bodyweight"])), false);
});

test("multi-select unions rather than overwrites", () => {
  const both = equipmentCapabilities(["Bands", "Pull-up bar"]);
  assert.ok(canPerform("Band Squat", both));
  assert.ok(canPerform("Pull-up", both));
  assert.ok(canPerform("Push-up", both), "bodyweight is always implied");
  assert.equal(canPerform("Barbell Bench Press", both), false);
});
