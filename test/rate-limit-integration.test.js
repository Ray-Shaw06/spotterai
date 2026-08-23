/**
 * The rate limit, exercised through a real route.
 *
 * Separate from rate-limit.test.js so each commit stands on its own: the
 * limiter module lands before anything calls it, and this file lands with the
 * wiring that makes it true. Running it against the unwired routes is exactly
 * the failure a bisect should report.
 */

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { LIMITS, __resetRateLimitForTests } from "../lib/rate-limit.js";
import generateHandler from "../api/generate.js";

beforeEach(() => __resetRateLimitForTests());

test("INTEGRATION: /api/generate refuses past the cap BEFORE it looks for the key", async () => {
  // With no GEMINI_API_KEY, a body that passes the input gate stops at a 500 that
  // names the variable (generate-guard.test.js pins that). So a 500 here proves
  // the request got through, and a 429 proves the limit stopped it EARLIER than
  // the key lookup — i.e. an over-cap request costs nothing at all.
  const valid = { goal: "Build muscle", experience: "Beginner", daysPerWeek: 3, equipment: ["Bodyweight"] };
  const saved = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const post = async () => {
      const out = { statusCode: null, body: null, headers: {} };
      const res = {
        setHeader: (k, v) => (out.headers[k] = v),
        status(c) { out.statusCode = c; return this; },
        json(b) { out.body = b; return this; },
      };
      await generateHandler({ method: "POST", body: valid, headers: { "x-forwarded-for": "12.12.12.12" } }, res);
      return out;
    };
    for (let i = 0; i < LIMITS.generate.perMinute; i++) {
      assert.equal((await post()).statusCode, 500, `call ${i + 1} must reach the key lookup`);
    }
    const capped = await post();
    assert.equal(capped.statusCode, 429, "the call past the cap must be refused");
    assert.doesNotMatch(JSON.stringify(capped.body), /GEMINI_API_KEY/, "a refused call must not reach, or leak, server config");
  } finally {
    if (saved !== undefined) process.env.GEMINI_API_KEY = saved;
  }
});
