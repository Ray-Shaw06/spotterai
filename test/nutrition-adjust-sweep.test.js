/**
 * Two guarantees the weekly check-in rests on, as tests rather than promises.
 *
 * 1. Cross-system sweep: every proposal, for every body and trend in a realistic
 *    grid, passes the safety auditor, respects the calorie floor, and never
 *    lowers calories for an under-18. (The prescriber and the auditor must agree.)
 * 2. Statistical guarantee: against the published scale-noise levels (see
 *    scripts/simulate-weight-trend.mjs and docs/rubric-sources.md), WITH the
 *    autocorrelation those levels imply (AR(1), phi 0.4), a user clearly inside the
 *    band is flagged at most 1% of the time per check, one near a band edge at most 4%,
 *    and re-checked weekly for twelve weeks at most 5%. Loosen the gate, the weekly
 *    cadence or the confidence widening and this fails.
 * 3. Unsafe starting targets: a saved target already below what SpotterAI would set is
 *    never called on track, never lowered, and any proposal moves it toward safety.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { checkIn } from "../nutrition-adjust.js";
import { buildPlan } from "../nutrition-plan.js";
import { addDays } from "../lib/calendar-days.js";
import { evaluateNutrition, NUTRITION_THRESHOLDS } from "../nutrition-safety.js";

// A Sunday: the check-in snaps to the most recent Sunday, so a Sunday keeps the window where the tests put it.
const TODAY = "2026-10-04";
const GOAL = { cut: "Fat loss", bulk: "Hypertrophy", recomp: "General" };

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function scenario({ stats, kg0, ratePct, weighDays, noise = () => 0, extraKcal = 0 }) {
  const plan = buildPlan({ bodyStats: stats, kg: kg0 });
  if (!plan) return null;
  const targets = { ...plan.targets, kcal: plan.targets.kcal + extraKcal };
  const series = weighDays.map((d) => ({ date: addDays(TODAY, -(27 - d)), kg: kg0 * (1 + (ratePct / 100) * (d / 7)) + noise(d) }));
  const days = {};
  for (let i = 0; i < 28; i++) days[addDays(TODAY, -i)] = { kcal: targets.kcal, protein: targets.protein };
  return { plan, targets, args: { series, days, targets, bodyStats: stats, trainingAge: "Intermediate", unit: "kg", today: TODAY } };
}

const calorieFlagsAtStart = (s) =>
  evaluateNutrition({ targets: s.targets, bodyweight: s.args.series.at(-1).kg, unit: "kg", goal: GOAL[s.plan.intent], maintenance: s.plan.tdee }).flags.some((x) => /calorie|deficit/i.test(x.label));

test("every proposal across the realistic grid passes the auditor, the floor, and the under-18 rule", () => {
  const all = Array.from({ length: 28 }, (_, i) => i);
  let cases = 0;
  let proposals = 0;
  for (const heightCm of [155, 170, 185]) {
    for (const kg0 of [55, 80, 110, 140]) {
      for (const ageRange of ["Under 18", "18–29", "45–59"]) {
        for (const sex of ["", "Male", "Female"]) {
          for (const dailyActivity of ["sitting", "onfeet"]) {
            for (const intent of ["cut", "bulk", "recomp"]) {
              for (const ratePct of [-1.8, -0.6, 0, 0.3, 1.2]) {
                for (const extraKcal of [0, 250, -900]) {
                  const stats = { heightCm, ageRange, sex, dailyActivity, daysPerWeek: 3, sessionLength: 60, intent };
                  const s = scenario({ stats, kg0, ratePct, weighDays: all, extraKcal });
                  if (!s) continue;
                  cases++;
                  const r = checkIn(s.args);
                  if (calorieFlagsAtStart(s) && r.status !== "propose") {
                    assert.equal(r.reason === "target_unsafe" || r.status === "inconclusive" || r.status === "not_ready", true, `an unsafe target read as ${r.status}`);
                    assert.notEqual(r.status, "on_track");
                  }
                  if (r.status !== "propose") continue;
                  proposals++;
                  const label = `${heightCm}cm ${kg0}kg ${ageRange} ${sex || "?"} ${dailyActivity} ${intent} ${ratePct}%/wk +${extraKcal}`;
                  // The maintenance the check (and the Food diary) uses: the plan at the mean of the last week's weights.
                  const recent = s.args.series.slice(-7).map((p) => p.kg);
                  const nowPlan = buildPlan({ bodyStats: stats, kg: recent.reduce((a, b) => a + b, 0) / recent.length });
                  const audit = (targets) => evaluateNutrition({ targets, bodyweight: s.args.series.at(-1).kg, unit: "kg", goal: GOAL[s.plan.intent], maintenance: nowPlan.tdee }).flags;
                  const calorieFlags = (f) => f.filter((x) => /calorie|deficit/i.test(x.label));
                  const startedUnsafe = calorieFlags(audit({ kcal: r.fromKcal, protein: s.targets.protein, fat: s.targets.fat })).length > 0;
                  const flags = audit(r.targets);
                  if (startedUnsafe) {
                    assert.equal(calorieFlags(flags).length, 0, `${label}: from an unsafe target the proposal must clear the calorie flags: ${flags.map((f) => f.label)}`);
                    assert.ok(r.toKcal > r.fromKcal, `${label}: an unsafe target was lowered`);
                  } else {
                    assert.equal(flags.length, 0, `${label}: ${flags.map((f) => f.label)}`);
                  }
                  assert.notEqual(r.toKcal, r.fromKcal, label);
                  if (r.toKcal < r.fromKcal) {
                    assert.ok(r.toKcal >= Math.max(NUTRITION_THRESHOLDS.LOW_KCAL, s.plan.bmr), `${label}: under the floor`);
                    assert.notEqual(ageRange, "Under 18", `${label}: a minor was offered a decrease`);
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  assert.ok(cases > 5000, `${cases} cases`);
  assert.ok(proposals / cases >= 0.05, `the sweep is not vacuous: ${proposals} proposals in ${cases} cases`);
});

/** Autocorrelated daily scale noise (AR(1), phi 0.4) plus the weekday rhythm. Stationary SD = sigmaPct of bodyweight. */
function arNoise(rng, length, sigmaKg, phi = 0.4) {
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
  const out = [];
  let e = sigmaKg * gauss();
  for (let d = 0; d < length; d++) {
    out.push(e);
    e = phi * e + Math.sqrt(1 - phi * phi) * sigmaKg * gauss();
  }
  return out;
}

