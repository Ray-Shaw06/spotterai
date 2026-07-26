/**
 * Tests for the form-session recorder (post-set report data):
 *   • Cue frequency is per rep window ("N of M reps" stays arithmetically true).
 *   • Best/worst/flagged reps derive from verdicts + warn cues, judged reps only.
 *   • Tips are deterministic functions of the recorded timeline.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { SessionRecorder, tipsFor, TIPS } from "../form-session.js";

const GOOD = { level: "good", text: "Hit depth" };
const SHALLOW = { level: "warn", text: "Too shallow, bigger range" };
const SAG = { level: "warn", text: "Hips sagging, brace your core" };

function record(recorder, { tMs, rep, verdict, judged = true, cueFrames = [] }) {
  for (const cues of cueFrames) recorder.recordCues(cues);
  recorder.recordRep({ tMs, rep, verdict, judged });
}

test("a cue on many frames of one rep counts as one rep affected", () => {
  const r = new SessionRecorder("pushup");
  r.start(1000);
  // Same warn cue visible on 5 consecutive frames of rep 1.
  record(r, { tMs: 3000, rep: 1, verdict: GOOD, cueFrames: Array(5).fill([SAG]) });
  record(r, { tMs: 5000, rep: 2, verdict: GOOD });
  const s = r.summary();
  const sag = s.cueFrequency.find((e) => e.text === SAG.text);
  assert.equal(sag.reps, 1);
  assert.equal(s.reps, 2);
});

test("cue windows reset per rep, three affected reps count 3 of 4", () => {
  const r = new SessionRecorder("pushup");
  r.start(0);
  record(r, { tMs: 2000, rep: 1, verdict: GOOD, cueFrames: [[SAG]] });
  record(r, { tMs: 4000, rep: 2, verdict: GOOD, cueFrames: [[SAG]] });
  record(r, { tMs: 6000, rep: 3, verdict: GOOD });
  record(r, { tMs: 8000, rep: 4, verdict: GOOD, cueFrames: [[SAG]] });
  const s = r.summary();
  assert.equal(s.cueFrequency.find((e) => e.text === SAG.text).reps, 3);
  assert.deepEqual(s.flaggedReps, [1, 2, 4]);
});

test("warn verdicts join the frequency list; good reps stay clean", () => {
  const r = new SessionRecorder("squat");
  r.start(0);
  record(r, { tMs: 2000, rep: 1, verdict: SHALLOW });
  record(r, { tMs: 4000, rep: 2, verdict: SHALLOW });
  record(r, { tMs: 6000, rep: 3, verdict: GOOD });
  const s = r.summary();
  assert.equal(s.cueFrequency.find((e) => e.text === SHALLOW.text).reps, 2);
  assert.equal(s.bestRep, 3);
  assert.equal(s.flaggedReps.length, 2);
});

test("best and worst reps come from verdict + warn-cue score", () => {
  const r = new SessionRecorder("pushup");
  r.start(0);
  record(r, { tMs: 2000, rep: 1, verdict: GOOD }); // score 0 → best
  record(r, { tMs: 4000, rep: 2, verdict: SHALLOW, cueFrames: [[SAG]] }); // score 2 → worst
  record(r, { tMs: 6000, rep: 3, verdict: GOOD, cueFrames: [[SAG]] }); // score 1
  const s = r.summary();
  assert.equal(s.bestRep, 1);
  assert.equal(s.worstRep, 2);
});

test("uniform sessions have no worst rep (nothing is worse than the best)", () => {
  const r = new SessionRecorder("squat");
  r.start(0);
  record(r, { tMs: 2000, rep: 1, verdict: GOOD });
  record(r, { tMs: 4000, rep: 2, verdict: GOOD });
  const s = r.summary();
  assert.equal(s.bestRep, 1);
  assert.equal(s.worstRep, null);
  assert.deepEqual(s.flaggedReps, []);
});

test("unjudged reps are excluded from best/worst/flagged and counted honestly", () => {
  const r = new SessionRecorder("squat");
  r.start(0);
  record(r, { tMs: 2000, rep: 1, verdict: null, judged: false });
  record(r, { tMs: 4000, rep: 2, verdict: GOOD });
  const s = r.summary();
  assert.equal(s.reps, 2);
  assert.equal(s.judgedReps, 1);
  assert.equal(s.bestRep, 2);
  assert.equal(s.worstRep, null);
  assert.equal(s.repRecords[0].verdict.text, "Unable to judge this rep");
  // The refusal is not a coachable finding.
  assert.equal(s.cueFrequency.find((e) => e.text === "Unable to judge this rep"), undefined);
});

test("timestamps are relative to session start; duration spans to the last rep", () => {
  const r = new SessionRecorder("squat");
  r.start(10_000);
  record(r, { tMs: 13_000, rep: 1, verdict: GOOD });
  record(r, { tMs: 17_500, rep: 2, verdict: GOOD });
  const s = r.summary();
  assert.equal(s.repRecords[0].atMs, 3000);
  assert.equal(s.repRecords[1].atMs, 7500);
  assert.equal(s.durationMs, 7500);
});

test("confidence averages across recorded frames", () => {
  const r = new SessionRecorder("squat");
  r.start(0);
  r.recordConfidence(0.8);
  r.recordConfidence(0.6);
  record(r, { tMs: 2000, rep: 1, verdict: GOOD });
  const s = r.summary();
  assert.ok(Math.abs(s.avgConfidence - 0.7) < 1e-9);
});

test("zero-rep sessions summarize empty without inventing anything", () => {
  const r = new SessionRecorder("squat");
  r.start(0);
  r.recordCues([SAG]); // cues without a completed rep never reach the report
  const s = r.summary();
  assert.equal(s.reps, 0);
  assert.deepEqual(s.cueFrequency, []);
  assert.equal(s.bestRep, null);
  assert.deepEqual(tipsFor(s), []);
});

test("tips are deterministic and map only known warn findings", () => {
  const make = () => {
    const r = new SessionRecorder("pushup");
    r.start(0);
    record(r, { tMs: 2000, rep: 1, verdict: SHALLOW, cueFrames: [[SAG]] });
    record(r, { tMs: 4000, rep: 2, verdict: SHALLOW, cueFrames: [[SAG]] });
    return r.summary();
  };
  const t1 = tipsFor(make());
  const t2 = tipsFor(make());
  assert.deepEqual(t1, t2); // same session, same tips
  assert.equal(t1.length, 2);
  for (const t of t1) {
    assert.equal(t.tip, TIPS[t.finding]);
    assert.equal(t.reps, 2);
  }
});

test("a single-rep set still earns its tip; good cues never become tips", () => {
  const r = new SessionRecorder("pushup");
  r.start(0);
  record(r, { tMs: 2000, rep: 1, verdict: GOOD, cueFrames: [[SAG, { level: "good", text: "Good depth" }]] });
  const tips = tipsFor(r.summary());
  assert.equal(tips.length, 1);
  assert.equal(tips[0].finding, SAG.text);
});

test("tips cap at three, ordered by how many reps each finding affected", () => {
  const r = new SessionRecorder("squat");
  r.start(0);
  const c = (text) => ({ level: "warn", text });
  const lean = c("Chest up, too much forward lean");
  const deep = c("Go deeper, aim for parallel");
  record(r, { tMs: 1000, rep: 1, verdict: SHALLOW, cueFrames: [[lean, deep]] });
  record(r, { tMs: 2000, rep: 2, verdict: SHALLOW, cueFrames: [[lean, deep]] });
  record(r, { tMs: 3000, rep: 3, verdict: SHALLOW, cueFrames: [[lean]] });
  record(r, { tMs: 4000, rep: 4, verdict: GOOD, cueFrames: [[lean]] });
  const tips = tipsFor(r.summary());
  assert.equal(tips.length, 3);
  assert.equal(tips[0].finding, lean.text); // 4 reps
  assert.equal(tips[1].finding, SHALLOW.text); // 3 reps
  assert.equal(tips[2].finding, deep.text); // 2 reps
});

test("every tip line stays claim-safe (no medical or superlative language)", () => {
  const banned = /revolutionary|game-changing|guarantee|medically|diagnos|cure|inj[ue]r/i;
  for (const [finding, tip] of Object.entries(TIPS)) {
    assert.doesNotMatch(tip, banned, `tip for "${finding}"`);
  }
});
