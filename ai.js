/**
 * SpotterAI — AI estimate client
 * ============================================================================
 * Thin wrapper over the /api/estimate serverless function so the nutrition and
 * workout UIs can turn free text into structured data:
 *   - estimateFood("2 egg & cheese omelettes") -> { name, serving, kcal, ... }
 *   - classifyExercise("hammer strength row")  -> { name, muscle, equipment, cardio }
 *
 * Both reject on any failure (offline static preview, rate limit, overload) so
 * callers can fall back to manual entry. The API key stays server-side.
 */

async function estimate(kind, query, signal) {
  const res = await fetch("api/estimate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, query }),
    signal,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(data.error || `Estimate failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/** Estimate calories + macros for any food described in plain language. */
export async function estimateFood(query, signal) {
  const { food } = await estimate("food", query, signal);
  if (!food) throw new Error("No estimate returned");
  return food;
}

/** Classify any exercise name into { muscle, equipment, cardio }. */
export async function classifyExercise(query, signal) {
  const { exercise } = await estimate("exercise", query, signal);
  if (!exercise) throw new Error("No classification returned");
  return exercise;
}
