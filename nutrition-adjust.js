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

import { dayNumber } from "./lib/calendar-days.js";

/** One-sided 95% limit on the slope. DERIVED: the simulation fixes the rule's false-flag rate with it. */
export const Z95 = 1.645;

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
