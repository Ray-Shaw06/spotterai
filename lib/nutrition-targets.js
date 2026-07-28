/**
 * SpotterAI — nutrition targets from user stats (pure, deterministic, testable)
 * ============================================================================
 * Turns a user's stats (height, weight, age band, sex) plus how active their
 * day is and how much they train into calorie and macro targets for an explicit
 * eating intent: cut, recomp, or bulk.
 *
 * This module PRESCRIBES; nutrition-safety.js AUDITS. Keeping the two apart is
 * the point — every target produced here is expected to pass evaluateNutrition
 * with zero flags, and test/nutrition-targets.test.js sweeps the realistic stat
 * space to prove it. If that sweep ever fails, one of the two files has drifted.
 *
 * Runtime: Node 18+ / browser. ES module, no DOM, no network.
 */

import { NUTRITION_THRESHOLDS } from "../nutrition-safety.js";

/** Eating intent. kcalFactor scales TDEE; proteinPerKg sets the protein target. */
export const NUTRITION_INTENTS = [
  { value: "cut", label: "Cut", blurb: "Lose fat at a steady pace while holding onto muscle.", kcalFactor: 0.8, proteinPerKg: 1.8 },
  { value: "recomp", label: "Recomp", blurb: "Eat around maintenance, building muscle and losing fat slowly.", kcalFactor: 1.0, proteinPerKg: 1.8 },
  { value: "bulk", label: "Bulk", blurb: "Gain muscle on a small surplus, keeping fat gain low.", kcalFactor: 1.1, proteinPerKg: 1.6 },
];

/** Life outside training. Combined with training volume for the activity factor. */
export const DAILY_ACTIVITY = [
  { value: "sitting", label: "Mostly sitting", base: 1.2 },
  { value: "some", label: "On my feet some", base: 1.35 },
  { value: "onfeet", label: "On my feet all day", base: 1.5 },
];

/** Midpoints of the AGE_RANGES chips in onboarding.js. Note the en dashes. */
export const AGE_MIDPOINTS = {
  "Under 18": 17,
  "18–29": 24,
  "30–44": 37,
  "45–59": 52,
  "60+": 65,
};

const MINOR_RANGE = "Under 18";
const DEFAULT_RANGE = "30–44";

/** Shown whenever the under-18 guard holds targets at maintenance. */
export const MINOR_NOTICE =
  "During growth years SpotterAI won't set a calorie deficit. These are maintenance targets. For weight goals at your age, please talk to a doctor or a registered dietitian who knows your history.";

// Mifflin-St Jeor sex constants. The unknown case is the midpoint of the two,
// which costs about 83 kcal of precision and is reported as Medium confidence.
const SEX_CONSTANT = { male: 5, female: -161 };
const SEX_UNKNOWN = (SEX_CONSTANT.male + SEX_CONSTANT.female) / 2; // -78

const TRAINING_PER_HOUR = 0.06;
const TRAINING_CAP = 0.35;
const MULTIPLIER_MIN = 1.2;
const MULTIPLIER_MAX = 1.9;

/** Calories at which the drift nudge offers updated targets. */
export const DRIFT_KCAL = 100;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function sexConstant(sex) {
  const s = String(sex || "").toLowerCase();
  if (s === "male") return SEX_CONSTANT.male;
  if (s === "female") return SEX_CONSTANT.female;
  return SEX_UNKNOWN;
}

/** Mifflin-St Jeor resting energy. Null unless height, weight, and age are all usable. */
export function estimateBmr({ kg, cm, age, sex } = {}) {
  const w = num(kg);
  const h = num(cm);
  const a = num(age);
  if (!w || !h || !a || w <= 0 || h <= 0 || a <= 0) return null;
  return 10 * w + 6.25 * h - 5 * a + sexConstant(sex);
}

/**
 * Lifestyle base plus a training add-on, kept separate so training volume is
 * not double-counted the way a single "how active are you" question does.
 */
export function activityMultiplier({ dailyActivity, daysPerWeek, sessionLength } = {}) {
  const entry = DAILY_ACTIVITY.find((d) => d.value === dailyActivity);
  const base = entry ? entry.base : DAILY_ACTIVITY[0].base;
  const hours = ((num(daysPerWeek) || 0) * (num(sessionLength) || 0)) / 60;
  const add = Math.min(TRAINING_CAP, TRAINING_PER_HOUR * Math.max(0, hours));
  return clamp(base + add, MULTIPLIER_MIN, MULTIPLIER_MAX);
}

/** Total daily energy expenditure. Null when BMR is unavailable. */
export function estimateTdee(stats = {}) {
  const bmr = estimateBmr(stats);
  if (bmr == null) return null;
  return bmr * activityMultiplier(stats);
}
