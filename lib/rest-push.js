/**
 * SpotterAI — scheduled rest-timer push, the pure half
 * ============================================================================
 * A locked iPhone freezes page JavaScript. The rest alarm's tone survives that
 * because it is booked on the audio clock, but the NOTIFICATION was fired from
 * JS at the deadline, so with the screen off it showed at unlock, which is the
 * one moment nobody needs it. No client API books a future notification
 * (Notification Triggers never shipped, and never on WebKit), so the only thing
 * that wakes a locked phone is a push from a server, sent AT the deadline.
 *
 * Who holds the delay is the whole design:
 *
 *   arm  ──POST /api/rest-push──▶  Vercel  ──publish, Not-Before=endsAt──▶  QStash
 *                                                                              │
 *   phone ◀── Web Push (VAPID) ── Vercel  ◀────── signed callback at endsAt ───┘
 *
 * QStash (Upstash) holds the message until `endsAt` and calls us back. Its free
 * tier is 1,000 messages a day and needs no card, which is what the 2026-07-22
 * decision to retire Web Push was missing: a scheduler that is not Firebase
 * Blaze. There is still NO database. The push subscription rides inside the
 * QStash message, SEALED with a key only this server holds, so Upstash stores an
 * opaque blob rather than a usable push address.
 *
 * Everything here is pure and injectable so it runs headless under node --test:
 * sealing, the cancel token, the callback signature check and the two QStash
 * calls. The HTTP handler in api/rest-push.js is the thin shell around it.
 */

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const QSTASH_URL = "https://qstash.upstash.io";

/** A booking that cannot be made in three seconds is not worth holding a
 *  serverless function for. Same reasoning as lib/sentry-server.js. */
export const QSTASH_TIMEOUT_MS = 3000;

/** Longest rest the alarm accepts (rest-alarm.js MAX_REST_SEC), plus slack. */
export const MAX_LEAD_SEC = 60 * 60 + 60;
/**
 * A deadline already this far in the past is not worth a push. Two minutes,
 * not fifteen: a QStash retry that lands later than this would buzz "Rest
 * complete" while the user is already well into the next set, which is worse
 * than no notification at all.
 */
export const MAX_LATE_SEC = 2 * 60;
/** Clock skew tolerated on the callback JWT, in seconds. */
export const CLOCK_TOLERANCE_SEC = 60;
/** Push payload lifetime: a rest notice is worthless ten minutes late. */
export const PUSH_TTL_SEC = 600;
/** Web Push topic: a newer rest push replaces an undelivered older one. */
export const PUSH_TOPIC = "spotterai-rest";

/**
 * Read the server configuration, or null when any required value is missing.
 * Missing config is not an error: the endpoint answers "not enabled" and the
 * client keeps today's page-alive alarm. Nothing half-configured ever sends.
 */
export function restPushEnv(env = process.env) {
  const publicKey = String(env.WEB_PUSH_PUBLIC_KEY || "").trim();
  const privateKey = String(env.WEB_PUSH_PRIVATE_KEY || "").trim();
  const subject = String(env.WEB_PUSH_SUBJECT || "").trim();
  const qstashToken = String(env.QSTASH_TOKEN || "").trim();
  const current = String(env.QSTASH_CURRENT_SIGNING_KEY || "").trim();
  const next = String(env.QSTASH_NEXT_SIGNING_KEY || "").trim();
  if (!publicKey || !privateKey || !subject || !qstashToken || !current) return null;
  if (!/^(mailto:|https:\/\/)/.test(subject)) return null; // VAPID requires one of the two
  return { publicKey, privateKey, subject, qstashToken, signingKeys: next ? [current, next] : [current] };
}

// --- Encoding ---------------------------------------------------------------

export function toBase64Url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(str) {
  const s = String(str).replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(s + "=".repeat((4 - (s.length % 4)) % 4), "base64");
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/**
 * The push services that actually exist. Without this the endpoint is a relay:
 * anyone could POST a subscription naming any https host and, up to an hour
 * later, this server would POST to it carrying a JWT signed with the operator's
 * VAPID key, on the operator's egress and the operator's QStash quota. A
 * subscription only ever comes from one of these four, so pinning the host
 * costs a real user nothing and takes the relay away.
 */
const PUSH_HOSTS = Object.freeze([
  "web.push.apple.com",          // Safari / iOS
  "fcm.googleapis.com",          // Chrome, Edge, and everything Chromium
  "updates.push.services.mozilla.com", // Firefox
  "notify.windows.com",          // WNS
]);

/** True when `hostname` is a push service or a subdomain of one. */
export function isPushServiceHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return PUSH_HOSTS.some((known) => host === known || host.endsWith(`.${known}`));
}

