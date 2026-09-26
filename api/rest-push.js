/**
 * SpotterAI — /api/rest-push
 * ============================================================================
 * Books a Web Push for the moment a rest timer ends, so a locked iPhone still
 * gets the "Rest complete" banner (and, from the OS, the buzz that WebKit
 * offers no other route to). lib/rest-push.js explains the shape; this file is
 * the HTTP surface, four verbs on one route:
 *
 *   GET            → { enabled, publicKey }  what the client may subscribe with
 *   POST (client)  → { token, endsAt }       book a callback with QStash
 *   POST (QStash)  → sends the push          signed callback at the deadline
 *   DELETE ?token= → 204                     cancel a booking (skip, +15s, re-arm)
 *
 * The two POSTs are told apart by the `Upstash-Signature` header, which only a
 * holder of the signing key can produce. A client POST carrying a forged one
 * fails verification and gets a 401 rather than falling through to booking.
 *
 * Properties this holds to, in order:
 *
 *   1. Nothing is stored. The subscription is sealed into the QStash message
 *      and unsealed on the callback; the cancel token is an HMAC of the message
 *      id. No Firestore, no table, no growth.
 *   2. Unconfigured means invisible. Without the five env vars, GET says
 *      `enabled: false`, POST answers 503, and the client keeps the page-alive
 *      alarm it has today. Half a config never sends anything.
 *   3. It cannot spend the free tier for you. Per-IP rate limits from
 *      lib/rate-limit.js on every verb, a daily publish cap across everyone,
 *      and a callback that is unsealable, stale, rejected or aimed at a dead
 *      subscription answers 200 so QStash does NOT retry (every retry is
 *      another billed message). The only non-2xx answers from the callback are
 *      401 (a signature that is not ours, so not a real QStash callback) and
 *      502 (the push service itself failed, which a retry can genuinely fix).
 *
 * The callback destination comes from the server's own environment, never from
 * a request header: see callbackUrl().
 */

import { enforceRateLimit } from "../lib/rate-limit.js";
import { withSentry } from "../lib/sentry-server.js";
import { callbackUrl as callbackUrlFor, rawBody, parseJson, queryParam, header, dailyCap } from "../lib/push-route.js";
import {
  restPushEnv,
  validateSubscription,
  seal,
  open,
  signCancelToken,
  verifyCancelToken,
  verifyUpstashSignature,
  deadlineFor,
  isStale,
  publishQstashMessage,
  cancelQstashMessage,
  PUSH_TTL_SEC,
  PUSH_TOPIC,
} from "../lib/rest-push.js";

const PAYLOAD_VERSION = 1;
/** Payload versions this deploy can still open. A bump ADDS to this set rather
 *  than replacing it: QStash may be holding messages from the previous deploy
 *  for up to an hour, and those rests still deserve their notification. */
const SUPPORTED_VERSIONS = new Set([1]);

/**
 * Publishes to QStash allowed per UTC day, across everyone. The free tier is
 * 1,000 messages/day and the per-IP limits alone do not defend it: this route
 * is public, and an attacker rotating IPs could drain the day's quota in
 * minutes, which would silently cost every real user their notification. Same
 * shape as api/audit-telemetry.js's DAILY_AUDIT_CAP, and the same honest limit:
 * the counter is per serverless INSTANCE, so it blunts the attack rather than
 * accounting for it exactly.
 */
export const DAILY_PUBLISH_CAP = 600;
const publishCap = dailyCap(DAILY_PUBLISH_CAP);

/** Test seam: forget today's publish count. */
export function __resetDailyCapForTests() {
  publishCap.reset();
}

/**
 * Test seams. `fetch` reaches QStash; `webpush` is the web-push module (lazily
 * imported so an unconfigured deployment never loads it); `env` and `now` let
 * a test pin the configuration and the clock without touching process.env.
 */
let deps = { fetch: null, webpush: null, env: null, now: null };
export function __setDepsForTests(next) {
  deps = { fetch: null, webpush: null, env: null, now: null, ...(next || {}) };
}

const fetchImpl = (...args) => (deps.fetch || globalThis.fetch)(...args);
const nowMs = () => (deps.now ? deps.now() : Date.now());
const config = () => restPushEnv(deps.env || process.env);

async function webpush() {
  if (deps.webpush) return deps.webpush;
  const mod = await import("web-push");
  return mod.default || mod;
}

/** The URL QStash must call back: see lib/push-route.js for why it comes from
 *  the server's own environment and never from a request header. */
export function callbackUrl(env = deps.env || process.env) {
  return callbackUrlFor("/api/rest-push", env);
}

// --- GET: what the client may subscribe with ---------------------------------

function handleGet(req, res) {
  const cfg = config();
  // Short public cache, at the edge as well as in the browser: the body is the
  // same for every caller and changes only when the operator rotates the key,
  // so serving it from the edge keeps a cold start off the booking path.
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300, stale-while-revalidate=3600");
  if (!cfg) return res.status(200).json({ enabled: false });
  return res.status(200).json({ enabled: true, publicKey: cfg.publicKey });
}

// --- POST from the client: book the callback ---------------------------------

