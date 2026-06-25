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

const DEFAULTS = {
  workouts: [], // { id, date 'YYYY-MM-DD', name, focus, exercises:[{name,sets,reps,weight}], volume, xp }
  nutrition: [], // { id, date, name, kcal, protein }
  bodyweight: [], // { id, date, value }
  targets: { kcal: 2200, protein: 140, weeklyWorkouts: 4 },
  achievements: [], // unlocked ids
  unit: "kg",
};

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
    updatedAt: incoming.updatedAt || Date.now(),
  };
  persist(false); // preserve the incoming timestamp
  return true;
}

// ----------------------------------------------------------------------------
// Date helpers (local time)
// ----------------------------------------------------------------------------
function ymd(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}
function today() {
  return ymd(new Date());
}
function mondayOf(d) {
  const x = new Date(d);
  const dow = (x.getDay() + 6) % 7; // Mon=0
  x.setDate(x.getDate() - dow);
  x.setHours(0, 0, 0, 0);
  return x;
}
function shortDate(d) {
  const x = new Date(d);
  return `${x.getMonth() + 1}/${x.getDate()}`;
}
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ----------------------------------------------------------------------------
// Mutations
// ----------------------------------------------------------------------------
export function addWorkout({ name, focus, exercises = [], date } = {}) {
  const clean = exercises
    .map((e) => ({
      name: String(e.name || "Exercise"),
      sets: Number(e.sets) || 0,
      reps: Number(e.reps) || 0,
      weight: Number(e.weight) || 0,
    }))
    .filter((e) => e.name);
  const volume = clean.reduce((v, e) => v + e.sets * e.reps * e.weight, 0);
  const workout = {
    id: uid(),
    date: date || today(),
    name: String(name || "Workout"),
    focus: String(focus || ""),
    exercises: clean,
    volume: Math.round(volume),
    xp: workoutXp(volume),
  };
  state.workouts.push(workout);
  const unlocked = unlockAchievements();
  persist();
  return { workout, newAchievements: unlocked };
}

export function addNutrition({ name, kcal, protein, date } = {}) {
  const entry = {
    id: uid(),
    date: date || today(),
    name: String(name || "Food"),
    kcal: Math.max(0, Math.round(Number(kcal) || 0)),
    protein: Math.max(0, Math.round(Number(protein) || 0)),
  };
  state.nutrition.push(entry);
  const unlocked = unlockAchievements();
  persist();
  return { entry, newAchievements: unlocked };
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

export function setUnit(unit) {
  state.unit = unit === "lb" ? "lb" : "kg";
  persist();
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
    (byDay[e.date] ||= { kcal: 0, protein: 0 });
    byDay[e.date].kcal += e.kcal;
    byDay[e.date].protein += e.protein;
  }
  const nutritionDays = Object.keys(byDay).length;
  const proteinTargetDays = Object.values(byDay).filter((d) => d.protein >= state.targets.protein).length;

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
  for (const w of workouts) for (const e of w.exercises) if (e.weight > 0) prs[e.name] = Math.max(prs[e.name] || 0, e.weight);

  return { workoutCount, maxSessionVolume, streakDays, nutritionDays, proteinTargetDays, bodyweightCount: state.bodyweight.length, thisWeek, byDay, prs };
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
  const nutritionToday = {
    kcal: todayEntries.reduce((v, e) => v + e.kcal, 0),
    protein: todayEntries.reduce((v, e) => v + e.protein, 0),
    targetKcal: state.targets.kcal,
    targetProtein: state.targets.protein,
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
      exercises: w.exercises.map((e) => `${e.name} ${e.sets}x${e.reps}${e.weight ? ` @${e.weight}${state.unit}` : ""}`),
    })),
    nutritionToday: { kcal: d.nutritionToday.kcal, protein: d.nutritionToday.protein, targetKcal: d.nutritionToday.targetKcal, targetProtein: d.nutritionToday.targetProtein },
    proteinTargetDays: d.proteinTargetDays,
    bodyweight: { latest: d.bodyweight.latest, change: d.bodyweight.change, unit: state.unit },
    personalRecords: d.prs,
    achievementsUnlocked: d.achievements.filter((a) => a.unlocked).map((a) => a.name),
  };
}

export function subscribe(cb) {
  window.addEventListener("spotter:tracker", cb);
  return () => window.removeEventListener("spotter:tracker", cb);
}
