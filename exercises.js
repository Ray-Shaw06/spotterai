/**
 * SpotterAI — Exercise library (searchable view of the canonical catalog)
 * ============================================================================
 * A built-in, searchable list of exercises (name + muscle group + equipment) so
 * logging is a quick pick instead of free typing, and so we can surface a
 * "previous" reference per exercise. Users can still log a custom name.
 *
 * The list and the matching both live in exercise-catalog.js now. This module
 * is the lean projection its consumers have always used: `{ name, muscle,
 * equipment }`, where `equipment` is the single-word display label.
 *
 * It used to own a second, separate table plus an exact-match `findExercise`
 * that disagreed with its own search box: you could search "bench press", get
 * "Barbell Bench Press", log it, and then have `findExercise` return null for
 * the previous-set reference. Both now go through the catalog's one resolver.
 *
 * To add a lift, edit BASE in exercise-catalog.js, not this file.
 */

import {
  CATALOG,
  MUSCLES as CATALOG_MUSCLES,
  resolveExercise,
  searchCatalog,
  isCardioExercise,
} from "./exercise-catalog.js";

export const MUSCLES = CATALOG_MUSCLES;

/** Keep the lean shape consumers store and render; the catalog carries the rest. */
const lean = (entry) =>
  entry && Object.hasOwn(entry, "hasSafetyData")
    ? { name: entry.name, muscle: entry.muscle, equipment: entry.equipment }
    : entry; // caller-supplied custom exercises pass through untouched

export const EXERCISES = CATALOG.map(lean);

/**
 * Look up an exercise's metadata by name. Forgiving: partial names, gym
 * shorthand, plurals, and spacing all resolve ("bench press", "rdl",
 * "hammer curls", "pushup"). Returns null when the name is unknown or too
 * ambiguous to resolve to one lift, rather than guessing.
 */
export function findExercise(name) {
  return lean(resolveExercise(name)) || null;
}

/** Cardio/time-based exercises log time + distance rather than weight × reps. */
export function isCardio(name) {
  return isCardioExercise(name);
}

/**
 * Search the library, optionally merging in `extra` entries (the user's custom
 * exercises + anything they've logged) so any exercise stays findable.
 *
 * Every word you type must match somewhere in the exercise's name, muscle,
 * equipment, or one of its aliases — so "machine preacher curls" finds
 * "Preacher Curl" (Biceps · Machine) regardless of word order or plurals.
 * Ranked: full-name prefix > name-word match > anywhere.
 */
export function searchExercises(query, limit = 30, extra = []) {
  return searchCatalog(query, limit, extra).map(lean);
}
