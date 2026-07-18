/**
 * Tests for the post-set report markup: the HTML the user reads must carry
 * the same arithmetic truths as the recorded session (counts, judged reps),
 * escape untrusted text, and degrade honestly (adaptive counter, unjudged reps).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { SessionRecorder, tipsFor } from "../form-session.js";
import { reportHTML } from "../form-report.js";

const GOOD = { level: "good", text: "Hit depth" };
const SHALLOW = { level: "warn", text: "Too shallow — bigger range" };
const SAG = { level: "warn", text: "Hips sagging — brace your core" };

function session(reps) {
  const r = new SessionRecorder("pushup");
  r.start(0);
  reps.forEach((spec, i) => {
    for (const cues of spec.cueFrames || []) r.recordCues(cues);
    r.recordRep({ tMs: (i + 1) * 2000, rep: i + 1, verdict: spec.verdict ?? GOOD, judged: spec.judged ?? true });
  });
  return r.summary();
}

test("report states rep count, duration, and judged count truthfully", () => {
  const s = session([{}, {}, { judged: false, verdict: null }]);
  const html = reportHTML(s, "Push-up", tipsFor(s));
  assert.match(html, /3 reps · 0:06 · judged 2 of 3/);
  assert.match(html, /Set report — Push-up/);
});

test("finding counts in the HTML match the recorded frequency", () => {
  const s = session([
    { cueFrames: [[SAG]] },
    { cueFrames: [[SAG]] },
    { verdict: SHALLOW },
    {},
  ]);
  const html = reportHTML(s, "Push-up", tipsFor(s));
  assert.match(html, /Hips sagging — brace your core <span class="form-finding__count">2 of 4 reps<\/span>/);
  assert.match(html, /Too shallow — bigger range <span class="form-finding__count">1 of 4 reps<\/span>/);
  // The good verdict shows as the positive line.
  assert.match(html, /form-finding--good/);
});

test("one chip per rep with good/warn/unjudged states and a marked best rep", () => {
  const s = session([{}, { verdict: SHALLOW }, { judged: false, verdict: null }]);
  const html = reportHTML(s, "Push-up", []);
  assert.equal((html.match(/rep-chip /g) || []).length, 3);
  assert.match(html, /rep-chip--good rep-chip--best/);
  assert.match(html, /rep-chip--warn/);
  assert.match(html, /rep-chip--unjudged/);
});

test("clean sets say so instead of inventing findings", () => {
  const s = session([{}, {}]);
  const html = reportHTML(s, "Squat", tipsFor(s));
  assert.match(html, /Clean set — no recurring form flags/);
  assert.doesNotMatch(html, /Work on next/);
});

test("tips render with their finding and mapped line", () => {
  const s = session([{ cueFrames: [[SAG]] }, { cueFrames: [[SAG]] }]);
  const tips = tipsFor(s);
  const html = reportHTML(s, "Push-up", tips);
  assert.match(html, /Work on next/);
  assert.match(html, /<strong>Hips sagging — brace your core<\/strong>/);
  assert.ok(html.includes(tips[0].tip.replaceAll('"', "&quot;")));
});

test("unjudged reps produce the visibility note", () => {
  const s = session([{}, { judged: false, verdict: null }, { judged: false, verdict: null }]);
  const html = reportHTML(s, "Squat", []);
  assert.match(html, /2 reps were not judged/);
});

test("the adaptive counter's report never pretends to have form analysis", () => {
  const r = new SessionRecorder("general");
  r.start(0);
  r.recordRep({ tMs: 2000, rep: 1, verdict: null, judged: false });
  const html = reportHTML(r.summary(), "Other — auto rep counter", [], { adaptive: true });
  assert.match(html, /Rep counting only/);
  assert.doesNotMatch(html, /rep-chip|judged/);
});

test("the honest-limitation line is always present", () => {
  const s = session([{}]);
  for (const html of [reportHTML(s, "Squat", []), reportHTML(s, "Other", [], { adaptive: true })]) {
    assert.match(html, /a mirror, not a judge|Rep counting only/);
  }
  assert.match(reportHTML(s, "Squat", []), /Nothing was uploaded/);
});

test("exercise labels and cue text are HTML-escaped", () => {
  const r = new SessionRecorder("squat");
  r.start(0);
  r.recordCues([{ level: "warn", text: '<img src=x onerror=alert(1)>' }]);
  r.recordRep({ tMs: 2000, rep: 1, verdict: GOOD });
  const html = reportHTML(r.summary(), '<script>alert(1)</script>', []);
  assert.doesNotMatch(html, /<script>|<img/);
  assert.match(html, /&lt;script&gt;/);
});

// ---- session recording helpers (pure) -------------------------------------

import { pickRecorderMime, markersFor, videoHTML } from "../form-report.js";

test("recorder mime prefers mp4 (iOS), falls back to webm, then null", () => {
  assert.equal(pickRecorderMime((t) => t === "video/mp4"), "video/mp4");
  assert.equal(pickRecorderMime((t) => t.startsWith("video/webm")), "video/webm;codecs=vp9");
  assert.equal(pickRecorderMime((t) => t === "video/webm"), "video/webm");
  assert.equal(pickRecorderMime(() => false), null);
  assert.equal(pickRecorderMime(() => { throw new Error("boom"); }), null);
});

test("markers: best rep first, flagged reps follow, best never duplicated", () => {
  const s = session([
    {}, // rep 1 clean → best
    { verdict: SHALLOW }, // flagged
    { cueFrames: [[SAG]] }, // flagged
  ]);
  const m = markersFor(s);
  assert.deepEqual(m.map((x) => [x.kind, x.rep]), [["best", 1], ["flagged", 2], ["flagged", 3]]);
});

test("marker seek lands just before the rep and never below zero", () => {
  const s = session([{ verdict: SHALLOW }]); // rep 1 at 2000ms
  const m = markersFor(s);
  assert.equal(m[0].seekS, 0.5); // 2.0s - 1.5s lead
  const r = new SessionRecorder("squat");
  r.start(0);
  r.recordRep({ tMs: 400, rep: 1, verdict: SHALLOW }); // 0.4s - 1.5s → clamp to 0
  assert.equal(markersFor(r.summary())[0].seekS, 0);
});

test("markers cap so a rough set doesn't become a wall of buttons", () => {
  const s = session(Array.from({ length: 15 }, () => ({ verdict: SHALLOW })));
  assert.ok(markersFor(s).length <= 8);
});

test("video block renders seekable buttons and the on-device promise", () => {
  const s = session([{}, { verdict: SHALLOW }]);
  const html = videoHTML(markersFor(s));
  assert.match(html, /<video class="form-video__player" playsinline controls/);
  assert.match(html, /marker-btn marker-btn--best/);
  assert.match(html, /data-seek="/);
  assert.match(html, /Recorded on this device only/);
});

test("no markers → no empty marker strip", () => {
  const html = videoHTML([]);
  assert.doesNotMatch(html, /form-video__markers/);
  assert.match(html, /<video/);
});