async function handleSchedule(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (enforceRateLimit("restPush", req, res, nowMs())) return;
  const cfg = config();
  // `configured: false` is the discriminator the client latches on, so a 503
  // from the platform (a paused deployment, an edge error) is never mistaken
  // for "the operator turned this off".
  if (!cfg) return res.status(503).json({ error: "Rest push is not configured on this server.", configured: false });

  const body = parseJson(req.body);
  const subscription = validateSubscription(body?.subscription);
  if (!subscription) return res.status(400).json({ error: "A valid push subscription is required." });
  const now = nowMs();
  const deadline = deadlineFor(body?.endsAt, body?.now, now);
  if (!deadline) return res.status(400).json({ error: "endsAt must be a time within the next hour." });

  const destination = callbackUrl();
  if (!destination) return res.status(503).json({ error: "Rest push is not configured on this server.", configured: false });

  if (!publishCap.claim(now)) {
    // Out of budget for today. The page-alive alarm still fires, so this is a
    // quiet degrade rather than an error the user has to understand.
    return res.status(503).json({ error: "The notification budget for today is spent.", configured: true });
  }

  const message = JSON.stringify({ v: PAYLOAD_VERSION, s: seal(subscription, cfg.privateKey), endsAt: deadline.endsAt });
  try {
    const { messageId } = await publishQstashMessage({
      fetchImpl,
      token: cfg.qstashToken,
      destination,
      body: message,
      notBefore: deadline.notBefore,
    });
    return res.status(200).json({ token: signCancelToken(messageId, cfg.privateKey), endsAt: deadline.endsAt });
  } catch {
    // The client's page-alive alarm still fires. Say so honestly and stop.
    return res.status(502).json({ error: "Could not book the notification. The on-screen timer and sound still work." });
  }
}

// --- DELETE: cancel a booking --------------------------------------------------

async function handleCancel(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (enforceRateLimit("restPush", req, res, nowMs())) return;
  const cfg = config();
  if (!cfg) return res.status(204).end();
  const messageId = verifyCancelToken(queryParam(req, "token"), cfg.privateKey);
  if (!messageId) return res.status(400).json({ error: "Unrecognised cancel token." });
  try {
    await cancelQstashMessage({ fetchImpl, token: cfg.qstashToken, messageId });
  } catch {
    // Already delivered or QStash unreachable: either way there is nothing
    // more the client can do, and a stale push is bounded by its TTL.
  }
  return res.status(204).end();
}

// --- POST from QStash: send the push --------------------------------------------

/**
 * Send outcomes, and what QStash does with each:
 *   "sent"       200  delivered to the push service
 *   "gone"       200  subscription expired/unsubscribed (404/410): do not retry
 *   "stale"      200  the deadline is long past: do not retry
 *   "unsealable" 200  not sealed by this server's key: do not retry
 *   "failed"     502  push service hiccup: QStash retries (Upstash-Retries: 2)
 */
async function handleFire(req, res, cfg) {
  const raw = rawBody(req.body);
  // The callback URL is what the signature's audience is checked against, so a
  // deployment that cannot name itself must refuse rather than skip the check.
  const destination = callbackUrl();
  const claims = destination
    ? verifyUpstashSignature({
        signature: header(req, "upstash-signature"),
        body: raw,
        url: destination,
        keys: cfg.signingKeys,
        now: nowMs() / 1000,
      })
    : null;
  if (!claims) return res.status(401).json({ error: "Bad signature." });

  const payload = parseJson(raw);
  const subscription = payload && SUPPORTED_VERSIONS.has(payload.v) ? open(payload.s, cfg.privateKey) : null;
  if (!subscription || !validateSubscription(subscription)) return res.status(200).json({ outcome: "unsealable" });
  if (isStale(payload.endsAt, nowMs())) return res.status(200).json({ outcome: "stale" });

  try {
    const wp = await webpush();
    wp.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
    await wp.sendNotification(subscription, JSON.stringify({ kind: "rest", endsAt: payload.endsAt }), {
      TTL: PUSH_TTL_SEC,
      urgency: "high",
      topic: PUSH_TOPIC,
    });
    return res.status(200).json({ outcome: "sent" });
  } catch (err) {
    const status = Number(err?.statusCode);
    // Any 4xx from the push service is permanent for THIS subscription: 404/410
    // is unsubscribed, 403 is a VAPID key that no longer matches, 400/413 is a
    // payload it will never accept. Retrying spends QStash messages on a send
    // that cannot succeed, so only a 5xx or a transport failure is worth one.
    if (status >= 400 && status < 500) {
      return res.status(200).json({ outcome: status === 404 || status === 410 ? "gone" : "rejected" });
    }
    return res.status(502).json({ outcome: "failed" });
  }
}

// --- Router ---------------------------------------------------------------------

async function handler(req, res) {
  const method = String(req.method || "GET").toUpperCase();
  if (method === "GET") return handleGet(req, res);
  if (method === "DELETE") return handleCancel(req, res);
  if (method !== "POST") {
    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "Method not allowed." });
  }
  if (header(req, "upstash-signature") != null) {
    // Metered BEFORE the signature is checked: the header is just a header, so
    // an anonymous caller could otherwise attach a junk one and step off the
    // rate-limited path entirely. A real QStash callback arrives far below the
    // per-IP ceiling, so this costs the happy path nothing.
    if (enforceRateLimit("restPush", req, res, nowMs())) return;
    const cfg = config();
    // Unconfigured: nothing to send, and nothing for QStash to retry into.
    if (!cfg) return res.status(200).json({ outcome: "unconfigured" });
    return handleFire(req, res, cfg);
  }
  return handleSchedule(req, res);
}

export { handler as __handlerForTests, rawBody };

// Reports an unhandled throw to Sentry, then re-throws so the platform's own
// 500 is unchanged. Inert when SENTRY_DSN is unset.
export default withSentry(handler, { route: "rest-push" });
