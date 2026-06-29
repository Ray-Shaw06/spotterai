/**
 * Tests for the movement-pattern coaching cues that back the Exercise Library.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { MOVEMENT_CUES, PATTERN_LABEL, cuesFor, GENERIC_CUES } from "../movement-cues.js";
import { EXERCISE_DATA } from "../exercise-data.js";

test("every movement cue has setup / howto / mistakes / safety", () => {
  for (const [pattern, c] of Object.entries(MOVEMENT_CUES)) {
    assert.equal(typeof c.setup, "string");
    assert.ok(Array.isArray(c.howto) && c.howto.length, `${pattern} howto`);
    assert.ok(Array.isArray(c.mistakes) && c.mistakes.length, `${pattern} mistakes`);
    assert.equal(typeof c.safety, "string");
  }
});

test("cuesFor falls back to generic cues for an unknown pattern (no crash)", () => {
  assert.equal(cuesFor("not-a-pattern"), GENERIC_CUES);
  assert.ok(cuesFor("squat").howto.length);
});

test("every movement pattern used in the exercise DB has cues + a label", () => {
  const patterns = new Set(EXERCISE_DATA.map((e) => e.movementPattern));
  for (const p of patterns) {
    assert.ok(MOVEMENT_CUES[p], `cues missing for pattern: ${p}`);
    assert.ok(PATTERN_LABEL[p], `label missing for pattern: ${p}`);
  }
});
