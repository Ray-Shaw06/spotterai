/**
 * Shared plan helpers for the serverless functions.
 * ----------------------------------------------------------------------------
 * The plan JSON shape, plus parse / validate / normalize utilities, live here so
 * /api/generate (fresh plans) and the client-side adapt engine (re-tuned plans)
 * agree on exactly one schema. Change the plan shape in ONE place.
 *
 * Runtime: Node 18+. ES module (matches the rest of the codebase).
 */

import { isCardioExercise } from "../exercise-catalog.js";

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
          "notes": string,
          "type": "lift" | "cardio",        // omit for lifts
          "durationMin": number | null,     // cardio only, minutes
          "intensity": "easy" | "moderate" | "hard" | null  // cardio only
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

const INTENSITIES = new Set(["easy", "moderate", "hard"]);

/**
 * Is this entry cardio? An explicit `type` wins; otherwise the catalog decides
 * from the name.
 *
 * The inference is what makes this backward compatible. Every plan already
 * saved, and every model response that ignores the new field, still gets its
 * runs and rows recognised on read, so there is no migration and no plan that
 * silently loses its conditioning work.
 */
function isCardioEntry(ex) {
  if (ex && typeof ex.type === "string") return ex.type.toLowerCase() === "cardio";
  return isCardioExercise(ex?.name);
}

/**
 * Minutes for a cardio entry. Prefers the explicit field, then falls back to
 * reading a duration out of `reps` ("30 min", "45min"), which is how a model
 * that has not been told about `durationMin` expresses the same thing.
 */
const MAX_CARDIO_MIN = 600; // ten hours; past this the model is hallucinating, not coaching

function cardioMinutes(ex) {
  // Clamped, because this number comes from the model and is rendered straight
  // to the user and summed into the weekly total. Everything else this file
  // reads off an LLM response is bounded (clampNumber, the intensity set); an
  // unbounded "durationMin": 100000 would print as a 100000 minute run.
  const clamp = (n) => Math.min(MAX_CARDIO_MIN, Math.max(1, Math.round(n)));
  const explicit = Number(ex?.durationMin);
  if (Number.isFinite(explicit) && explicit > 0) return clamp(explicit);
  const text = String(ex?.reps ?? "").toLowerCase();
  const match = text.match(/(\d+)\s*(?:min|minute|m)\b/);
  if (match) return clamp(Number(match[1]));
  // A bare number on a cardio entry reads as minutes; "8-12 reps" of a run is
  // not a thing, so the alternative is discarding a real prescription.
  const bare = text.match(/^\s*(\d+)\s*$/);
  return bare ? clamp(Number(bare[1])) : 0;
}

/** One exercise, normalized. Cardio carries duration and intensity; lifts do not. */
function normalizeExercise(ex) {
  const base = {
    name: String(ex.name || "Exercise"),
    sets: Number(ex.sets) || 0,
    reps: String(ex.reps ?? ""),
    rpe: ex.rpe === null || ex.rpe === undefined ? null : Number(ex.rpe),
    notes: String(ex.notes || ""),
  };
  if (!isCardioEntry(ex)) return base;

  const intensity = String(ex.intensity || "").toLowerCase();
  return {
    ...base,
    // Cardio is one continuous effort, not a set count. Zero or a stray count
    // both normalize to 1 so per-session set maths cannot be skewed by it.
    sets: Math.max(1, Number(ex.sets) || 1),
    type: "cardio",
    durationMin: cardioMinutes(ex) || null,
    intensity: INTENSITIES.has(intensity) ? intensity : null,
  };
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
      exercises: (day.exercises || []).map(normalizeExercise),
    })),
    progression: String(plan.progression || ""),
    general_notes: String(plan.general_notes || ""),
  };
}

export { SCHEMA_HINT, clampNumber, extractJson, isValidPlan, normalizePlan, isCardioEntry, cardioMinutes };
