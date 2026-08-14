/**
 * SpotterAI — Tracker store (client-side, localStorage)
 * ============================================================================
 * The data layer for the gamified dashboard: workouts, nutrition, and
 * bodyweight, persisted in localStorage (no backend, no account). Exposes
 * mutations, a rich `deriveStats()` for the UI, and `getContext()` — a compact
 * summary the chatbot receives so it can answer "summarize my week", "am I
 * hitting protein", etc.
 *
 * Emits a "spotter:tracker" window event on every change.
 */

import { ACHIEVEMENTS, RANKS, XP, achievementXp, levelFor, rankFor, workoutXp } from "./gamify.js";
import { trackerKey } from "./profile-store.js";
import { deloadFromWeeklyVolume, epley1RM, suggestNextWeight } from "./progression.js";

const DEFAULTS = {
  workouts: [], // { id, date 'YYYY-MM-DD', name, focus, exercises:[{name,sets,reps,weight}], volume, xp }
  nutrition: [], // { id, date, name, kcal, protein }
  bodyweight: [], // { id, date, value }
  targets: { kcal: 2200, protein: 140, carbs: 250, fat: 70, weeklyWorkouts: 4, waterMl: 2500 },
  achievements: [], // unlocked ids
  routines: [], // saved workout templates
  customExercises: [], // user-added exercises { name, muscle, cardio }
  customFoods: [], // user-added foods { name, serving, kcal, protein, carbs, fat }
  mealTemplates: [], // saved meals { id, name, items:[{name,qty,unit,kcal,protein,carbs,fat}] }
  water: {}, // { 'YYYY-MM-DD': ml }
  painReports: [], // { id, date, location, severity, timing, note, injuryKey }
  exercisePrefs: { favorites: [], disliked: [] }, // exercise names
  unit: "kg",
};

const MEALS = ["breakfast", "lunch", "dinner", "snacks"];

// ----------------------------------------------------------------------------
// Persistence
// ----------------------------------------------------------------------------
function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(trackerKey()) || "{}");
    return { ...DEFAULTS, ...raw, targets: { ...DEFAULTS.targets, ...(raw.targets || {}) } };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

let state = load();

// Switch data when the active profile changes (re-render via spotter:tracker).
window.addEventListener("spotter:profile", () => {
  state = load();
  window.dispatchEvent(new CustomEvent("spotter:tracker"));
});

function persist(bump = true) {
  // `updatedAt` powers last-write-wins cloud sync. Real edits bump it; importing
  // remote/backup data (bump=false) preserves the incoming timestamp.
  if (bump) state.updatedAt = Date.now();
  try {
    localStorage.setItem(trackerKey(), JSON.stringify(state));
  } catch {
    /* storage full / disabled — keep working in-memory */
  }
  window.dispatchEvent(new CustomEvent("spotter:tracker"));
}

export function getState() {
  return state;
}

/** Serialize the active profile's data for a downloadable backup. */
export function exportData() {
  return JSON.stringify({ app: "spotterai", version: 1, exportedAt: new Date().toISOString(), data: state }, null, 2);
}

/**
 * Wipe ALL local data from this browser — every profile's tracker + plan,
 * onboarding/first-week progress, reminders, streak, session drafts and any
 * Firebase auth cache — AND the PWA offline cache + service worker, so the next
 * load is fully fresh (no stale code/assets). The caller MUST hard-reload
 * afterwards so every module re-initialises from empty. Cloud data (if synced)
 * is untouched. Returns a promise that resolves once the wipe is done.
 */
export async function clearAllData() {
  try { localStorage.clear(); } catch { /* storage unavailable */ }
  try { sessionStorage.clear(); } catch { /* storage unavailable */ }
  // Drop the PWA caches so the reload re-fetches everything from the network.
  try {
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch { /* no Cache API */ }
  // Unregister the service worker so it can't serve stale assets after reload.
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) || [];
    await Promise.all(regs.map((r) => r.unregister()));
  } catch { /* no SW */ }
}

/** Replace the active profile's data from a parsed backup object. Returns ok. */
export function importData(obj) {
  const incoming = obj && obj.data && typeof obj.data === "object" ? obj.data : obj;
  if (!incoming || typeof incoming !== "object" || (!Array.isArray(incoming.workouts) && !Array.isArray(incoming.nutrition))) {
    return false;
  }
  state = {
    ...structuredClone(DEFAULTS),
    ...incoming,
    targets: { ...DEFAULTS.targets, ...(incoming.targets || {}) },
    workouts: Array.isArray(incoming.workouts) ? incoming.workouts : [],
    nutrition: Array.isArray(incoming.nutrition) ? incoming.nutrition : [],
    bodyweight: Array.isArray(incoming.bodyweight) ? incoming.bodyweight : [],
    achievements: Array.isArray(incoming.achievements) ? incoming.achievements : [],
    routines: Array.isArray(incoming.routines) ? incoming.routines : [],
    customExercises: Array.isArray(incoming.customExercises) ? incoming.customExercises : [],
    customFoods: Array.isArray(incoming.customFoods) ? incoming.customFoods : [],
    mealTemplates: Array.isArray(incoming.mealTemplates) ? incoming.mealTemplates : [],
    water: incoming.water && typeof incoming.water === "object" ? incoming.water : {},
    updatedAt: incoming.updatedAt || Date.now(),
  };
  persist(false); // preserve the incoming timestamp
  return true;
}

