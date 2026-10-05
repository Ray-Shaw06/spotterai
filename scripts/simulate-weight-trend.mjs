/**
 * How well can a weight trend be read through scale noise?
 * ============================================================================
 * Backs the "Nutrition pace bands" section of docs/rubric-sources.md. Zero
 * dependencies; seeded, so the same command prints the same table.
 *
 *   node scripts/simulate-weight-trend.mjs
 *
 * MODEL. A person's true weight moves in a straight line (a constant true rate
 * in % of bodyweight per week). Each weigh-in adds a weekday rhythm (heavier
 * Sunday/Monday, lighter Friday) and independent noise, then a least-squares
 * line is fitted through the weigh-ins in the window and a one-sided 95%
 * confidence limit is put on its slope. The rule fires only when the whole
 * interval sits outside the pace band.
 *
 * NOISE INPUTS come from the literature, not from this file:
 *   - Schneditz 2023: SD of day-to-day body-mass change 0.53% (one-day
 *     interval), 0.69% (seven-day), one healthy adult, 9,521 days. If weigh-ins
 *     were independent that implies a per-weigh-in SD of about 0.37 to 0.49%.
 *   - Turicchi 2020: a within-week rhythm of 0.35% in 1,421 adults.
 *   - Bhutani 2017: SD of a free-living two-week change of 1.2 kg in adults in
 *     energy balance, which implies a per-weigh-in SD of roughly 1%.
 * We therefore run 0.4%, 0.5% and 1.0% as low, typical and pessimistic.
 *
 * WHAT THIS IS NOT. It is a simulation of the statistics of a decision rule,
 * not evidence about physiology. It says how often a rule would misfire given
 * those noise levels. It is labelled as derived, never cited as a finding.
 */

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

const rng = mulberry32(20261005);
const gauss = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());

/** `n` distinct days out of `window`, sorted. */
function pickDays(window, n) {
  const pool = Array.from({ length: window }, (_, i) => i);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n).sort((a, b) => a - b);
}

function weighIns({ ratePerWeek, sigma, n, window, rhythm = 0.35 }) {
  const days = pickDays(window, n);
  const start = Math.floor(rng() * 7);
  const y = days.map((d) => (ratePerWeek * d) / 7 + (rhythm / 2) * Math.cos((2 * Math.PI * ((d + start) % 7)) / 7) + sigma * gauss());
  return { days, y };
}

/** Least-squares slope per week and its standard error per week. */
export function slopePerWeek({ days, y }) {
  const n = y.length;
  const md = days.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  const sxx = days.reduce((a, d) => a + (d - md) ** 2, 0);
  const b = days.reduce((a, d, i) => a + (d - md) * (y[i] - my), 0) / sxx;
  const rss = y.reduce((a, v, i) => a + (v - (my + b * (days[i] - md))) ** 2, 0);
  return { slope: b * 7, se: Math.sqrt(rss / (n - 2) / sxx) * 7 };
}

const Z95_ONE_SIDED = 1.645;
const TRIALS = 6000;

function rates({ truth, sigma, n, window, floor, ceil }) {
  let slow = 0;
  let fast = 0;
  for (let t = 0; t < TRIALS; t++) {
    const { slope, se } = slopePerWeek(weighIns({ ratePerWeek: truth, sigma, n, window }));
    if (slope - Z95_ONE_SIDED * se > floor) slow++; // whole interval above the slow edge
    if (slope + Z95_ONE_SIDED * se < ceil) fast++; // whole interval below the fast edge
  }
  return { slow: slow / TRIALS, fast: fast / TRIALS };
}

const pct = (x) => `${(x * 100).toFixed(1)}%`.padStart(6);
const CUT_BAND = { floor: -0.25, ceil: -1.0 }; // % of bodyweight per week; see rubric-sources.md

console.log("Cut band: on pace is a loss between 0.25% and 1.0% of bodyweight per week.");
console.log("Columns: share of simulated users flagged 'slower than the band' / 'faster than the band'.\n");
console.log("noise   window  weigh-ins | truly on pace (-0.6)  | truly stalled (0.0)   | truly too fast (-1.4)");
for (const sigma of [0.4, 0.5, 1.0]) {
  for (const [window, n] of [[21, 12], [28, 12], [28, 16], [42, 24]]) {
    const cells = [-0.6, 0, -1.4].map((truth) => {
      const r = rates({ truth, sigma, n, window, ...CUT_BAND });
      return `${pct(r.slow)} / ${pct(r.fast)}`;
    });
    console.log(`${String(sigma).padEnd(5)}%  ${String(window).padStart(3)}d    ${String(n).padStart(3)}      | ${cells.join("  | ")}`);
  }
}

// The rule an earlier draft of the design used: weekly mean weights over three
// weeks, and propose only when BOTH weekly changes lie outside the band. Kept
// here so the comparison in rubric-sources.md can be re-run, not just stated.
function weeklyMeansRule({ truth, sigma, n }) {
  let wrongSlow = 0;
  let wrongFast = 0;
  let usable = 0;
  for (let t = 0; t < TRIALS; t++) {
    const { days, y } = weighIns({ ratePerWeek: truth, sigma, n, window: 21 });
    const means = [0, 1, 2].map((w) => {
      const v = y.filter((_, i) => days[i] >= 7 * w && days[i] < 7 * w + 7);
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    });
    if (means.some((m) => m == null)) continue; // a week with no weigh-in cannot be judged
    usable++;
    const d1 = means[1] - means[0];
    const d2 = means[2] - means[1];
    if (d1 > CUT_BAND.floor && d2 > CUT_BAND.floor) wrongSlow++;
    if (d1 < CUT_BAND.ceil && d2 < CUT_BAND.ceil) wrongFast++;
  }
  return { wrong: (wrongSlow + wrongFast) / Math.max(1, usable), usable: usable / TRIALS };
}

console.log("\nEarlier draft rule (two weekly changes must agree), 21 days, user truly on pace (-0.6):");
console.log("noise   weigh-ins | false flag | share of users with a weigh-in in every week");
for (const sigma of [0.5, 1.0]) {
  for (const n of [6, 12]) {
    const r = weeklyMeansRule({ truth: -0.6, sigma, n });
    console.log(`${String(sigma).padEnd(5)}%  ${String(n).padStart(3)}       | ${pct(r.wrong)}     | ${pct(r.usable)}`);
  }
}
