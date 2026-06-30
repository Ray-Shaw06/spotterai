/**
 * SpotterAI — split & workout effectiveness analyzer (pure)
 * ============================================================================
 * Given a set of workouts (saved routines, plan days, or logged sessions) that
 * make up a training week, this estimates how effective the *split* is and
 * rates *each workout*. Deterministic + transparent, like the plan audit:
 * weekly sets per muscle (reusing the evaluator's volume model), training
 * frequency, push/pull + quad/ham balance, and evidence-informed flags.
 *
 * Framing matches the rest of the app: this is general guidance from volume
 * heuristics, NOT a guarantee or a prescription. Ranges are common targets,
 * not rules — individuals vary.
 */

import { computeWeeklyVolume, MUSCLE_KEYWORDS, PUSH_GROUPS, PULL_GROUPS, THRESHOLDS } from "./evaluator.js";

const MAJOR = ["chest", "back", "quads", "hamstrings", "glutes", "shoulders"];
const UPPER = ["chest", "back", "shoulders", "biceps", "triceps"];
const LOWER = ["quads", "hamstrings", "glutes", "calves"];
const OPTIMAL = { min: 10, max: 20 }; // common weekly-sets target per muscle for growth

const cap = (s) => String(s || "").charAt(0).toUpperCase() + String(s || "").slice(1);
const setCount = (e) => (Array.isArray(e.sets) ? e.sets.length : Number(e.sets) || 0);
const toPlan = (workouts) => ({ days: workouts.map((w) => ({ exercises: (w.exercises || []).map((e) => ({ name: e.name, sets: setCount(e) })) })) });
const sumGroups = (vol, gs) => gs.reduce((t, g) => t + (vol[g] || 0), 0);
// Imbalance ratio of the larger to the smaller side (Infinity if one side is 0).
const ratio = (a, b) => {
  const hi = Math.max(a, b), lo = Math.min(a, b);
  return lo <= 0 ? (hi > 0 ? Infinity : 1) : hi / lo;
};

/** Rate one workout: size, focus, and a plain-language note. */
export function analyzeWorkout(workout = {}) {
  const vol = computeWeeklyVolume(toPlan([workout]));
  const sets = (workout.exercises || []).reduce((t, e) => t + setCount(e), 0);
  const hit = Object.entries(vol).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const top = hit.slice(0, 3).map(([g]) => g);
  const groupsHit = hit.length;

  let rating, note;
  if (sets === 0) { rating = "empty"; note = "No working sets yet — add some sets to assess this one."; }
  else if (sets > 30) { rating = "too-long"; note = `${sets} sets is a very long session — later lifts suffer as fatigue builds. Consider splitting it across two days.`; }
  else if (groupsHit >= 6) { rating = "full-body"; note = `Touches ${groupsHit} muscle groups — more of a full-body day than a focused one. Great for low frequency, harder to push hard on each.`; }
  else if (sets < 8) { rating = "light"; note = `${sets} sets — a short, focused session. Fine as an accessory or time-crunched day.`; }
  else { rating = "balanced"; note = `${sets} sets, mostly ${top.join(", ")} — a focused, well-sized session.`; }
  return { name: workout.name || "Workout", sets, groupsHit, top, rating, note };
}

/**
 * Analyze a whole split (the workouts you run in a week).
 * @param {Array} workouts [{ name, exercises:[{ name, sets }] }]  (sets = array or count)
 * @param {object} [opts] { goal }
 */