// ----------------------------------------------------------------------------
// Cloud sync surface (per-record)
// ============================================================================
// Sync used to write this entire object to one Firestore document with
// last-write-wins on a single top-level `updatedAt`, so two devices active in
// the same window silently erased each other's sessions.
//
// It is now per-record. These helpers are the ONLY way remote data enters local
// state, and they exist specifically so that `importData` is never used for it:
// importData REPLACES the whole state, which is correct for restoring a backup
// file and catastrophic for applying a partial batch. Feeding a bounded sync
// window through importData would delete every record older than the window.
//
//   importData(obj)              whole-state replace   <- backup restore only
//   mergeRemoteRecords(kind, r)  upsert by id          <- sync
//   removeRemoteRecords(kind, i) delete by id          <- sync
//   mergeRemoteMeta(patch)       scalar/singleton keys <- sync
// ----------------------------------------------------------------------------

/** Array collections that sync as one document per record. */
export const SYNCED_RECORD_KINDS = Object.freeze([
  "workouts",
  "nutrition",
  "bodyweight",
  "painReports",
  "routines",
  "mealTemplates",
  "customExercises",
  "customFoods",
]);

/** Kinds carrying a 'YYYY-MM-DD' date, so the live listener can bound a window. */
export const DATED_RECORD_KINDS = Object.freeze(["workouts", "nutrition", "bodyweight", "painReports"]);

/** Scalar / singleton keys that live in the parent users/<uid> document. */
export const SYNCED_META_KEYS = Object.freeze(["targets", "water", "achievements", "exercisePrefs", "unit"]);

/**
 * Stable document id for a record. Most kinds carry their own `id`; the
 * user-authored name lists do not, so they key off the normalized name. A
 * record with neither is not syncable and is skipped rather than given a random
 * id, which would duplicate it on every push.
 */
export function recordId(record) {
  if (!record || typeof record !== "object") return null;
  if (record.id) return String(record.id);
  if (record.name) return `name:${String(record.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
  return null;
}

/**
 * Remote records are untrusted input: they come from another device that may be
 * running an older build, a half-migrated schema, or a partially written
 * document. Give the array-shaped fields their expected type before they reach
 * local state, so a malformed record degrades into an empty one instead of
 * crashing stats on the next render.
 */
function normalizeSyncedRecord(kind, record) {
  if (!record || typeof record !== "object") return null;
  if (kind === "workouts") {
    return { ...record, exercises: Array.isArray(record.exercises) ? record.exercises : [] };
  }
  if (kind === "routines") {
    return { ...record, exercises: Array.isArray(record.exercises) ? record.exercises : [] };
  }
  if (kind === "mealTemplates") {
    return { ...record, entries: Array.isArray(record.entries) ? record.entries : [] };
  }
  return record;
}

/** True while remote data is being applied, so callers can suppress echo pushes. */
let applyingRemote = false;
export function isApplyingRemote() {
  return applyingRemote;
}

function withRemoteApply(fn) {
  applyingRemote = true;
  try {
    return fn();
  } finally {
    applyingRemote = false;
  }
}

/**
 * Upsert remote records into one collection, by id. Records already present are
 * replaced; records absent from the batch are LEFT ALONE. That last part is the
 * whole point: a bounded window only ever carries recent records, so anything
 * that removed the rest would be silent data loss.
 * Returns the number of records that actually changed.
 */
export function mergeRemoteRecords(kind, records) {
  if (!SYNCED_RECORD_KINDS.includes(kind) || !Array.isArray(records) || !records.length) return 0;
  return withRemoteApply(() => {
    const list = Array.isArray(state[kind]) ? state[kind].slice() : [];
    const indexById = new Map(list.map((r, i) => [recordId(r), i]));
    let changed = 0;
    for (const raw of records) {
      const incoming = normalizeSyncedRecord(kind, raw);
      if (!incoming) continue;
      const id = recordId(incoming);
      if (!id) continue;
      const at = indexById.get(id);
      if (at === undefined) {
        list.push(incoming);
        indexById.set(id, list.length - 1);
        changed++;
      } else if (JSON.stringify(list[at]) !== JSON.stringify(incoming)) {
        list[at] = incoming;
        changed++;
      }
    }
    if (!changed) return 0;
    state[kind] = list;
    persist(false); // preserve the incoming timestamp; this is not a local edit
    return changed;
  });
}

/** Remove records another device deleted. No-op for ids we do not hold. */
export function removeRemoteRecords(kind, ids) {
  if (!SYNCED_RECORD_KINDS.includes(kind) || !Array.isArray(ids) || !ids.length) return 0;
  return withRemoteApply(() => {
    const drop = new Set(ids.map(String));
    const before = Array.isArray(state[kind]) ? state[kind] : [];
    const after = before.filter((r) => !drop.has(recordId(r)));
    if (after.length === before.length) return 0;
    state[kind] = after;
    persist(false);
    return before.length - after.length;
  });
}

/** Apply the scalar/singleton half of remote state. Unknown keys are ignored. */
export function mergeRemoteMeta(patch) {
  if (!patch || typeof patch !== "object") return false;
  return withRemoteApply(() => {
    let changed = false;
    for (const key of SYNCED_META_KEYS) {
      if (!(key in patch)) continue;
      const incoming = patch[key];
      if (incoming === undefined) continue;
      if (JSON.stringify(state[key]) === JSON.stringify(incoming)) continue;
      state[key] = key === "targets" ? { ...DEFAULTS.targets, ...incoming } : incoming;
      changed = true;
    }
    if (changed) persist(false);
    return changed;
  });
}

/** The scalar/singleton half of local state, for pushing. */
export function metaSnapshot() {
  const out = {};
  for (const key of SYNCED_META_KEYS) out[key] = state[key];
  return out;
}

// ----------------------------------------------------------------------------
// Date helpers (local time)
// ----------------------------------------------------------------------------
/**
 * Parse a stored day into a LOCAL Date.
 *
 * `new Date("2026-08-10")` is parsed as UTC midnight, which at any negative UTC
 * offset is the previous day locally. Every date in this store is a local
 * 'YYYY-MM-DD' string, so feeding one straight to `new Date` shifted the whole
 * week: in America/Los_Angeles a Monday workout was attributed to the PREVIOUS
 * week, which silently undercounted `thisWeek.sessions` and misplaced points on
 * the weekly volume chart. It never showed up at UTC or at positive offsets.
 *
 * `ymdOffset` below already used the `+ "T12:00:00"` trick; the rest of the date
 * helpers had drifted away from it. Noon also sidesteps DST edges.
 */
function parseDay(value) {
  if (value instanceof Date) return new Date(value);
  const s = String(value ?? "");
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00`) : new Date(s);
}

