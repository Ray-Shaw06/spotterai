/**
 * Per-IP rate limiting for the AI routes.
 *
 * The hole this closes was recorded but left open by the 2026-08-02 input gate
 * (see generate-guard.test.js): that gate stopped an EMPTY body from buying a
 * Gemini call, but a VALID body could still be looped without limit against the
 * one free-tier key that generate, import, chat, estimate and parse all share.
 * Draining it takes plan generation down for every real user.
 *
 * Per the project standard the suite was checked against the bug: reverting
 * checkRateLimit to `return null` fails 9 of these 12. The three survivors are
 * the ones that cannot fail by construction — "unknown routes fail open" is a
 * no-op by design, the clientIp parsing never reaches the limiter, and "under
 * the cap is never blocked" passes trivially when nothing is ever blocked.
 *
 * Times are injected, so nothing here waits on a real clock. The limiter is
 * exercised end to end through a real route in rate-limit-integration.test.js.
 */

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  LIMITS,
  INSTANCE_PER_MINUTE,
  checkRateLimit,
  clientIp,
  enforceRateLimit,
  __resetRateLimitForTests,
} from "../lib/rate-limit.js";

/** Minute- and hour-aligned, so window edges land where the arithmetic says. */
const BASE = Math.floor(1_700_000_000_000 / 3_600_000) * 3_600_000;
const MINUTE = 60_000;
const HOUR = 3_600_000;

const req = (ip) => ({ headers: { "x-forwarded-for": ip } });

beforeEach(() => __resetRateLimitForTests());

test("a caller under the per-minute cap is never blocked", () => {
  for (let i = 0; i < LIMITS.generate.perMinute; i++) {
    assert.equal(checkRateLimit("generate", req("1.1.1.1"), BASE), null, `call ${i + 1} must pass`);
  }
});

test("the call past the per-minute cap is denied, and says how long to wait", () => {
  for (let i = 0; i < LIMITS.generate.perMinute; i++) checkRateLimit("generate", req("1.1.1.1"), BASE);
  const denied = checkRateLimit("generate", req("1.1.1.1"), BASE);
  assert.ok(denied, "the call past the cap must be refused");
  assert.equal(denied.scope, "minute");
  assert.equal(denied.retryAfter, 60, "a full window remains at the window edge");
});

test("denied calls are not counted, so a caller cannot lock itself out", () => {
  // Knock 50 times in one window, far past the cap of 5.
  for (let i = 0; i < 50; i++) checkRateLimit("generate", req("2.2.2.2"), BASE);
  // The next window must hand back the FULL allowance, not a reduced one.
  let allowed = 0;
  for (let i = 0; i < 20; i++) {
    if (checkRateLimit("generate", req("2.2.2.2"), BASE + MINUTE) === null) allowed++;
  }
  assert.equal(allowed, LIMITS.generate.perMinute, "a new window owes the full quota");
});

test("the per-minute window resets when it turns", () => {
  for (let i = 0; i < LIMITS.generate.perMinute; i++) checkRateLimit("generate", req("3.3.3.3"), BASE);
  assert.ok(checkRateLimit("generate", req("3.3.3.3"), BASE), "still capped inside the window");
  assert.equal(checkRateLimit("generate", req("3.3.3.3"), BASE + MINUTE), null, "next minute is clean");
});

test("the hourly cap catches draining that paces itself under the minute cap", () => {
  const { perMinute, perHour } = LIMITS.generate;
  let allowed = 0;
  // Spread across enough minutes that the per-minute tier never trips.
  for (let m = 0; m < perHour / perMinute + 2; m++) {
    for (let i = 0; i < perMinute; i++) {
      if (checkRateLimit("generate", req("4.4.4.4"), BASE + m * MINUTE) === null) allowed++;
    }
  }
  assert.equal(allowed, perHour, "the hour is the ceiling once the minutes stop binding");
  const denied = checkRateLimit("generate", req("4.4.4.4"), BASE + 20 * MINUTE);
  assert.equal(denied?.scope, "hour");
});

