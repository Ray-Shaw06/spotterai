/**
 * SpotterAI — Trust Report history (audit score across plan versions)
 * ============================================================================
 * Every time a plan is generated or adapted, the deterministic evaluator runs
 * and produces a Trust Report. This module snapshots that report so the user can
 * watch their plan's safety/quality score move over versions (v1, v2, v3, ...).
 *
 * The logic is pure and unit-testable; the only side effect is a small,
 * per-profile localStorage array. Pass an explicit `store` to test without a DOM.
 *
 *   buildAuditEntry(plan, audit, opts) -> entry   (pure)
 *   recordAudit(entry[, store])       -> { recorded, history }
 *   getAuditHistory([store])          -> entry[]  (oldest -> newest)
 *   auditTrend(history)               -> { from, to, delta, points } | null
 */

import { planConfidence } from "./trust.js";
import { auditHistoryKey } from "./profile-store.js";

export const AUDIT_HISTORY_LIMIT = 20;

function safeLocal() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/** Cheap content signature, so re-rendering the same plan doesn't double-record. */
function signature(plan) {
  const days = Array.isArray(plan?.days) ? plan.days : [];
  let sets = 0;
  for (const d of days) for (const e of d.exercises || []) sets += Number(e.sets) || 0;
  return `${days.length}:${sets}`;
}

/** Build one history entry from an evaluator result. Pure. */
export function buildAuditEntry(plan, audit, { hasInjuries = false, note = "", now = Date.now() } = {}) {
  const s = (audit && audit.summary) || {};
  const conf = planConfidence(s, { hasInjuries });
  return {
    at: now,
    version: (plan && plan.version) || "v1",
    score: Number(audit && audit.score) || 0,
    critical: s.critical || 0,
    warning: s.warning || 0,
    suggestion: s.suggestion || 0,
    level: conf.level,
    sig: signature(plan),
    note: String(note || "").slice(0, 160),
  };
}

/** Do two entries describe the same audited plan state? */
export function isSameAudit(a, b) {
  return !!a && !!b && a.version === b.version && a.score === b.score && a.sig === b.sig;
}

/** Read the stored history (oldest -> newest). */
export function getAuditHistory(store = safeLocal()) {
  if (!store) return [];
  try {
    const raw = JSON.parse(store.getItem(auditHistoryKey()) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

/** Append an entry unless it repeats the latest; cap length; persist. */
export function recordAudit(entry, store = safeLocal()) {
  const history = getAuditHistory(store);
  const last = history[history.length - 1];
  if (isSameAudit(last, entry)) return { recorded: false, history };
  const next = [...history, entry].slice(-AUDIT_HISTORY_LIMIT);
  if (store) {
    try {
      store.setItem(auditHistoryKey(), JSON.stringify(next));
    } catch {
      /* storage full / disabled — keep working in-memory */
    }
  }
  return { recorded: true, history: next };
}

export function clearAuditHistory(store = safeLocal()) {
  if (!store) return;
  try {
    store.removeItem(auditHistoryKey());
  } catch {
    /* ignore */
  }
}

/** Headline trend across the whole history, or null with fewer than 2 points. */
export function auditTrend(history) {
  if (!Array.isArray(history) || history.length < 2) return null;
  const first = history[0];
  const last = history[history.length - 1];
  return { from: first.score, to: last.score, delta: last.score - first.score, points: history.length };
}