const CUT = { heightCm: 178, ageRange: "18–29", sex: "Male", dailyActivity: "some", daysPerWeek: 4, sessionLength: 60, intent: "cut" };

function singleCheckFlagRate({ ratePct, sigmaPct, seed, trials = 2000 }) {
  const rng = mulberry32(seed);
  let flagged = 0;
  for (let t = 0; t < trials; t++) {
    const pool = Array.from({ length: 28 }, (_, i) => i);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const weighDays = pool.slice(0, 12).sort((a, b) => a - b);
    const kg0 = 90;
    const noise = arNoise(rng, 28, (sigmaPct / 100) * kg0);
    const start = Math.floor(rng() * 7);
    const wobble = (d) => (0.35 / 200) * kg0 * Math.cos((2 * Math.PI * ((d + start) % 7)) / 7) + noise[d];
    const s = scenario({ stats: CUT, kg0, ratePct, weighDays, noise: wobble });
    if (checkIn(s.args).status === "propose") flagged++;
  }
  return flagged / trials;
}

test("a user clearly inside the band is flagged at most 1% of the time, with realistic autocorrelated noise", () => {
  for (const [sigmaPct, seed] of [[0.4, 11], [0.5, 22], [1.0, 33]]) {
    const rate = singleCheckFlagRate({ ratePct: -0.6, sigmaPct, seed });
    assert.ok(rate <= 0.01, `noise ${sigmaPct}%: ${(rate * 100).toFixed(2)}% of on-pace users flagged`);
  }
});

test("a user sitting near a band edge is flagged at most 4% of the time per check", () => {
  for (const [ratePct, sigmaPct, seed] of [[-0.3, 0.5, 44], [-0.95, 0.5, 55], [-0.3, 1.0, 66], [-0.95, 1.0, 77]]) {
    const rate = singleCheckFlagRate({ ratePct, sigmaPct, seed });
    assert.ok(rate <= 0.04, `pace ${ratePct}, noise ${sigmaPct}%: ${(rate * 100).toFixed(2)}%`);
  }
});

test("checked weekly for twelve weeks, an on-pace user is flagged at most 5% of the time", () => {
  const rng = mulberry32(88);
  const TRIALS = 400;
  const HORIZON = 112;
  const kg0 = 100;
  const plan = buildPlan({ bodyStats: CUT, kg: kg0 });
  let anyFlag = 0;
  for (const sigmaPct of [1.0]) {
    for (let t = 0; t < TRIALS; t++) {
      const noise = arNoise(rng, HORIZON, (sigmaPct / 100) * kg0);
      const start = Math.floor(rng() * 7);
      const first = addDays(TODAY, -(HORIZON - 1));
      const series = [];
      const days = {};
      for (let d = 0; d < HORIZON; d++) {
        days[addDays(first, d)] = { kcal: plan.targets.kcal, protein: plan.targets.protein };
        if (rng() < 5 / 7) series.push({ date: addDays(first, d), kg: kg0 * (1 + (-0.6 / 100) * (d / 7)) + (0.35 / 200) * kg0 * Math.cos((2 * Math.PI * ((d + start) % 7)) / 7) + noise[d] });
      }
      let flagged = false;
      for (let d = 27; d < HORIZON && !flagged; d += 7) {
        const asOf = addDays(first, d);
        const r = checkIn({ series, days, targets: plan.targets, bodyStats: CUT, trainingAge: "Intermediate", unit: "kg", today: asOf });
        if (r.status === "propose") flagged = true;
      }
      if (flagged) anyFlag++;
    }
  }
  assert.ok(anyFlag / TRIALS <= 0.05, `${anyFlag}/${TRIALS} on-pace users flagged at least once in 12 weekly checks`);
});

test("a saved target already below what SpotterAI would set is never reassured, lowered, or left unnoticed", () => {
  const small = { heightCm: 165, ageRange: "30–44", sex: "Female", dailyActivity: "some", daysPerWeek: 3, sessionLength: 45, intent: "cut" };
  for (const kcalOver of [-1300, -1000, -700]) {
    for (const ratePct of [-1.8, -0.6, 0, 0.5]) {
      const s = scenario({ stats: small, kg0: 80, ratePct, weighDays: Array.from({ length: 28 }, (_, i) => i), extraKcal: kcalOver });
      const r = checkIn(s.args);
      assert.notEqual(r.status, "on_track", `${kcalOver} ${ratePct}`);
      assert.notEqual(r.status === "propose" && r.direction === "lower", true);
      assert.ok(r.status === "propose" || r.reason === "target_unsafe", `${kcalOver} ${ratePct}: ${r.status}/${r.reason}`);
    }
  }
});
