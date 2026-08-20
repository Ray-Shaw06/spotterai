/**
 * SpotterAI — audit telemetry sender
 * ============================================================================
 * Turns a completed audit into the allow-listed payload and fires it at
 * /api/audit-telemetry. Fire-and-forget: every failure path returns false and
 * nothing is ever surfaced to the user mid-audit.
 *
 * The payload is validated against the SAME sanitizer the server runs, so a
 * payload that would be silently dropped server-side is caught here instead of
 * being sent into a void.
 */

import { EVALUATOR_VERSION } from "./evaluator.js";
import { sanitizeTelemetry, scoreBucket, TELEMETRY_VERSION } from "./lib/telemetry-schema.js";

const ENDPOINT = "/api/audit-telemetry";

/**
 * Defaults for the no-profile paths. Someone who pasted a plan never onboarded,
 * so their goal and experience are genuinely unknown; "General" and "Beginner"
 * are what the evaluator itself assumes for them, and matching that keeps the
 * telemetry consistent with the audit it describes.
 */
const DEFAULT_GOAL = "General";
const DEFAULT_EXPERIENCE = "Beginner";

export function buildTelemetryPayload(audit, plan, inputs, source) {
  if (!audit || !Array.isArray(audit.checks) || audit.checks.length === 0) return null;
  if (!plan || !Array.isArray(plan.days)) return null;

  const bucket = scoreBucket(audit.score);
  if (!bucket) return null;

  const payload = {
    v: TELEMETRY_VERSION,
    evaluatorVersion: EVALUATOR_VERSION,
    source,
    scoreBucket: bucket,
    daysCount: plan.days.length,
    exerciseCount: plan.days.reduce((n, day) => n + (day.exercises?.length || 0), 0),
    goal: inputs?.goal || DEFAULT_GOAL,
    experience: inputs?.experience || DEFAULT_EXPERIENCE,
    checks: audit.checks.map((check) => ({ id: check.id, status: check.status })),
  };

  // The server would drop an invalid payload silently, which would make a
  // client-side bug invisible. Validating here means a bad payload never gets
  // sent at all.
  return sanitizeTelemetry(payload);
}

export function sendAuditTelemetry(audit, plan, inputs, source) {
  const payload = buildTelemetryPayload(audit, plan, inputs, source);
  if (!payload) return false;
  try {
    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    return navigator.sendBeacon(ENDPOINT, blob) === true;
  } catch {
    return false;
  }
}
