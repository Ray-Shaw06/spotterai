/**
 * /api/generate input gate.
 *
 * Found live on spotterai.xyz by /qa on 2026-08-02:
 *   curl -X POST https://spotterai.xyz/api/generate -d '{}'  ->  200 + a full plan
 *
 * buildPrompt defaults every field, so an empty body still produced a real
 * Gemini call. /api/generate is the most expensive of the four functions
 * (maxDuration 60, MAX_OUTPUT_TOKENS 4096, up to MAX_RETRIES+1 model calls) and
 * shares one free-tier key with chat, estimate and parse — so an unauthenticated
 * loop against it takes plan generation down for everyone.
 *
 * These tests call the handler directly with a fake req/res. The gate runs
 * before the GEMINI_API_KEY lookup, so nothing here touches the network.
 */

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import handler from "../api/generate.js";
import { __resetRateLimitForTests } from "../lib/rate-limit.js";

/** Minimal Vercel-style res double: records status + payload, never sends. */
function fakeRes() {
  const out = { statusCode: null, body: null, headers: {} };
  return {
    out,
    setHeader(k, v) {
      out.headers[k] = v;
    },
    status(code) {
      out.statusCode = code;
      return this;
    },
    json(payload) {
      out.body = payload;
      return this;
    },
  };
}

// These tests are about the INPUT gate, and every one of them posts as the
// same anonymous caller. Without this they trip the per-IP rate limit that now
// sits in front of the gate, and a 429 would look like the gate rejecting a
// body it actually accepts.
beforeEach(() => __resetRateLimitForTests());

// Each post() is a DISTINCT caller. The gate does not care who is asking, so
// tying these cases to one IP would only couple them to the per-IP rate limit
// that now runs first, and a 429 there would read as the gate rejecting a body
// it actually accepts. That is precisely what happened when the limit landed.
let caller = 0;
async function post(body) {
  const res = fakeRes();
  const headers = { "x-forwarded-for": "203.0.113." + ((caller++ % 250) + 1) };
  await handler({ method: "POST", body, headers }, res);
  return res.out;
}

test("REGRESSION: an empty body is rejected instead of spending a Gemini call", async () => {
  const r = await post({});
  assert.equal(r.statusCode, 400, "empty POST must not reach the model");
  assert.match(r.body.error, /profile/i);
});

test("bodies with no recognised profile field are rejected", async () => {
  for (const body of [null, undefined, [], "", { random: "junk" }, { goal: "" }, { equipment: [] }]) {
    const r = await post(body);
    assert.equal(r.statusCode, 400, `should reject: ${JSON.stringify(body)}`);
  }
});

test("a malformed JSON string body is a 400, not a crash", async () => {
  const r = await post("{not json");
  assert.equal(r.statusCode, 400);
  assert.match(r.body.error, /Invalid request body/i);
});

test("the gate runs before the API key check, so junk cannot probe server config", async () => {
  // With no GEMINI_API_KEY set (the case in CI), a junk request must still get
  // a plain 400 rather than the 500 that names the missing variable.
  const saved = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const r = await post({});
    assert.equal(r.statusCode, 400);
    assert.doesNotMatch(JSON.stringify(r.body), /GEMINI_API_KEY/);
  } finally {
    if (saved !== undefined) process.env.GEMINI_API_KEY = saved;
  }
});

test("a real onboarding payload passes the gate", async () => {
  // Exactly the shape mapOnboardingToInputs returns. It must get past the gate;
  // with no key configured it stops at the 500, which proves the gate let it by.
  const saved = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const r = await post({
      goal: "Build muscle",
      experience: "Beginner",
      daysPerWeek: 3,
      sessionLength: 45,
      equipment: ["Bodyweight"],
      injuries: [],
      injuryNotes: "",
    });
    assert.equal(r.statusCode, 500, "a valid profile must pass the gate");
    assert.match(r.body.error, /GEMINI_API_KEY/);
  } finally {
    if (saved !== undefined) process.env.GEMINI_API_KEY = saved;
  }
});

test("a single field is enough, so an older client shape is not broken", async () => {
  const saved = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    for (const body of [{ goal: "Get stronger" }, { daysPerWeek: 4 }, { equipment: ["Full gym"] }]) {
      const r = await post(body);
      assert.equal(r.statusCode, 500, `should pass the gate: ${JSON.stringify(body)}`);
    }
  } finally {
    if (saved !== undefined) process.env.GEMINI_API_KEY = saved;
  }
});

test("non-POST methods are still refused with Allow set", async () => {
  const res = fakeRes();
  await handler({ method: "GET" }, res);
  assert.equal(res.out.statusCode, 405);
  assert.equal(res.out.headers.Allow, "POST");
});
