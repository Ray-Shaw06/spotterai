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
 *      The SAME quota also caps reads at 50k/day project-wide, which is why
 *      GET is edge-cached and the daily write cap is checked from a
 *      same-instance cache rather than a Firestore read on every POST.
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
const DAY_CACHE_TTL_MS = 60_000;

/** UTC date key. Deliberately UTC so the bucket does not depend on the caller. */
export function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function hourKey(date = new Date()) {
  return date.toISOString().slice(0, 13);
}

/**
 * Normalize whatever the platform handed us as req.body into a plain object,
 * or null if it cannot be read as one. Pure, and exported, because with
 * Firestore unconfigured the handler answers 204 identically whether a body
 * parsed or was silently dropped — the only way to prove a Buffer body
 * (as navigator.sendBeacon(Blob) can arrive, unparsed by Vercel's body
 * parser when the content type isn't recognized as JSON) is actually being
 * read rather than dropped is to test this seam directly.
 */
export function parseBody(raw) {
  let body = raw;
  if (Buffer.isBuffer(body)) body = body.toString("utf8");
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { return null; }
  }
  return body ?? null;
}

/**
 * Build the increment map for one audit. Pure, so the shape of what gets
 * stored is testable without Firestore.
 *
 * Nested objects, NOT dotted-path keys. Dot-path field expansion
 * ("a.b.c": value) is documented only for update() in the Admin SDK
 * (@google-cloud/firestore's firestore.d.ts covers it on update() alone);
 * set(..., { merge: true }) treats a key containing dots as one literal
 * field name. A dotted key here would have written a field literally named
 * "byCheck.rest_days.pass" while readAggregate() below reads a genuinely
 * nested `byCheck[id][status]`, so the two would silently disagree forever.
 * Nested objects merge deep and correctly under set(..., { merge: true }),
 * so the writer and reader agree by construction.
 */
export function counterUpdates(clean, FieldValue) {
  const byCheck = {};
  for (const check of clean.checks) {
    if (!byCheck[check.id]) byCheck[check.id] = {};
    // A repeated (id, status) pair within one audit collapses to a single
    // increment rather than stacking. Deliberate anti-inflation, not a bug:
    // one audit is one occurrence of a check firing, however many times the
    // evaluator happened to report the same (id, status) pair for it.
    byCheck[check.id][check.status] = FieldValue.increment(1);
  }
  return {
    audits: FieldValue.increment(1),
    byScoreBucket: { [clean.scoreBucket]: FieldValue.increment(1) },
    byGoal: { [clean.goal]: FieldValue.increment(1) },
    byExperience: { [clean.experience]: FieldValue.increment(1) },
    byDaysCount: { [clean.daysCount]: FieldValue.increment(1) },
    bySource: { [clean.source]: FieldValue.increment(1) },
    byCheck,
  };
}

let cached = null;

/**
 * Test-only seam: install a Firestore handle (real or a fake store) directly,
 * bypassing FIREBASE_SERVICE_ACCOUNT and the real firebase-admin SDK. Without
 * this, the only way to drive handler() through a GET that actually reaches
 * Firestore is a live project with real credentials, which is exactly why the
 * cache-header test used to pin the header on the free unconfigured fallback
 * instead of the configured response that actually gets cached. Pass `null`
 * to restore the lazy, env-var-driven lookup.
 */
export function __setFirestoreForTests(handle) {
  cached = handle;
}

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
  } catch (err) {
    // A malformed service account must not take the endpoint down noisily —
    // but it must not be invisible either, or a bad credential looks
    // identical to "telemetry is simply off" forever.
    console.warn("[audit-telemetry] init failed", err?.code ?? err?.message ?? String(err));
    return null;
  }
}

/**
 * Hash the caller's IP with the service account as salt. The raw IP is never
 * written, and the hash is scoped to the hour so it is not a stable
 * pseudonym across a day.
 *
 * Prefers x-real-ip: Vercel sets it from the actual connecting peer and a
 * caller cannot rewrite it. Falling back to x-forwarded-for, takes the
 * RIGHTMOST entry, the hop the trusted proxy itself appended — a proxy that
 * APPENDS to an existing XFF rather than replacing it passes through
 * whatever the caller already sent as the leading entries, so trusting the
 * leftmost entry would let a rotating forged header defeat IP_HOURLY_CAP.
 */
function ipKey(req) {
  const pick = (h) => (Array.isArray(h) ? h[0] : h);
  const realIp = pick(req.headers?.["x-real-ip"]);
  const forwarded = pick(req.headers?.["x-forwarded-for"]);
  const fromForwarded = forwarded ? String(forwarded).split(",").pop().trim() : "";
  const ip = String(realIp || fromForwarded || "unknown").trim();
  const salt = (process.env.FIREBASE_SERVICE_ACCOUNT || "").slice(0, 64);
  return createHash("sha256").update(`${salt}:${ip}:${hourKey()}`).digest("hex").slice(0, 32);
}

/**
 * Sum the last HISTORY_DAYS day documents into one aggregate. Exported so
 * the reader half of the writer/reader contract can be driven directly with
 * a fake store — the seam the dotted-key/nested-object disagreement lived in
 * undetected, because nothing exercised it.
 */