// --- Subscription -----------------------------------------------------------

/**
 * Accept exactly the shape PushSubscription.toJSON() produces and nothing else.
 * Bounds are generous but finite: a push endpoint is a long URL, p256dh is a
 * 65-byte point (87 chars), auth is 16 bytes (22 chars).
 */
export function validateSubscription(raw) {
  if (!raw || typeof raw !== "object") return null;
  const endpoint = typeof raw.endpoint === "string" ? raw.endpoint.trim() : "";
  if (!endpoint || endpoint.length > 2048) return null;
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (!isPushServiceHost(url.hostname)) return null;
  const keys = raw.keys && typeof raw.keys === "object" ? raw.keys : null;
  if (!keys) return null;
  const p256dh = typeof keys.p256dh === "string" ? keys.p256dh.replace(/=+$/, "") : "";
  const auth = typeof keys.auth === "string" ? keys.auth.replace(/=+$/, "") : "";
  if (!BASE64URL.test(p256dh) || p256dh.length < 80 || p256dh.length > 100) return null;
  if (!BASE64URL.test(auth) || auth.length < 16 || auth.length > 32) return null;
  return { endpoint, keys: { p256dh, auth } };
}

// --- Sealing (what QStash is allowed to hold) --------------------------------

function keyFor(secret, purpose) {
  return createHash("sha256").update(`spotterai.rest-push.${purpose}:`).update(String(secret)).digest();
}

/** AES-256-GCM. Output is base64url(iv ‖ tag ‖ ciphertext). */
export function seal(value, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(secret, "seal"), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return toBase64Url(Buffer.concat([iv, cipher.getAuthTag(), ciphertext]));
}