export function analyzeSplit(workouts = [], opts = {}) {
  const list = Array.isArray(workouts) ? workouts.filter((w) => w && (w.exercises || []).length) : [];
  const groups = Object.keys(MUSCLE_KEYWORDS);
  const volume = computeWeeklyVolume(toPlan(list));

  // How many workouts train each muscle (≥1 set) — i.e. weekly frequency.
  const freq = {};
  for (const g of groups) freq[g] = 0;
  for (const w of list) {
    const wv = computeWeeklyVolume(toPlan([w]));
    for (const g of groups) if (wv[g] > 0) freq[g] += 1;
  }

  const push = sumGroups(volume, PUSH_GROUPS);
  const pull = sumGroups(volume, PULL_GROUPS);
  const upper = sumGroups(volume, UPPER);
  const lower = sumGroups(volume, LOWER);
  const quad = volume.quads || 0;
  const ham = volume.hamstrings || 0;

  const flags = [];
  const add = (tier, title, detail) => flags.push({ tier, title, detail });

  // Missing / under-stimulated major muscles.
  for (const g of MAJOR) {
    const v = volume[g] || 0;
    if (v === 0) add("warning", `No direct ${g} work`, `0 weekly sets for ${g}. A balanced split usually trains every major muscle.`);
    else if (v < THRESHOLDS.LOW_WEEKLY_SETS_FOR_GROWTH) add("suggestion", `${cap(g)} volume is low`, `~${v} sets/week. ${OPTIMAL.min}–${OPTIMAL.max} is a common growth target.`);
  }
  // Junk volume.
  for (const g of groups) {
    const v = volume[g] || 0;
    if (v >= THRESHOLDS.HIGH_WEEKLY_SETS_WARN) add("warning", `${cap(g)} volume is very high`, `~${v} sets/week — past ~${THRESHOLDS.HIGH_WEEKLY_SETS_WARN}, extra sets tend to add fatigue more than growth.`);
  }
  // Push / pull balance.
  if (push + pull >= THRESHOLDS.BALANCE_MIN_SETS_TO_JUDGE && ratio(push, pull) >= THRESHOLDS.BALANCE_RATIO_WARN) {
    add("suggestion", "Push/pull imbalance", `Push ${push} vs pull ${pull} sets/week. Keeping them roughly even supports posture and shoulder health.`);
  }
  // Quad / hamstring balance.
  if (quad + ham >= 6 && ratio(quad, ham) >= 2) {
    add("suggestion", "Quad/hamstring imbalance", `Quads ${quad} vs hamstrings ${ham} sets/week. Balancing them supports the knees and posterior chain.`);
  }
  // Frequency: a well-trained muscle hit only once a week.
  for (const g of MAJOR) {
    if ((volume[g] || 0) >= OPTIMAL.min && freq[g] === 1) {
      add("suggestion", `${cap(g)} trained once a week`, `Spreading ${g} over 2 sessions usually beats one big day for growth at the same weekly volume.`);
    }
  }

  const inOptimal = MAJOR.filter((g) => (volume[g] || 0) >= OPTIMAL.min && (volume[g] || 0) <= OPTIMAL.max);

  // Deterministic 0–100 effectiveness score.
  let score = 100;
  for (const f of flags) score -= f.tier === "critical" ? 20 : f.tier === "warning" ? 12 : 6;
  if (!list.length) score = 0;
  score = list.length ? Math.max(25, Math.min(100, score)) : 0;

  const perWorkout = list.map(analyzeWorkout);

  return {
    workoutCount: list.length,
    weeklySetsByMuscle: volume,
    frequencyByMuscle: freq,
    balance: { push, pull, upper, lower, quad, ham },
    flags,
    score,
    grade: score >= 85 ? "Strong" : score >= 70 ? "Solid" : score >= 50 ? "Needs work" : "Unbalanced",
    inOptimal,
    perWorkout,
    summary: summarize(list.length, flags, inOptimal),
    optimalRange: OPTIMAL,
  };
}

function summarize(count, flags, inOptimal) {
  if (!count) return "Save a few workouts (or build a plan) and SpotterAI will analyse your weekly volume, balance and frequency.";
  const warns = flags.filter((f) => f.tier === "warning").length;
  const cov = inOptimal.length
    ? `${inOptimal.length} major muscle${inOptimal.length === 1 ? "" : "s"} in the ideal weekly range`
    : "Volumes look modest — if you run these once a week, adding sets or a second session would help";
  if (warns) return `${cap(cov)}, with ${warns} thing${warns === 1 ? "" : "s"} to address below.`;
  if (flags.length) return `${cap(cov)} — plus a few small tweaks to consider below.`;
  return `Well-balanced split — every major muscle sits in a sensible weekly range. Keep progressing gradually.`;
}
