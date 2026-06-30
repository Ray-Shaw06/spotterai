/**
 * Tests for the animated movement demos: each known pattern is rigged, unknown
 * patterns fall back to a neutral idle, and the markup is self-contained.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { patternAnimation } from "../exercise-anim.js";

const PATTERNS = ["squat", "lunge", "hinge", "horizontal_push", "vertical_push", "horizontal_pull", "vertical_pull", "isolation", "plyometric", "isometric"];

test("every known movement pattern produces a rigged figure with a caption", () => {
  for (const p of PATTERNS) {
    const html = patternAnimation(p);
    assert.match(html, new RegExp(`data-anim="${p}"`));
    assert.match(html, /class="ex-fig"/);
    assert.match(html, /<figcaption/);
  }
});

test("unknown / missing patterns fall back to a neutral idle (no crash)", () => {
  assert.match(patternAnimation("nonsense"), /data-anim="idle"/);
  assert.match(patternAnimation(undefined), /data-anim="idle"/);
  assert.match(patternAnimation(""), /data-anim="idle"/);
});

test("the demo is decorative for assistive tech (aria-hidden svg + labelled figure)", () => {
  const html = patternAnimation("squat");
  assert.match(html, /aria-label="Animated movement demonstration"/);
  assert.match(html, /aria-hidden="true"/);
});