function ymd(d) {
  const x = parseDay(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}
function today() {
  return ymd(new Date());
}
function mondayOf(d) {
  const x = parseDay(d);
  const dow = (x.getDay() + 6) % 7; // Mon=0
  x.setDate(x.getDate() - dow);
  x.setHours(0, 0, 0, 0);
  return x;
}
function shortDate(d) {
  const x = parseDay(d);
  return `${x.getMonth() + 1}/${x.getDate()}`;
}
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ----------------------------------------------------------------------------
// Workout normalization — supports both the new per-set model
// (ex.sets = [{ weight, reps, ... }]) and the legacy one (ex.sets = count).
// ----------------------------------------------------------------------------
/** An exercise's sets as an array of { weight, reps, ...optional cardio fields }. */
export function setsOf(ex) {
  if (Array.isArray(ex.sets)) {
    return ex.sets.map((s) => ({
      weight: Number(s.weight) || 0,
      reps: Number(s.reps) || 0,
      ...(s.durationMin != null ? { durationMin: Number(s.durationMin) || 0 } : {}),
      ...(s.distance != null ? { distance: Number(s.distance) || 0 } : {}),
    }));
  }
  // Legacy: sets = count, with single reps/weight.
  const count = Number(ex.sets) || 0;
  const reps = Number(ex.reps) || 0;
  const weight = Number(ex.weight) || 0;
  return Array.from({ length: count }, () => ({ weight, reps }));
}

const setHasWork = (s) => s.weight > 0 || s.reps > 0 || s.durationMin > 0 || s.distance > 0;

/** Total volume (Σ weight × reps) of a workout, across either model. */
export function workoutVolume(w) {
  let v = 0;
  for (const ex of w.exercises || []) for (const s of setsOf(ex)) v += s.weight * s.reps;
  return Math.round(v);
}

/** One-line summary of an exercise (top set), for the chatbot context. */
function exerciseSummary(ex) {
  const sets = setsOf(ex).filter(setHasWork);
  if (!sets.length) return ex.name;
  const top = sets.reduce((b, s) => (s.weight > (b.weight || 0) ? s : b), sets[0]);
  const w = top.weight ? ` @ ${top.weight}${state.unit}` : "";
  return `${ex.name}: ${sets.length} set${sets.length > 1 ? "s" : ""}, top ${top.reps}${w}`;
}

// ----------------------------------------------------------------------------
// Mutations
// ----------------------------------------------------------------------------
function cleanExercises(exercises) {
  return exercises
    .map((e) => {
      const sets = setsOf(e)
        .map((s) => ({
          weight: Number(s.weight) || 0,
          reps: Number(s.reps) || 0,
          ...(s.durationMin ? { durationMin: Number(s.durationMin) || 0 } : {}),
          ...(s.distance ? { distance: Number(s.distance) || 0 } : {}),
        }))
        .filter(setHasWork); // only keep completed sets
      return { name: String(e.name || "Exercise"), muscle: e.muscle || "", notes: String(e.notes || ""), sets };
    })
    .filter((e) => e.name && e.sets.length);
}
export function addWorkout({ name, focus, exercises = [], date, durationSec, difficulty } = {}) {
  const clean = cleanExercises(exercises);
  const volume = workoutVolume({ exercises: clean });
  const workout = {
    id: uid(),
    date: date || today(),
    name: String(name || "Workout"),
    focus: String(focus || ""),
    durationSec: Number(durationSec) || 0,
    exercises: clean,
    volume: Math.round(volume),
    xp: workoutXp(volume),
    ...(difficulty ? { difficulty: String(difficulty) } : {}),
  };
  state.workouts.push(workout);
  const unlocked = unlockAchievements();
  persist();
  return { workout, newAchievements: unlocked };
}

/**
 * Replace a logged workout's contents (edit after saving). Keeps its id + date,
 * recomputes volume + XP from the edited sets. Returns the workout or null.
 */
export function updateWorkout(id, { name, exercises = [], durationSec, difficulty } = {}) {
  const w = state.workouts.find((x) => x.id === id);
  if (!w) return null;
  const clean = cleanExercises(exercises);
  if (!clean.length) return null; // an edit can't empty a workout, delete instead
  const volume = workoutVolume({ exercises: clean });
  w.name = String(name || w.name);
  w.exercises = clean;
  w.volume = Math.round(volume);
  w.xp = workoutXp(volume);
  if (durationSec != null) w.durationSec = Number(durationSec) || w.durationSec;
  if (difficulty != null) difficulty ? (w.difficulty = String(difficulty)) : delete w.difficulty;
  persist();
  return w;
}

// --- Routines (saved workout templates) -------------------------------------
export function addRoutine({ name, exercises = [] } = {}) {
  const routine = {
    id: uid(),
    name: String(name || "Routine").slice(0, 40),
    exercises: exercises.map((e) => ({
      name: String(e.name || "Exercise"),
      muscle: e.muscle || "",
      sets: setsOf(e).map((s) => ({ weight: Number(s.weight) || 0, reps: Number(s.reps) || 0 })),
    })),
  };
  state.routines.push(routine);
  persist();
  return routine;
}
export function removeRoutine(id) {
  state.routines = (state.routines || []).filter((r) => r.id !== id);
  persist();
}
export function getRoutines() {
  return state.routines || [];
}

/** Most recent logged sets for an exercise (the "Previous" reference). */
export function lastSetFor(name) {
  const key = String(name || "").toLowerCase();
  for (let i = state.workouts.length - 1; i >= 0; i--) {
    const ex = (state.workouts[i].exercises || []).find((e) => String(e.name).toLowerCase() === key);
    if (!ex) continue;
    const sets = setsOf(ex).filter(setHasWork);
    if (!sets.length) continue;
    const top = sets.reduce((b, s) => (s.weight > (b.weight || 0) ? s : b), sets[0]);
    return { date: state.workouts[i].date, sets, top };
  }
  return null;
}

export function addNutrition({ name, meal, qty, unit, kcal, protein, carbs, fat, date } = {}) {
  const num = (v, dp = 1) => Math.max(0, Math.round((Number(v) || 0) * 10 ** dp) / 10 ** dp);
  const entry = {
    id: uid(),
    date: date || today(),
    meal: MEALS.includes(meal) ? meal : "snacks",
    name: String(name || "Food"),
    qty: Number(qty) || 1,
    unit: String(unit || ""),
    kcal: num(kcal, 0),
    protein: num(protein),
    carbs: num(carbs),
    fat: num(fat),
  };
  state.nutrition.push(entry);
  const unlocked = unlockAchievements();
  persist();
  return { entry, newAchievements: unlocked };
}

/** Edit a logged food in place (name/qty/kcal/macros/meal) — no delete+re-add. */
export function updateNutrition(id, patch = {}) {
  const e = state.nutrition.find((x) => x.id === id);
  if (!e) return null;
  const num = (v, dp = 1) => Math.max(0, Math.round((Number(v) || 0) * 10 ** dp) / 10 ** dp);
  if (patch.name != null && String(patch.name).trim()) e.name = String(patch.name).trim();
  if (patch.meal != null && MEALS.includes(patch.meal)) e.meal = patch.meal;
  if (patch.qty != null) e.qty = Number(patch.qty) || e.qty;
  for (const k of ["kcal", "protein", "carbs", "fat"]) {
    if (patch[k] != null && patch[k] !== "") e[k] = num(patch[k], k === "kcal" ? 0 : 1);
  }
  persist();
  return e;
}

/**
 * Copy one meal's entries from another day (default: yesterday) onto `date`.
 * Returns the number of entries copied.
 */
export function copyMeal({ meal, fromDate, date } = {}) {
  const to = date || today();
  const from = fromDate || ymdOffset(to, -1);
  const src = state.nutrition.filter((e) => e.date === from && e.meal === meal);
  for (const e of src) {
    state.nutrition.push({ ...e, id: uid(), date: to });
  }
  if (src.length) {
    unlockAchievements();
    persist();
  }
  return src.length;
}

function ymdOffset(ymdStr, days) {
  const d = new Date(ymdStr + "T12:00:00"); // noon avoids DST edge-cases
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// --- Saved meals (templates): log a whole meal in one tap -------------------
export function saveMealTemplate({ name, entries = [] } = {}) {
  const items = entries
    .map((e) => ({ name: e.name, qty: e.qty || 1, unit: e.unit || "", kcal: e.kcal || 0, protein: e.protein || 0, carbs: e.carbs || 0, fat: e.fat || 0 }))
    .filter((i) => i.name);
  if (!items.length) return null;
  const t = { id: uid(), name: String(name || "My meal").slice(0, 40), items };
  state.mealTemplates = state.mealTemplates || [];
  // Same name → replace (updating your usual breakfast shouldn't duplicate).
  state.mealTemplates = state.mealTemplates.filter((x) => x.name.toLowerCase() !== t.name.toLowerCase());
  state.mealTemplates.push(t);
  persist();
  return t;
}
export function getMealTemplates() {
  return state.mealTemplates || [];
}
export function removeMealTemplate(id) {
  state.mealTemplates = (state.mealTemplates || []).filter((t) => t.id !== id);
  persist();
}
/** Log every item of a saved meal to `meal` on `date`. Returns entries added. */
export function logMealTemplate(id, meal, date) {
  const t = (state.mealTemplates || []).find((x) => x.id === id);
  if (!t) return 0;
  for (const i of t.items) {
    state.nutrition.push({ id: uid(), date: date || today(), meal: MEALS.includes(meal) ? meal : "snacks", ...i });
  }
  unlockAchievements();
  persist();
  return t.items.length;
}

// --- Water -----------------------------------------------------------------
export function addWater(deltaMl, date) {
  const d = date || today();
  state.water[d] = Math.max(0, (state.water[d] || 0) + (Number(deltaMl) || 0));
  persist();
  unlockAchievements(); // "Hydration Habit"
  return state.water[d];
}
export function getWater(date) {
  return state.water[date || today()] || 0;
}

// --- Exercise preferences (favorite / disliked) ----------------------------
function ensurePrefs() {
  if (!state.exercisePrefs || typeof state.exercisePrefs !== "object") state.exercisePrefs = { favorites: [], disliked: [] };
  state.exercisePrefs.favorites ||= [];
  state.exercisePrefs.disliked ||= [];
  return state.exercisePrefs;
}
export function getExercisePrefs() {
  const p = ensurePrefs();
  return { favorites: [...p.favorites], disliked: [...p.disliked] };
}
/** Toggle an exercise in "favorites" or "disliked" (mutually exclusive). Returns the new state. */
export function toggleExercisePref(name, kind) {
  const p = ensurePrefs();
  const other = kind === "favorites" ? "disliked" : "favorites";
  const has = p[kind].includes(name);
  p[kind] = has ? p[kind].filter((n) => n !== name) : [...p[kind], name];
  if (!has) p[other] = p[other].filter((n) => n !== name); // can't be both
  persist();
  return { favorite: p.favorites.includes(name), disliked: p.disliked.includes(name) };
}

// --- Pain reports (Pain Mode) ----------------------------------------------
export function addPainReport({ location, severity, timing = "", note = "", injuryKey = null, date } = {}) {
  const entry = { id: uid(), date: date || today(), location, severity, timing, note: String(note || ""), injuryKey: injuryKey || null };
  if (!Array.isArray(state.painReports)) state.painReports = [];
  state.painReports.push(entry);
  persist();
  unlockAchievements(); // "Body Awareness", reporting pain is healthy, not a failure
  return entry;
}
export function getPainReports() {
  return [...(state.painReports || [])];
}
/** Evaluator injury keys from pain reports in the last `days` (active limitations). */
export function getActiveLimitations(days = 14) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cut = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;
  const keys = new Set();
  for (const r of state.painReports || []) {
    if (r.injuryKey && r.date >= cut) keys.add(r.injuryKey);
  }
  return [...keys];
}

/** Most recent distinct foods (for quick re-add). */
export function getRecentFoods(limit = 8) {
  const seen = new Set();
  const out = [];
  for (let i = state.nutrition.length - 1; i >= 0; i--) {
    const e = state.nutrition[i];
    const key = e.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: e.name, qty: e.qty || 1, unit: e.unit || "", kcal: e.kcal, protein: e.protein, carbs: e.carbs || 0, fat: e.fat || 0 });
    if (out.length >= limit) break;
  }
  return out;
}

