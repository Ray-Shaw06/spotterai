/**
 * SpotterAI — progression math (pure, no state, no DOM)
 * ============================================================================
 * Small, transparent functions for the coaching-depth features:
 *   - epley1RM: estimate a one-rep max from a working set
 *   - suggestNextWeight: auto-progression target from the last top set
 *   - deloadFromWeeklyVolume: a conservative "back off" flag from volume trend
 *
 * Kept dependency-free (no browser globals) so it runs under Node's test runner.
 * tracker-store.js wraps these with the user's logged data.
 */

const roundTo = (v, step) => Math.round(v / step) * step;

/** Estimated 1-rep max (Epley). Returns 0 for invalid input. */
export function epley1RM(weight, reps) {
  const w = Number(weight) || 0;
  const r = Number(reps) || 0;
  if (w <= 0 || r <= 0) return 0;
  return r === 1 ? w : w * (1 + r / 30);
}

/**
 * Auto-progression: suggest next session's load from the last top set.
 * Heavier lifts jump more; we only add load if the last set was a real working
 * set (≥5 reps), otherwise we hold. Returns null when there's no basis.
 */
export function suggestNextWeight(top) {
  const w = Number(top?.weight) || 0;
  const reps = Number(top?.reps) || 0;
  if (w <= 0) return null;
  const inc = w < 40 ? 1.25 : w < 80 ? 2.5 : 5;
  const weight = reps >= 5 ? roundTo(w + inc, 0.25) : w;
  return { from: w, weight, reps: reps || null, increment: Math.round((weight - w) * 100) / 100 };
}

/**
 * Deload flag from weekly training volume (array oldest→current). Conservative:
 * only suggests backing off when volume has risen for ~3 straight weeks INTO a
 * fresh peak. Returns { recommend, reason } or null.
 */
export function deloadFromWeeklyVolume(weeks) {
  if (!Array.isArray(weeks) || weeks.length < 4) return null;
  const v = weeks.slice(-5);
  const d = v[v.length - 1]; // current week
  if (d <= 0) return null;
  const a = v[v.length - 4];
  const b = v[v.length - 3];
  const c = v[v.length - 2];
  const rising = a < b && b < c && c <= d;
  const peak = d >= Math.max(...v);
  if (!rising || !peak) return null;
  const pct = a > 0 ? Math.round(((d - a) / a) * 100) : 0;
  return {
    recommend: true,
    reason: `Your weekly training volume has climbed 3 weeks running${pct > 0 ? ` (about +${pct}%)` : ""} to a new high. Consider an easier deload week — roughly −40% volume — to recover, then push again.`,
  };
}