/** Inverse of seal(). Null on any tampering or a different secret, never a throw. */
export function open(token, secret) {
  try {
    const buf = fromBase64Url(token);
    if (buf.length < 12 + 16 + 1) return null;
    const decipher = createDecipheriv("aes-256-gcm", keyFor(secret, "seal"), buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    const plain = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
    return JSON.parse(plain);
  } catch {
    return null;
  }
}

// --- Cancel token -------------------------------------------------------------

/**
 * The client gets back `messageId.mac` rather than the bare QStash id, so a
 * cancel needs the value we handed out and cannot be aimed at someone else's
 * message by guessing. Not a secret from the client, only from third parties.
 */
export function signCancelToken(messageId, secret) {
  const mac = createHmac("sha256", keyFor(secret, "cancel")).update(String(messageId)).digest("hex").slice(0, 32);
  return `${messageId}.${mac}`;
}

export function verifyCancelToken(token, secret) {
  if (typeof token !== "string" || token.length > 256) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const messageId = token.slice(0, dot);
  if (!/^[A-Za-z0-9_-]+$/.test(messageId)) return null;
  const expected = signCancelToken(messageId, secret);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return messageId;
}

// --- QStash callback signature -----------------------------------------------

/**
 * Verify the `Upstash-Signature` JWT (HS256) that QStash sends with every
 * callback. Returns the claims, or null. Checks, per Upstash's own receiver:
 * signature under the current OR next signing key (rotation), iss, sub (the
 * exact URL we published to), exp/nbf with tolerance, and `body` = base64url
 * SHA-256 of the RAW request body, which is why the handler must hash the
 * bytes it received and never a re-serialised object.
 */
export function verifyUpstashSignature({ signature, body, url, keys, now = Date.now() / 1000 }) {
  if (typeof signature !== "string" || !Array.isArray(keys) || !keys.length) return null;
  const parts = signature.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  let header;
  let claims;
  try {
    header = JSON.parse(fromBase64Url(h).toString("utf8"));
    claims = JSON.parse(fromBase64Url(p).toString("utf8"));
  } catch {
    return null;
  }
  if (!header || header.alg !== "HS256") return null;

  const signed = Buffer.from(`${h}.${p}`);
  const given = fromBase64Url(s);
  const valid = keys.some((key) => {
    if (!key) return false;
    const mac = createHmac("sha256", key).update(signed).digest();
    return mac.length === given.length && timingSafeEqual(mac, given);
  });
  if (!valid) return null;

  if (claims.iss !== "Upstash") return null;
  if (url && claims.sub !== url) return null;
  if (typeof claims.exp !== "number" || claims.exp < now - CLOCK_TOLERANCE_SEC) return null;
  if (typeof claims.nbf === "number" && claims.nbf > now + CLOCK_TOLERANCE_SEC) return null;

  const bodyHash = toBase64Url(createHash("sha256").update(body ?? "").digest());
  const claimed = String(claims.body || "").replace(/=+$/, "");
  const a = Buffer.from(bodyHash);
  const b = Buffer.from(claimed);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return claims;
}

/** Test helper as much as anything: mint a JWT the way QStash does. */
export function signUpstashJwt({ key, body, url, now = Date.now() / 1000, ttlSec = 300, header = { alg: "HS256", typ: "JWT" }, claims = {} }) {
  const payload = {
    iss: "Upstash",
    sub: url,
    exp: Math.floor(now + ttlSec),
    nbf: Math.floor(now),
    iat: Math.floor(now),
    jti: toBase64Url(randomBytes(12)),
    body: toBase64Url(createHash("sha256").update(body).digest()),
    ...claims,
  };
  const h = toBase64Url(Buffer.from(JSON.stringify(header)));
  const p = toBase64Url(Buffer.from(JSON.stringify(payload)));
  const s = toBase64Url(createHmac("sha256", key).update(`${h}.${p}`).digest());
  return `${h}.${p}.${s}`;
}

// --- Timing -----------------------------------------------------------------

/**
 * Turn a client-reported deadline into a server-clock one.
 *
 * The client's INTERVAL is trustworthy: it comes from the same wall-clock
 * deadline the on-screen timer counts down to. Its EPOCH is not — a phone whose
 * clock is forty seconds fast would otherwise book every push forty seconds
 * after the timer visibly hit zero, every set, with nothing anywhere reporting
 * an error. So the lead is taken from the client and the origin from this
 * server. `clientNowMs` is what the client believed the time was when it sent;
 * without it the epoch is all we have and we fall back to trusting it.
 *
 * Returns { notBefore, endsAt } on the server clock, or null when the lead is
 * not one we would ever push for: already past, or longer than the longest rest.
 */
export function deadlineFor(endsAtMs, clientNowMs, nowMs = Date.now()) {
  const ends = Number(endsAtMs);
  if (!Number.isFinite(ends)) return null;
  const clientNow = Number(clientNowMs);
  const leadMs = Number.isFinite(clientNow) ? ends - clientNow : ends - nowMs;
  const lead = leadMs / 1000;
  if (lead < -5 || lead > MAX_LEAD_SEC) return null;
  const endsAt = Math.round(nowMs + leadMs);
  // Floor rather than round: a second early beats a second late, and push
  // transit adds a second or two of its own.
  return { notBefore: Math.max(Math.floor(nowMs / 1000), Math.floor(endsAt / 1000)), endsAt };
}

/** True when a callback arrives so late that showing "Rest complete" would mislead. */
export function isStale(endsAtMs, nowMs = Date.now()) {
  const ends = Number(endsAtMs);
  return !Number.isFinite(ends) || nowMs - ends > MAX_LATE_SEC * 1000;
}

// --- QStash calls -------------------------------------------------------------

/**
 * Book one callback. `body` is sent as text/plain ON PURPOSE: QStash forwards
 * the Content-Type, and Vercel hands a text/plain body to the callback as the
 * raw string, which is what the signature's body hash is computed over. A JSON
 * content type would arrive pre-parsed and have to be re-serialised to hash.
 */
export async function publishQstashMessage({ fetchImpl, token, destination, body, notBefore, retries = 2, base = QSTASH_URL }) {
  const res = await fetchImpl(`${base}/v2/publish/${destination}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "text/plain",
      "Upstash-Not-Before": String(notBefore),
      "Upstash-Retries": String(retries),
    },
    body,
    signal: AbortSignal.timeout(QSTASH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const err = new Error(`QStash publish failed: ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const json = await res.json();
  const messageId = json && typeof json.messageId === "string" ? json.messageId : "";
  if (!messageId) throw new Error("QStash publish returned no messageId");
  return { messageId };
}

/** Cancel a pending callback. False when it was already delivered (404). */
export async function cancelQstashMessage({ fetchImpl, token, messageId, base = QSTASH_URL }) {
  const res = await fetchImpl(`${base}/v2/messages/${encodeURIComponent(messageId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(QSTASH_TIMEOUT_MS),
  });
  if (res.ok) return true;
  if (res.status === 404) return false;
  const err = new Error(`QStash cancel failed: ${res.status}`);
  err.status = res.status;
  throw err;
}