// --- Custom library (exercises + foods you add stick around, synced) --------
export function addCustomExercise({ name, muscle, cardio } = {}) {
  const n = String(name || "").trim();
  if (!n || state.customExercises.some((e) => e.name.toLowerCase() === n.toLowerCase())) return;
  state.customExercises.push({ name: n, muscle: muscle || "", cardio: cardio === true });
  persist();
}
export function getCustomExercises() {
  return state.customExercises || [];
}

/** Fill in a custom exercise's muscle/cardio later (e.g. after AI classifies it). */
export function updateCustomExercise(name, muscle, cardio) {
  const e = state.customExercises.find((x) => x.name.toLowerCase() === String(name || "").toLowerCase());
  if (!e) return;
  let changed = false;
  if (muscle && e.muscle !== muscle) {
    e.muscle = muscle;
    changed = true;
  }
  if (typeof cardio === "boolean" && e.cardio !== cardio) {
    e.cardio = cardio;
    changed = true;
  }
  if (changed) persist();
}

/** Distinct exercise names from logged workouts (so anything logged stays findable). */
export function getLoggedExerciseNames() {
  const seen = new Set();
  const out = [];
  for (let i = state.workouts.length - 1; i >= 0; i--) {
    for (const e of state.workouts[i].exercises || []) {
      const k = String(e.name).toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        out.push({ name: e.name, muscle: e.muscle || "" });
      }
    }
  }
  return out;
}