export async function readAggregate(store) {
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

// Same-instance cache of today's audit count, keyed by the Firestore handle
// itself so a fresh store (a cold instance, or a different store in tests)
// never trusts a stale entry. Lets a saturated day cost close to zero reads
// instead of one per POST — 25,000 POSTs against the naive read-then-decide
// version would have cost 50,000 reads and endangered the SAME quota user
// sync depends on.
let dayCountCache = { store: null, day: null, audits: 0, checkedAt: 0 };

/**
 * Today's audit count, from the module-scope cache when it is fresh (same
 * store, same day, read within the last DAY_CACHE_TTL_MS), else a real read.
 *
 * This can let DAILY_AUDIT_CAP overshoot by up to one instance-minute of
 * traffic before a fresh read notices the day is saturated. Acceptable: the
 * cap is a safety valve protecting the shared free-tier quota, not an
 * accounting boundary that has to be exact.
 */
async function todaysAuditCount(store, today) {
  const fresh = dayCountCache.store === store
    && dayCountCache.day === today
    && Date.now() - dayCountCache.checkedAt < DAY_CACHE_TTL_MS;
  if (fresh) return dayCountCache.audits;
  const snap = await store.collection("audit_telemetry").doc(today).get();
  const audits = snap.data()?.audits || 0;
  dayCountCache = { store, day: today, audits, checkedAt: Date.now() };
  return audits;
}

/**
 * Enforce both caps and write the aggregate counters for one audit. Exported
 * so cap enforcement and the exact shape handed to Firestore can be driven
 * with a fake store instead of only being checked by reading the source.
 *
 * The daily cap is checked FIRST, from the cache above, and a saturated day
 * returns immediately without ever reading the IP-throttle document — a
 * saturated day must cost close to zero reads, not two reads per rejected
 * request. The IP read only happens on the path where the day is not
 * saturated.
 *
 * @returns {Promise<boolean>} true if the write happened, false if a cap
 *   dropped it. Never surfaced to the client — the caller always answers 204
 *   either way, per the fire-and-forget contract.
 */
export async function recordAudit(store, FieldValue, clean, req) {
  const today = dayKey();
  if ((await todaysAuditCount(store, today)) >= DAILY_AUDIT_CAP) return false;

  const ipRef = store.collection("audit_telemetry_throttle").doc(ipKey(req));
  const ipSnap = await ipRef.get();
  if ((ipSnap.data()?.hits || 0) >= IP_HOURLY_CAP) return false;

  const dayRef = store.collection("audit_telemetry").doc(today);
  await Promise.all([
    dayRef.set(counterUpdates(clean, FieldValue), { merge: true }),
    // expiresAt requires a Firestore TTL policy on
    // audit_telemetry_throttle.expiresAt, provisioned outside this repo —
    // see docs/SETUP.md. The field is written regardless so the policy can
    // be turned on at any time without a backfill.
    ipRef.set({ hits: FieldValue.increment(1), expiresAt: new Date(Date.now() + 3600000) }, { merge: true }),
  ]);
  // Keep the same-instance cache in sync with the write it just issued, or an
  // instance that read a stale count (say, 4,990) keeps writing against that
  // stale figure for up to DAY_CACHE_TTL_MS instead of noticing it crossed
  // DAILY_AUDIT_CAP mid-window.
  if (dayCountCache.store === store && dayCountCache.day === today) dayCountCache.audits += 1;
  return true;
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    // The aggregate is a 30-day rolling sum; five minutes of staleness is
    // irrelevant to it, and letting Vercel's edge absorb repeat views is the
    // difference between this fanning out to up to 30 Firestore reads on
    // every Safety Lab page view (exhausting the 50k/day project-wide read
    // quota at roughly 1,666 views) and effectively zero.
    const fs = await firestore();
    if (!fs) {
      // Nothing was actually read, so there is nothing worth 5 minutes of
      // edge caching: caching this fallback would pin a misleading zero at
      // the edge for anyone hitting an unconfigured deploy.
      res.setHeader?.("Cache-Control", "no-store");
      return res.status(200).json({ audits: 0, byCheck: {}, since: null });
    }
    try {
      const aggregate = await readAggregate(fs.store);
      // Only set the shared cache header once a real aggregate is in hand,
      // right before the success response. Setting it earlier (as this used
      // to) meant a transient Firestore failure below would cache the
      // fallback {audits: 0} for 5 minutes at the edge — a misleading zero,
      // pinned, right after the block that hides on audits <= 0.
      res.setHeader?.("Cache-Control", "s-maxage=300, stale-while-revalidate=3600");
      return res.status(200).json(aggregate);
    } catch (err) {
      console.warn("[audit-telemetry] read failed", err?.code ?? err?.message ?? String(err));
      res.setHeader?.("Cache-Control", "no-store");
      return res.status(200).json({ audits: 0, byCheck: {}, since: null });
    }
  }

  if (req.method !== "POST") {
    res.setHeader?.("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  // Every remaining path returns 204. The client is fire-and-forget and must
  // never learn whether its telemetry landed.
  const clean = sanitizeTelemetry(parseBody(req.body));
  if (!clean) return res.status(204).end();

  const fs = await firestore();
  if (!fs) return res.status(204).end();

  try {
    await recordAudit(fs.store, fs.FieldValue, clean, req);
  } catch (err) {
    // Quota exhaustion, a network fault, a permissions problem: all the same
    // from the client's point of view (204 regardless) but worth a log line,
    // or a bad credential looks identical to "telemetry is simply off".
    console.warn("[audit-telemetry] write failed", err?.code ?? err?.message ?? String(err));
  }
  return res.status(204).end();
}
