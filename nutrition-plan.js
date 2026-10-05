/**
 * SpotterAI — nutrition plan (pure)
 * ============================================================================
 * Body stats in, an explained calorie and macro plan out. This file decides what
 * a plan says; nutrition-plan-ui.js only draws it. The arithmetic lives in
 * lib/nutrition-targets.js, which PRESCRIBES, while nutrition-safety.js AUDITS.
 *
 * Everything here is deterministic and runs in the browser, and the stats it
 * reads never leave the device unless the user has opted into sync.
 */

import { AGE_RANGES, GOAL_OPTIONS } from "./onboarding.js";
import { DAILY_ACTIVITY, NUTRITION_INTENTS, calculateTargets, intentForGoal } from "./lib/nutrition-targets.js";

const num = (v) => (v === "" || v == null ? NaN : Number(v));

/**
 * Check and normalise body stats from a form or a backup.
 * @returns {{ ok: boolean, errors: string[], value: object|null }}
 */
export function validateBodyStats(rawInput = {}) {
  // Anything that is not an object (a corrupted backup, a bad sync value) reads as empty.
  const input = rawInput && typeof rawInput === "object" && !Array.isArray(rawInput) ? rawInput : {};
  const errors = [];
  const heightCm = num(input.heightCm);
  if (!Number.isFinite(heightCm) || heightCm < 100 || heightCm > 250) errors.push("heightCm: height must be between 100 and 250 cm");

  const ageRange = String(input.ageRange ?? "");
  if (!AGE_RANGES.includes(ageRange)) errors.push("ageRange: pick an age range");

  // Sex is optional. "Prefer not to say" is the chip label and means blank.
  const rawSex = String(input.sex ?? "");
  const sex = rawSex === "Male" || rawSex === "Female" ? rawSex : rawSex === "" || rawSex === "Prefer not to say" ? "" : null;
  if (sex === null) errors.push("sex: use Male, Female, or leave it blank");

  const dailyActivity = String(input.dailyActivity ?? "");
  if (!DAILY_ACTIVITY.some((d) => d.value === dailyActivity)) errors.push("dailyActivity: pick how active your day is");

  const daysPerWeek = num(input.daysPerWeek);
  if (!Number.isInteger(daysPerWeek) || daysPerWeek < 0 || daysPerWeek > 7) errors.push("daysPerWeek: training days must be 0 to 7");

  // With no training days a session length means nothing, so 0 is allowed.
  const sessionLength = num(input.sessionLength);
  const noTraining = daysPerWeek === 0 && (sessionLength === 0 || !Number.isFinite(sessionLength));
  if (!noTraining && (!Number.isFinite(sessionLength) || sessionLength < 15 || sessionLength > 180)) errors.push("sessionLength: session length must be 15 to 180 minutes");

  const intent = String(input.intent ?? "");
  if (!NUTRITION_INTENTS.some((i) => i.value === intent)) errors.push("intent: pick cut, recomp, or bulk");

  if (errors.length) return { ok: false, errors, value: null };
  return {
    ok: true,
    errors: [],
    value: { heightCm, ageRange, sex, dailyActivity, daysPerWeek, sessionLength: noTraining ? 0 : sessionLength, intent },
  };
}

const LIMITATIONS =
  "These are estimates, not measurements. Your own weight trend over several weeks is a better guide, and the weekly check-in adjusts from it.";

/**
 * The explained plan for a set of stats, or null when there is not enough to
 * calculate one (the caller then falls back to the bodyweight-only suggestion).
 * @param {{ bodyStats: object|null, kg: number|null }} input
 */
export function buildPlan({ bodyStats, kg } = {}) {
  if (!bodyStats || !(Number(kg) > 0)) return null;
  const t = calculateTargets({
    kg: Number(kg),
    cm: bodyStats.heightCm,
    ageRange: bodyStats.ageRange,
    sex: bodyStats.sex,
    dailyActivity: bodyStats.dailyActivity,
    daysPerWeek: bodyStats.daysPerWeek,
    sessionLength: bodyStats.sessionLength,
    intent: bodyStats.intent,
  });
  if (!t) return null;
  return {
    targets: { kcal: t.kcal, protein: t.protein, carbs: t.carbs, fat: t.fat },
    tdee: t.tdee,
    bmr: t.bmr,
    bmi: t.bmi,
    deficitKcal: t.deficitKcal,
    effectiveDeficitKcal: t.effectiveDeficitKcal,
    floorBound: t.floorBound,
    intent: t.intent,
    requestedIntent: t.requestedIntent,
    confidence: t.confidence,
    basis: t.basis,
    notice: t.notice,
    proteinPerKg: Math.round((t.protein / Number(kg)) * 10) / 10,
    limitations: LIMITATIONS,
  };
}

/** The maintenance calories to hand the auditor, or null when no plan can be built. */
export function maintenanceFor(bodyStats, kg) {
  return buildPlan({ bodyStats, kg })?.tdee ?? null;
}

/**
 * Setup-sheet defaults from the training plan the user already has. Unknown goals
 * land on recomp: nobody is guessed into a deficit.
 */
export function prefillFromInputs(inputs) {
  const goal = GOAL_OPTIONS.find((g) => g.goal === inputs?.goal);
  return {
    daysPerWeek: Number(inputs?.daysPerWeek) || 3,
    sessionLength: Number(inputs?.sessionLength) || 45,
    intent: intentForGoal(goal?.value),
  };
}
