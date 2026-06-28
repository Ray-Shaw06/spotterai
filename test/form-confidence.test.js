/**
 * Tests for the form-check confidence logic (extracted from form-coach.js):
 * low visibility must refuse strong advice; clear visibility allows it.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { frameConfidence, confidenceLevel, canJudge, LOW_CONFIDENCE, CONF_LANDMARKS } from "../form-confidence.js";

// Build a fake landmark array where the key joints have a given visibility.
function landmarksAt(visibility) {
  const arr = [];
  for (const i of CONF_LANDMARKS) arr[i] = { visibility };
  return arr;
}

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test("frameConfidence averages visibility of the key joints", () => {
  near(frameConfidence(landmarksAt(0.9)), 0.9);
  near(frameConfidence(landmarksAt(0.3)), 0.3);
});

test("frameConfidence is 0 when nothing is visible / landmarks missing", () => {
  assert.equal(frameConfidence([]), 0);
  assert.equal(frameConfidence(null), 0);
});

test("confidenceLevel buckets high / med / low at the right boundaries", () => {
  assert.equal(confidenceLevel(0.8), "high");
  assert.equal(confidenceLevel(0.75), "high");
  assert.equal(confidenceLevel(0.6), "med");
  assert.equal(confidenceLevel(LOW_CONFIDENCE), "med");
  assert.equal(confidenceLevel(0.4), "low");
});

test("canJudge refuses strong advice below the low-confidence threshold", () => {
  assert.equal(canJudge(0.8), true);
  assert.equal(canJudge(LOW_CONFIDENCE), true);
  assert.equal(canJudge(0.49), false);
  // a barely-visible body must NOT get graded
  assert.equal(canJudge(frameConfidence(landmarksAt(0.2))), false);
});
