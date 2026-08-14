/**
 * Canonical exercise catalog — the single source of truth for exercise
 * identity (T4).
 *
 * Before this file existed, resolving an exercise name went through THREE
 * functions with three different semantics:
 *
 *   searchExercises   exercises.js      token AND + prefix + 9 abbreviations
 *   findExercise      exercises.js      exact lowercase Map hit
 *   lookupExercise    exercise-data.js  O(n) substring scan
 *
 * ...over TWO tables that had drifted apart: 109 lifts were searchable with no
 * safety metadata, and 9 lifts carried safety metadata while being unsearchable
 * (4 of those 9 were the same lift spelled differently in each table).
 *
 * The user-visible bug: you could search "bench press", find it, log it, and
 * then have the app fail to recognise the same lift for your previous-set
 * reference and its own contraindication check.
 *
 * Every test below fails against the pre-T4 code. That is deliberate — a test
 * written after the bug is understood passes trivially far more often than it
 * should, so these were run red first.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CATALOG,
  resolveExercise,
  searchCatalog,
  normalizeExerciseName,
} from "../exercise-catalog.js";
import { EXERCISES, findExercise, isCardio, searchExercises } from "../exercises.js";
import { EXERCISE_DATA, lookupExercise, isContraindicated, suggestAlternatives } from "../exercise-data.js";

const nameOf = (e) => e && e.name;

// ---------------------------------------------------------------------------
// The reported bug: partial and reordered names must resolve.
// ---------------------------------------------------------------------------
test("a partial name resolves to the canonical lift", () => {
  assert.equal(nameOf(resolveExercise("bench press")), "Barbell Bench Press");
  assert.equal(nameOf(resolveExercise("Bench Press")), "Barbell Bench Press");
});

test("a qualified name resolves to the lift it qualifies", () => {
  // "Barbell Back Squat" returned null from the old exact-match findExercise.
  assert.equal(nameOf(resolveExercise("Barbell Back Squat")), "Back Squat");
});

test("gym shorthand resolves", () => {
  assert.equal(nameOf(resolveExercise("rdl")), "Romanian Deadlift");
  assert.equal(nameOf(resolveExercise("ohp")), "Overhead Press");
  assert.equal(nameOf(resolveExercise("bss")), "Bulgarian Split Squat");
  assert.equal(nameOf(resolveExercise("db bench")), "Dumbbell Bench Press");
});

test("shorthand mixed into a longer name still resolves", () => {
  // Search expanded "db" -> "dumbbell" but resolution did not, so this returned
  // null while the picker showed exactly one obvious answer.
  assert.equal(nameOf(resolveExercise("incline db press")), "Incline Dumbbell Press");
  assert.equal(nameOf(resolveExercise("cg bench press")), "Close-Grip Bench Press");
});

test("punctuation and spacing never change the answer", () => {
  const forms = ["Push-up", "push up", "pushup", "Push Up", "  push-up  "];
  const resolved = forms.map((f) => nameOf(resolveExercise(f)));
  assert.deepEqual(new Set(resolved), new Set(["Push-up"]), `got ${resolved.join(", ")}`);
});

test("plurals resolve to the singular canonical lift", () => {
  assert.equal(nameOf(resolveExercise("hammer curls")), "Hammer Curl");
  assert.equal(nameOf(resolveExercise("lateral raises")), "Dumbbell Lateral Raise");
});

// ---------------------------------------------------------------------------
// The two-table drift.
// ---------------------------------------------------------------------------
test("names that differed between the two tables are one lift", () => {
  const pairs = [
    ["skullcrusher", "skull crusher"],
    ["pec deck", "pec deck fly"],
    ["triceps kickback", "dumbbell kickback"],
    ["dumbbell shoulder press", "seated dumbbell shoulder press"],
  ];
  for (const [a, b] of pairs) {
    const ra = resolveExercise(a);
    const rb = resolveExercise(b);
    assert.ok(ra, `"${a}" did not resolve`);
    assert.ok(rb, `"${b}" did not resolve`);
    assert.equal(ra.name, rb.name, `"${a}" and "${b}" are the same lift`);
  }
});

test("every lift carrying safety metadata is searchable", () => {
  const unreachable = CATALOG
    .filter((e) => e.contraindications?.length || e.jointStress?.length)
    .filter((e) => !searchCatalog(e.name, 200).some((hit) => hit.name === e.name));
  assert.deepEqual(unreachable.map(nameOf), [], "safety metadata on an unsearchable lift is unreachable");
});

test("every alternative the repair engine can suggest is itself resolvable", () => {
  const missing = new Set();
  for (const e of CATALOG) {
    for (const key of ["commonSubstitutions", "regressionOptions", "progressionOptions"]) {
      for (const suggestion of e[key] || []) {
        if (!resolveExercise(suggestion)) missing.add(`${e.name} → ${suggestion} (${key})`);
      }
    }
  }
  assert.deepEqual([...missing], [], "the app suggested a lift the user cannot find or log");
});

// ---------------------------------------------------------------------------
// One resolver: all three legacy entry points must now agree.
// ---------------------------------------------------------------------------
test("findExercise and lookupExercise agree on every catalog name", () => {
  const disagreements = [];
  for (const e of CATALOG) {
    const viaFind = findExercise(e.name);
    const viaLookup = lookupExercise(e.name);
    if (!viaFind) disagreements.push(`${e.name}: findExercise returned null`);
    // lookupExercise is the SAFETY view: it returns null for a lift nobody has
    // assessed, and the evaluator relies on that null to fall back to keyword
    // matching. Only curated lifts are expected to resolve here.
    if (e.hasSafetyData && !viaLookup) disagreements.push(`${e.name}: curated but lookupExercise returned null`);
    if (!e.hasSafetyData && viaLookup) disagreements.push(`${e.name}: uncurated but lookupExercise returned an entry`);
    if (viaFind && viaLookup && viaFind.name !== viaLookup.name) {
      disagreements.push(`${e.name}: findExercise=${viaFind.name} lookupExercise=${viaLookup.name}`);
    }
  }
  assert.deepEqual(disagreements, []);
});

test("an uncurated lift returns null from the safety layer so the keyword fallback still fires", () => {
  // Load-bearing: if this ever returns an entry with empty contraindications,
  // the evaluator stops falling back and silently reports "no contraindications"
  // for a lift nobody has actually assessed.
  const uncurated = CATALOG.find((e) => !e.hasSafetyData);
  assert.ok(uncurated, "expected at least one uncurated lift");
  assert.equal(lookupExercise(uncurated.name), null);
  assert.ok(findExercise(uncurated.name), "but it must still be findable for logging");
});

test("search, resolve, and the safety check see the same lift", () => {
  // The exact three-way disagreement that motivated T4.
  const typed = "bench press";
  const searched = searchExercises(typed)[0];
  const resolved = resolveExercise(typed);
  assert.ok(searched, "search found nothing");
  assert.equal(searched.name, resolved.name, "search and resolve disagree");
  assert.ok(lookupExercise(typed), "the safety layer could not resolve what search returned");
  assert.equal(lookupExercise(typed).name, resolved.name, "the safety layer resolved a different lift");
});

test("a contraindication check works off a name the user actually typed", () => {
  // Old behaviour: isContraindicated("barbell back squat", ...) fell through to
  // a keyword guess because the exact key was "back squat".
  assert.equal(isContraindicated("Barbell Back Squat", "lower_back"), isContraindicated("Back Squat", "lower_back"));
});

// ---------------------------------------------------------------------------
// Ambiguity and misses must be honest, not confidently wrong.
// ---------------------------------------------------------------------------
test("an unknown lift resolves to null rather than the nearest guess", () => {
  assert.equal(resolveExercise("banana press"), null);
  assert.equal(resolveExercise(""), null);
  assert.equal(resolveExercise(null), null);
  assert.equal(resolveExercise("   "), null);
});

test("a bare ambiguous token does not silently pick a winner", () => {
  // "curl" matches many lifts. Resolution must decline rather than guess.
  assert.equal(resolveExercise("curl"), null, "an ambiguous token must not resolve to one lift");
  assert.ok(searchCatalog("curl").length > 3, "but search must still offer the options");
});

// ---------------------------------------------------------------------------
// Backwards compatibility: existing consumers must not change behaviour.
// ---------------------------------------------------------------------------
test("EXERCISES keeps the shape its consumers expect", () => {
  assert.ok(EXERCISES.length >= 184, `expected at least the original 184, got ${EXERCISES.length}`);
  for (const e of EXERCISES.slice(0, 20)) {
    assert.equal(typeof e.name, "string");
    assert.equal(typeof e.muscle, "string");
    assert.equal(typeof e.equipment, "string", `${e.name}.equipment must stay a display string`);
  }
});

test("EXERCISE_DATA keeps the array-shaped equipment its consumers expect", () => {
  assert.ok(EXERCISE_DATA.length >= 84, `expected at least the original 84, got ${EXERCISE_DATA.length}`);
  for (const e of EXERCISE_DATA) {
    assert.ok(Array.isArray(e.equipment), `${e.name}.equipment must stay an array of tags`);
    assert.ok(Array.isArray(e.contraindications), `${e.name}.contraindications must stay an array`);
  }
});

test("isCardio still classifies from the catalog", () => {
  assert.equal(isCardio("Treadmill Run"), true);
  assert.equal(isCardio("Back Squat"), false);
  assert.equal(isCardio("treadmill run"), true, "casing must not change the answer");
});

test("suggestAlternatives still returns usable names", () => {
  const alts = suggestAlternatives("Back Squat", { limitations: ["lower_back"] });
  assert.equal(alts.known, true);
  for (const key of ["recommended", "safer", "easier", "harder"]) {
    assert.ok(Array.isArray(alts[key]), `${key} must be an array`);
    for (const suggestion of alts[key]) {
      assert.ok(resolveExercise(suggestion), `suggested "${suggestion}" (${key}) is unresolvable`);
    }
  }
});

test("suggestAlternatives resolves off a name the user typed, not just the canonical", () => {
  // "barbell back squat" used to miss the exact key "back squat".
  assert.equal(suggestAlternatives("Barbell Back Squat").known, true);
});

// ---------------------------------------------------------------------------
// Tripwire: no module may grow its own exercise-name matcher again.
//
// The Exercise Library page silently kept a fourth set of rules through the
// first pass of this work — a raw `e.name.toLowerCase().includes(query)` over
// the curated slice — so it browsed 84 of 209 lifts and no shorthand worked
// there. A grep for the imports did not catch it, because it imported the data
// and then matched by hand. This asserts on the source instead.
// ---------------------------------------------------------------------------
test("no module reimplements exercise-name matching by hand", () => {
  const root = new URL("..", import.meta.url);
  const skip = new Set(["node_modules", "test", "integration", "scripts", "docs", "icons", "data", ".git", "api"]);
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith(".js")) continue;
      if (entry.name === "exercise-catalog.js") continue; // the one legitimate home
      const src = readFileSync(full, "utf8");
      // Matching an exercise name against typed text without going through the
      // catalog. Deliberately narrow: only flags `.name...includes(` shapes.
      if (/\.name\s*\.toLowerCase\(\)\s*\.includes\s*\(/.test(src)) offenders.push(entry.name);
    }
  };
  walk(fileURLToPath(root));
  assert.deepEqual(offenders, [], "resolve through exercise-catalog.js instead of matching names inline");
});

// ---------------------------------------------------------------------------
// The normalizer is the one shared primitive.
// ---------------------------------------------------------------------------
test("normalizeExerciseName is stable and idempotent", () => {
  const n = normalizeExerciseName("  Close-Grip   Bench Press!! ");
  assert.equal(n, normalizeExerciseName(n), "normalizing twice must not change the result");
  assert.equal(n, "close grip bench press");
});
