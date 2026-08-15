/**
 * SpotterAI — structured exercise knowledge layer
 * ============================================================================
 * The safety-facing view of the canonical catalog (see exercise-catalog.js):
 * muscles, movement pattern, joint stress, contraindications, and substitution
 * / regression / progression options.
 *
 * This module used to own its own 84-entry table and its own O(n) substring
 * matcher, which drifted from the searchable library in exercises.js. Both the
 * data and the matching now come from the catalog; what remains here is the
 * domain logic the evaluator and the repair engine depend on.
 *
 * LOAD-BEARING: `EXERCISE_DATA` and `lookupExercise` expose ONLY lifts with
 * curated safety metadata, exactly as before. The evaluator falls back to
 * keyword matching when `lookupExercise` returns null, so widening this to the
 * whole catalog would silently replace "nobody has assessed this lift" with
 * "this lift has no contraindications" and disable the fallback. `hasSafetyData`
 * on the catalog entry is what keeps the two apart.
 *
 * Contraindication / jointStress keys match the evaluator's injury keys:
 *   "knee" | "lower_back" | "shoulder" | "wrist".
 */

import { CATALOG, resolveExercise, normalizeExerciseName } from "./exercise-catalog.js";

const norm = normalizeExerciseName;

/** Project a catalog entry into the shape this module has always exposed. */
function toDataEntry(entry) {
  return {
    name: entry.name,
    primaryMuscles: entry.primaryMuscles,
    secondaryMuscles: entry.secondaryMuscles,
    movementPattern: entry.movementPattern,
    // Fine-grained lowercase tags, NOT the display label. canPerform() and the
    // equipment-fit check both read this as an array.
    equipment: entry.equipmentTags,
    difficulty: entry.difficulty,
    jointStress: entry.jointStress,
    contraindications: entry.contraindications,
    commonSubstitutions: entry.commonSubstitutions,
    regressionOptions: entry.regressionOptions,
    progressionOptions: entry.progressionOptions,
  };
}

/** Lifts carrying curated safety metadata. Not the whole catalog, by design. */
export const EXERCISE_DATA = CATALOG.filter((e) => e.hasSafetyData).map(toDataEntry);

const ASSESSED = new Map(EXERCISE_DATA.map((e) => [norm(e.name), e]));

/**
 * Find the structured entry for an exercise name, or null when the lift has no
 * curated safety data (→ the caller falls back to keyword matching).
 *
 * Resolution is the catalog's single matcher, so this agrees with search and
 * with findExercise by construction. "Barbell Back Squat", "bench press", and
 * "skullcrusher" all now resolve here, where the old exact/substring matcher
 * disagreed with the search box.
 */
export function lookupExercise(name) {
  const entry = resolveExercise(name);
  if (!entry || !entry.hasSafetyData) return null;
  return ASSESSED.get(norm(entry.name)) ?? null;
}

/** True if this exercise is contraindicated for an injury key, per the curated
 *  DB list (jointStress is informational only, so knee-friendly lifts like the
 *  leg press aren't over-flagged). */
export function isContraindicated(name, injuryKey) {
  const e = lookupExercise(name);
  return !!e && e.contraindications.includes(injuryKey);
}

// ----------------------------------------------------------------------------
// ----------------------------------------------------------------------------
// Equipment fit — map the user's coarse onboarding choices to the DB's tags.
// ----------------------------------------------------------------------------

// Onboarding offers coarse options ("Full gym", "Dumbbells", "Barbell",
// "Bodyweight", "Bands"). Each unlocks a set of the DB's fine-grained equipment
// tags. Bodyweight is always available. Kept here so both the evaluator's
// equipment-fit check and the substitution filter share one source of truth.
// Must cover EVERY tag the catalog uses, or a selection silently under-claims.
// "Full gym" listed nine of the twelve, which was invisible while the check only
// looked at curated lifts and became nine false warnings the moment it started
// reading the whole catalog: a full-gym user being told Sled Push and Medicine
// Ball Slam "need equipment you didn't list". A gym with barbells has plates by
// definition; commercial gyms have sleds and med balls.
const EQUIPMENT_MAP = {
  "full gym": ["barbell", "rack", "bench", "dumbbell", "machine", "cable", "band", "kettlebell", "plate", "sled", "medicine ball", "bodyweight"],
  dumbbells: ["dumbbell", "bench", "bodyweight"],
  dumbbell: ["dumbbell", "bench", "bodyweight"],
  // A barbell you cannot load is not a barbell.
  barbell: ["barbell", "rack", "bench", "plate", "bodyweight"],
  bands: ["band", "bodyweight"],
  band: ["band", "bodyweight"],
  bodyweight: ["bodyweight"],
};

/**
 * Turn the user's selected equipment into the set of usable DB equipment tags.
 * Returns null for an empty or fully-unrecognized selection, meaning "no
 * constraint — don't assess" (callers treat null as everything-allowed).
 */
export function equipmentCapabilities(userEquipment) {
  if (!Array.isArray(userEquipment) || !userEquipment.length) return null;
  const caps = new Set(["bodyweight"]);
  let known = false;
  for (const item of userEquipment) {
    const tags = EQUIPMENT_MAP[norm(item)];
    if (tags) {
      known = true;
      for (const t of tags) caps.add(t);
    }
  }
  return known ? caps : null;
}

