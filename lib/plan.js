/**
 * Shared plan helpers for the serverless functions.
 * ----------------------------------------------------------------------------
 * The plan JSON shape, plus parse / validate / normalize utilities, live here so
 * BOTH /api/generate (fresh plans) and /api/adapt (re-tuned plans) agree on
 * exactly one schema. Change the plan shape in ONE place.
 *
 * Runtime: Node 18+. CommonJS so it works without a build step.
 */

// The exact JSON shape we want back, shown to the model in the prompt. We
// enforce JSON via `responseMimeType: "application/json"` plus this explicit
// schema in the prompt, and parse/validate/retry to catch any drift.
const SCHEMA_HINT = `{
  "program_name": string,
  "goal": string,
  "days_per_week": number,
  "days": [
    {
      "day": string,                // e.g. "Day 1"
      "focus": string,              // e.g. "Upper Body" or "Rest"
      "exercises": [
        {
          "name": string,
          "sets": number,
          "reps": string,           // e.g. "8-12", "5", or "30s"
          "rpe": number | null,     // 6-10, or null for warm-up/mobility
          "notes": string
        }
      ]
    }
  ],
  "progression": string,
  "general_notes": string
}`;

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Remove markdown code fences (```json ... ```) and grab the outermost JSON
 * object, then attempt to parse. Returns the parsed object or null.
 */
function extractJson(raw) {
  if (!raw || typeof raw !== "string") return null;

  // Strip ```json ... ``` or ``` ... ``` fences if the model added them.
  let text = raw.trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  // As a last resort, slice from the first "{" to the last "}".
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    text = text.slice(first, last + 1);
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Shallow structural validation of the plan. We only confirm the shape the UI
 * and evaluator depend on; we do NOT grade the training content here (that is
 * the evaluator's job, client-side).
 */
function isValidPlan(plan) {
  if (!plan || typeof plan !== "object") return false;
  if (typeof plan.program_name !== "string") return false;
  if (!Array.isArray(plan.days) || plan.days.length === 0) return false;

  return plan.days.every(
    (day) =>
      day &&
      typeof day.focus === "string" &&
      Array.isArray(day.exercises) &&
      day.exercises.every((ex) => ex && typeof ex.name === "string" && ex.sets !== undefined && ex.reps !== undefined)
  );
}

/** Normalize a validated plan so optional fields always exist for the client. */
function normalizePlan(plan, inputs = {}) {
  return {
    program_name: plan.program_name || "Custom Training Program",
    goal: plan.goal || inputs.goal || "General fitness",
    days_per_week: Number(plan.days_per_week) || plan.days.length,
    days: plan.days.map((day) => ({
      day: String(day.day || ""),
      focus: String(day.focus || ""),
      exercises: (day.exercises || []).map((ex) => ({
        name: String(ex.name || "Exercise"),
        sets: Number(ex.sets) || 0,
        reps: String(ex.reps ?? ""),
        rpe: ex.rpe === null || ex.rpe === undefined ? null : Number(ex.rpe),
        notes: String(ex.notes || ""),
      })),
    })),
    progression: String(plan.progression || ""),
    general_notes: String(plan.general_notes || ""),
  };
}

module.exports = { SCHEMA_HINT, clampNumber, extractJson, isValidPlan, normalizePlan };
