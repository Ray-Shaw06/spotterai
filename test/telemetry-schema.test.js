import test from "node:test";
import assert from "node:assert/strict";
import { INJURY_RULES } from "../evaluator.js";
import {
  sanitizeTelemetry, scoreBucket, CHECK_IDS, CHECK_STATUSES,
  SOURCES, SCORE_BUCKETS, GOALS, EXPERIENCES, TELEMETRY_VERSION,
} from "../lib/telemetry-schema.js";

const valid = () => ({
  v: TELEMETRY_VERSION,
  evaluatorVersion: "v1.3.0",
  source: "generate",
  scoreBucket: "85-100",
  daysCount: 4,
  exerciseCount: 22,
  goal: "Hypertrophy",
  experience: "Intermediate",
  checks: [{ id: "rest_days", status: "pass" }, { id: "muscle_balance", status: "warn" }],
});

test("a fully valid payload survives unchanged", () => {
  assert.deepEqual(sanitizeTelemetry(valid()), valid());
});

test("score bucketing is correct at every boundary", () => {
  assert.equal(scoreBucket(0), "0-59");
  assert.equal(scoreBucket(59), "0-59");
  assert.equal(scoreBucket(60), "60-74");
  assert.equal(scoreBucket(74), "60-74");
  assert.equal(scoreBucket(75), "75-84");
  assert.equal(scoreBucket(84), "75-84");
  assert.equal(scoreBucket(85), "85-100");
  assert.equal(scoreBucket(100), "85-100");
  assert.equal(scoreBucket("nope"), null);
  assert.equal(scoreBucket(undefined), null);
});

test("an unknown check id is rejected outright", () => {
  const p = valid();
  p.checks = [{ id: "secret_check", status: "pass" }];
  assert.equal(sanitizeTelemetry(p), null);
});

test("an unknown check status is rejected outright", () => {
  const p = valid();
  p.checks = [{ id: "rest_days", status: "catastrophe" }];
  assert.equal(sanitizeTelemetry(p), null);
});

test("every injury id derived from INJURY_RULES is accepted", () => {
  const keys = Object.keys(INJURY_RULES);
  assert.ok(keys.length > 0, "INJURY_RULES must not be empty");
  for (const key of keys) {
    const p = valid();
    p.checks = [{ id: `injury_${key}`, status: "fail" }];
    assert.notEqual(sanitizeTelemetry(p), null, `injury_${key} should be allowed`);
  }
  assert.equal(CHECK_IDS.includes(`injury_${keys[0]}`), true);
});

test("free text and extra fields never reach the output", () => {
  const p = { ...valid(), programName: "My Program", notes: "private", exerciseName: "Back Squat" };
  const clean = sanitizeTelemetry(p);
  const serialized = JSON.stringify(clean);
  assert.doesNotMatch(serialized, /My Program|private|Back Squat|programName|notes|exerciseName/);
  assert.deepEqual(Object.keys(clean).sort(), Object.keys(valid()).sort());
});

test("a check entry carrying extra keys is stripped down to id and status", () => {
  const p = valid();
  p.checks = [{ id: "rest_days", status: "pass", detail: "Seven straight training days" }];
  const clean = sanitizeTelemetry(p);
  assert.deepEqual(clean.checks, [{ id: "rest_days", status: "pass" }]);
  assert.doesNotMatch(JSON.stringify(clean), /Seven straight/);
});

test("out-of-range counts are rejected", () => {
  assert.equal(sanitizeTelemetry({ ...valid(), daysCount: 0 }), null);
  assert.equal(sanitizeTelemetry({ ...valid(), daysCount: 8 }), null);
  assert.equal(sanitizeTelemetry({ ...valid(), exerciseCount: -1 }), null);
  assert.equal(sanitizeTelemetry({ ...valid(), exerciseCount: 141 }), null);
  assert.equal(sanitizeTelemetry({ ...valid(), daysCount: 4.5 }), null);
});

test("bad enums and versions are rejected", () => {
  assert.equal(sanitizeTelemetry({ ...valid(), source: "elsewhere" }), null);
  assert.equal(sanitizeTelemetry({ ...valid(), goal: "Aesthetics" }), null);
  assert.equal(sanitizeTelemetry({ ...valid(), experience: "Elite" }), null);
  assert.equal(sanitizeTelemetry({ ...valid(), scoreBucket: "90-100" }), null);
  assert.equal(sanitizeTelemetry({ ...valid(), evaluatorVersion: "1.3.0" }), null);
  assert.equal(sanitizeTelemetry({ ...valid(), v: 99 }), null);
});

test("junk input is rejected rather than throwing", () => {
  assert.equal(sanitizeTelemetry(null), null);
  assert.equal(sanitizeTelemetry("string"), null);
  assert.equal(sanitizeTelemetry([]), null);
  assert.equal(sanitizeTelemetry({}), null);
  assert.equal(sanitizeTelemetry({ ...valid(), checks: "nope" }), null);
  assert.equal(sanitizeTelemetry({ ...valid(), checks: [] }), null);
});

test("the constants are frozen so nothing can widen them at runtime", () => {
  for (const frozen of [CHECK_IDS, CHECK_STATUSES, SOURCES, SCORE_BUCKETS, GOALS, EXPERIENCES]) {
    assert.ok(Object.isFrozen(frozen));
  }
});

import { GOAL_OPTIONS, TRAINING_AGE_OPTIONS } from "../onboarding.js";

test("the goal and experience enums match what onboarding can actually produce", () => {
  for (const option of GOAL_OPTIONS) {
    assert.ok(GOALS.includes(option.goal), `onboarding can produce goal "${option.goal}" but telemetry would reject it`);
  }
  for (const option of TRAINING_AGE_OPTIONS) {
    assert.ok(EXPERIENCES.includes(option.experience), `onboarding can produce experience "${option.experience}" but telemetry would reject it`);
  }
});
