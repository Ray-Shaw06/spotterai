/**
 * SpotterAI — audit telemetry allow-list (pure)
 * ============================================================================
 * The allow-list IS the privacy design. Output is built by copying known keys
 * onto a fresh object, never by deleting unknown ones from the input, so a
 * field nobody anticipated cannot reach storage even if the client sends it.
 *
 * Rejected outright (returns null): a bad enum, a bad count, an unknown check
 * id or status. Silently dropped: any key not on this list.
 *
 * Shared by the browser and api/audit-telemetry.js so the sender and the
 * receiver cannot disagree about what is collectable.
 */

import { INJURY_RULES } from "../evaluator.js";

export const TELEMETRY_VERSION = 1;

export const SOURCES = Object.freeze(["generate", "import", "adapt"]);
export const SCORE_BUCKETS = Object.freeze(["0-59", "60-74", "75-84", "85-100"]);

// Mirrors GOAL_OPTIONS / TRAINING_AGE_OPTIONS in onboarding.js. Pinned by test.
export const GOALS = Object.freeze(["Hypertrophy", "Strength", "Fat loss", "General"]);
export const EXPERIENCES = Object.freeze(["Beginner", "Intermediate", "Advanced"]);

export const CHECK_STATUSES = Object.freeze(["pass", "warn", "fail", "not_assessed"]);

/** The eleven fixed ids in evaluator.js, plus its structural failure id. */
export const BASE_CHECK_IDS = Object.freeze([
  "rest_days", "weekly_volume", "muscle_balance", "beginner_load", "goal_fit",
  "progressive_overload", "leg_balance", "muscle_frequency", "equipment_fit",
  "session_load", "coverage", "invalid_plan",
]);

/**
 * Injury check ids are generated at evaluator.js:495 as `injury_${key}`, so
 * they are DERIVED here rather than listed. A hardcoded list would silently go
 * stale the day a new injury rule is added, and the new check's data would be
 * dropped without anyone noticing.
 */
export const CHECK_IDS = Object.freeze([
  ...BASE_CHECK_IDS,
  ...Object.keys(INJURY_RULES).map((key) => `injury_${key}`),
]);

const MAX_DAYS = 7;
const MAX_EXERCISES = 140; // 7 days x the 20/day ceiling enforced in api/import.js
// Exported so boundary tests assert against the real limit rather than a
// copy-pasted literal that could silently drift from this one.
export const MAX_CHECKS = 40;

/** Bucket a raw score client-side. The raw number is never transmitted. */
export function scoreBucket(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return null;
  if (n < 60) return "0-59";
  if (n < 75) return "60-74";
  if (n < 85) return "75-84";
  return "85-100";
}

const isCount = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

/**
 * @param {unknown} input
 * @returns {object|null} a freshly built, allow-listed object, or null
 */
export function sanitizeTelemetry(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;

  if (input.v !== TELEMETRY_VERSION) return null;
  if (typeof input.evaluatorVersion !== "string" || !/^v\d+\.\d+\.\d+$/.test(input.evaluatorVersion)) return null;
  if (!SOURCES.includes(input.source)) return null;
  if (!SCORE_BUCKETS.includes(input.scoreBucket)) return null;
  if (!GOALS.includes(input.goal)) return null;
  if (!EXPERIENCES.includes(input.experience)) return null;
  if (!isCount(input.daysCount, 1, MAX_DAYS)) return null;
  if (!isCount(input.exerciseCount, 0, MAX_EXERCISES)) return null;

  if (!Array.isArray(input.checks) || input.checks.length === 0 || input.checks.length > MAX_CHECKS) return null;
  const checks = [];
  for (const entry of input.checks) {
    if (!entry || typeof entry !== "object") return null;
    if (!CHECK_IDS.includes(entry.id)) return null;
    if (!CHECK_STATUSES.includes(entry.status)) return null;
    checks.push({ id: entry.id, status: entry.status });
  }

  return {
    v: TELEMETRY_VERSION,
    evaluatorVersion: input.evaluatorVersion,
    source: input.source,
    scoreBucket: input.scoreBucket,
    daysCount: input.daysCount,
    exerciseCount: input.exerciseCount,
    goal: input.goal,
    experience: input.experience,
    checks,
  };
}
