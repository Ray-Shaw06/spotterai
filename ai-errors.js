const COPY = {
  offline: "You're offline. Reconnect and try again.",
  timeout: "That took longer than expected. Your inputs are still here—try once more.",
  rate_limited: "The coach is busy right now. Wait a moment and try again.",
  unavailable: "The coach is temporarily unavailable. Try again shortly.",
  invalid_response: "The coach returned an incomplete result. Try again for a fresh response.",
  unknown: "Something interrupted the request. Your inputs are still here—try again.",
};

function invalidResponseError(message) {
  const error = new Error(message);
  error.failureClass = "invalid_response";
  return error;
}

/** Ensure a generated plan can reach the evaluator and renderer safely. */
export function assertPlanShape(plan) {
  const hasRenderableDays =
    plan &&
    typeof plan === "object" &&
    !Array.isArray(plan) &&
    Array.isArray(plan.days) &&
    plan.days.every((day) =>
      day &&
      typeof day === "object" &&
      !Array.isArray(day) &&
      Array.isArray(day.exercises) &&
      day.exercises.every((exercise) => exercise && typeof exercise === "object" && !Array.isArray(exercise))
    );
  if (!hasRenderableDays) throw invalidResponseError("The generator returned an incomplete plan.");
  return plan;
}

/** Fetch with a local deadline while preserving a caller's AbortSignal. */
export async function fetchWithTimeout(url, options = {}, timeoutMs) {
  const controller = new AbortController();
  const externalSignal = options.signal;
  let timedOut = false;

  const forwardAbort = () => controller.abort(externalSignal.reason);
  if (externalSignal?.aborted) forwardAbort();
  else externalSignal?.addEventListener("abort", forwardAbort, { once: true });

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (timedOut) {
      const timeout = new Error("Request timed out");
      timeout.name = "TimeoutError";
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", forwardAbort);
  }
}

/** Turn implementation errors into a small, analytics-safe failure enum. */
export function classifyAiFailure(error, { online } = {}) {
  if (online === false) return "offline";
  if (error?.name === "TimeoutError") return "timeout";
  if (error?.failureClass === "invalid_response" || error instanceof SyntaxError) return "invalid_response";
  if (error?.status === 429) return "rate_limited";
  if ([502, 503, 504].includes(error?.status)) return "unavailable";
  return "unknown";
}

/** Safe, provider-agnostic copy for every user-facing AI failure surface. */
export function aiFailureMessage(_surface, failureClass, _options = {}) {
  return COPY[failureClass] || COPY.unknown;
}
