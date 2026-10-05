import test from "node:test";
import assert from "node:assert/strict";

import { trendOf, prepareWeighIns, checkIn, paceBandFor, AR1_INFLATION, PHI_AR1, WINDOW_DAYS, MAX_WINDOW_DAYS, MIN_WEIGHINS, MIN_WEEKDAYS, MIN_LOGGED_DAYS, MIN_DAYS_BETWEEN, STEP_PCT } from "../nutrition-adjust.js";
import { addDays, weekdayOf } from "../lib/calendar-days.js";

// A Sunday: the check-in snaps to the most recent Sunday, so a Sunday keeps the window where the tests put it.
const TODAY = "2026-10-04";
const series = (kgs, today = TODAY) => kgs.map((kg, i) => ({ date: addDays(today, -(kgs.length - 1 - i)), kg }));
/** A weight that falls `pctPerWeek` of its starting value each week, one weigh-in a day for `days` days. */
const line = (start, pctPerWeek, days = 28) => series(Array.from({ length: days }, (_, d) => start * (1 + (pctPerWeek / 100) * (d / 7))));

test("a perfect loss line reads back as the same percent per week, with no uncertainty", () => {
  const pts = prepareWeighIns(line(80, -0.5), TODAY, 28);
  const t = trendOf(pts);
  assert.equal(t.n, 28);
  assert.ok(Math.abs(t.slopePctPerWeek - -0.505) < 0.02, `${t.slopePctPerWeek}`);
  assert.ok(Math.abs(t.upper - t.lower) < 1e-9, "a perfect line has a zero-width interval");
  assert.ok(t.upper >= t.lower);
});

test("flat weight reads as about zero and the interval brackets zero when the data is noisy", () => {
  const flat = trendOf(prepareWeighIns(line(80, 0), TODAY, 28));
  assert.ok(Math.abs(flat.slopePctPerWeek) < 1e-9);
  const noisy = series(Array.from({ length: 28 }, (_, d) => 80 + (d % 2 ? 0.8 : -0.8)));
  const t = trendOf(prepareWeighIns(noisy, TODAY, 28));
  assert.ok(t.lower < 0 && t.upper > 0);
});

test("two entries on one date are averaged, and the point count is days, not entries", () => {
  const s = [...line(80, 0, 10), { date: TODAY, kg: 82 }];
  const pts = prepareWeighIns(s, TODAY, 28);
  assert.equal(pts.length, 10);
  assert.equal(pts[pts.length - 1].kg, 81, "80 and 82 on the last date");
});

test("a typo, an impossible value and a future date are dropped", () => {
  const s = line(80, 0, 12);
  s[5] = { ...s[5], kg: 8.0 }; // typo for 80
  s[6] = { ...s[6], kg: 800 };
  s[7] = { ...s[7], kg: 95 }; // more than 15% from the window median
  s.push({ date: addDays(TODAY, 3), kg: 80 });
  const pts = prepareWeighIns(s, TODAY, 28);
  assert.equal(pts.length, 9);
  assert.ok(pts.every((p) => p.kg === 80));
});

test("only the window is used", () => {
  const s = [{ date: addDays(TODAY, -40), kg: 70 }, ...line(80, 0, 10)];
  assert.equal(prepareWeighIns(s, TODAY, 28).length, 10);
});

test("fewer than three distinct days gives no trend", () => {
  assert.equal(trendOf(prepareWeighIns(line(80, 0, 2), TODAY, 28)), null);
  assert.equal(trendOf([]), null);
});

test("the percent trend does not depend on the unit the weights were entered in", () => {
  const kg = line(80, -0.6);
  const lb = kg.map((p) => ({ ...p, kg: p.kg * 2.2046226218 }));
  const a = trendOf(prepareWeighIns(kg, TODAY, 28));
  const b = trendOf(prepareWeighIns(lb, TODAY, 28));
  assert.ok(Math.abs(a.slopePctPerWeek - b.slopePctPerWeek) < 1e-9);
});

test("weigh-ins all on one weekday still yield a trend; the weekday spread is a gate elsewhere", () => {
  const mondays = [0, 7, 14, 21].map((d, i) => ({ date: addDays("2026-09-14", d), kg: 80 - i * 0.4 }));
  assert.ok(trendOf(prepareWeighIns(mondays, TODAY, 28)).slopePctPerWeek < 0);
});

// --- the check-in decision (Task 10) -------------------------------------------