// ----------------------------------------------------------------------------
// Coaching depth: per-exercise progress, auto-progression, deload trend
// ----------------------------------------------------------------------------

/** Per-session estimated 1RM / top weight / volume for one exercise, oldest→newest. */
export function exerciseProgress(name) {
  const key = String(name || "").toLowerCase();
  const points = [];
  for (const w of state.workouts) {
    const ex = (w.exercises || []).find((e) => String(e.name).toLowerCase() === key);
    if (!ex) continue;
    const sets = setsOf(ex).filter((s) => s.weight > 0 && s.reps > 0);
    if (!sets.length) continue;
    let best = 0;
    let top = 0;
    let vol = 0;
    for (const s of sets) {
      best = Math.max(best, epley1RM(s.weight, s.reps));
      top = Math.max(top, s.weight);
      vol += s.weight * s.reps;
    }
    points.push({ date: w.date, label: shortDate(w.date), e1RM: Math.round(best), topWeight: top, volume: Math.round(vol) });
  }
  return points.sort((a, b) => a.date.localeCompare(b.date));
}

/** Distinct exercise names that have at least one weighted set (most recent first). */
export function exerciseNamesWithHistory() {
  const seen = new Set();
  const out = [];
  for (let i = state.workouts.length - 1; i >= 0; i--) {
    for (const e of state.workouts[i].exercises || []) {
      const k = String(e.name).toLowerCase();
      if (seen.has(k)) continue;
      if (setsOf(e).some((s) => s.weight > 0 && s.reps > 0)) {
        seen.add(k);
        out.push(e.name);
      }
    }
  }
  return out;
}

/** Auto-progression target for the next session of an exercise (or null). */
export function suggestProgression(name) {
  const prev = lastSetFor(name);
  return prev ? suggestNextWeight(prev.top) : null;
}

/** Weekly training volume for the last `n` weeks (oldest→current). */
function lastNWeeksVolume(n) {
  const starts = [];
  let m = mondayOf(new Date());
  for (let i = 0; i < n; i++) {
    starts.unshift(new Date(m));
    m = new Date(m);
    m.setDate(m.getDate() - 7);
  }
  return starts.map((wk) => {
    const t = wk.getTime();
    return state.workouts.filter((w) => mondayOf(w.date).getTime() === t).reduce((v, w) => v + (w.volume || 0), 0);
  });
}

/** Deload suggestion from the recent volume trend (or null). */
export function deloadCheck() {
  return deloadFromWeeklyVolume(lastNWeeksVolume(6));
}

