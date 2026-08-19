/**
 * SpotterAI — /api/audit-telemetry
 * ============================================================================
 * Counts which evaluator checks fire on real plans. Every public number on the
 * Safety Lab today describes 21 bundled fixtures; this is the only source that
 * can say whether a check ever fires outside them.
 *
 * Three properties this endpoint holds to, in priority order:
 *
 *   1. It cannot hurt a user. Fire-and-forget from the client, and every
 *      failure path here returns 204. A telemetry outage is invisible.
 *   2. It cannot store anything personal. AGGREGATE COUNTERS ONLY — no raw row
 *      is ever written, so there is nothing to correlate even in principle.
 *      The payload is allow-listed by lib/telemetry-schema.js before it gets
 *      near a write.
 *   3. It cannot exhaust the free tier. Firestore Spark allows 20k writes/day
 *      and USER SYNC RUNS ON THE SAME QUOTA, so the cap below matters: losing
 *      the tail of an anomalous day is strictly better than breaking sync.
 *
 * It is public and unauthenticated, because the product has no account
 * requirement and telemetry must not introduce one. The counters can therefore
 * be skewed by someone determined. That is answered in the Safety Lab's copy,
 * which labels this number "unverified" against the reproducible bundled
 * benchmark, not by pretending the endpoint is trustworthy.
 */

import { createHash } from "node:crypto";
import { sanitizeTelemetry } from "../lib/telemetry-schema.js";

export const DAILY_AUDIT_CAP = 5000;
export const IP_HOURLY_CAP = 60;
const HISTORY_DAYS = 30;

/** UTC date key. Deliberately UTC so the bucket does not depend on the caller. */
export function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function hourKey(date = new Date()) {
  return date.toISOString().slice(0, 13);
}

/**
 * Build the increment map for one audit. Pure, so the shape of what gets
 * stored is testable without Firestore.
 */
export function counterUpdates(clean, FieldValue) {
  const updates = {
    audits: FieldValue.increment(1),
    [`byScoreBucket.${clean.scoreBucket}`]: FieldValue.increment(1),
    [`byGoal.${clean.goal}`]: FieldValue.increment(1),
    [`byExperience.${clean.experience}`]: FieldValue.increment(1),
    [`byDaysCount.${clean.daysCount}`]: FieldValue.increment(1),
  };
  for (const check of clean.checks) {
    updates[`byCheck.${check.id}.${check.status}`] = FieldValue.increment(1);
  }
  return updates;
}

let cached = null;

/** Lazy Firestore handle. Returns null when the project is not configured. */
async function firestore() {
  if (cached) return cached;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const { cert, getApps, initializeApp } = await import("firebase-admin/app");
    const { getFirestore, FieldValue } = await import("firebase-admin/firestore");
    if (!getApps().length) initializeApp({ credential: cert(JSON.parse(raw)) });
    cached = { store: getFirestore(), FieldValue };
    return cached;
  } catch {
    // A malformed service account must not take the endpoint down noisily.
    return null;
  }
}

/**
 * Hash the caller's IP with the service account as salt. The raw IP is never
 * written, and the hash is scoped to the hour so it is not a stable
 * pseudonym across a day.
 */
function ipKey(req) {
  const forwarded = req.headers?.["x-forwarded-for"];
  const ip = String(Array.isArray(forwarded) ? forwarded[0] : forwarded || "unknown").split(",")[0].trim();
  const salt = (process.env.FIREBASE_SERVICE_ACCOUNT || "").slice(0, 64);
  return createHash("sha256").update(`${salt}:${ip}:${hourKey()}`).digest("hex").slice(0, 32);
}

async function readAggregate(store) {
  const days = [];
  const now = new Date();
  for (let i = 0; i < HISTORY_DAYS; i++) {
    const d = new Date(now.getTime() - i * 86400000);
    days.push(dayKey(d));
  }
  const docs = await store.getAll(...days.map((key) => store.collection("audit_telemetry").doc(key)));

  const totals = { audits: 0, byCheck: {}, since: null };
  for (const doc of docs) {
    if (!doc.exists) continue;
    const data = doc.data();
    totals.audits += data.audits || 0;
    totals.since = totals.since && totals.since < doc.id ? totals.since : doc.id;
    for (const [id, statuses] of Object.entries(data.byCheck || {})) {
      totals.byCheck[id] = totals.byCheck[id] || { pass: 0, warn: 0, fail: 0, not_assessed: 0 };
      for (const [status, count] of Object.entries(statuses)) {
        totals.byCheck[id][status] = (totals.byCheck[id][status] || 0) + count;
      }
    }
  }
  return totals;
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    const fs = await firestore();
    if (!fs) return res.status(200).json({ audits: 0, byCheck: {}, since: null });
    try {
      return res.status(200).json(await readAggregate(fs.store));
    } catch {
      return res.status(200).json({ audits: 0, byCheck: {}, since: null });
    }
  }

  if (req.method !== "POST") {
    res.setHeader?.("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  // Every remaining path returns 204. The client is fire-and-forget and must
  // never learn whether its telemetry landed.
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { return res.status(204).end(); }
  }

  const clean = sanitizeTelemetry(body);
  if (!clean) return res.status(204).end();

  const fs = await firestore();
  if (!fs) return res.status(204).end();

  try {
    const { store, FieldValue } = fs;
    const dayRef = store.collection("audit_telemetry").doc(dayKey());
    const ipRef = store.collection("audit_telemetry_throttle").doc(ipKey(req));

    const [daySnap, ipSnap] = await Promise.all([dayRef.get(), ipRef.get()]);
    if ((daySnap.data()?.audits || 0) >= DAILY_AUDIT_CAP) return res.status(204).end();
    if ((ipSnap.data()?.hits || 0) >= IP_HOURLY_CAP) return res.status(204).end();

    await Promise.all([
      dayRef.set(counterUpdates(clean, FieldValue), { merge: true }),
      ipRef.set({ hits: FieldValue.increment(1), expiresAt: new Date(Date.now() + 3600000) }, { merge: true }),
    ]);
  } catch {
    // Quota exhaustion, a network fault, a permissions problem: all the same
    // from here. Drop it.
  }
  return res.status(204).end();
}
