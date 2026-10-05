/**
 * SpotterAI — weekly nutrition check-in (pure)
 * ============================================================================
 * Compares a user's weight trend with the pace their goal expects and, only when
 * the trend is CONFIDENTLY outside it, proposes one small calorie change. The user
 * approves; nothing here applies anything.
 *
 * EVIDENCE. Every number in this file is graded in docs/rubric-sources.md
 * ("Nutrition pace"). A constant marked DIRECTIONAL has literature behind its
 * direction but not its exact value; PRACTICAL means no literature sets it and it
 * is a labelled design choice; DERIVED means it was set by simulating the decision
 * rule against published scale-noise levels (scripts/simulate-weight-trend.mjs).
 * Nothing here may be presented to a user as research backing.
 */

import { dayNumber, ymdFromNumber, weekdayOf } from "./lib/calendar-days.js";
import { buildPlan } from "./nutrition-plan.js";
import { completeMacros } from "./lib/nutrition-targets.js";
import { evaluateNutrition, NUTRITION_THRESHOLDS } from "./nutrition-safety.js";

/** One-sided 95% limit on the slope. DERIVED: the simulation fixes the rule's false-flag rate with it. */
export const Z95 = 1.645;

// --- Window and gate. WINDOW and the weigh-in counts are DERIVED (simulation); the rest PRACTICAL. ---
export const WINDOW_DAYS = 28;
export const MAX_WINDOW_DAYS = 42;
export const MIN_WEIGHINS = 12;
export const MIN_WEIGHINS_EXTENDED = 24;
export const MIN_WEEKDAYS = 4;
export const MIN_LOGGED_DAYS = 20;
/** Days between a target change or a proposal and the next proposal. The response is slow (Hall 2011). PRACTICAL. */
export const MIN_DAYS_BETWEEN = 28;
/** One step is 5% of the calorie target, rounded to 25. PRACTICAL: under Murphy & Koehler's 500 kcal ceiling, no finer than a food log can be trusted. */
export const STEP_PCT = 0.05;
/** Logged intake this far under target, with a scale that is not moving, means the log may be missing food. PRACTICAL. */
const LOG_DISAGREE_BELOW = 0.85;
/** How far above maintenance a raise may go. cut: never above maintenance. bulk: Iraki 2019 surplus ceiling (DIRECTIONAL). recomp: PRACTICAL. */
const MAX_ABOVE_MAINTENANCE = { cut: 1.0, recomp: 1.05, bulk: 1.2 };
const GOAL_TEXT = { cut: "Fat loss", bulk: "Hypertrophy", recomp: "General" };

/** A weight outside this range is a typo, not a weigh-in. PRACTICAL. */
const MIN_KG = 25;
const MAX_KG = 400;
/** A weigh-in this far from the window's median is dropped as a typo (80 logged as 95). PRACTICAL. */
const MAX_DEVIATION = 0.15;

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Weigh-ins inside the window as one point per day: same-date entries averaged,
 * future dates, impossible values and typos dropped.
 * @param {Array<{date: string, kg: number}>} series  kg, any order
 * @param {string} today  'YYYY-MM-DD'
 * @param {number} windowDays
 * @returns {Array<{day: number, kg: number}>} sorted by day
 */
export function prepareWeighIns(series, today, windowDays = 28) {
  const end = dayNumber(today);
  const start = end - windowDays + 1;
  const byDay = new Map();
  for (const p of series || []) {
    const kg = Number(p?.kg);
    if (!p?.date || !(kg >= MIN_KG && kg <= MAX_KG)) continue;
    const day = dayNumber(p.date);
    if (day < start || day > end) continue;
    (byDay.get(day) || byDay.set(day, []).get(day)).push(kg);
  }
  const daily = [...byDay.entries()].map(([day, kgs]) => ({ day, kg: kgs.reduce((a, b) => a + b, 0) / kgs.length }));
  if (!daily.length) return [];
  const mid = median(daily.map((d) => d.kg));
  return daily.filter((d) => Math.abs(d.kg - mid) / mid <= MAX_DEVIATION).sort((a, b) => a.day - b.day);
}