/** Top working set per logged session of one exercise (oldest→newest). */
function topSetHistory(name) {
  const key = String(name || "").toLowerCase();
  const out = [];
  for (const w of state.workouts) {
    const ex = (w.exercises || []).find((e) => String(e.name).toLowerCase() === key);
    if (!ex) continue;
    const sets = setsOf(ex).filter(setHasWork);
    if (!sets.length) continue;
    // Heaviest set; ties broken by more reps, so bodyweight (weight 0) still ranks by reps.
    const top = sets.reduce((b, s) => {
      if (s.weight > b.weight) return s;
      if (s.weight === b.weight && s.reps > b.reps) return s;
      return b;
    }, sets[0]);
    out.push({ date: w.date, weight: top.weight, reps: top.reps });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Structured context for the deterministic adapt engine (adapt-engine.js).
 * Everything the engine needs, as plain data — no display strings. Returns null
 * when there's nothing logged. Only exercises that appear in BOTH the plan and
 * the log get per-exercise history.
 */
export function buildAdaptContext(plan) {
  const ctx = getContext();
  if (!ctx) return null;

  const wanted = new Set();
  for (const d of plan?.days || []) for (const e of d.exercises || []) wanted.add(String(e.name).toLowerCase());

  const exercises = {};
  for (const name of wanted) {
    const hist = topSetHistory(name);
    if (!hist.length) continue;
    const last = hist[hist.length - 1];
    exercises[name] = {
      sessions: hist.length,
      latest: { weight: last.weight, reps: last.reps },
      recentTopReps: [...hist].reverse().map((h) => h.reps), // newest first
    };
  }

  return {
    workoutsLogged: ctx.workoutsLogged,
    thisWeek: ctx.thisWeek,
    weeklySessions: ctx.last8WeeksSessions,
    weeklyVolume: lastNWeeksVolume(6),
    activeLimitations: ctx.activeLimitations,
    recentPain: ctx.recentPain,
    unit: state.unit,
    exercises,
  };
}

export function addCustomFood(food = {}) {
  const n = String(food.name || "").trim();
  if (!n || state.customFoods.some((f) => f.name.toLowerCase() === n.toLowerCase())) return;
  state.customFoods.push({
    name: n,
    serving: food.serving || "1 serving",
    kcal: Math.max(0, Math.round(Number(food.kcal) || 0)),
    protein: Math.max(0, Number(food.protein) || 0),
    carbs: Math.max(0, Number(food.carbs) || 0),
    fat: Math.max(0, Number(food.fat) || 0),
  });
  persist();
}
export function getCustomFoods() {
  return state.customFoods || [];
}

export function addBodyweight({ value, date } = {}) {
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0) return { newAchievements: [] };
  state.bodyweight.push({ id: uid(), date: date || today(), value: Math.round(v * 10) / 10 });
  const unlocked = unlockAchievements();
  persist();
  return { newAchievements: unlocked };
}

export function setTargets(t) {
  state.targets = { ...state.targets, ...t };
  persist();
}

/**
 * Switch weight units (kg ⇄ lb), which also flips the whole imperial/metric
 * system used for display (water → fl oz, distance → mi). Stored weights are in
 * the active unit, so we convert all of them — bodyweight, logged set weights,
 * saved-routine weights, and cardio distances — so the numbers stay physically
 * correct rather than just being relabelled. (Water is stored canonically in ml,
 * so it needs no conversion — only display.)
 */
export function setUnit(unit) {
  const next = unit === "lb" ? "lb" : "kg";
  if (next === state.unit) return;
  const wf = next === "lb" ? 2.2046226218 : 1 / 2.2046226218; // kg⇄lb
  const df = next === "lb" ? 0.62137119 : 1.609344; // km⇄mi
  const r1 = (n, f) => (Number(n) > 0 ? Math.round(Number(n) * f * 10) / 10 : n);

  state.bodyweight = (state.bodyweight || []).map((b) => ({ ...b, value: r1(b.value, wf) }));
  if (state.targets && state.targets.weight) state.targets.weight = r1(state.targets.weight, wf);
  const convSets = (list) => {
    for (const w of list || []) {
      for (const e of w.exercises || []) {
        for (const s of e.sets || []) {
          if (s.weight) s.weight = r1(s.weight, wf);
          if (s.distance) s.distance = r1(s.distance, df);
        }
      }
    }
  };
  convSets(state.workouts);
  convSets(state.routines);

  state.unit = next;
  persist();
}

/** True when the user is on imperial (lb / fl oz / mi). */
export function isImperial() {
  return state.unit === "lb";
}

export function removeEntry(kind, id) {
  if (!state[kind]) return;
  state[kind] = state[kind].filter((x) => x.id !== id);
  persist();
}

export function resetAll() {
  state = structuredClone(DEFAULTS);
  persist();
}

// ----------------------------------------------------------------------------
// Consistency calendar
// ============================================================================
// A month grid of "did I train" and "did I hit my nutrition goals", built from
// data the store already holds. Pure functions: no DOM, no storage.
//
// WHY THE WEEKLY STREAK EXISTS
// ----------------------------
// `computeStreak` below counts consecutive CALENDAR days containing a workout,
// so a rest day breaks it. That is fine as a "days in a row" novelty and the
// achievements are built on it, but it is the wrong headline for a calendar: a
// correct 4-day split has rest days by design, so the grid would render good
// training as a broken streak and read as failure. `weeklyStreak` counts
// consecutive weeks that met the weekly session target instead, which is the
// unit lifting actually happens in.
// ----------------------------------------------------------------------------

/**
 * Did this day's nutrition hit target? Protein at or above target AND calories
 * within 10% either way.
 *
 * Water is deliberately NOT required. Most days have no water logged at all, so
 * requiring it would make "goals met" unreachable and the calendar dead on
 * arrival. It is reported separately so the UI can show it without gating.
 */
export function nutritionGoalsMet(totals, targets) {
  if (!totals || !targets) return false;
  const proteinTarget = Number(targets.protein) || 0;
  const kcalTarget = Number(targets.kcal) || 0;
  if (proteinTarget <= 0 || kcalTarget <= 0) return false;
  const proteinOk = (totals.protein || 0) >= proteinTarget;
  const kcalOk = (totals.kcal || 0) >= kcalTarget * 0.9 && (totals.kcal || 0) <= kcalTarget * 1.1;
  return proteinOk && kcalOk;
}

/** Everything the calendar needs about one day. Pure. */
export function dayStatus(dateKey) {
  const sessions = state.workouts.filter((w) => w.date === dateKey);
  const totals = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  let logged = false;
  for (const e of state.nutrition) {
    if (e.date !== dateKey) continue;
    logged = true;
    totals.kcal += e.kcal || 0;
    totals.protein += e.protein || 0;
    totals.carbs += e.carbs || 0;
    totals.fat += e.fat || 0;
  }
  const waterMl = (state.water || {})[dateKey] || 0;
  return {
    date: dateKey,
    trained: sessions.length > 0,
    sessions: sessions.length,
    volume: sessions.reduce((v, w) => v + (w.volume || 0), 0),
    loggedNutrition: logged,
    totals,
    nutritionMet: logged && nutritionGoalsMet(totals, state.targets),
    waterMl,
    waterMet: waterMl >= (state.targets.waterMl || 0) && waterMl > 0,
  };
}

/**
 * One month as a grid of weeks, Monday-first, padded with the neighbouring
 * days so every row has seven cells. `inMonth` marks the padding.
 */
export function calendarMonth(year, monthIndex) {
  const first = new Date(year, monthIndex, 1);
  const start = mondayOf(first);
  const last = new Date(year, monthIndex + 1, 0);
  const end = mondayOf(last);
  end.setDate(end.getDate() + 6);

  const todayKey = today();
  const weeks = [];
  let cursor = new Date(start);
  while (cursor <= end) {
    const week = [];
    for (let i = 0; i < 7; i++) {
      const key = ymd(cursor);
      week.push({
        ...dayStatus(key),
        day: cursor.getDate(),
        inMonth: cursor.getMonth() === monthIndex,
        isToday: key === todayKey,
        isFuture: key > todayKey,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return { year, month: monthIndex, weeks };
}

/** Sessions per week, keyed by that week's Monday. */
function sessionsByWeek(workouts) {
  const counts = new Map();
  for (const w of workouts) {
    const key = mondayOf(w.date).getTime();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

/**
 * Consecutive weeks that met the weekly session target.
 *
 * The current week is in progress, so falling short of target this week does
 * NOT break the streak — it just is not counted yet. Without that grace the
 * number would collapse to zero every Monday morning, which is exactly the kind
 * of dishonest discouragement the daily streak already produces.
 */
export function computeWeeklyStreak(workouts, weeklyTarget) {
  const target = Math.max(1, Number(weeklyTarget) || 1);
  const counts = sessionsByWeek(workouts);
  const cursor = mondayOf(new Date());

  let streak = 0;
  // Current week counts only if it has already hit target.
  if ((counts.get(cursor.getTime()) || 0) >= target) streak++;
  cursor.setDate(cursor.getDate() - 7);

  while ((counts.get(cursor.getTime()) || 0) >= target) {
    streak++;
    cursor.setDate(cursor.getDate() - 7);
  }
  return streak;
}

// ----------------------------------------------------------------------------
// Derived stats
// ----------------------------------------------------------------------------
function computeStreak(workouts) {
  const set = new Set(workouts.map((w) => w.date));
  const day = new Date();
  if (!set.has(ymd(day))) {
    day.setDate(day.getDate() - 1); // grace: streak survives until a full day is missed
    if (!set.has(ymd(day))) return 0;
  }
  let streak = 0;
  while (set.has(ymd(day))) {
    streak++;
    day.setDate(day.getDate() - 1);
  }
  return streak;
}

/** Stats that don't depend on achievement XP (so achievement tests can use them). */
function baseStats() {
  const workouts = state.workouts;
  const workoutCount = workouts.length;
  const maxSessionVolume = workouts.reduce((m, w) => Math.max(m, w.volume || 0), 0);
  const streakDays = computeStreak(workouts);

  // Nutrition aggregated per day
  const byDay = {};
  for (const e of state.nutrition) {
    (byDay[e.date] ||= { kcal: 0, protein: 0, carbs: 0, fat: 0 });
    byDay[e.date].kcal += e.kcal;
    byDay[e.date].protein += e.protein;
    byDay[e.date].carbs += e.carbs || 0;
    byDay[e.date].fat += e.fat || 0;
  }
  const nutritionDays = Object.keys(byDay).length;
  const proteinTargetDays = Object.values(byDay).filter((d) => d.protein >= state.targets.protein).length;
  // Days that met BOTH protein and calories, which is what the calendar marks.
  // proteinTargetDays above only checks protein and is kept for the existing
  // achievements and first-week review that are built on it.
  const nutritionGoalDays = Object.values(byDay).filter((d) => nutritionGoalsMet(d, state.targets)).length;

  // This week
  const weekStart = mondayOf(new Date()).getTime();
  const thisWeekWorkouts = workouts.filter((w) => mondayOf(w.date).getTime() === weekStart);
  const thisWeek = {
    sessions: thisWeekWorkouts.length,
    target: state.targets.weeklyWorkouts,
    volume: thisWeekWorkouts.reduce((v, w) => v + (w.volume || 0), 0),
  };

  // PRs (best weight per exercise)
  const prs = {};
  for (const w of workouts) for (const e of w.exercises || []) for (const s of setsOf(e)) if (s.weight > 0) prs[e.name] = Math.max(prs[e.name] || 0, s.weight);

  // Healthy-habit signals (recovery + honest logging + hydration).
  const painReportsCount = (state.painReports || []).length;
  const waterTargetDays = Object.values(state.water || {}).filter((ml) => ml >= (state.targets.waterMl || 2500)).length;

  const weeklyStreak = computeWeeklyStreak(workouts, state.targets.weeklyWorkouts);

  return { workoutCount, maxSessionVolume, streakDays, weeklyStreak, nutritionDays, proteinTargetDays, nutritionGoalDays, bodyweightCount: state.bodyweight.length, painReportsCount, waterTargetDays, thisWeek, byDay, prs };
}

function unlockAchievements() {
  const s = baseStats();
  const newly = [];
  for (const a of ACHIEVEMENTS) {
    if (!state.achievements.includes(a.id) && a.test(s)) {
      state.achievements.push(a.id);
      newly.push(a);
    }
  }
  return newly;
}

/** Last `n` weeks as [{ label, value }] for a metric ('sessions' | 'volume'). */
function weeklySeries(metric, n = 8) {
  const weeks = [];
  let m = mondayOf(new Date());
  for (let i = 0; i < n; i++) {
    weeks.unshift(new Date(m));
    m = new Date(m);
    m.setDate(m.getDate() - 7);
  }
  return weeks.map((wk) => {
    const t = wk.getTime();
    const items = state.workouts.filter((w) => mondayOf(w.date).getTime() === t);
    const value = metric === "volume" ? items.reduce((v, w) => v + (w.volume || 0), 0) : items.length;
    return { label: shortDate(wk), value };
  });
}

/** Full stats for the dashboard UI. */
export function deriveStats() {
  const s = baseStats();
  const workoutsXp = state.workouts.reduce((v, w) => v + (w.xp || 0), 0);
  const nutritionXp = s.proteinTargetDays * XP.NUTRITION_DAY;
  const achXp = achievementXp(state.achievements);
  const totalXP = workoutsXp + nutritionXp + achXp;

  // Nutrition: today + last 7 days
  const todayKey = today();
  const todayEntries = state.nutrition.filter((e) => e.date === todayKey);
  const sum = (k) => Math.round(todayEntries.reduce((v, e) => v + (e[k] || 0), 0));
  const nutritionToday = {
    kcal: sum("kcal"),
    protein: sum("protein"),
    carbs: sum("carbs"),
    fat: sum("fat"),
    targetKcal: state.targets.kcal,
    targetProtein: state.targets.protein,
    targetCarbs: state.targets.carbs,
    targetFat: state.targets.fat,
    entries: todayEntries,
  };
  const days7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const k = ymd(d);
    const day = s.byDay[k] || { kcal: 0, protein: 0 };
    days7.push({ label: shortDate(d), kcal: day.kcal, protein: day.protein });
  }

  // Bodyweight series
  const bw = [...state.bodyweight].sort((a, b) => a.date.localeCompare(b.date));
  const bodyweight = {
    series: bw.map((b) => ({ label: shortDate(b.date), value: b.value })),
    latest: bw.length ? bw[bw.length - 1].value : null,
    change: bw.length >= 2 ? Math.round((bw[bw.length - 1].value - bw[0].value) * 10) / 10 : 0,
  };

  return {
    ...s,
    totalXP,
    level: levelFor(totalXP),
    rank: rankFor(totalXP),
    weeklyVolume: weeklySeries("volume"),
    weeklySessions: weeklySeries("sessions"),
    nutritionToday,
    nutrition7d: days7,
    bodyweight,
    achievements: ACHIEVEMENTS.map((a) => ({ ...a, unlocked: state.achievements.includes(a.id) })),
    recentWorkouts: [...state.workouts].slice(-10).reverse(),
    unit: state.unit,
  };
}

// ----------------------------------------------------------------------------
// Chatbot context — compact summary the assistant can reason over
// ----------------------------------------------------------------------------
export function getContext() {
  if (!state.workouts.length && !state.nutrition.length && !state.bodyweight.length) return null;
  const d = deriveStats();
  return {
    rank: d.rank.tier.name,
    level: d.level,
    totalXP: d.totalXP,
    streakDays: d.streakDays,
    workoutsLogged: d.workoutCount,
    thisWeek: { sessions: d.thisWeek.sessions, target: d.thisWeek.target, volume: d.thisWeek.volume },
    last8WeeksSessions: d.weeklySessions.map((w) => w.value),
    recentWorkouts: d.recentWorkouts.slice(0, 6).map((w) => ({
      date: w.date,
      name: w.name,
      focus: w.focus,
      volume: w.volume,
      exercises: (w.exercises || []).map((e) => exerciseSummary(e)),
    })),
    nutritionToday: {
      kcal: d.nutritionToday.kcal,
      protein: d.nutritionToday.protein,
      carbs: d.nutritionToday.carbs,
      fat: d.nutritionToday.fat,
      targetKcal: d.nutritionToday.targetKcal,
      targetProtein: d.nutritionToday.targetProtein,
    },
    proteinTargetDays: d.proteinTargetDays,
    bodyweight: { latest: d.bodyweight.latest, change: d.bodyweight.change, unit: state.unit },
    personalRecords: d.prs,
    achievementsUnlocked: d.achievements.filter((a) => a.unlocked).map((a) => a.name),
    activeLimitations: getActiveLimitations(),
    recentPain: (state.painReports || []).slice(-5).map((r) => ({ date: r.date, location: r.location, severity: r.severity })),
  };
}

export function subscribe(cb) {
  window.addEventListener("spotter:tracker", cb);
  return () => window.removeEventListener("spotter:tracker", cb);
}