test("the hourly window turns too", () => {
  const { perMinute, perHour } = LIMITS.generate;
  for (let m = 0; m < perHour / perMinute; m++) {
    for (let i = 0; i < perMinute; i++) checkRateLimit("generate", req("5.5.5.5"), BASE + m * MINUTE);
  }
  assert.ok(checkRateLimit("generate", req("5.5.5.5"), BASE + 30 * MINUTE), "capped for the rest of the hour");
  assert.equal(checkRateLimit("generate", req("5.5.5.5"), BASE + HOUR), null, "next hour is clean");
});

test("one caller hitting its cap does not block anybody else", () => {
  for (let i = 0; i < LIMITS.generate.perMinute; i++) checkRateLimit("generate", req("6.6.6.6"), BASE);
  assert.ok(checkRateLimit("generate", req("6.6.6.6"), BASE), "the loud caller is capped");
  assert.equal(checkRateLimit("generate", req("7.7.7.7"), BASE), null, "a different caller is unaffected");
});

test("routes hold separate budgets, so chat cannot spend generate's", () => {
  for (let i = 0; i < LIMITS.generate.perMinute; i++) checkRateLimit("generate", req("8.8.8.8"), BASE);
  assert.ok(checkRateLimit("generate", req("8.8.8.8"), BASE), "generate is capped");
  assert.equal(checkRateLimit("chat", req("8.8.8.8"), BASE), null, "chat has its own, larger budget");
});

test("the instance ceiling still bites when the caller rotates IPs", () => {
  // chat is the most permissive route, so this is the cheapest way to reach the
  // instance ceiling — which is the ONLY tier an IP rotation cannot walk around.
  let allowed = 0;
  for (let n = 0; n < 40; n++) {
    for (let i = 0; i < LIMITS.chat.perMinute; i++) {
      if (checkRateLimit("chat", req(`10.0.0.${n}`), BASE) === null) allowed++;
    }
  }
  assert.equal(allowed, INSTANCE_PER_MINUTE, "the instance ceiling is the binding limit");
  const denied = checkRateLimit("chat", req("10.0.1.1"), BASE);
  assert.equal(denied?.scope, "instance");
});

test("x-forwarded-for is read from the right, so a prepended entry cannot spoof it", () => {
  // A client controls what it PREPENDS; only the last hop is appended by a proxy
  // we trust. Reading from the left would let one caller mint unlimited buckets.
  assert.equal(clientIp({ headers: { "x-forwarded-for": "9.9.9.9, 203.0.113.7" } }), "203.0.113.7");
  assert.equal(clientIp({ headers: { "x-real-ip": "198.51.100.4" } }), "198.51.100.4");
  assert.equal(clientIp({ headers: {} }), "unknown");
  assert.equal(clientIp({}), "unknown");
});

test("an unrouted name fails open rather than locking a caller out", () => {
  for (let i = 0; i < 500; i++) {
    assert.equal(checkRateLimit("not-a-route", req("1.2.3.4"), BASE), null);
  }
});

test("enforceRateLimit answers 429 with Retry-After and reports that it did", () => {
  const out = { statusCode: null, body: null, headers: {} };
  const res = {
    setHeader: (k, v) => (out.headers[k] = v),
    status(c) { out.statusCode = c; return this; },
    json(b) { out.body = b; return this; },
  };
  for (let i = 0; i < LIMITS.generate.perMinute; i++) {
    assert.equal(enforceRateLimit("generate", req("11.11.11.11"), res, BASE), false, "under the cap it must not answer");
  }
  assert.equal(enforceRateLimit("generate", req("11.11.11.11"), res, BASE), true, "past the cap it answers and says so");
  assert.equal(out.statusCode, 429);
  assert.equal(out.headers["Retry-After"], "60");
  assert.match(out.body.error, /too many requests/i);
  assert.doesNotMatch(JSON.stringify(out.body), /minute|hour|instance/i, "the response must not teach a caller how to pace around the tiers");
});
