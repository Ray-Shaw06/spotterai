/**
 * SpotterAI — Trust Report confidence (pure)
 * ============================================================================
 * Derives the plan Trust Report's Low / Medium / High confidence from the
 * evaluator summary + whether the user declared injuries. Extracted from app.js
 * so it can be unit-tested without a DOM.
 *
 *   High   — no critical issues or warnings, and no major limitations
 *   Medium — warnings exist but no critical issues
 *   Low    — critical issues, or injury/limitation conflicts
 */
export function planConfidence(summary, { hasInjuries = false } = {}) {
  const s = summary || {};
  if ((s.critical || 0) > 0 || hasInjuries) {
    return { level: "Low", why: "critical or injury-related concerns were flagged" };
  }
  if ((s.warning || 0) > 0) {
    return { level: "Medium", why: "warnings exist but no critical issues" };
  }
  return { level: "High", why: "no critical issues or warnings, and inputs look complete" };
}
