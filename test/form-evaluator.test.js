/**
 * Tests for the form evaluator's accuracy guards:
 *   • chooseSide — L/R hysteresis so the tracked side doesn't flip-flop.
 *   • per-exercise reliability — gated on the joints each move actually measures.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { chooseSide, chooseModelTier, EXERCISES, resetSideSelector, RepCounter, FORM_THRESHOLDS } from "../form-evaluator.js";

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

// ---- pull-up & dip (Release 2) --------------------------------------------

const P = FORM_THRESHOLDS.pullup;

function runReps(counter, seq) {
  let completed = [];
  for (const [t, elbow] of seq) {
    const r = counter.update({ elbow, reliable: true }, t);
    if (r.justCompleted) completed.push(counter.lastRep);
  }
  return completed;
}

test("pull-up counter counts a clean hang→pull→hang cycle as one rep", () => {
  const c = new RepCounter(EXERCISES.pullup);
  const done = runReps(c, [[0, 165], [200, 110], [400, 70], [800, 165]]);
  assert.equal(c.reps, 1);
  assert.equal(done[0].depth.level, "good");
  assert.equal(done[0].depth.text, "Full pull");
});

test("pull-up depth verdicts: almost vs partial", () => {
  // Peak flexion 100° → inside SHALLOW_PEAK → "Almost".
  const c1 = new RepCounter(EXERCISES.pullup);
  const d1 = runReps(c1, [[0, 165], [200, 100], [800, 165]]);
  assert.equal(d1[0].depth.text, "Almost — chin over the bar");
  // Peak flexion 112° → beyond SHALLOW_PEAK but enough ROM → "Partial rep".
  const c2 = new RepCounter(EXERCISES.pullup);
  const d2 = runReps(c2, [[0, 168], [200, 112], [800, 168]]);
  assert.equal(d2[0].depth.text, "Partial rep — aim for full range");
});

test("pull-up counter rejects tiny bounces (min range of motion)", () => {
  const c = new RepCounter(EXERCISES.pullup);
  // Dips below DOWN but total ROM < MIN_RANGE (112→150 = 38 < 40).
  runReps(c, [[0, 150], [200, 112], [800, 151]]);
  assert.equal(c.reps, 0);
});

test("pull-up cues: chin over the bar vs pull higher, near the top only", () => {
  const ex = EXERCISES.pullup;
  const base = { reliable: true, torsoSwing: 5 };
  assert.deepEqual(
    ex.cues({ ...base, elbow: 90, chinOverBar: true }).map((c) => c.text),
    ["Chin over the bar"]
  );
  assert.deepEqual(
    ex.cues({ ...base, elbow: 90, chinOverBar: false }).map((c) => c.text),
    ["Pull higher — chin to the bar"]
  );
  // Mid-pull (elbow 120) says nothing about the chin.
  assert.deepEqual(ex.cues({ ...base, elbow: 120, chinOverBar: false }), []);
});

test("pull-up swing cue fires only past the threshold", () => {
  const ex = EXERCISES.pullup;
  const swing = ex.cues({ reliable: true, elbow: 140, torsoSwing: P.MAX_SWING + 5, chinOverBar: false });
  assert.equal(swing[0].text, "Minimize the swing — quiet body");
  assert.deepEqual(ex.cues({ reliable: true, elbow: 140, torsoSwing: P.MAX_SWING - 5, chinOverBar: false }), []);
});

test("pull-up reliability: one clearly visible arm is enough (front-on)", () => {
  resetSideSelector();
  // Default frame: left shoulder dim (0.3) but right arm fully visible → reliable.
  assert.equal(EXERCISES.pullup.metrics(frame(), frame()).reliable, true);
  resetSideSelector();
  // Occlude the right arm too → neither arm trustworthy → refuse.
  assert.equal(EXERCISES.pullup.metrics(frame({ 12: 0.15, 14: 0.15 }), frame()).reliable, false);
});

test("pull-up chin proxy: nose above the hands reads as chin over bar", () => {
  resetSideSelector();
  const f = frame();
  f[0] = { ...f[0], y: 0.35 }; // nose above both wrists (0.5, 0.6)
  assert.equal(EXERCISES.pullup.metrics(f, frame()).chinOverBar, true);
  resetSideSelector();
  const g = frame();
  g[0] = { ...g[0], y: 0.7 }; // nose below the hands — still hanging
  assert.equal(EXERCISES.pullup.metrics(g, frame()).chinOverBar, false);
});

test("dip counter + depth verdicts follow the elbow", () => {
  const c = new RepCounter(EXERCISES.dip);
  const done = runReps(c, [[0, 160], [200, 90], [800, 160]]);
  assert.equal(c.reps, 1);
  assert.equal(done[0].depth.level, "good");
  const c2 = new RepCounter(EXERCISES.dip);
  const d2 = runReps(c2, [[0, 160], [200, 117], [800, 160]]);
  assert.equal(d2[0].depth.text, "Too shallow — bigger range");
});

test("dip reliability follows the arm joints like the push-up", () => {
  resetSideSelector();
  assert.equal(EXERCISES.dip.metrics(frame(), frame()).reliable, true);
  resetSideSelector();
  assert.equal(EXERCISES.dip.metrics(frame({ 16: 0.15 }), frame()).reliable, false);
});