/**
 * Least-squares trend through the points, as percent of mean bodyweight per week,
 * with one-sided 95% limits. `upper` is the larger limit, `lower` the smaller.
 * Null when there are fewer than three distinct days.
 */
export function trendOf(points) {
  const n = points?.length || 0;
  if (n < 3) return null;
  const md = points.reduce((a, p) => a + p.day, 0) / n;
  const mk = points.reduce((a, p) => a + p.kg, 0) / n;
  const sxx = points.reduce((a, p) => a + (p.day - md) ** 2, 0);
  const slope = points.reduce((a, p) => a + (p.day - md) * (p.kg - mk), 0) / sxx; // kg per day
  const rss = points.reduce((a, p) => a + (p.kg - (mk + slope * (p.day - md))) ** 2, 0);
  const se = Math.sqrt(rss / (n - 2) / sxx);
  const toPct = (kgPerDay) => ((kgPerDay * 7) / mk) * 100;
  return {
    slopePctPerWeek: toPct(slope),
    upper: toPct(slope + Z95 * se),
    lower: toPct(slope - Z95 * se),
    n,
  };
}

const round25 = (n) => Math.round(n / 25) * 25;

/**
 * The pace band for a goal, in percent of bodyweight per week.
 * `min` and `max` bound the on-pace slope. For a cut `fastLimit` is the fastest
 * acceptable loss (negative) and `slowEdge` the slowest; for a bulk the reverse.
 * Cut: fast limit DIRECTIONAL (Garthe 2011, Helms 2014, Roberts 2020, ISSN, CDC),
 * 0.5% for BMI under 25 is a PRACTICAL proxy for "lean". Bulk: DIRECTIONAL and weak
 * (Iraki 2019, Helms 2023; Slater 2019 says the optimum is unknown). Every slow edge
 * and the recomp band are PRACTICAL, set at about the smallest trend a four-week
 * window can resolve. See docs/rubric-sources.md.
 */
export function paceBandFor({ intent, bmi, trainingAge } = {}) {
  if (intent === "cut") {
    const fastLimit = bmi < 25 ? -0.5 : -1.0;
    return { slowEdge: -0.25, fastLimit, min: fastLimit, max: -0.25 };
  }
  if (intent === "bulk") {
    const fastLimit = trainingAge === "Advanced" ? 0.25 : 0.5;
    return { slowEdge: 0.1, fastLimit, min: 0.1, max: fastLimit };
  }
  return { slowEdge: null, fastLimit: null, min: -0.25, max: 0.25 };
}

/** "below" or "above" only when the WHOLE confidence interval is outside the band. */
function classify(trend, band) {
  if (!trend) return "straddle";
  if (trend.upper < band.min) return "below";
  if (trend.lower > band.max) return "above";
  if (trend.slopePctPerWeek >= band.min && trend.slopePctPerWeek <= band.max) return "within";
  return "straddle";
}

/** What an off-pace trend means for this goal, and which way calories should move. */
function responseFor(intent, side) {
  if (intent === "cut") return side === "below" ? { reason: "too_fast", direction: "raise" } : { reason: "stalled", direction: "lower" };
  if (intent === "bulk") return side === "below" ? { reason: "stalled", direction: "raise" } : { reason: "too_fast", direction: "lower" };
  return side === "below" ? { reason: "too_fast", direction: "raise" } : { reason: "too_fast", direction: "lower" };
}

const weekdaysIn = (points) => new Set(points.map((p) => weekdayOf(ymdFromNumber(p.day)))).size;

/**
 * The weekly check-in. Pure; applies nothing.
 * @returns one of
 *   { status: "not_ready", reason: "no_stats"|"too_soon"|"few_weighins"|"few_weekdays"|"few_logs" }
 *   { status: "inconclusive", reason: "straddles_band"|"log_scale_disagree"|"at_limit"|"no_change_offered"|"audit" }
 *   { status: "on_track", slopePctPerWeek }
 *   { status: "propose", reason, direction, fromKcal, toKcal, targets, slopePctPerWeek, windowDays }
 */
