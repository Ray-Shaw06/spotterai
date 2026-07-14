/**
 * SpotterAI — nutrition math (pure, deterministic, testable)
 * ----------------------------------------------------------------------------
 * Shared helpers for keeping a food estimate INTERNALLY CONSISTENT. LLM
 * estimators (photo + text) return a calorie total and a macro breakdown as
 * independent numbers, and they routinely disagree — a "500 kcal" meal whose
 * protein/carbs/fat only add up to ~330. A calorie total that contradicts its
 * own macros is definitionally wrong, so we reconcile the two using the Atwater
 * energy factors (the same 9 kcal/g of fat already used in nutrition-safety.js).
 *
 * Used by /api/estimate (photo + text) and /api/parse (quick-log). No network,
 * no DOM — just arithmetic, so it's unit-tested.
 *
 * Runtime: Node 18+ / browser. ES module (matches the rest of the codebase).
 */

// Atwater energy factors (kcal per gram).
export const ATWATER = { protein: 4, carbs: 4, fat: 9 };

/** Energy (kcal) implied by a macro breakdown via Atwater 4/4/9. */
export function macroKcal({ protein = 0, carbs = 0, fat = 0 } = {}) {
  const p = Math.max(0, Number(protein) || 0);
  const c = Math.max(0, Number(carbs) || 0);
  const f = Math.max(0, Number(fat) || 0);
  return ATWATER.protein * p + ATWATER.carbs * c + ATWATER.fat * f;
}

/**
 * Reconcile a stated calorie total with its own macro breakdown.
 *
 * When the two agree (within `tol`, a fraction of the stated kcal) the estimate
 * is already self-consistent — leave it untouched. When they disagree by more
 * than `tol`, trust the macro-derived energy: the model reasons about grams per
 * component, so the breakdown is the more grounded signal, and an inconsistent
 * total is by definition an error. If a plausibility range is supplied
 * (`low`/`high`, e.g. the model's own kcal_low/high), clamp the result inside it
 * so reconciliation can never push a value outside a sane bound.
 *
 * Only ever makes the number MORE consistent; it does not add its own bias
 * (the conservative overshoot-curbing lives in api/estimate.js).
 *
 * @returns {number} reconciled kcal (rounded, ≥ 0)
 */
export function reconcileKcal({ kcal, protein, carbs, fat, low = null, high = null, tol = 0.12 } = {}) {
  const stated = Math.max(0, Number(kcal) || 0);
  const mk = macroKcal({ protein, carbs, fat });

  // No usable macros → nothing to reconcile against; keep the stated total.
  if (mk <= 0) return Math.round(stated);
  // No usable total → the macros are all we have.
  if (stated <= 0) return Math.round(mk);

  const disagreement = Math.abs(mk - stated) / stated;
  let out = disagreement > tol ? mk : stated;

  const lo = Number(low);
  const hi = Number(high);
  if (Number.isFinite(lo) && Number.isFinite(hi) && hi >= lo && hi > 0) {
    out = Math.min(Math.max(out, lo), hi);
  }
  return Math.round(out);
}
