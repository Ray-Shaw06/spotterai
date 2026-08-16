/**
 * The guard rail on machine-drafted exercise metadata.
 *
 * 229 of 383 catalog lifts have no curated safety data. Writing it by hand is a
 * months-long content job; having a model draft it is a review job. The whole
 * question is what makes the second one safe.
 *
 * The answer is that scripts/draft-exercise-metadata.mjs enforces every
 * STRUCTURAL invariant in code, so the human review left over is about
 * judgement — mainly contraindications — rather than typos and hallucinations.
 * These tests are that enforcement, exercised against the kind of output a
 * model actually produces: right-ish, confidently wrong in places, and
 * occasionally citing exercises that do not exist.
 *
 * Boundary worth restating: this script is NOT part of the app. Nothing imports
 * it at runtime. The evaluator stays pure code with no LLM in the loop, because
 * an auditor whose data came from a model would depend on that model not
 * hallucinating in order to catch a model hallucinating.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { CATALOG, resolveExercise } from "../exercise-catalog.js";
import {
  validate, pickFrom, resolveNames, render, buildPrompt,
  PATTERNS, DIFFICULTIES, JOINTS, CONTRA, MUSCLES,
} from "../scripts/draft-exercise-metadata.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const entryFor = (name) => CATALOG.find((e) => e.name === name);

/** A structurally perfect draft, to mutate one field at a time. */
const good = {
  name: "Dumbbell Calf Raise",
  primaryMuscles: ["calves"],
  secondaryMuscles: [],
  movementPattern: "isolation",
  difficulty: "beginner",
  jointStress: ["ankle"],
  contraindications: [],
  commonSubstitutions: ["Standing Calf Raise"],
  regressionOptions: [],
  progressionOptions: [],
};

// ---------------------------------------------------------------------------
// 1. The boundary
// ---------------------------------------------------------------------------
test("CRITICAL: nothing in the app imports the drafting script", () => {
  // The moment a runtime module imports this, the evaluator has an LLM in its
  // dependency graph and the "pure code auditor" claim stops being true.
  const appFiles = ["evaluator.js", "exercise-data.js", "exercise-catalog.js", "exercise-metadata.js", "app.js", "api/generate.js", "api/chat.js"];
  // An IMPORT, not a mention. exercise-metadata.js legitimately names the script
  // in a comment explaining where its drafted entries came from, and a bare
  // substring check failed on that — flagging prose as a dependency.
  const importsIt = /(?:^|\n)\s*(?:import\b[^;\n]*|export\b[^;\n]*from\s*)['"][^'"]*draft-exercise-metadata|require\(\s*['"][^'"]*draft-exercise-metadata/;
  for (const f of appFiles) {
    const src = readFileSync(join(root, f), "utf8");
    assert.ok(!importsIt.test(src), `${f} imports the drafting script`);
  }
});

test("the drafter's own output file is a draft, not a data source", () => {
  const src = readFileSync(join(root, "scripts/draft-exercise-metadata.mjs"), "utf8");
  assert.match(src, /DRAFT_METADATA/, "the generated export is no longer named as a draft");
  assert.ok(!src.includes("exercise-metadata.js\","), "the script writes straight into the live metadata file");
});

// ---------------------------------------------------------------------------
// 2. Enums cannot be invented
// ---------------------------------------------------------------------------
test("vocabularies are derived from the real data, not restated", () => {
  // Restating them would let this file drift from what the evaluator accepts.
  assert.ok(PATTERNS.has("hinge") && PATTERNS.has("isolation"));
  assert.ok(CONTRA.has("lower_back") && CONTRA.has("shoulder"));
  assert.ok(!CONTRA.has("ankle"), "ankle is jointStress, never a contraindication key");
  assert.ok(JOINTS.has("ankle"));
  assert.deepEqual([...DIFFICULTIES].sort(), ["advanced", "beginner", "intermediate"]);
});

test("CRITICAL: an invented enum value is rejected, not passed through", () => {
  const e = entryFor("Dumbbell Calf Raise");
  const bad = validate({ ...good, movementPattern: "calf_pump" }, e);
  assert.equal(bad.ok, false);
  assert.match(bad.problems.join(" "), /movementPattern/);

  const bad2 = validate({ ...good, difficulty: "very hard" }, e);
  assert.equal(bad2.ok, false);
  assert.match(bad2.problems.join(" "), /difficulty/);
});

test("an invented muscle or injury key is dropped, and the rest survives", () => {
  const e = entryFor("Dumbbell Calf Raise");
  const r = validate(
    { ...good, primaryMuscles: ["calves", "soleus", "gastrocnemius"], jointStress: ["ankle", "achilles"], contraindications: ["ankle", "knee"] },
    e
  );
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.primaryMuscles, ["calves"], "soleus/gastrocnemius are not evaluator muscle groups");
  assert.deepEqual(r.value.jointStress, ["ankle"]);
  // "ankle" is a legal jointStress but NOT a contraindication key. Silently
  // accepting it would put a value in the field the injury check never matches.
  assert.deepEqual(r.value.contraindications, ["knee"]);
});

test("a draft with no usable primary muscle is rejected outright", () => {
  const r = validate({ ...good, primaryMuscles: ["soleus"] }, entryFor("Dumbbell Calf Raise"));
  assert.equal(r.ok, false);
  assert.match(r.problems.join(" "), /primaryMuscles/);
});

