/**
 * Two guarantees the weekly check-in rests on, as tests rather than promises.
 *
 * 1. Cross-system sweep: every proposal, for every body and trend in a realistic
 *    grid, passes the safety auditor, respects the calorie floor, and never
 *    lowers calories for an under-18. (The prescriber and the auditor must agree.)
 * 2. Statistical guarantee: against the published scale-noise levels (see
 *    scripts/simulate-weight-trend.mjs and docs/rubric-sources.md), a user who is
 *    genuinely on pace is flagged at most 1% of the time. Loosen the gate or the
 *    confidence limit and this fails.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { checkIn } from "../nutrition-adjust.js";
import { buildPlan } from "../nutrition-plan.js";
import { addDays } from "../lib/calendar-days.js";
import { evaluateNutrition, NUTRITION_THRESHOLDS } from "../nutrition-safety.js";

const TODAY = "2026-10-05";
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
                for (const extraKcal of [0, 250]) {
                  const stats = { heightCm, ageRange, sex, dailyActivity, daysPerWeek: 3, sessionLength: 60, intent };
                  const s = scenario({ stats, kg0, ratePct, weighDays: all, extraKcal });
                  if (!s) continue;
                  cases++;
                  const r = checkIn(s.args);
                  if (r.status !== "propose") continue;
                  proposals++;
                  const label = `${heightCm}cm ${kg0}kg ${ageRange} ${sex || "?"} ${dailyActivity} ${intent} ${ratePct}%/wk +${extraKcal}`;
                  const flags = evaluateNutrition({ targets: r.targets, bodyweight: s.args.series.at(-1).kg, unit: "kg", goal: GOAL[s.plan.intent], maintenance: s.plan.tdee }).flags;
                  assert.equal(flags.length, 0, `${label}: ${flags.map((f) => f.label)}`);
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

test("a user genuinely on pace is flagged at most 1% of the time at the published noise levels", () => {
  const stats = { heightCm: 178, ageRange: "18–29", sex: "Male", dailyActivity: "some", daysPerWeek: 4, sessionLength: 60, intent: "cut" };
  const TRIALS = 2000;
  for (const [sigmaPct, seed] of [[0.4, 11], [0.5, 22], [1.0, 33]]) {
    const rng = mulberry32(seed);
    const gauss = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
    let flagged = 0;
    for (let t = 0; t < TRIALS; t++) {
      const pool = Array.from({ length: 28 }, (_, i) => i);
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      const weighDays = pool.slice(0, 12).sort((a, b) => a - b);
      const kg0 = 90;
      const start = Math.floor(rng() * 7);
      const noise = (d) => (0.35 / 200) * kg0 * Math.cos((2 * Math.PI * ((d + start) % 7)) / 7) + (sigmaPct / 100) * kg0 * gauss();
      const s = scenario({ stats, kg0, ratePct: -0.6, weighDays, noise });
      if (checkIn(s.args).status === "propose") flagged++;
    }
    assert.ok(flagged / TRIALS <= 0.01, `noise ${sigmaPct}%: ${flagged}/${TRIALS} on-pace users flagged`);
  }
});
