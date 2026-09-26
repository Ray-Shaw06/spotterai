/**
 * SpotterAI — /api/reminders
 * ============================================================================
 * Books workout, meal and water reminders as Web Push. Same machinery as
 * /api/rest-push (lib/rest-push.js explains it): the device's push
 * subscription is sealed into a QStash message, QStash calls back at the
 * reminder's time, and this route sends the push. Nothing is stored.
 *
 *   POST (client)  { subscription, kind, detail, at, now } -> { token, at }
 *   POST (QStash)  signed callback at `at` -> sends the push
 *   DELETE ?token= -> 204                    cancel (the thing got logged)
 *
 * The device decides WHICH reminders it wants, from logs only it holds
 * (reminder-plan.js, reminders-sync.js). This route only checks the shape,
 * books, cancels and sends.
 *
 * What differs from rest push: a booking may be up to 7 days out (QStash free
 * tier's longest delay), a reminder may land up to 30 minutes late, and it has
 * its own daily publish budget so reminders can never spend the rest timer's.
 * The push carries only { kind, detail, at }; the service worker writes the
 * words, so no calories, weights or other numbers leave the device.
 *
 * Config is the rest-push config (same VAPID keys, same QStash token). GET is
 * not served here: the client asks /api/rest-push for the public key.
 */

import { enforceRateLimit } from "../lib/rate-limit.js";
import { withSentry } from "../lib/sentry-server.js";
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
} from "../lib/rest-push.js";
import { callbackUrl as callbackUrlFor, rawBody, parseJson, queryParam, header, dailyCap } from "../lib/push-route.js";

const PAYLOAD_VERSION = 1;
const SUPPORTED_VERSIONS = new Set([1]);

export const REMINDER_KINDS = Object.freeze(["workout", "meal", "water"]);
export const MEAL_SLOTS = Object.freeze(["breakfast", "lunch", "dinner"]);
/** QStash free tier's longest delay (upstash.com/pricing, 2026-09-25). */
export const MAX_REMINDER_LEAD_SEC = 7 * 24 * 3600;
/** Half an hour late is still a useful nudge; later than that it is noise. */
export const MAX_REMINDER_LATE_SEC = 30 * 60;
/** How long the push service may hold an undelivered reminder. */
export const REMINDER_TTL_SEC = 3600;
/**
 * Publishes per UTC day, per instance. Separate from rest push's 600 so the
 * two together stay under the free tier's 1,000 and a busy day of reminders
 * can never cost someone their rest-timer banner.
 */
export const DAILY_REMINDER_CAP = 300;
const publishCap = dailyCap(DAILY_REMINDER_CAP);

/** Test seam: forget today's publish count. */
export function __resetDailyCapForTests() {
  publishCap.reset();
}

/** Test seams, as in api/rest-push.js. */
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

/** Where QStash calls back: see lib/push-route.js for why it never comes from a header. */
export function callbackUrl(env = deps.env || process.env) {
  return callbackUrlFor("/api/reminders", env);
}

/** `{ kind, detail }` when it is one of ours, else null. Meals need a slot; nothing else takes one. */
export function validReminder(kind, detail) {
  if (!REMINDER_KINDS.includes(kind)) return null;
  if (kind === "meal") return MEAL_SLOTS.includes(detail) ? { kind, detail } : null;
  return detail == null || detail === "" ? { kind, detail: "" } : null;
}

// --- POST from the client: book one reminder ---------------------------------