import { buildPlan } from "../nutrition-plan.js";
import { evaluateNutrition, NUTRITION_THRESHOLDS } from "../nutrition-safety.js";

const STATS = { heightCm: 178, ageRange: "18–29", sex: "Male", dailyActivity: "some", daysPerWeek: 4, sessionLength: 60, intent: "cut" };
const round25 = (n) => Math.round(n / 25) * 25;
const GOAL = { cut: "Fat loss", bulk: "Hypertrophy", recomp: "General" };

/** A noise-free (or seeded-noise) world: weights, a food log, and the inputs checkIn takes. */
function world({ stats = STATS, kg0 = 90, rate = -0.6, weighDays, days = 28, loggedDays = 28, loggedFactor = 1, kcalOver, protein, changedOn = null, lastProposalOn = null, noise } = {}) {
  const plan = buildPlan({ bodyStats: stats, kg: kg0 });
  const targets = { ...plan.targets, ...(kcalOver ? { kcal: kcalOver } : {}), ...(protein != null ? { protein } : {}) };
  const offsets = weighDays || Array.from({ length: days }, (_, i) => i);
  const wobble = noise || (() => 0);
  const seriesData = offsets.map((d) => ({ date: addDays(TODAY, -(days - 1 - d)), kg: kg0 * (1 + (rate / 100) * (d / 7)) + wobble(d) }));
  const logged = {};
  for (let i = 0; i < loggedDays; i++) logged[addDays(TODAY, -i)] = { kcal: targets.kcal * loggedFactor, protein: targets.protein };
  return { plan, args: { series: seriesData, days: logged, targets, bodyStats: stats, trainingAge: "Intermediate", unit: "kg", today: TODAY, targetsChangedOn: changedOn, lastProposalOn } };
}
const run = (opts) => checkIn(world(opts).args);
// Twelve days spread over five different weekdays inside a 28-day window.
const TWELVE = [0, 1, 3, 6, 8, 11, 13, 15, 18, 20, 24, 27];

test("the constants are the ones the spec fixes", () => {
  assert.deepEqual([WINDOW_DAYS, MAX_WINDOW_DAYS, MIN_WEIGHINS, MIN_WEEKDAYS, MIN_LOGGED_DAYS, MIN_DAYS_BETWEEN, STEP_PCT], [28, 42, 12, 4, 20, 28, 0.05]);
});

test("pace bands by goal, leanness and training age", () => {
  assert.deepEqual(pick(paceBandFor({ intent: "cut", bmi: 27, trainingAge: "Intermediate" })), { slowEdge: -0.25, fastLimit: -1.0 });
  assert.equal(paceBandFor({ intent: "cut", bmi: 24.9, trainingAge: "Intermediate" }).fastLimit, -0.5);
  assert.deepEqual(pick(paceBandFor({ intent: "bulk", bmi: 24, trainingAge: "Beginner" })), { slowEdge: 0.1, fastLimit: 0.5 });
  assert.equal(paceBandFor({ intent: "bulk", bmi: 24, trainingAge: "Advanced" }).fastLimit, 0.25);
  const r = paceBandFor({ intent: "recomp", bmi: 24, trainingAge: "" });
  assert.deepEqual([r.min, r.max], [-0.25, 0.25]);
  function pick(b) { return { slowEdge: b.slowEdge, fastLimit: b.fastLimit }; }
});

test("each missing piece of evidence gives its own not_ready reason, at the exact boundary", () => {
  const ok = run({});
  assert.equal(ok.status, "on_track");
  assert.deepEqual(run({ changedOn: addDays(TODAY, -27) }), { status: "not_ready", reason: "too_soon" });
  assert.equal(run({ changedOn: addDays(TODAY, -28) }).status, "on_track");
  assert.equal(run({ lastProposalOn: addDays(TODAY, -27) }).reason, "too_soon");
  assert.equal(run({ weighDays: TWELVE.slice(1) }).reason, "few_weighins");
  assert.equal(run({ weighDays: TWELVE }).status, "on_track", "12 weigh-ins is enough");
  assert.equal(run({ loggedDays: MIN_LOGGED_DAYS - 1 }).reason, "few_logs");
  assert.equal(run({ loggedDays: MIN_LOGGED_DAYS }).status, "on_track");
});