export function checkIn({ series, days, targets, bodyStats, trainingAge, today, targetsChangedOn = null, lastProposalOn = null } = {}) {
  if (!bodyStats) return { status: "not_ready", reason: "no_stats" };

  const since = (date) => dayNumber(today) - dayNumber(date);
  if ((targetsChangedOn && since(targetsChangedOn) < MIN_DAYS_BETWEEN) || (lastProposalOn && since(lastProposalOn) < MIN_DAYS_BETWEEN)) {
    return { status: "not_ready", reason: "too_soon" };
  }

  const w28 = prepareWeighIns(series, today, WINDOW_DAYS);
  if (w28.length < MIN_WEIGHINS) return { status: "not_ready", reason: "few_weighins" };
  if (weekdaysIn(w28) < MIN_WEEKDAYS) return { status: "not_ready", reason: "few_weekdays" };

  const todayN = dayNumber(today);
  const loggedKcal = [];
  for (let i = 0; i < WINDOW_DAYS; i++) {
    const d = days?.[ymdFromNumber(todayN - i)];
    if (d) loggedKcal.push(Number(d.kcal) || 0);
  }
  if (loggedKcal.length < MIN_LOGGED_DAYS) return { status: "not_ready", reason: "few_logs" };

  const latestKg = w28[w28.length - 1].kg;
  const plan = buildPlan({ bodyStats, kg: latestKg });
  if (!plan) return { status: "not_ready", reason: "no_stats" };
  const intent = plan.intent;
  const band = paceBandFor({ intent, bmi: plan.bmi, trainingAge });

  let trend = trendOf(w28);
  let windowDays = WINDOW_DAYS;
  let side = classify(trend, band);
  if (side === "straddle") {
    // Not clear in 28 days: use up to 42 if there is enough to say more, never guess.
    const w42 = prepareWeighIns(series, today, MAX_WINDOW_DAYS);
    if (w42.length >= MIN_WEIGHINS_EXTENDED) {
      trend = trendOf(w42);
      windowDays = MAX_WINDOW_DAYS;
      side = classify(trend, band);
    }
  }
  if (side === "within") return { status: "on_track", slopePctPerWeek: trend.slopePctPerWeek };
  if (side === "straddle") return { status: "inconclusive", reason: "straddles_band" };

  const { reason, direction } = responseFor(intent, side);
  const current = Number(targets?.kcal) || 0;

  // Under 18: only ever more food, never a decrease.
  if (bodyStats.ageRange === "Under 18" && direction === "lower") return { status: "inconclusive", reason: "no_change_offered" };

  // A flat scale beside a log that sits well under target is usually a log missing food.
  const avgLogged = loggedKcal.reduce((a, b) => a + b, 0) / loggedKcal.length;
  if (reason === "stalled" && avgLogged < current * LOG_DISAGREE_BELOW) return { status: "inconclusive", reason: "log_scale_disagree" };

  const step = Math.max(25, round25(current * STEP_PCT));
  let toKcal = direction === "raise" ? current + step : current - step;
  if (direction === "raise") {
    toKcal = Math.min(toKcal, round25(plan.tdee * MAX_ABOVE_MAINTENANCE[intent]));
    if (toKcal <= current) return { status: "inconclusive", reason: "at_limit" };
  } else {
    // Never chase a plateau downward: not below the starting plan (a bulk may come down to maintenance), and never under the floor.
    const lowest = intent === "bulk" ? round25(plan.tdee) : plan.targets.kcal;
    const floor = Math.max(NUTRITION_THRESHOLDS.LOW_KCAL, plan.bmr);
    if (toKcal < lowest || toKcal < floor) return { status: "inconclusive", reason: "at_limit" };
  }

  const macros = completeMacros({ kcal: toKcal, protein: targets.protein });
  if (!macros) return { status: "inconclusive", reason: "audit" };
  const proposed = { kcal: toKcal, protein: macros.protein, carbs: macros.carbs, fat: macros.fat };
  const flags = evaluateNutrition({ targets: proposed, bodyweight: latestKg, unit: "kg", goal: GOAL_TEXT[intent], maintenance: plan.tdee }).flags;
  if (flags.length) return { status: "inconclusive", reason: "audit" };

  return { status: "propose", reason, direction, fromKcal: current, toKcal, targets: proposed, slopePctPerWeek: trend.slopePctPerWeek, windowDays };
}
