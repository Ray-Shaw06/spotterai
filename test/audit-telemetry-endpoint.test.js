import test from "node:test";
import assert from "node:assert/strict";
import handler, { DAILY_AUDIT_CAP, IP_HOURLY_CAP, dayKey, counterUpdates } from "../api/audit-telemetry.js";

/** Minimal res double matching what the handler uses. */
function makeRes() {
  const res = { statusCode: null, body: null, ended: false };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; res.ended = true; return res; };
  res.end = () => { res.ended = true; return res; };
  return res;
}

const validBody = {
  v: 1,
  evaluatorVersion: "v1.3.0",
  source: "generate",
  scoreBucket: "85-100",
  daysCount: 4,
  exerciseCount: 22,
  goal: "Hypertrophy",
  experience: "Intermediate",
  checks: [{ id: "rest_days", status: "pass" }, { id: "muscle_balance", status: "warn" }],
};

test("a day key is the UTC date", () => {
  assert.equal(dayKey(new Date("2026-08-18T23:59:59Z")), "2026-08-18");
  assert.equal(dayKey(new Date("2026-08-19T00:00:01Z")), "2026-08-19");
});

test("the caps are set to the values the spec commits to", () => {
  assert.equal(DAILY_AUDIT_CAP, 5000);
  assert.equal(IP_HOURLY_CAP, 60);
});

test("counter updates increment exactly the documented paths", () => {
  const increment = (n) => ({ __increment: n });
  const updates = counterUpdates(validBody, { increment });
  assert.deepEqual(updates["audits"], { __increment: 1 });
  assert.deepEqual(updates["byCheck.rest_days.pass"], { __increment: 1 });
  assert.deepEqual(updates["byCheck.muscle_balance.warn"], { __increment: 1 });
  assert.deepEqual(updates["byScoreBucket.85-100"], { __increment: 1 });
  assert.deepEqual(updates["byGoal.Hypertrophy"], { __increment: 1 });
  assert.deepEqual(updates["byExperience.Intermediate"], { __increment: 1 });
  assert.deepEqual(updates["byDaysCount.4"], { __increment: 1 });
});

test("counter updates never contain free text or a raw score", () => {
  const updates = counterUpdates(validBody, { increment: (n) => n });
  const keys = JSON.stringify(Object.keys(updates));
  assert.doesNotMatch(keys, /score"?:\s*\d|exerciseName|notes|programName/);
  assert.equal(Object.keys(updates).some((k) => k.startsWith("byScore.")), false);
});

test("GET serves the aggregate, and serves an empty one when unconfigured", async () => {
  const saved = process.env.FIREBASE_SERVICE_ACCOUNT;
  delete process.env.FIREBASE_SERVICE_ACCOUNT;
  const res = makeRes();
  await handler({ method: "GET", body: null, headers: {}, query: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { audits: 0, byCheck: {}, since: null });
  if (saved !== undefined) process.env.FIREBASE_SERVICE_ACCOUNT = saved;
});

test("a method that is neither GET nor POST is refused", async () => {
  const res = makeRes();
  await handler({ method: "PUT", body: null, headers: {}, setHeader: () => {}, query: {} }, res);
  assert.equal(res.statusCode, 405);
});

test("with no service account configured the handler accepts and writes nothing", async () => {
  const saved = process.env.FIREBASE_SERVICE_ACCOUNT;
  delete process.env.FIREBASE_SERVICE_ACCOUNT;
  const res = makeRes();
  await handler({ method: "POST", body: validBody, headers: {}, query: {} }, res);
  assert.equal(res.statusCode, 204);
  if (saved !== undefined) process.env.FIREBASE_SERVICE_ACCOUNT = saved;
});

test("an invalid payload is accepted and dropped, never surfaced as an error", async () => {
  const saved = process.env.FIREBASE_SERVICE_ACCOUNT;
  delete process.env.FIREBASE_SERVICE_ACCOUNT;
  const res = makeRes();
  await handler({ method: "POST", body: { v: 1, checks: [{ id: "secret", status: "pass" }] }, headers: {}, query: {} }, res);
  assert.equal(res.statusCode, 204);
  if (saved !== undefined) process.env.FIREBASE_SERVICE_ACCOUNT = saved;
});
