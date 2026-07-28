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

const FAT_PCT = 0.25;
const FAT_PCT_MIN = 0.2;
const CARB_PCT_MIN = 0.1;
const PROTEIN_PCT_MAX = 0.4;

const round25 = (n) => Math.round(n / 25) * 25;

/**
 * Protein first (it protects muscle in a deficit), then fat at a fixed share,
 * with carbs taking the remainder. Two guards cover the tails: if carbs would
 * fall under CARB_PCT_MIN we walk fat down toward FAT_PCT_MIN to make room, and
 * protein is capped at PROTEIN_PCT_MAX so carbs can never go negative. The cap
 * is unreachable for a real body given the calorie floor, but it means the
 * arithmetic is total rather than merely usually right.
 */
function splitMacros(kcal, kg, proteinPerKg) {
  const proteinKcal = Math.min(proteinPerKg * kg * 4, kcal * PROTEIN_PCT_MAX);
  let fatKcal = kcal * FAT_PCT;
  let carbKcal = kcal - proteinKcal - fatKcal;
  const minCarbKcal = kcal * CARB_PCT_MIN;
  if (carbKcal < minCarbKcal) {
    fatKcal = Math.max(kcal * FAT_PCT_MIN, kcal - proteinKcal - minCarbKcal);
    carbKcal = kcal - proteinKcal - fatKcal;
  }
  return {
    protein: Math.round(proteinKcal / 4),
    carbs: Math.round(Math.max(0, carbKcal) / 4),
    fat: Math.round(fatKcal / 9),
  };
}

function basisLine(tdee, applied, isMinor) {
  const maint = `Around ${round25(tdee).toLocaleString("en-US")} kcal maintenance`;
  if (isMinor) return `${maint}, held level during growth years.`;
  if (applied.value === "cut") return `${maint}, minus 20% for a cut.`;
  if (applied.value === "bulk") return `${maint}, plus 10% for a lean bulk.`;
  return `${maint}, held level for a recomp.`;
}

/**
 * Calorie and macro targets for a set of stats and an eating intent.
 * Returns null when height or weight is missing, so callers can fall back to
 * the bodyweight-only saferTargets() suggestion.
 */
export function calculateTargets({ kg, cm, ageRange, sex, dailyActivity, daysPerWeek, sessionLength, intent } = {}) {
  const w = num(kg);
  const h = num(cm);
  if (!w || !h || w <= 0 || h <= 0) return null;

  const age = AGE_MIDPOINTS[ageRange] ?? AGE_MIDPOINTS[DEFAULT_RANGE];
  const bmr = estimateBmr({ kg: w, cm: h, age, sex });
  if (bmr == null) return null;

  const multiplier = activityMultiplier({ dailyActivity, daysPerWeek, sessionLength });
  const tdee = bmr * multiplier;

  // Growth years: never a deficit, whatever was asked for.
  const isMinor = ageRange === MINOR_RANGE;
  const asked = NUTRITION_INTENTS.find((i) => i.value === intent) || NUTRITION_INTENTS[1];
  const applied = isMinor ? NUTRITION_INTENTS.find((i) => i.value === "recomp") : asked;

  const kcal = round25(Math.max(NUTRITION_THRESHOLDS.LOW_KCAL, bmr, tdee * applied.kcalFactor));
  const { protein, carbs, fat } = splitMacros(kcal, w, applied.proteinPerKg);

  return {
    kcal, protein, carbs, fat,
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    multiplier: Math.round(multiplier * 100) / 100,
    intent: applied.value,
    requestedIntent: asked.value,
    confidence: /^(male|female)$/i.test(String(sex || "")) ? "High" : "Medium",
    basis: basisLine(tdee, applied, isMinor),
    notice: isMinor ? MINOR_NOTICE : null,
  };
}

// Training goal (GOAL_OPTIONS in onboarding.js) to a default eating intent.
// Anything unrecognised lands on recomp: never guess someone into a deficit.
const GOAL_INTENT = { fatloss: "cut", muscle: "bulk", strength: "recomp", general: "recomp", consistency: "recomp" };

/** The eating intent to pre-select for a training goal. Always overridable. */
export function intentForGoal(goalValue) {
  return GOAL_INTENT[goalValue] || "recomp";
}

/**
 * Has the stats-derived target drifted far enough from the saved one to be
 * worth offering an update? Signed delta so the UI can say which way.
 */
export function targetsDrift(current, calculated) {
  const a = num(current?.kcal);
  const b = num(calculated?.kcal);
  if (!a || !b) return { drifted: false, deltaKcal: 0 };
  const deltaKcal = b - a;
  return { drifted: Math.abs(deltaKcal) >= DRIFT_KCAL, deltaKcal };
}
