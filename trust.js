/**
 * SpotterAI — Trust Report confidence (pure)
 * ============================================================================
 * Derives the plan Trust Report's Low / Medium / High confidence from the
 * evaluator summary + whether the user declared injuries. Extracted from app.js
 * so it can be unit-tested without a DOM.
 *
 *   High   — no critical issues or warnings, and every check actually ran
 *   Medium — warnings exist, or some checks could not be assessed
 *   Low    — critical issues, or injury/limitation conflicts
 *
 * Confidence is a claim about how much we know, so an unassessed check has to
 * count against it. The evaluator's `not_assessed` tier (v1.3.0) marks checks
 * we skipped because the inputs were never collected; before this read them,
 * a zero-input audit reported "High — inputs look complete" on a plan where two
 * checks never ran, which is the false reassurance that tier exists to remove.
 */
export function planConfidence(summary, { hasInjuries = false } = {}) {
  const s = summary || {};
  const unassessed = s.not_assessed || 0;
  const gap = `${unassessed} check${unassessed === 1 ? "" : "s"} could not be assessed`;

  if ((s.critical || 0) > 0 || hasInjuries) {
    return { level: "Low", why: "critical or injury-related concerns were flagged" };
  }
  if ((s.warning || 0) > 0) {
    return {
      level: "Medium",
      why: unassessed > 0 ? `warnings exist but no critical issues, and ${gap}` : "warnings exist but no critical issues",
    };
  }
  if (unassessed > 0) {
    return { level: "Medium", why: `nothing was flagged, but ${gap}` };
  }
  return { level: "High", why: "no critical issues or warnings, and inputs look complete" };
}
