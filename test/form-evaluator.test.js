/**
 * Tests for the form evaluator's accuracy guards:
 *   • chooseSide — L/R hysteresis so the tracked side doesn't flip-flop.
 *   • per-exercise reliability — gated on the joints each move actually measures.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { chooseSide, chooseModelTier, EXERCISES, resetSideSelector } from "../form-evaluator.js";

// ---- chooseSide (pure hysteresis) -----------------------------------------

test("with no prior side, picks the more visible one", () => {
  assert.equal(chooseSide(0.3, 0.9, null), "R");
  assert.equal(chooseSide(0.9, 0.3, null), "L");
});

test("sticks with the current side when the other is only slightly better", () => {
  // left (0.55) edges out right (0.50) but not by the 0.15 margin → stay R.
  assert.equal(chooseSide(0.55, 0.5, "R"), "R");
});

test("flips only when the other side is clearly more visible", () => {
  assert.equal(chooseSide(0.8, 0.5, "R"), "L"); // 0.8 ≥ 0.5 + 0.15 → flip
  assert.equal(chooseSide(0.5, 0.8, "L"), "R");
});

test("an exact tie never flips (no oscillation on near-frontal views)", () => {
  assert.equal(chooseSide(0.5, 0.5, "R"), "R");
  assert.equal(chooseSide(0.5, 0.5, "L"), "L");
});

// ---- chooseModelTier (adaptive pose model) --------------------------------

test("desktop-class hardware gets the heavy model", () => {
  assert.equal(chooseModelTier({ fine: true, coarse: false, cores: 8, mem: 8 }), "heavy");
  assert.equal(chooseModelTier({ fine: true, coarse: false, cores: 12, mem: 0 }), "heavy"); // mem unknown → allowed
});

test("touch / mobile devices stay on full", () => {
  assert.equal(chooseModelTier({ fine: false, coarse: true, cores: 8, mem: 8 }), "full"); // phone
  assert.equal(chooseModelTier({ fine: true, coarse: true, cores: 16, mem: 16 }), "full"); // touchscreen laptop → conservative
});

test("underpowered desktops stay on full", () => {
  assert.equal(chooseModelTier({ fine: true, coarse: false, cores: 4, mem: 16 }), "full"); // too few cores
  assert.equal(chooseModelTier({ fine: true, coarse: false, cores: 8, mem: 4 }), "full");  // too little RAM
});

test("no signals → safe default of full", () => {
  assert.equal(chooseModelTier({}), "full");
  assert.equal(chooseModelTier(), "full");
});

// ---- per-exercise reliability (F1) ----------------------------------------

// Minimal MediaPipe-style frame; visMap overrides specific landmark visibility.
function frame(visMap = {}) {
  const a = [];
  for (let i = 0; i < 33; i++) a[i] = { x: 0.5, y: 0.5, z: 0, visibility: 0.9 };
  const pos = { 12: [0.5, 0.2], 14: [0.5, 0.4], 16: [0.5, 0.6], 24: [0.5, 0.5], 26: [0.55, 0.7], 28: [0.5, 0.9] };
  for (const [i, [x, y]] of Object.entries(pos)) a[i] = { ...a[i], x, y };
  // left side kept lower so side() settles on the right
  for (const i of [11, 23, 25]) a[i] = { ...a[i], visibility: 0.3 };
  for (const [i, v] of Object.entries(visMap)) a[i] = { ...a[i], visibility: v };
  return a;
}

test("squat reliability requires the ankle (which its knee angle uses)", () => {
  resetSideSelector();
  assert.equal(EXERCISES.squat.metrics(frame(), frame()).reliable, true);
  resetSideSelector();
  // ankle (R = 28) occluded → the knee angle is untrustworthy → not reliable.
  assert.equal(EXERCISES.squat.metrics(frame({ 28: 0.15 }), frame()).reliable, false);
});

test("push-up reliability follows the wrist, not the legs", () => {
  resetSideSelector();
  assert.equal(EXERCISES.pushup.metrics(frame(), frame()).reliable, true);
  resetSideSelector();
  // wrist (R = 16) occluded but legs fully visible → old code said reliable; now false.
  assert.equal(EXERCISES.pushup.metrics(frame({ 16: 0.15, 24: 0.9, 26: 0.9 }), frame()).reliable, false);
});
