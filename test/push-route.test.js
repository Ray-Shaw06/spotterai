import test from "node:test";
import assert from "node:assert/strict";

import { callbackUrl, rawBody, parseJson, queryParam, header, dailyCap } from "../lib/push-route.js";
import { deadlineFor, isStale } from "../lib/rest-push.js";

test("callbackUrl names the given route on the server's own origin", () => {
  assert.equal(callbackUrl("/api/reminders", { VERCEL_PROJECT_PRODUCTION_URL: "spotterai.example" }), "https://spotterai.example/api/reminders");
  assert.equal(callbackUrl("/api/rest-push", { REST_PUSH_ORIGIN: "https://custom.example/x" }), "https://custom.example/api/rest-push");
  assert.equal(callbackUrl("/api/reminders", {}), null);
  assert.equal(callbackUrl("/api/reminders", { REST_PUSH_ORIGIN: "http://insecure.example" }), null);
});

test("body and header helpers read what Vercel hands a function", () => {
  assert.equal(rawBody(Buffer.from("hi")), "hi");
  assert.equal(rawBody({ a: 1 }), '{"a":1}');
  assert.deepEqual(parseJson('{"a":1}'), { a: 1 });
  assert.equal(parseJson("nope"), null);
  assert.equal(queryParam({ url: "/api/reminders?token=abc" }, "token"), "abc");
  assert.equal(header({ headers: { "upstash-signature": ["x", "y"] } }, "upstash-signature"), "x");
});

test("dailyCap counts per UTC day and resets", () => {
  const cap = dailyCap(2);
  const day1 = Date.UTC(2026, 8, 25, 12);
  assert.equal(cap.claim(day1), true);
  assert.equal(cap.claim(day1), true);
  assert.equal(cap.claim(day1), false);
  assert.equal(cap.claim(day1 + 24 * 3600 * 1000), true, "a new UTC day starts a new count");
  cap.reset();
  assert.equal(cap.claim(day1), true);
});

test("deadlineFor and isStale take a route's own limits", () => {
  const now = Date.UTC(2026, 8, 25, 12);
  const threeDays = now + 3 * 24 * 3600 * 1000;
  assert.equal(deadlineFor(threeDays, now, now), null, "rest push still stops at an hour");
  assert.equal(deadlineFor(threeDays, now, now, 7 * 24 * 3600).endsAt, threeDays);
  assert.equal(isStale(now - 10 * 60 * 1000, now), true, "rest push: ten minutes late is stale");
  assert.equal(isStale(now - 10 * 60 * 1000, now, 30 * 60), false, "reminders: ten minutes late is fine");
});