test("twelve weigh-ins on three weekdays is not enough, a fourth weekday is", () => {
  const dates = (wds) => Array.from({ length: 28 }, (_, d) => d).filter((d) => wds.includes(weekdayOf(addDays(TODAY, -(27 - d)))));
  const three = dates([1, 3, 5]);
  assert.equal(three.length, 12);
  assert.equal(run({ weighDays: three }).reason, "few_weekdays");
  const four = [...three, dates([2])[0]];
  assert.equal(run({ weighDays: four }).status, "on_track");
});

test("no stats means no check-in, not a guess", () => {
  const w = world();
  assert.deepEqual(checkIn({ ...w.args, bodyStats: null }), { status: "not_ready", reason: "no_stats" });
});

test("a clean cut at the right pace is on track; too fast proposes more food", () => {
  assert.equal(run({ rate: -0.6 }).status, "on_track");
  const w = world({ rate: -1.5 });
  const r = checkIn(w.args);
  assert.equal(r.status, "propose");
  assert.equal(r.reason, "too_fast");
  assert.equal(r.fromKcal, w.args.targets.kcal);
  assert.equal(r.toKcal, r.fromKcal + Math.max(25, round25(r.fromKcal * 0.05)));
  assert.equal(r.targets.kcal, r.toKcal);
  assert.equal(r.targets.protein, w.args.targets.protein, "protein held");
  assert.ok(r.slopePctPerWeek < -1.0);
});

test("a stalled cut at the starting plan is not chased downward", () => {
  const r = run({ rate: 0 });
  assert.equal(r.status, "inconclusive");
  assert.equal(r.reason, "at_limit");
});

test("a stalled cut above the starting plan can come down, but never below it", () => {
  const w = world({ rate: 0, kcalOver: world().plan.targets.kcal + 300 });
  const r = checkIn(w.args);
  assert.equal(r.status, "propose");
  assert.equal(r.reason, "stalled");
  assert.ok(r.toKcal < r.fromKcal);
  assert.ok(r.toKcal >= w.plan.targets.kcal, "never deeper than the starting plan");
  const near = world({ rate: 0, kcalOver: world().plan.targets.kcal + 25 });
  assert.notEqual(checkIn(near.args).status, "propose", "one step would cross the starting plan");
});

test("bulks mirror the cut: too fast comes down toward maintenance, stalled goes up", () => {
  const bulk = { ...STATS, intent: "bulk" };
  const fast = world({ stats: bulk, rate: 1.0 });
  const f = checkIn(fast.args);
  assert.equal(f.status, "propose");
  assert.equal(f.reason, "too_fast");
  assert.ok(f.toKcal < f.fromKcal && f.toKcal >= round25(fast.plan.tdee));
  const slow = checkIn(world({ stats: bulk, rate: 0 }).args);
  assert.equal(slow.status, "propose");
  assert.equal(slow.reason, "stalled");
  assert.ok(slow.toKcal > slow.fromKcal);
});

test("under 18 is never offered a decrease", () => {
  const minor = { ...STATS, ageRange: "Under 18", intent: "recomp" };
  const gaining = checkIn(world({ stats: minor, kg0: 60, rate: 1.0 }).args);
  assert.notEqual(gaining.status, "propose");
  const losing = checkIn(world({ stats: minor, kg0: 60, rate: -1.0 }).args);
  assert.equal(losing.status, "propose");
  assert.ok(losing.toKcal >= losing.fromKcal);
});

test("a proposal never goes below the calorie floor", () => {
  const small = { heightCm: 155, ageRange: "18–29", sex: "Female", dailyActivity: "sitting", daysPerWeek: 0, sessionLength: 0, intent: "cut" };
  const base = world({ stats: small, kg0: 45, rate: 0 });
  const floor = Math.max(NUTRITION_THRESHOLDS.LOW_KCAL, base.plan.bmr);
  const w = world({ stats: small, kg0: 45, rate: 0, kcalOver: 1225 });
  const r = checkIn(w.args);
  assert.notEqual(r.status === "propose" && r.toKcal < floor, true);
  assert.notEqual(r.status, "propose", "one step down from 1225 would be under the floor");
});

test("a proposal the auditor would flag is not made", () => {
  const w = world({ rate: 0, kcalOver: world().plan.targets.kcal + 300, protein: 40 });
  const r = checkIn(w.args);
  assert.equal(r.status, "inconclusive");
  assert.equal(r.reason, "audit");
});

