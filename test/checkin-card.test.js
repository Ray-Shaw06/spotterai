import test from "node:test";
import assert from "node:assert/strict";

import { checkInCardModel, checkInCardHTML, checkInTodayLine } from "../checkin-card.js";

const BANNED = ["missed", "failed", "fail", "behind", "lost", "broke", "clean", "junk", "bad", "cheat", "lazy", "slacking", "guilty", "you didn't"];
const PROPOSE = { status: "propose", reason: "too_fast", direction: "raise", fromKcal: 2350, toKcal: 2475, targets: { kcal: 2475, protein: 144, carbs: 330, fat: 69 }, slopePctPerWeek: -1.42, windowDays: 28 };
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const everyResult = [
  PROPOSE,
  { ...PROPOSE, reason: "stalled", direction: "lower", fromKcal: 2650, toKcal: 2525, slopePctPerWeek: 0.02, windowDays: 42 },
  { status: "on_track", slopePctPerWeek: -0.6 },
  { status: "not_ready", reason: "few_weighins" },
  { status: "not_ready", reason: "few_weekdays" },
  { status: "not_ready", reason: "few_logs" },
  { status: "not_ready", reason: "too_soon" },
  { status: "not_ready", reason: "no_stats" },
  { status: "inconclusive", reason: "log_scale_disagree" },
  { status: "inconclusive", reason: "straddles_band" },
  { status: "inconclusive", reason: "at_limit" },
  { status: "inconclusive", reason: "no_change_offered" },
  { status: "inconclusive", reason: "audit" },
  { status: "inconclusive", reason: "target_unsafe" },
];

test("a proposal names the observed trend and the one step offered, with Apply and Not now", () => {
  const m = checkInCardModel(PROPOSE);
  assert.equal(m.kind, "propose");
  const t = text(checkInCardHTML(m));
  assert.match(t, /down about 1\.4% a week/);
  assert.match(t, /4 weeks/);
  assert.ok(t.includes("2,350") && t.includes("2,475"), "from and to");
  assert.match(t, /Protein stays/);
  assert.equal(m.cta, "Change my targets");
  assert.equal(m.dismiss, "Not now");
});

test("a stalled trend over six weeks reads as about level, in the other direction", () => {
  const t = text(checkInCardHTML(checkInCardModel(everyResult[1])));
  assert.match(t, /about level/);
  assert.match(t, /6 weeks/);
});

test("on track is one quiet line with no buttons", () => {
  const m = checkInCardModel({ status: "on_track", slopePctPerWeek: -0.6 });
  assert.equal(m.kind, "on_track");
  const html = checkInCardHTML(m);
  assert.ok(!/<button/.test(html));
  assert.match(text(html), /fits your goal/);
});

test("not ready shows a prompt only when weigh-ins are what is missing", () => {
  assert.equal(checkInCardModel({ status: "not_ready", reason: "few_weighins" }).kind, "prompt");
  assert.equal(checkInCardModel({ status: "not_ready", reason: "few_weekdays" }).kind, "prompt");
  for (const reason of ["few_logs", "too_soon", "no_stats"]) assert.equal(checkInCardModel({ status: "not_ready", reason }), null, reason);
});

test("a flat scale beside a thin log says the log may be missing food and accuses nobody", () => {
  const m = checkInCardModel({ status: "inconclusive", reason: "log_scale_disagree" });
  assert.equal(m.kind, "info");
  const t = text(checkInCardHTML(m));
  assert.match(t, /may be missing some food/);
  assert.ok(!/you (ate|are eating|forgot)/i.test(t));
  assert.ok(!/<button/.test(checkInCardHTML(m)));
});

test("results with nothing useful to say render nothing", () => {
  for (const r of [{ status: "inconclusive", reason: "straddles_band" }, { status: "inconclusive", reason: "at_limit" }, { status: "inconclusive", reason: "no_change_offered" }, { status: "inconclusive", reason: "audit" }, null, undefined]) {
    assert.equal(checkInCardModel(r), null, JSON.stringify(r));
    assert.equal(checkInCardHTML(null), "");
  }
});

test("the Today line exists only for a proposal and carries no number and no prediction", () => {
  assert.match(checkInTodayLine(PROPOSE), /weekly check-in/i);
  assert.ok(!/\d/.test(checkInTodayLine(PROPOSE)));
  for (const r of everyResult.slice(2)) assert.equal(checkInTodayLine(r), null);
});

test("no card copy shames, predicts, claims research, or uses an em dash", () => {
  let checked = 0;
  for (const r of everyResult) {
    const m = checkInCardModel(r);
    const strings = [m && checkInCardHTML(m), checkInTodayLine(r)].filter(Boolean).map(text);
    for (const t of strings) {
      const lower = t.toLowerCase();
      for (const w of BANNED) assert.ok(!new RegExp(`\\b${w}\\b`).test(lower), `"${w}" in: ${t}`);
      for (const w of ["studies show", "science", "proven", "will lose", "will gain", "you'll lose", "per week you will", "kilos", "kg a week"]) assert.ok(!lower.includes(w), `"${w}" in: ${t}`);
      assert.ok(!t.includes("—"), t);
      checked++;
    }
  }
  assert.ok(checked >= 6);
});

test("a real heading on the proposal card and no eyebrow", () => {
  const html = checkInCardHTML(checkInCardModel(PROPOSE));
  assert.match(html, /<h2 class="card-title">Weekly check-in<\/h2>/);
  assert.ok(!/eyebrow/.test(html));
});

test("an unsafe saved target gets a plain note pointing to the safety check and the plan, never reassurance", () => {
  const m = checkInCardModel({ status: "inconclusive", reason: "target_unsafe" });
  assert.equal(m.kind, "info");
  const html = checkInCardHTML(m);
  const t = text(html);
  assert.match(t, /lower than SpotterAI would set/);
  assert.match(t, /safety check/);
  assert.match(t, /Your nutrition plan/);
  assert.ok(!/on track|fits your goal|no change needed/i.test(t), "never reassuring beside an unsafe target");
  assert.ok(!/<button/.test(html));
});