async function handleSchedule(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (enforceRateLimit("reminders", req, res, nowMs())) return;
  const cfg = config();
  if (!cfg) return res.status(503).json({ error: "Reminders are not configured on this server.", configured: false });

  const body = parseJson(req.body);
  const subscription = validateSubscription(body?.subscription);
  if (!subscription) return res.status(400).json({ error: "A valid push subscription is required." });
  const reminder = validReminder(body?.kind, body?.detail);
  if (!reminder) return res.status(400).json({ error: "Unknown reminder." });
  const now = nowMs();
  const deadline = deadlineFor(body?.at, body?.now, now, MAX_REMINDER_LEAD_SEC);
  if (!deadline || deadline.endsAt <= now) return res.status(400).json({ error: "at must be a time within the next 7 days." });

  const destination = callbackUrl();
  if (!destination) return res.status(503).json({ error: "Reminders are not configured on this server.", configured: false });
  if (!publishCap.claim(now)) {
    // The device keeps the reminder unbooked and stops asking until tomorrow.
    return res.status(503).json({ error: "The reminder budget for today is spent.", configured: true });
  }

  const message = JSON.stringify({
    v: PAYLOAD_VERSION,
    s: seal(subscription, cfg.privateKey),
    kind: reminder.kind,
    detail: reminder.detail,
    at: deadline.endsAt,
  });
  try {
    const { messageId } = await publishQstashMessage({
      fetchImpl,
      token: cfg.qstashToken,
      destination,
      body: message,
      notBefore: deadline.notBefore,
    });
    return res.status(200).json({ token: signCancelToken(messageId, cfg.privateKey), at: deadline.endsAt });
  } catch {
    return res.status(502).json({ error: "Could not book the reminder." });
  }
}

// --- DELETE: cancel one -------------------------------------------------------

async function handleCancel(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (enforceRateLimit("reminders", req, res, nowMs())) return;
  const cfg = config();
  if (!cfg) return res.status(204).end();
  const messageId = verifyCancelToken(queryParam(req, "token"), cfg.privateKey);
  if (!messageId) return res.status(400).json({ error: "Unrecognised cancel token." });
  try {
    await cancelQstashMessage({ fetchImpl, token: cfg.qstashToken, messageId });
  } catch {
    // Already delivered or QStash unreachable. A stale reminder is bounded by
    // the device's booking horizon.
  }
  return res.status(204).end();
}

// --- POST from QStash: send the push ------------------------------------------

/** Outcomes and what QStash does with each are as in api/rest-push.js. */
async function handleFire(req, res, cfg) {
  const raw = rawBody(req.body);
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
  const reminder = payload ? validReminder(payload.kind, payload.detail) : null;
  if (!subscription || !validateSubscription(subscription) || !reminder) return res.status(200).json({ outcome: "unsealable" });
  if (isStale(payload.at, nowMs(), MAX_REMINDER_LATE_SEC)) return res.status(200).json({ outcome: "stale" });

  try {
    const wp = await webpush();
    wp.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
    await wp.sendNotification(subscription, JSON.stringify({ kind: reminder.kind, detail: reminder.detail, at: payload.at }), {
      TTL: REMINDER_TTL_SEC,
      urgency: "normal",
      // A newer undelivered reminder of the same kind replaces an older one.
      topic: `spotterai-${reminder.kind}`,
    });
    return res.status(200).json({ outcome: "sent" });
  } catch (err) {
    const status = Number(err?.statusCode);
    if (status >= 400 && status < 500) {
      return res.status(200).json({ outcome: status === 404 || status === 410 ? "gone" : "rejected" });
    }
    return res.status(502).json({ outcome: "failed" });
  }
}

// --- Router ---------------------------------------------------------------------

async function handler(req, res) {
  const method = String(req.method || "GET").toUpperCase();
  if (method === "DELETE") return handleCancel(req, res);
  if (method !== "POST") {
    res.setHeader("Allow", "POST, DELETE");
    return res.status(405).json({ error: "Method not allowed." });
  }
  if (header(req, "upstash-signature") != null) {
    // Metered before the signature check, as rest push does, so a junk header
    // is not a way off the rate-limited path.
    if (enforceRateLimit("reminders", req, res, nowMs())) return;
    const cfg = config();
    if (!cfg) return res.status(200).json({ outcome: "unconfigured" });
    return handleFire(req, res, cfg);
  }
  return handleSchedule(req, res);
}

export { handler as __handlerForTests };

export default withSentry(handler, { route: "reminders" });