test("every proposal passes the auditor with accurate maintenance", () => {
  for (const rate of [-1.6, 0, 1.2]) for (const intent of ["cut", "bulk", "recomp"]) {
    const w = world({ stats: { ...STATS, intent }, rate, kcalOver: world({ stats: { ...STATS, intent } }).plan.targets.kcal + 200 });
    const r = checkIn(w.args);
    if (r.status !== "propose") continue;
    const flags = evaluateNutrition({ targets: r.targets, bodyweight: 90, unit: "kg", goal: GOAL[intent], maintenance: w.plan.tdee }).flags;
    assert.equal(flags.length, 0, `${intent} ${rate}: ${flags.map((f) => f.label)}`);
  }
});

test("logged intake far below target with a flat scale says the log may be missing food, and offers no change", () => {
  const r = run({ rate: 0, loggedFactor: 0.7, kcalOver: world().plan.targets.kcal + 300 });
  assert.equal(r.status, "inconclusive");
  assert.equal(r.reason, "log_scale_disagree");
});

test("a window that straddles a band edge is inconclusive, and 42 days can settle what 28 could not", () => {
  const high = world().plan.targets.kcal + 300;
  // 12 weigh-ins in the last 28 days (not enough to be sure at typical noise) plus 12 older ones.
  const older = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const recent = [14, 16, 19, 21, 24, 26, 29, 31, 34, 36, 39, 41];
  let settledAt42 = 0;
  let straddled = 0;
  let settledAt28 = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const rng = seededRng(seed);
    const w = world({ rate: 0, days: 42, weighDays: [...older, ...recent], kcalOver: high, noise: () => 0.45 * gaussFrom(rng) });
    const r = checkIn(w.args);
    if (r.status === "propose" && r.windowDays === 42) settledAt42++;
    else if (r.status === "propose") settledAt28++;
    else if (r.status === "inconclusive" && r.reason === "straddles_band") straddled++;
  }
  assert.ok(settledAt42 > 0, "the 42-day extension is reachable and can propose");
  assert.ok(settledAt28 > 0, "a clear 28-day signal does not wait for 42");
  assert.ok(straddled + settledAt42 + settledAt28 === 60, "every run ends in a decision or an honest 'not clear'");
});

function seededRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussFrom(rng) {
  return Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
}

// --- Fixes from the Phase 2 review -------------------------------------------------


test("the trend interval is widened for autocorrelated scale noise", () => {
  assert.equal(PHI_AR1, 0.4);
  assert.ok(Math.abs(AR1_INFLATION - Math.sqrt(1.4 / 0.6)) < 1e-12);
  const pts = prepareWeighIns(series(Array.from({ length: 28 }, (_, d) => 80 + (d % 3) * 0.5 + (d % 2 ? 0.4 : -0.4))), TODAY, 28);
  const t = trendOf(pts);
  // independent OLS to get the plain standard error
  const n = pts.length, md = pts.reduce((a, p) => a + p.day, 0) / n, mk = pts.reduce((a, p) => a + p.kg, 0) / n;
  const sxx = pts.reduce((a, p) => a + (p.day - md) ** 2, 0);
  const b = pts.reduce((a, p) => a + (p.day - md) * (p.kg - mk), 0) / sxx;
  const rss = pts.reduce((a, p) => a + (p.kg - (mk + b * (p.day - md))) ** 2, 0);
  const seWeekPct = (Math.sqrt(rss / (n - 2) / sxx) * 7 / mk) * 100;
  assert.ok(Math.abs((t.upper - t.lower) / 2 - 1.645 * AR1_INFLATION * seWeekPct) < 1e-9);
});

test("the check is weekly: every day of a week gives the answer of the Sunday that ends it", () => {
  const sunday = "2026-10-04";
  const base = world({ rate: -1.5, days: 28 });
  const dayResults = [];
  for (let k = 0; k < 7; k++) {
    // same data, a later 'today' inside the following week
    dayResults.push(JSON.stringify(checkIn({ ...base.args, today: addDays(sunday, k) })));
  }
  assert.equal(new Set(dayResults).size, 1, "Sunday through Saturday agree");
  // weigh-ins after the Sunday do not count until the next Sunday
  const extra = { ...base.args, today: addDays(sunday, 3), series: [...base.args.series, { date: addDays(sunday, 2), kg: 200 }] };
  assert.equal(JSON.stringify(checkIn(extra)), dayResults[0]);
});

