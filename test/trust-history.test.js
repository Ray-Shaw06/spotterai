import test from "node:test";
import assert from "node:assert/strict";

import {
  AUDIT_HISTORY_LIMIT,
  buildAuditEntry,
  isSameAudit,
  getAuditHistory,
  recordAudit,
  clearAuditHistory,
  auditTrend,
} from "../trust-history.js";

// Minimal in-memory store standing in for localStorage.
function fakeStore(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    size: () => map.size,
  };
}

const plan = (version, days) => ({ version, days });
const audit = (score, { critical = 0, warning = 0, suggestion = 0 } = {}) => ({
  score,
  summary: { critical, warning, suggestion, total: 9, passed: 9 - critical - warning - suggestion },
});

test("buildAuditEntry maps score, tiers, and confidence level", () => {
  const p = plan("v2", [{ exercises: [{ sets: 3 }, { sets: 4 }] }]);
  const e = buildAuditEntry(p, audit(88, { warning: 1 }), { note: "bumped bench", now: 1000 });
  assert.equal(e.version, "v2");
  assert.equal(e.score, 88);
  assert.equal(e.warning, 1);
  assert.equal(e.level, "Medium"); // warning but no critical
  assert.equal(e.at, 1000);
  assert.equal(e.note, "bumped bench");
  assert.equal(e.sig, "1:7"); // 1 day, 7 total sets
});

test("confidence goes Low with a critical flag or an injury", () => {
  const p = plan("v1", []);
  assert.equal(buildAuditEntry(p, audit(50, { critical: 1 })).level, "Low");
  assert.equal(buildAuditEntry(p, audit(100), { hasInjuries: true }).level, "Low");
  assert.equal(buildAuditEntry(p, audit(100)).level, "High");
});

test("note is truncated to 160 chars", () => {
  const e = buildAuditEntry(plan("v1", []), audit(90), { note: "x".repeat(400) });
  assert.equal(e.note.length, 160);
});

test("isSameAudit compares version + score + signature", () => {
  const a = { version: "v1", score: 90, sig: "3:20" };
  assert.equal(isSameAudit(a, { ...a }), true);
  assert.equal(isSameAudit(a, { ...a, score: 91 }), false);
  assert.equal(isSameAudit(a, { ...a, sig: "3:21" }), false);
  assert.equal(isSameAudit(null, a), false);
});

test("recordAudit appends and round-trips through the store", () => {
  const store = fakeStore();
  const p = plan("v1", [{ exercises: [{ sets: 3 }] }]);
  const r1 = recordAudit(buildAuditEntry(p, audit(80), { now: 1 }), store);
  assert.equal(r1.recorded, true);
  assert.equal(getAuditHistory(store).length, 1);

  const p2 = plan("v2", [{ exercises: [{ sets: 4 }] }]);
  const r2 = recordAudit(buildAuditEntry(p2, audit(88), { now: 2 }), store);
  assert.equal(r2.recorded, true);
  const hist = getAuditHistory(store);
  assert.equal(hist.length, 2);
  assert.deepEqual(hist.map((h) => h.score), [80, 88]); // oldest -> newest
});

test("recordAudit dedupes an identical latest entry", () => {
  const store = fakeStore();
  const p = plan("v1", [{ exercises: [{ sets: 3 }] }]);
  recordAudit(buildAuditEntry(p, audit(80), { now: 1 }), store);
  const again = recordAudit(buildAuditEntry(p, audit(80), { now: 2 }), store);
  assert.equal(again.recorded, false);
  assert.equal(getAuditHistory(store).length, 1);
});

test("recordAudit caps history at the limit", () => {
  const store = fakeStore();
  for (let i = 0; i < AUDIT_HISTORY_LIMIT + 6; i++) {
    // vary score so entries aren't deduped
    recordAudit(buildAuditEntry(plan("v" + i, []), audit(50 + i), { now: i }), store);
  }
  const hist = getAuditHistory(store);
  assert.equal(hist.length, AUDIT_HISTORY_LIMIT);
  // Kept the most recent ones.
  assert.equal(hist[hist.length - 1].score, 50 + AUDIT_HISTORY_LIMIT + 5);
});

test("clearAuditHistory empties it", () => {
  const store = fakeStore();
  recordAudit(buildAuditEntry(plan("v1", []), audit(80)), store);
  clearAuditHistory(store);
  assert.equal(getAuditHistory(store).length, 0);
});

test("getAuditHistory tolerates a missing/corrupt store value", () => {
  assert.deepEqual(getAuditHistory(fakeStore()), []);
  assert.deepEqual(getAuditHistory(fakeStore({ "spotterai.audit.v1::guest": "not json" })), []);
  assert.deepEqual(getAuditHistory(null), []);
});

test("auditTrend reports the delta across the history", () => {
  assert.equal(auditTrend([]), null);
  assert.equal(auditTrend([{ score: 80 }]), null);
  assert.deepEqual(auditTrend([{ score: 72 }, { score: 80 }, { score: 88 }]), {
    from: 72,
    to: 88,
    delta: 16,
    points: 3,
  });
});
