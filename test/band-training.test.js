/**
 * Resistance-band home training.
 *
 * "Bands" was an onboarding option, the prompt was told to respect equipment,
 * and the evaluator had an equipment-fit check. All three existed and the
 * feature still did not work, because the catalog held THREE band exercises —
 * Pull-Apart, Hip Thrust, Anti-Rotation Hold — and none for shoulders, biceps,
 * triceps or calves. Measured against a plausible band plan, that produced
 * three separate failures:
 *
 *   1. Names the model invents ("Band Chest Press", "Banded Row") resolved to
 *      NOTHING. `lookupExercise` returns null for an unknown lift, `canPerform`
 *      assumes null is performable, and equipment_fit then reported "every
 *      prescribed exercise fits the equipment you have available" for a plan it
 *      had not actually looked at. A vacuous pass presented as a check.
 *
 *   2. Names that DID resolve resolved to the wrong implement. The containment
 *      fallback dropped the "Band" qualifier, so "Band Overhead Press" became
 *      the BARBELL "Overhead Press" and the audit told a band-only user their
 *      band press needed equipment they had not listed. Same for "Band Face
 *      Pull" (cable) and "Band Triceps Pushdown" (cable). Wrong, and shown as a
 *      warning.
 *
 *   3. With no metadata, no band lift could be injury-checked either.
 *
 * The fixes are a 49-lift band catalog with curated safety metadata, an
 * implement guard in the resolver, band-name folding in normalization, and an
 * exact exercise vocabulary handed to the generator instead of a rule it has to
 * invent against.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { CATALOG, MUSCLES, resolveExercise, normalizeExerciseName } from "../exercise-catalog.js";
import { equipmentCapabilities, canPerform, lookupExercise, exercisesForEquipment } from "../exercise-data.js";
import { searchExercises, isTimeBased } from "../exercises.js";
import { evaluatePlan } from "../evaluator.js";
import { buildPrompt } from "../api/generate.js";

const BAND_CAPS = equipmentCapabilities(["Bands"]);
const bandEntries = CATALOG.filter((e) => e.equipment === "Band");

// A band plan can only train what the catalog can name.
const TRAINABLE = ["Chest", "Back", "Shoulders", "Biceps", "Triceps", "Quads", "Hamstrings", "Glutes", "Calves", "Core"];

// ---------------------------------------------------------------------------
// 1. The library
// ---------------------------------------------------------------------------
test("CRITICAL: every muscle group has band exercises", () => {
  // Was: shoulders 0, biceps 0, triceps 0, calves 0. You cannot write an upper
  // body day out of a library with no shoulder or arm movements, so the model
  // had to invent them, and everything downstream lost track of the plan.
  for (const muscle of TRAINABLE) {
    const found = bandEntries.filter((e) => e.muscle === muscle);
    assert.ok(found.length >= 2, `${muscle} has only ${found.length} band exercise(s); a band plan cannot train it`);
  }
});

test("the band library is big enough to program a week without repeating", () => {
  assert.ok(bandEntries.length >= 40, `only ${bandEntries.length} band exercises`);
});

test("band exercises are searchable in the Library", () => {
  const names = searchExercises("band", 60).map((e) => e.name);
  assert.ok(names.length >= 40, `Library search for "band" returned ${names.length}`);
});

// ---------------------------------------------------------------------------
// 2. Naming — people and models write band names four different ways
// ---------------------------------------------------------------------------
test("CRITICAL: band / banded / resistance band are one exercise", () => {
  // Folded in normalizeExerciseName, so exact match, alias lookup, metadata
  // keying and the fuzzy fallback all agree. Folding it only in the fallback
  // would mean the fuzziest path was the only one that worked.
  const target = "Band Bent-Over Row";
  for (const written of ["Band Bent-Over Row", "Banded Bent Over Row", "Resistance Band Bent-Over Row", "resistance bands bent over row"]) {
    assert.equal(resolveExercise(written)?.name, target, `"${written}" did not resolve to ${target}`);
  }
});

test("the shorthand a band user actually types resolves", () => {
  const expected = {
    "Banded Row": "Band Bent-Over Row", // ambiguous between bent-over and seated; would tie to null
    "band curl": "Band Biceps Curl",
    "band rdl": "Band Romanian Deadlift",
    "band ohp": "Band Overhead Press",
    "Band Shoulder Press": "Band Overhead Press",
    "Band Pulldown": "Band Lat Pulldown",
    "Banded Curls": "Band Biceps Curl",
    "Band Tricep Pushdown": "Band Triceps Pushdown",
    "Band Woodchopper": "Band Woodchop",
    "Band Clamshells": "Band Clamshell",
  };
  for (const [written, target] of Object.entries(expected)) {
    assert.equal(resolveExercise(written)?.name, target, `"${written}" -> ${resolveExercise(written)?.name ?? "null"}`);
  }
});

test("renaming the three shipped band lifts did not orphan existing logs", () => {
  // They shipped as "Banded Pull-Apart" / "Banded Hip Thrust" / "Banded
  // Anti-Rotation Hold" and are stored under those names in real workout
  // history. The rename to the "Band X" prefix is only safe because
  // normalization folds "banded" into "band".
  assert.equal(resolveExercise("Banded Pull-Apart")?.name, "Band Pull-Apart");
  assert.equal(resolveExercise("Banded Hip Thrust")?.name, "Band Hip Thrust");
  assert.equal(resolveExercise("Banded Anti-Rotation Hold")?.name, "Band Anti-Rotation Hold");
  // ...and it is still logged in seconds, not reps.
  assert.equal(isTimeBased("Banded Anti-Rotation Hold"), true);
  assert.equal(isTimeBased("Band Anti-Rotation Hold"), true);
});

// ---------------------------------------------------------------------------
// 3. The implement guard
// ---------------------------------------------------------------------------
test("CRITICAL: a band name never resolves to a barbell or cable lift", () => {
  // The exact regression: "band overhead press" -> "Overhead Press" (barbell),
  // so equipment_fit warned a band-only user that their band press needed a
  // barbell. Now these hit their own entries.
  assert.equal(resolveExercise("Band Overhead Press")?.name, "Band Overhead Press");
  assert.equal(resolveExercise("Band Face Pull")?.name, "Band Face Pull");
  assert.equal(resolveExercise("Band Triceps Pushdown")?.name, "Band Triceps Pushdown");

  // And the guard holds for band lifts NOT in the catalog: unresolved beats
  // silently becoming a different implement, because callers treat unknown as
  // unassessed rather than inventing a constraint the user does not have.
  for (const invented of ["Band Landmine Press", "Band Pendlay Row", "Band Hack Squat"]) {
    const hit = resolveExercise(invented);
    assert.ok(
      hit === null || (hit.equipmentTags || []).includes("band"),
      `"${invented}" resolved to ${hit?.name} (${hit?.equipment}), a different implement`
    );
  }
});

test("the guard did not break ordinary implement-qualified matching", () => {
  assert.equal(resolveExercise("db bench press")?.name, "Dumbbell Bench Press");
  assert.equal(resolveExercise("barbell bench press")?.name, "Barbell Bench Press");
  assert.equal(resolveExercise("incline db press")?.name, "Incline Dumbbell Press");
  // No implement named: the fallback is unchanged.
  assert.equal(resolveExercise("romanian deadlift")?.name, "Romanian Deadlift");
});

// ---------------------------------------------------------------------------
// 4. The checks that were passing vacuously
// ---------------------------------------------------------------------------
test("CRITICAL: band lifts carry safety metadata, so the audit can see them", () => {
  // Without an entry, lookupExercise returns null, canPerform assumes the lift
  // is fine, and equipment_fit reports a pass on a plan it never inspected.
  const uncurated = bandEntries.filter((e) => !e.hasSafetyData).map((e) => e.name);
  assert.equal(uncurated.length, 0, `band lifts with no safety metadata: ${uncurated.join(", ")}`);
  for (const e of bandEntries) {
    // `includes`, not equals: Band Push-up is legitimately ["band",
    // "bodyweight"] — it is a push-up with a band across the back, and a
    // bodyweight-only user can still do the unbanded version.
    assert.ok(lookupExercise(e.name)?.equipment.includes("band"), `${e.name} is not tagged as band equipment`);
  }
});

test("a band-only user has a real training palette, not just bodyweight", () => {
  const doable = CATALOG.filter((e) => e.hasSafetyData && canPerform(e.name, BAND_CAPS));
  assert.ok(doable.length >= 60, `only ${doable.length} assessable exercises for a band user`);
  for (const muscle of TRAINABLE) {
    assert.ok(doable.some((e) => e.muscle === muscle), `nothing assessable for ${muscle}`);
  }
});

test("CRITICAL: equipment_fit flags the barbell lifts and NOT the band ones", () => {
  const plan = {
    days: [
      { day: "Mon", focus: "Upper", exercises: [
        { name: "Band Chest Press", sets: 3, reps: "12-15" },
        { name: "Banded Row", sets: 3, reps: "12-15" },
        { name: "Band Overhead Press", sets: 3, reps: "12-15" },
      ]},
      { day: "Wed", focus: "Lower", exercises: [
        { name: "Band Squat", sets: 3, reps: "15" },
        { name: "Barbell Bench Press", sets: 5, reps: "5" },
      ]},
    ],
  };
  const r = evaluatePlan(plan, { goal: "general fitness", experience: "beginner", daysPerWeek: 2, equipment: ["Bands"], injuries: [] });
  const eq = r.checks.find((c) => c.id === "equipment_fit");
  assert.equal(eq.status, "warn");
  assert.match(eq.detail, /Barbell Bench Press/);
  for (const banded of ["Band Chest Press", "Band Overhead Press", "Band Squat"]) {
    assert.doesNotMatch(eq.detail, new RegExp(banded), `${banded} was wrongly flagged as unavailable to a band user`);
  }
});

test("an all-band plan passes equipment_fit outright", () => {
  const plan = {
    days: [
      { day: "Mon", focus: "Upper", exercises: [
        { name: "Band Chest Press", sets: 3, reps: "12-15" },
        { name: "Band Bent-Over Row", sets: 3, reps: "12-15" },
        { name: "Band Lateral Raise", sets: 3, reps: "15" },
        { name: "Band Biceps Curl", sets: 3, reps: "12" },
        { name: "Band Triceps Pushdown", sets: 3, reps: "12" },
      ]},
      { day: "Thu", focus: "Lower", exercises: [
        { name: "Band Squat", sets: 3, reps: "15" },
        { name: "Band Romanian Deadlift", sets: 3, reps: "12" },
        { name: "Band Hip Thrust", sets: 3, reps: "15" },
        { name: "Band Calf Raise", sets: 3, reps: "20" },
      ]},
    ],
  };
  const r = evaluatePlan(plan, { goal: "general fitness", experience: "beginner", daysPerWeek: 2, equipment: ["Bands"], injuries: [] });
  assert.equal(r.checks.find((c) => c.id === "equipment_fit").status, "pass");
});

test("CRITICAL: the audit no longer contradicts itself on a band lift", () => {
  // Worth being precise about what changed here. The shoulder warning on a band
  // overhead press fired BEFORE this work too — but only by accident, because
  // "Band Overhead Press" mis-resolved to the BARBELL "Overhead Press", which
  // carries the contraindication. The same mis-resolution simultaneously made
  // equipment_fit report that the band press needed a barbell the user did not
  // own. One lift, two checks, flatly contradicting each other.
  //
  // So the guard is not "injuries are checked" (they were, for the wrong
  // reason). It is that the warning now comes from the band entry's own
  // metadata, and the equipment check agrees the lift is possible.
  const plan = { days: [{ day: "Mon", focus: "Upper", exercises: [
    { name: "Band Overhead Press", sets: 3, reps: "12" },
    { name: "Band Upright Row", sets: 3, reps: "12" },
  ]}]};
  const r = evaluatePlan(plan, { goal: "general fitness", experience: "beginner", daysPerWeek: 1, equipment: ["Bands"], injuries: ["shoulder"] });
  const injury = r.checks.filter((c) => c.id.includes("injur")).map((c) => c.detail).join(" ");
  assert.match(injury, /Band Overhead Press/);
  assert.match(injury, /Band Upright Row/);

  const eq = r.checks.find((c) => c.id === "equipment_fit");
  assert.equal(eq.status, "pass", `equipment_fit still calls band lifts impossible: ${eq.detail}`);

  // And the warning is sourced from the band entry, not borrowed from a
  // barbell lift the user cannot do.
  assert.deepEqual(lookupExercise("Band Overhead Press").equipment, ["band"]);
  assert.deepEqual(lookupExercise("Band Upright Row").equipment, ["band"]);
});

test("band contraindications are judged on the position, not copied from the barbell", () => {
  // Band tension peaks at the top of the range, so a band squat or row does not
  // carry the barbell version's spinal loading. Where the risk IS the position,
  // it is kept. Getting this wrong in either direction makes the audit useless:
  // copy everything and a band plan is all warnings; copy nothing and a genuine
  // impingement position goes unflagged.
  assert.deepEqual(lookupExercise("Band Squat").contraindications, [], "a band squat is not a lower-back risk");
  assert.deepEqual(lookupExercise("Band Bent-Over Row").contraindications, [], "a band row is not a lower-back risk");
  assert.ok(lookupExercise("Band Upright Row").contraindications.includes("shoulder"), "upright row is an impingement position with any implement");
  assert.ok(lookupExercise("Band Good Morning").contraindications.includes("lower_back"), "good morning is loaded spinal flexion with any implement");
});

// ---------------------------------------------------------------------------
// 5. Generation
// ---------------------------------------------------------------------------
test("CRITICAL: constrained equipment gets an exact vocabulary, not a rule", () => {
  const byMuscle = exercisesForEquipment(BAND_CAPS);
  assert.ok(byMuscle, "no vocabulary for a band user");
  for (const muscle of TRAINABLE) {
    assert.ok((byMuscle.get(muscle) || []).length >= 2, `vocabulary has nothing for ${muscle}`);
  }
  // Nothing needing equipment the user does not have may appear in it.
  for (const [, names] of byMuscle) {
    for (const name of names) {
      assert.ok(canPerform(name, BAND_CAPS), `${name} is in the band vocabulary but not performable with bands`);
    }
  }
});

test("CRITICAL: the band prompt actually carries the vocabulary", () => {
  const prompt = buildPrompt({ goal: "General fitness", experience: "Beginner", daysPerWeek: 3, sessionLength: 45, equipment: ["Bands"], injuries: [] });
  assert.match(prompt, /EXERCISES AVAILABLE WITH THIS EQUIPMENT \(use these names verbatim\)/);
  assert.match(prompt, /Use the EXACT exercise names from the list above/);
  // Every muscle group a band plan has to train is named with real entries.
  for (const muscle of TRAINABLE) {
    assert.match(prompt, new RegExp(`- ${muscle}: .*Band `), `prompt lists no band exercise for ${muscle}`);
  }
  // Nothing the user cannot do leaks into the list. Compare whole entries, not
  // substrings: "Lat Pulldown" is inside the legitimate "Band Lat Pulldown".
  const list = prompt.slice(prompt.indexOf("EXERCISES AVAILABLE"), prompt.indexOf("REQUIREMENTS"));
  const offered = new Set(
    list
      .split("\n")
      .filter((l) => l.startsWith("- "))
      .flatMap((l) => l.slice(l.indexOf(":") + 1).split(",").map((n) => n.trim()))
      .filter(Boolean)
  );
  for (const forbidden of ["Barbell Bench Press", "Lat Pulldown", "Leg Press", "Seated Cable Row", "Back Squat", "Deadlift"]) {
    assert.ok(!offered.has(forbidden), `${forbidden} is offered to a band-only user`);
  }
  // And every entry that IS offered is genuinely performable.
  for (const name of offered) {
    assert.ok(canPerform(name, BAND_CAPS), `${name} is in the prompt but not performable with bands`);
  }
});

test("the vocabulary is only spent where the model needs it", () => {
  // A full gym is ~1,550 tokens to enumerate and is the vocabulary the model
  // already has. Bands are ~550 and are where it invents names.
  const gymPrompt = buildPrompt({ goal: "Muscle gain", experience: "Intermediate", daysPerWeek: 4, sessionLength: 60, equipment: ["Full gym"], injuries: [] });
  assert.ok(!gymPrompt.includes("EXERCISES AVAILABLE WITH THIS EQUIPMENT"), "a full gym is being enumerated into every prompt");
  // No equipment given at all: still no list, and the old wording stands.
  const bare = buildPrompt({ goal: "General fitness", experience: "Beginner", daysPerWeek: 3, sessionLength: 45, equipment: [], injuries: [] });
  assert.ok(!bare.includes("EXERCISES AVAILABLE WITH THIS EQUIPMENT"));
  assert.match(bare, /Only prescribe exercises possible with the available equipment\./);
});

test("bodyweight and dumbbell users get the same treatment as bands", () => {
  // The fix is "constrained equipment gets a vocabulary", not "bands get a
  // special case" — home training in general is where the model invents names.
  for (const equipment of [["Bodyweight"], ["Dumbbells"], ["Bands", "Bodyweight"]]) {
    const prompt = buildPrompt({ goal: "General fitness", experience: "Beginner", daysPerWeek: 3, sessionLength: 45, equipment, injuries: [] });
    assert.match(prompt, /EXERCISES AVAILABLE WITH THIS EQUIPMENT/, `${equipment.join("+")} got no vocabulary`);
  }
});

test("every name the generator can be handed resolves back to the catalog", () => {
  // The round trip that matters: whatever we put IN the prompt has to come back
  // out through resolveExercise, or the checks skip it exactly as before.
  for (const equipment of [["Bands"], ["Bodyweight"], ["Dumbbells"], ["Bands", "Bodyweight"]]) {
    const byMuscle = exercisesForEquipment(equipmentCapabilities(equipment));
    for (const [, names] of byMuscle) {
      for (const name of names) {
        assert.equal(resolveExercise(name)?.name, name, `${name} (${equipment.join("+")}) does not round-trip`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// 6. Catalog integrity for the new block
// ---------------------------------------------------------------------------
test("band entries are well-formed and unique", () => {
  const seen = new Set();
  for (const e of bandEntries) {
    assert.ok(MUSCLES.includes(e.muscle), `${e.name} has muscle "${e.muscle}"`);
    assert.match(e.name, /^Band /, `${e.name} does not use the "Band X" prefix`);
    const key = normalizeExerciseName(e.name);
    assert.ok(!seen.has(key), `duplicate band entry: ${e.name}`);
    seen.add(key);
  }
});

test("band substitutions all resolve to something loggable", () => {
  for (const e of bandEntries) {
    const meta = lookupExercise(e.name);
    for (const list of ["commonSubstitutions", "regressionOptions", "progressionOptions"]) {
      for (const alt of meta[list] || []) {
        assert.ok(resolveExercise(alt), `${e.name}.${list} points at "${alt}", which resolves to nothing`);
      }
    }
  }
});
