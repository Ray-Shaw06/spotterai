/**
 * Per-IP rate limiting for the serverless AI functions.
 * ----------------------------------------------------------------------------
 * `test/generate-guard.test.js` already records the threat: /api/generate is
 * unauthenticated, and an empty body used to buy a full Gemini call. That gate
 * closed the free-call hole but not the volume one — a VALID body could still be
 * looped without limit, and generate, import, chat, estimate and parse all share
 * ONE free-tier key. Draining it takes plan generation down for every real user,
 * which is why this sits in front of all five rather than only the expensive one.
 *
 * Fixed windows, counted in memory. Two per caller (a minute for bursts, an hour
 * for sustained draining) plus one per-instance ceiling across all routes, which
 * is the only tier that does anything when a caller rotates IPs.
 *
 * THE LIMIT THIS CANNOT ENFORCE, stated plainly: the counters are module scope,
 * so they are per serverless INSTANCE. Vercel running N warm instances means the
 * effective ceiling is N x these numbers. That stops a loop from one client
 * completely and blunts a distributed one; it is not an accounting boundary.
 * The same trade-off `api/audit-telemetry.js` makes for its daily cap, for the
 * same reason: a backend-free architecture has nowhere exact to keep the count,
 * and the Firestore-backed alternative would spend the shared read quota that
 * user sync depends on, on every single AI call.
 *
 * Memory is bounded by construction. When a window turns, its whole Map is
 * dropped and replaced rather than swept, so nothing accumulates past one
 * window of distinct callers, and a denied request is never counted — a caller
 * at the cap gets exactly `perMinute` successes per window instead of locking
 * itself out for as long as it keeps knocking.
 *
 * The HOUR map is the one worth doing the arithmetic on, since it holds entries
 * for sixty times as long: INSTANCE_PER_MINUTE caps how many NEW callers can be
 * recorded per minute, so it tops out around 18,000 entries (a few MB) even
 * against an attacker rotating a fresh IP every request. The instance ceiling is
 * what bounds it, not the window.
 */

import { createHash } from "node:crypto";

/**
 * Per-route caps, sized against what the route costs and how a real person uses
 * it, NOT to one shared number: chat is conversational and estimate is the photo
 * path, which the 2026-08-16 funnel pull showed out-converting everything else.
 * Strangling either to protect generate would cost more than the attack does.
 */
export const LIMITS = {
  // maxDuration 60, 4096 output tokens, up to MAX_RETRIES+1 model calls.
  generate: { perMinute: 5, perHour: 30 },
  import: { perMinute: 5, perHour: 30 },
  // Image tokens make this the priciest per call, but it is also the best
  // front door the product has. Generous enough that a person logging a few
  // meals never sees it.
  estimate: { perMinute: 10, perHour: 60 },
  parse: { perMinute: 15, perHour: 100 },
  // A back-and-forth with the coach is many calls in a short span by design.
  chat: { perMinute: 20, perHour: 200 },
};

/** Across every route on ONE instance. The only tier an IP rotation still hits. */
export const INSTANCE_PER_MINUTE = 300;

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

let minuteWindow = { key: -1, hits: new Map(), total: 0 };
let hourWindow = { key: -1, hits: new Map() };

/**
 * The caller's IP as a single trimmed string.
 *
 * Shared rather than re-derived: `api/audit-telemetry.js` needs the same value
 * for its own throttle, and this project has already been bitten once by the
 * same logic existing in a fourth place nobody grepped (the Library exercise
 * matcher, 2026-08-14). One definition, two callers.
 *
 * `x-forwarded-for` is read from the RIGHT, since a client can prepend entries
 * but cannot forge what the last proxy appends.
 */
export function clientIp(req) {
  const pick = (h) => (Array.isArray(h) ? h[0] : h);
  const realIp = pick(req?.headers?.["x-real-ip"]);
  const forwarded = pick(req?.headers?.["x-forwarded-for"]);
  const fromForwarded = forwarded ? String(forwarded).split(",").pop().trim() : "";
  return String(realIp || fromForwarded || "unknown").trim();
}

/** Roll `state` onto `key`, dropping the previous window wholesale. */
function roll(state, key) {
  if (state.key !== key) {
    state.key = key;
    state.hits = new Map();
    state.total = 0;
  }
  return state;
}

/**
 * Decide whether one request may proceed. Pure apart from the module counters,
 * and takes `now` so the window edges can be driven in tests without waiting.
 *
 * @returns {null | { retryAfter: number, scope: "instance" | "minute" | "hour" }}
 *   null when allowed. Counters advance ONLY on the allowed path.
 */
export function checkRateLimit(route, req, now = Date.now()) {
  const limit = LIMITS[route];
  if (!limit) return null; // Unknown route: fail open rather than lock out a caller.

  const min = roll(minuteWindow, Math.floor(now / MINUTE_MS));
  const hr = roll(hourWindow, Math.floor(now / HOUR_MS));
  const secondsLeft = (ms) => Math.max(1, Math.ceil((ms - (now % ms)) / 1000));

  if (min.total >= INSTANCE_PER_MINUTE) {
    return { retryAfter: secondsLeft(MINUTE_MS), scope: "instance" };
  }

  const id = createHash("sha256").update(`${route}:${clientIp(req)}`).digest("hex").slice(0, 32);
  if ((min.hits.get(id) || 0) >= limit.perMinute) {
    return { retryAfter: secondsLeft(MINUTE_MS), scope: "minute" };
  }
  if ((hr.hits.get(id) || 0) >= limit.perHour) {
    return { retryAfter: secondsLeft(HOUR_MS), scope: "hour" };
  }

  min.hits.set(id, (min.hits.get(id) || 0) + 1);
  min.total += 1;
  hr.hits.set(id, (hr.hits.get(id) || 0) + 1);
  return null;
}

/**
 * Apply the limit to a Vercel-style req/res pair.
 *
 * @returns {boolean} true when the request was DENIED and already answered, so
 *   the handler must return immediately and spend nothing.
 */
export function enforceRateLimit(route, req, res, now = Date.now()) {
  const denied = checkRateLimit(route, req, now);
  if (!denied) return false;
  res.setHeader?.("Retry-After", String(denied.retryAfter));
  // Deliberately the same message whichever tier tripped: telling a caller
  // which ceiling they hit tells them how to pace around it.
  res.status(429).json({
    error: "Too many requests. This is a free service on a shared quota — wait a moment and try again.",
  });
  return true;
}

/** Test seam: drop all counters so window behaviour can be driven from zero. */
export function __resetRateLimitForTests() {
  minuteWindow = { key: -1, hits: new Map(), total: 0 };
  hourWindow = { key: -1, hits: new Map() };
}