test("one noisy weigh-in near BMI 30 cannot flip the starting plan", () => {
  const tall = { ...STATS, heightCm: 190 };
  const make = (lastKg) => {
    const w = world({ stats: tall, kg0: 107.5, rate: 0 });
    const series2 = w.args.series.map((p, i, a) => (i === a.length - 1 ? { ...p, kg: lastKg } : { ...p, kg: 107.5 }));
    return checkIn({ ...w.args, series: series2 });
  };
  const low = make(107.0);
  const high = make(109.0); // BMI 30.2 on its own; the 7-day mean is still under 30
  assert.deepEqual([high.status, high.reason], [low.status, low.reason]);
  assert.equal(low.status, "inconclusive");
  assert.equal(low.reason, "at_limit");
});

test("the 42-day extension never reaches back before the last target change", () => {
  const high = world().plan.targets.kcal + 300;
  const older = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const recent = [14, 16, 19, 21, 24, 26, 29, 31, 34, 36, 39, 41];
  let usedOld = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const rng = seededRng(seed);
    const noisy = () => 0.45 * gaussFrom(rng);
    const wo = world({ rate: 0, days: 42, weighDays: [...older, ...recent], kcalOver: high, noise: noisy });
    const open = checkIn(wo.args);
    const rng2 = seededRng(seed);
    const clipped = checkIn({ ...wo.args, targetsChangedOn: addDays(TODAY, -30) });
    if (open.status === "propose" && open.windowDays === 42) usedOld++;
    assert.ok(!(clipped.status === "propose" && clipped.windowDays === 42), `seed ${seed}: the old regime leaked into the window`);
    void rng2;
  }
  assert.ok(usedOld > 0, "the control: without a recent change the extension is used");
});

/** The plan at the weight the check actually uses: the mean of the last week of weigh-ins. */
const planAtRecent = (w) => {
  const last = w.args.series.slice(-7).map((p) => p.kg);
  return buildPlan({ bodyStats: w.args.bodyStats, kg: last.reduce((a, b) => a + b, 0) / last.length });
};

test("a target already below what SpotterAI would set is never called on track", () => {
  const w = world({ rate: -0.6, kcalOver: 1100 });
  const r = checkIn(w.args);
  assert.deepEqual([r.status, r.reason], ["inconclusive", "target_unsafe"]);
});

test("an unsafe target with weight falling too fast is offered a raise to a safe level, not silence", () => {
  const w = world({ rate: -1.5, kcalOver: 1100 });
  const r = checkIn(w.args);
  assert.equal(r.status, "propose");
  assert.equal(r.direction, "raise");
  const now = planAtRecent(w);
  const floor = Math.max(NUTRITION_THRESHOLDS.LOW_KCAL, now.bmr, now.tdee * 0.7);
  assert.ok(r.toKcal >= floor, `${r.toKcal} vs floor ${floor}`);
  const calorieFlags = evaluateNutrition({ targets: r.targets, bodyweight: 90, unit: "kg", goal: "Fat loss", maintenance: now.tdee }).flags.filter((f) => /calorie|deficit/i.test(f.label));
  assert.equal(calorieFlags.length, 0);
});

test("an unsafe target is never lowered further, whatever the scale says", () => {
  const r = checkIn(world({ rate: 0.4, kcalOver: 1100 }).args);
  assert.notEqual(r.status === "propose" && r.direction === "lower", true);
  assert.equal(r.status, "inconclusive");
});

test("an unsafe target still gets its note when there is too little data, or during a quiet period", () => {
  assert.equal(checkIn(world({ kcalOver: 1100, weighDays: [0, 1, 2] }).args).reason, "target_unsafe");
  assert.equal(checkIn(world({ kcalOver: 1100, lastProposalOn: addDays(TODAY, -3) }).args).reason, "target_unsafe");
});

test("a minor on a saved deficit is never told they are on track, and a too-fast loss is offered maintenance", () => {
  const minor = { ...STATS, ageRange: "Under 18", intent: "recomp" };
  const base = world({ stats: minor, kg0: 60, rate: -0.1 });
  const low = Math.round((base.plan.tdee * 0.8) / 25) * 25;
  assert.equal(checkIn(world({ stats: minor, kg0: 60, rate: -0.1, kcalOver: low }).args).reason, "target_unsafe");
  const fastWorld = world({ stats: minor, kg0: 60, rate: -1.0, kcalOver: low });
  const fast = checkIn(fastWorld.args);
  assert.equal(fast.status, "propose");
  assert.ok(fast.toKcal >= Math.round((planAtRecent(fastWorld).tdee * 0.95) / 25) * 25, "raised to within 5% of maintenance");
});

test("a safe target is unaffected by the unsafe-target rules", () => {
  assert.equal(run({ rate: -0.6 }).status, "on_track");
});