/**
 * Can this exercise be performed with the given capability set? Unknown
 * exercises and entries without equipment tags are assumed performable, so the
 * check never over-flags. OR semantics: usable if ANY required tag is available.
 */
export function canPerform(name, caps) {
  if (!caps) return true;
  const tags = equipmentTagsFor(name);
  if (!tags) return true; // genuinely unknown lift: assume performable, never invent a constraint
  return tags.some((tag) => caps.has(String(tag).toLowerCase()));
}

/**
 * The equipment tags for a lift, or null if we do not recognize it at all.
 *
 * Reads the CATALOG, not the curated-metadata slice, and that distinction was a
 * real hole: `equipmentTags` is populated for every catalog entry (from curated
 * metadata when there is any, otherwise derived from the display label), but
 * this used to go through `lookupExercise`, which returns null for the 168 of
 * 362 lifts with no curated entry. So a plan could prescribe a Stiff-Leg
 * Deadlift to someone training with resistance bands at home, and the
 * equipment-fit check waved it through — while the catalog sitting right there
 * said "Barbell".
 */
export function equipmentTagsFor(name) {
  const entry = resolveExercise(name);
  const tags = entry?.equipmentTags;
  return tags && tags.length ? tags : null;
}

/** Whether the equipment-fit check can say anything at all about this lift. */
export function hasKnownEquipment(name) {
  return equipmentTagsFor(name) !== null;
}

/**
 * Every catalog lift performable with `caps`, grouped by muscle group.
 *
 * Unlike `canPerform` this reads the WHOLE catalog, not just the curated slice:
 * it answers "what could this person be prescribed", where canPerform answers
 * "should I flag this one". Returns null for no constraint.
 *
 * Exists so the plan generator can be handed an exact vocabulary instead of
 * being told "only prescribe exercises possible with the available equipment"
 * and left to invent names. A name the model invents resolves to nothing, and
 * an exercise that resolves to nothing is one the equipment check, the injury
 * check and the Library all silently skip.
 */
export function exercisesForEquipment(caps) {
  if (!caps) return null;
  const byMuscle = new Map();
  for (const e of CATALOG) {
    const tags = e.equipmentTags || [];
    if (tags.length && !tags.some((t) => caps.has(String(t).toLowerCase()))) continue;
    if (!byMuscle.has(e.muscle)) byMuscle.set(e.muscle, []);
    byMuscle.get(e.muscle).push(e.name);
  }
  return byMuscle;
}

// The ten muscle groups the evaluator scores volume against.
const VOLUME_GROUPS = new Set(["chest", "back", "shoulders", "biceps", "triceps", "quads", "hamstrings", "glutes", "calves", "core"]);

/**
 * Categorised swap suggestions for an exercise: recommended (same movement),
 * safer (filtered to avoid the user's active limitations), easier regressions,
 * and harder progressions. Used by the Exercise Library's substitution UX and
 * the plan-repair engine. Returns empty arrays for unknown exercises.
 */
export function suggestAlternatives(name, { limitations = [], equipment = [] } = {}) {
  const e = lookupExercise(name);
  if (!e) return { recommended: [], safer: [], easier: [], harder: [], known: false };

  const lim = new Set(limitations.filter(Boolean));
  const safeFor = (altName) => {
    const a = lookupExercise(altName);
    if (!a) return true; // unknown alt, don't assume unsafe
    return !a.contraindications.some((c) => lim.has(c)) && !a.jointStress.some((j) => lim.has(j));
  };
  const eqOk = (altName) => {
    if (!equipment.length) return true;
    const a = lookupExercise(altName);
    if (!a || !a.equipment.length) return true;
    const have = new Set(equipment.map((x) => String(x).toLowerCase()));
    return a.equipment.some((x) => have.has(String(x).toLowerCase()));
  };

  const subs = e.commonSubstitutions || [];
  const recommended = equipment.length ? subs.filter(eqOk) : subs.slice();
  const saferPool = [...new Set([...subs, ...(e.regressionOptions || [])])];
  const safer = lim.size ? saferPool.filter(safeFor) : [];
  return {
    recommended,
    safer,
    easier: (e.regressionOptions || []).slice(),
    harder: (e.progressionOptions || []).slice(),
    known: true,
  };
}

/**
 * Per-set volume contribution for an exercise, by muscle group: a working set
 * counts 1.0 toward each primary mover and 0.5 toward each secondary (the
 * standard "direct vs indirect" convention) — far more accurate than counting a
 * full set toward every keyword-matched group. Returns null when the exercise
 * isn't in the DB (→ the evaluator falls back to keyword matching).
 */
export function volumeContribution(name) {
  const e = lookupExercise(name);
  if (!e) return null;
  const out = {};
  for (const m of e.primaryMuscles || []) if (VOLUME_GROUPS.has(m)) out[m] = (out[m] || 0) + 1;
  for (const m of e.secondaryMuscles || []) if (VOLUME_GROUPS.has(m)) out[m] = (out[m] || 0) + 0.5;
  return out;
}
