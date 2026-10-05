/**
 * SpotterAI — nutrition consistency streaks (pure)
 * ============================================================================
 * Three runs you can verify from your own log: protein target hit, calories in
 * range, and days logged. Each reports the current run, your best run, and how
 * many of the last seven days counted.
 *
 * WHY THESE THREE AND NOT A "CLEAN EATING" COUNTER. Every number here is a
 * target YOU set, compared with what YOU logged. The app never decides a food
 * is good or bad, and a day that misses is simply not counted: nothing is
 * "lost", nothing resets a score you were proud of. The seven-day figure
 * exists so one gap never erases the picture, and the best run stays on the
 * screen after a run ends. That is the line between a consistency tracker and
 * the food-moralizing counters that push people toward restrict-and-binge
 * cycles, which core_values.md section 4 rules out for this product.
 *
 * Pure and DOM-free, the same shape as catch-up.js and welcome-back.js.
 */

import { evaluateNutrition } from "./nutrition-safety.js";
import { dayNumber, ymdFromNumber } from "./lib/calendar-days.js";

/** Calories count as in range within this share of the target, either side.
 *  The same band `nutritionGoalsMet` uses; a test pins the two together. */
export const KCAL_BAND = 0.1;

export const KINDS = Object.freeze(["protein", "calories", "logged"]);

const WINDOW = 7;

/** Did this day count for this kind? `day` is that date's logged totals, or undefined. */
export function dayMet(kind, day, targets = {}) {
  if (!day) return false;
  const kcalTarget = Number(targets.kcal) || 0;
  const proteinTarget = Number(targets.protein) || 0;
  if (kind === "logged") return true;
  if (kind === "protein") return proteinTarget > 0 && (day.protein || 0) >= proteinTarget;
  if (kind === "calories") {
    if (kcalTarget <= 0) return false;
    const kcal = day.kcal || 0;
    return kcal >= kcalTarget * (1 - KCAL_BAND) && kcal <= kcalTarget * (1 + KCAL_BAND);
  }
  return false;
}

function streakFor(kind, days, targets, today) {
  const todayN = dayNumber(today);
  const met = (n) => dayMet(kind, days[ymdFromNumber(n)], targets);

  // Today only counts once it is met. An unmet today is still in progress, so
  // it neither adds to the run nor ends it: nobody sees 0 at nine in the morning.
  const end = met(todayN) ? todayN : todayN - 1;

  let current = 0;
  for (let n = end; met(n); n--) current++;

  // Best run over the whole record. Walk the met dates in order and count
  // consecutive day numbers.
  const metDays = Object.keys(days)
    .filter((d) => dayMet(kind, days[d], targets))
    .map(dayNumber)
    .sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  let prev = null;
  for (const n of metDays) {
    run = prev != null && n === prev + 1 ? run + 1 : 1;
    if (run > best) best = run;
    prev = n;
  }

  // Seven days ending at `end`, oldest first, so the dots read left to right.
  const week = [];
  for (let n = end - (WINDOW - 1); n <= end; n++) week.push(met(n));
  return { current, best, last7: week.filter(Boolean).length, week };
}

/**
 * @param {object} snapshot
 * @param {Object<string, {kcal:number, protein:number}>} snapshot.days  logged totals keyed by YYYY-MM-DD
 * @param {{kcal?:number, protein?:number}} snapshot.targets
 * @param {string} snapshot.today                    YYYY-MM-DD
 * @param {boolean} [snapshot.hideCalories]          targets trip a critical nutrition flag
 * @returns {null | { protein: object|null, calories: object|null, logged: object }}
 *   null when nothing has ever been logged, so a new user sees no card at all.
 */
export function computeStreaks({ days = {}, targets = {}, today, hideCalories = false } = {}) {
  if (!today || !Object.keys(days).length) return null;
  const hasProtein = Number(targets.protein) > 0;
  const hasKcal = Number(targets.kcal) > 0;
  return {
    protein: hasProtein ? streakFor("protein", days, targets, today) : null,
    // Never reward a dangerously low target: with a critical flag on the
    // calories, the in-range run is not shown at all.
    calories: hasKcal && !hideCalories ? streakFor("calories", days, targets, today) : null,
    logged: streakFor("logged", days, targets, today),
  };
}

/**
 * The one entry both screens call. Resolves "does this target trip a critical
 * nutrition flag" the same way the Food diary's safety card does, so the two
 * can never disagree about whether the calorie run is shown.
 */
export function streaksFor({ days, targets, today, bodyweight = null, unit = "kg", goal = "" } = {}) {
  const hideCalories = evaluateNutrition({ targets, bodyweight, unit, goal }).flags.some((f) => f.tier === "critical");
  return computeStreaks({ days, targets, today, hideCalories });
}