// ---------------------------------------------------------------------------
// 3. Equipment is never the model's to give
// ---------------------------------------------------------------------------
test("CRITICAL: equipment comes from the catalog, whatever the model says", () => {
  const e = entryFor("Dumbbell Calf Raise");
  const r = validate({ ...good, equipment: ["barbell", "rack", "unicorn"] }, e);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.equipment, e.equipmentTags, "the model overrode a fact we already hold");
  assert.deepEqual(r.value.equipment, ["dumbbell"]);
});

test("the prompt tells the model not to supply equipment, and states what it is", () => {
  const p = buildPrompt([entryFor("Band Squat"), entryFor("Pull-up")]);
  assert.match(p, /Do NOT include an "equipment" field/);
  assert.match(p, /Band Squat \(Quads, performed with: band\)/);
  assert.match(p, /Pull-up \(Back, performed with: pullup bar\)/);
});

// ---------------------------------------------------------------------------
// 4. Hallucinated exercise names cannot land
// ---------------------------------------------------------------------------
test("CRITICAL: substitutions that resolve to nothing are dropped", () => {
  // The repair engine once shipped 28 substitutions that resolved to nothing.
  // This path is where that would come back at scale.
  const r = resolveNames(["Standing Calf Raise", "Cybernetic Heel Drive", "Seated Calf Raise"], "Dumbbell Calf Raise", 3);
  assert.deepEqual(r.kept, ["Standing Calf Raise", "Seated Calf Raise"]);
  assert.deepEqual(r.dropped, ["Cybernetic Heel Drive"]);
});

test("kept substitutions are canonicalized, not echoed", () => {
  // A model writing "banded rows" should land on the catalog's own spelling, or
  // the merge creates a second unsearchable entry.
  const r = resolveNames(["banded rows", "db bench press"], "Band Squat", 3);
  assert.deepEqual(r.kept, ["Band Bent-Over Row", "Dumbbell Bench Press"]);
});

test("an exercise is never its own substitution", () => {
  const r = resolveNames(["Dumbbell Calf Raise", "dumbbell calf raises", "Standing Calf Raise"], "Dumbbell Calf Raise", 3);
  assert.deepEqual(r.kept, ["Standing Calf Raise"]);
});

test("every name in a validated draft resolves", () => {
  const r = validate(
    { ...good, commonSubstitutions: ["Standing Calf Raise", "Moon Calf Extension"], regressionOptions: ["Nonsense Raise"], progressionOptions: ["Seated Calf Raise"] },
    entryFor("Dumbbell Calf Raise")
  );
  assert.equal(r.ok, true);
  for (const list of ["commonSubstitutions", "regressionOptions", "progressionOptions"]) {
    for (const n of r.value[list]) assert.ok(resolveExercise(n), `${n} does not resolve`);
  }
  assert.deepEqual(r.value.regressionOptions, []);
  assert.ok(r.dropped.includes("Moon Calf Extension") && r.dropped.includes("Nonsense Raise"));
});

// ---------------------------------------------------------------------------
// 5. Output shape
// ---------------------------------------------------------------------------
test("a rendered entry is valid JS in the shape exercise-metadata.js uses", async () => {
  const r = validate(good, entryFor("Dumbbell Calf Raise"));
  const line = render(r.value);
  const E = (name, o) => ({ name, secondaryMuscles: [], jointStress: [], contraindications: [], commonSubstitutions: [], regressionOptions: [], progressionOptions: [], ...o });
  // eslint-disable-next-line no-new-func
  const parsed = new Function("E", `return [${line.trim().replace(/,$/, "")}];`)(E)[0];
  assert.equal(parsed.name, "Dumbbell Calf Raise");
  assert.deepEqual(parsed.equipment, ["dumbbell"]);
  assert.deepEqual(parsed.primaryMuscles, ["calves"]);
  assert.equal(parsed.movementPattern, "isolation");
});

test("pickFrom is order-preserving, deduped and capped", () => {
  assert.deepEqual(pickFrom(["knee", "KNEE", " shoulder ", "knee"], CONTRA, 3), ["knee", "shoulder"]);
  assert.deepEqual(pickFrom(["knee", "shoulder", "wrist", "lower_back"], CONTRA, 2), ["knee", "shoulder"]);
  assert.deepEqual(pickFrom(null, CONTRA, 3), []);
  assert.deepEqual(pickFrom("knee", CONTRA, 3), [], "a bare string is not a list");
});

// ---------------------------------------------------------------------------
// 6. What the human is actually being asked to check
// ---------------------------------------------------------------------------
test("the script surfaces contraindications for review rather than burying them", () => {
  const src = readFileSync(join(root, "scripts/draft-exercise-metadata.mjs"), "utf8");
  assert.match(src, /REVIEW THESE/, "the report no longer calls out contraindications");
  assert.match(src, /propose NO contraindication/, "drafts that flag nothing are not surfaced either");
});

test("cardio is excluded by default", () => {
  // The metadata shape describes lifting. A treadmill run has no movement
  // pattern, no primary movers worth scoring, and no business in this file.
  const src = readFileSync(join(root, "scripts/draft-exercise-metadata.mjs"), "utf8");
  assert.match(src, /opts\.includeCardio \|\| e\.muscle !== "Cardio"/);
});
