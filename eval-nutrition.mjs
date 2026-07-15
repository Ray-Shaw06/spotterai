/**
 * SpotterAI — nutrition-estimate benchmark (`npm run eval:nutrition`)
 * ============================================================================
 * Answers two questions about the food estimator:
 *
 *   1. COVERAGE (always, no network): does DB-grounding surface the right
 *      curated reference for each query? A regression here (e.g. a plural that
 *      stops matching) means grounding silently stops helping. Exit non-zero if
 *      any case misses its anchor.
 *
 *   2. ACCURACY (only with GEMINI_API_KEY + --live): run each food through the
 *      REAL estimator twice — grounded and ungrounded — and report how much
 *      grounding cuts the error vs. the curated truth. This is the number that
 *      tells you whether grounding + reconciliation actually pay off.
 *
 * Live runs cost tokens and are stochastic, so this is a manual benchmark, not a
 * CI gate (CI runs the deterministic coverage via test/nutrition-eval-suite.test.js).
 */

import { NUTRITION_CASES, anchorCoverage, scoreEstimate } from "./nutrition-eval-suite.js";
import { buildFoodReference, FOOD_INSTRUCTION, FOOD_SCHEMA, extractJson, normalizeFood } from "./api/estimate.js";
import { callGemini } from "./lib/gemini.js";

const pad = (s, n) => String(s).padEnd(n);
const pct = (x) => `${(x * 100).toFixed(1)}%`;

// ---- 1. Deterministic anchor coverage -------------------------------------
const cov = anchorCoverage();
const misses = cov.filter((c) => !c.covered);

console.log("\nSpotterAI — Nutrition Estimator Benchmark");
console.log("=".repeat(60));
console.log(pad("Cases", 34), NUTRITION_CASES.length);
console.log(pad("DB-anchor coverage", 34), `${cov.length - misses.length}/${cov.length} (${pct((cov.length - misses.length) / (cov.length || 1))})`);
if (misses.length) {
  console.log("\nMISSING anchors (grounding won't help these):");
  for (const m of misses) console.log(`  ✗ "${m.query}"  →  expected to surface "${m.anchor}"`);
}
console.log("=".repeat(60));

// ---- 2. Live grounded-vs-ungrounded accuracy (opt-in) ---------------------
const key = process.env.GEMINI_API_KEY;
const live = process.argv.includes("--live");

async function estimate(query, { grounded }) {
  const ref = grounded ? buildFoodReference(query) : "";
  const systemInstruction = ref ? `${FOOD_INSTRUCTION}\n\n${ref}` : FOOD_INSTRUCTION;
  // Mirror api/estimate.js's text-food request exactly.
  const text = await callGemini({
    apiKey: key,
    contents: [{ role: "user", parts: [{ text: `Food: ${query}` }] }],
    systemInstruction,
    generationConfig: { temperature: 0.3, maxOutputTokens: 320, responseMimeType: "application/json", responseSchema: FOOD_SCHEMA },
    timeoutMs: 20000,
  });
  return normalizeFood(extractJson(text), query);
}

// Pace calls so the free-tier per-minute limit isn't tripped (each estimate can
// fan out to a few requests via callGemini's retry + fallback). Overridable:
//   --delay=<ms between calls>   --limit=<how many foods to run>
const argVal = (name, def) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split("=")[1] : def;
};
const delayMs = Math.max(0, Number(argVal("delay", 7000)));
const limit = Math.max(1, Number(argVal("limit", NUTRITION_CASES.length)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shortErr = (m = "") =>
  /\b429\b/.test(m) ? "rate-limited (429) — free-tier quota"
    : /\b404\b/.test(m) ? "model unavailable (404)"
      : String(m).split("\n")[0].slice(0, 60);

if (live && key) {
  const cases = NUTRITION_CASES.slice(0, limit);
  console.log(`\nRunning LIVE estimates (grounded vs ungrounded) — ${cases.length} food(s), ~${delayMs}ms between calls to respect free-tier limits…\n`);
  const agg = { grounded: { k: 0, m: 0 }, ungrounded: { k: 0, m: 0 }, n: 0 };
  console.log(pad("Food", 34) + pad("kcal err ↓", 24) + "macro MAE ↓");
  let consecutive429 = 0;
  for (const c of cases) {
    try {
      const g = await estimate(c.query, { grounded: true });
      await sleep(delayMs);
      const u = await estimate(c.query, { grounded: false });
      await sleep(delayMs);
      consecutive429 = 0;
      const sg = scoreEstimate(g, c.expected);
      const su = scoreEstimate(u, c.expected);
      agg.grounded.k += sg.kcalErrPct; agg.grounded.m += sg.macroMae;
      agg.ungrounded.k += su.kcalErrPct; agg.ungrounded.m += su.macroMae;
      agg.n++;
      console.log(pad(c.anchor || c.query, 34) + pad(`${pct(su.kcalErrPct)} → ${pct(sg.kcalErrPct)}`, 24) + `${su.macroMae.toFixed(1)}g → ${sg.macroMae.toFixed(1)}g`);
    } catch (e) {
      const m = e.message || String(e);
      console.log(pad(c.anchor || c.query, 34) + `(skipped: ${shortErr(m)})`);
      if (/\b429\b/.test(m) && ++consecutive429 >= 3) {
        console.log(`\nStopped — 3 rate-limits in a row, so free-tier quota is the blocker, not the code.`);
        console.log(`Options: wait ~60s and re-run · widen the gap (--delay=12000) · run fewer (--limit=3)`);
        console.log(`· or raise limits with billing: https://ai.google.dev/gemini-api/docs/rate-limits`);
        break;
      }
      if (/\b429\b/.test(m)) await sleep(delayMs * 2); // cool down before the next food
    }
  }
  if (agg.n) {
    console.log("-".repeat(60));
    console.log(pad(`MEAN kcal error (n=${agg.n})`, 34) + `${pct(agg.ungrounded.k / agg.n)} → ${pct(agg.grounded.k / agg.n)} (grounded)`);
    console.log(pad("MEAN macro MAE", 34) + `${(agg.ungrounded.m / agg.n).toFixed(1)}g → ${(agg.grounded.m / agg.n).toFixed(1)}g (grounded)`);
  } else {
    console.log("\nNo successful estimates — the quota note above explains why.");
  }
} else {
  console.log("\nAccuracy A/B skipped. To measure grounding's payoff (paced for free tier):");
  console.log("  node --env-file=.env eval-nutrition.mjs --live --limit=3   # quick, low-quota check first");
  console.log("  node --env-file=.env eval-nutrition.mjs --live             # all foods once that works");
}

process.exit(misses.length ? 1 : 0);
