/**
 * SpotterAI — Safety Lab content
 * ============================================================================
 * Renders the explanatory + benchmark content above the live red-team report:
 *   - Evaluator Benchmark (computed from the real eval-suite + measured timing)
 *   - What SpotterAI catches well / may miss
 *   - Worked bad-plan examples
 *   - Technical Architecture
 *
 * Everything here is derived from the same pure evaluator that runs in the app
 * and in CI — no mock numbers where a real one is available.
 */

import { CASES, runEvalSuite, isRiskyCase } from "./eval-suite.js";
import { evaluatePlan, EVALUATOR_VERSION } from "./evaluator.js";
import { RULE_EXPLANATIONS, TRAINING_PRINCIPLES, PRINCIPLES_NOTE } from "./rule-explanations.js";
import { historyRows } from "./safety-lab-history.js";
import { productionRows } from "./safety-lab-production.js";
import { onceRouteActive } from "./route-gate.js";

const mount = document.getElementById("safety-lab");

function esc(t) {
  const d = document.createElement("div");
  d.textContent = t == null ? "" : String(t);
  return d.innerHTML;
}

// A case is "risky" if it expects the evaluator to flag something.
// Shared with eval.mjs and the benchmark test, so the public number and the
// CLI number are the same number.
const isRisky = isRiskyCase;

/** Real benchmark numbers from the suite + a measured average audit time. */
function benchmark() {
  const results = runEvalSuite();
  const paired = CASES.map((c, i) => ({ c, r: results[i] }));
  const risky = paired.filter((x) => isRisky(x.c));
  const safe = paired.filter((x) => !isRisky(x.c));

  const riskyCaught = risky.filter((x) => x.r.passed).length;
  // A safe plan raising a flag nobody sanctioned. Counts FLAGS, not expectation
  // failures — the old formula never looked at `flagged`, so this public number
  // could read 0 while known-good fixtures lit up.
  const falsePositives = safe.filter((x) => x.r.unexpectedFlags.length > 0).length;
  const casesPass = results.filter((r) => r.passed).length;
  const expPass = results.reduce((n, r) => n + r.expectations.filter((e) => e.ok).length, 0);
  const expTotal = results.reduce((n, r) => n + r.expectations.length, 0);

  // Measure average audit time over many runs (warm) for a stable number.
  const N = 40;
  const t0 = performance.now();
  for (let n = 0; n < N; n++) for (const c of CASES) evaluatePlan(c.plan, c.inputs || {});
  const avgMs = (performance.now() - t0) / (N * CASES.length);

  return {
    total: results.length,
    riskyTotal: risky.length,
    riskyCaught,
    falsePositives,
    expPass,
    expFail: expTotal - expPass,
    expTotal,
    avgMs,
    passing: casesPass === results.length,
  };
}

const CATCHES = [
  "Excessive weekly volume",
  "Poor recovery spacing",
  "Push / pull imbalance",
  "Beginner overload",
  "Conflicts with stated limitations",
  "Missing goal alignment",
];
const MISSES = [
  "Poor exercise form",
  "Undiagnosed injuries",
  "Pain during actual sets",
  "Bad load selection by the user",
  "Medical contraindications",
  "Incomplete or inaccurate user input",
];

const BAD_PLANS = [
  {
    title: "Beginner overload",
    plan: "A beginner is given six training days, heavy compound lifts every day, and repeated max-effort sets.",
    caught: ["Too many weekly sessions for a beginner", "Excessive intensity", "Poor recovery", "Too much compound-lift frequency"],
    repair: "Reduce to 3–4 days, remove max-effort language, add rest days, and lower weekly volume.",
  },
  {
    title: "Knee limitation conflict",
    plan: "A user with knee pain receives high-frequency squats, lunges, and jump training.",
    caught: ["Conflict with the stated knee limitation", "Too much knee-dominant volume", "No lower-impact alternatives"],
    repair: "Swap some knee-dominant exercises for hip thrusts, hamstring curls, glute bridges, and controlled step-ups.",
  },
  {
    title: "Push / pull imbalance",
    plan: "A hypertrophy plan includes heavy pressing 4 days per week but almost no rowing or pulling.",
    caught: ["Poor upper-body balance", "Excess pressing volume", "Missing back volume"],
    repair: "Add rows, pulldowns, and face pulls, and reduce redundant pressing.",
  },
];

const PRIVACY = {
  local: [
    "Workout, meal, progress, pain, and profile data are stored in this browser by default",
    "Raw webcam video stays on-device during form check",
    "Plan adaptation runs locally, without an AI request",
  ],
  sent: [
    "Plan-generation intake",
    "Coach messages plus the current plan and a recent tracker summary",
    "Food descriptions, meal photos, new exercise names, and quick-log text",
  ],
  services: [
    "Google Gemini processes AI requests; Groq may process text requests when Gemini is unavailable",
    "Vercel hosts the app and APIs; Vercel Web Analytics receives allow-listed funnel pageviews, never workout, meal, or message content",
    "Firebase stores tracker data plus Google account name and email only after you choose Cloud sync",
  ],
};

const ARCH = [
  ["AI plan generation", "A serverless function holds the API key and prompts Gemini for a strict-JSON weekly plan."],
  ["Deterministic evaluator", "Pure code (no LLM) scores the plan against a fixed, versioned rubric: the same logic in the app and in CI."],
  ["Structured exercise data", "Muscle, movement-pattern, and contraindication metadata back the checks, with keyword fallback."],
  ["Plan repair engine", "Rule-based fixes turn each flag into a concrete, safer edit."],
  ["Re-audit loop", "Every revised or adapted plan is re-scored before it's recommended."],
  ["Local-first tracking", "Workouts, meals, and progress live in the browser; nothing requires an account."],
  ["Safety Lab benchmarks", "A red-team suite measures what the evaluator catches and what it misses."],
  ["CI-backed eval tests", "The exact suite runs on every push, so the auditor can't silently regress."],
];

function render() {
  if (!mount) return;
  const b = benchmark();
  const row = (label, value, cls = "") => `<div class="bench__item"><dt>${label}</dt><dd class="${cls}">${value}</dd></div>`;

  const bench = `
    <div class="lab-block">
      <div class="lab-block__head">
        <div>
          <h3 class="lab-block__title">Evaluator benchmark <span class="bench__tag">Bundled local benchmark, reproducible</span></h3>
          <p class="lab-block__sub">SpotterAI runs known-good and intentionally risky plans through the same evaluator used in the app. These tests help catch regressions and make the guardrails more transparent. Computed live in your browser from the bundled suite; the same suite is gated in CI.</p>
        </div>
        <span class="bench__status bench__status--${b.passing ? "pass" : "fail"}">${b.passing ? "Passing" : "Needs review"}</span>
      </div>
      <dl class="bench">
        ${row("Test cases run", b.total)}
        ${row("Expectations passed", `${b.expPass}/${b.expTotal}`, "is-ok")}
        ${row("Expectations failed", b.expFail, b.expFail ? "is-warn" : "is-ok")}
        ${row("Risky plans caught", `${b.riskyCaught}/${b.riskyTotal}`, "is-ok")}
        ${row("Safe plans incorrectly flagged", b.falsePositives, b.falsePositives ? "is-warn" : "is-ok")}
        ${row("Average audit time", `${b.avgMs < 1 ? b.avgMs.toFixed(2) : Math.round(b.avgMs)} ms`)}
        ${row("Evaluator version", esc(EVALUATOR_VERSION))}
        ${row("Last test run", "Just now · on page load")}
        ${row("Regression status", b.passing ? "Passing" : "Needs review", b.passing ? "is-ok" : "is-warn")}
      </dl>
    </div>`;

  const rules = `
    <div class="lab-block">
      <h3 class="lab-block__title">Why these rules exist</h3>
      <p class="lab-block__sub">Every check in plain English: what it looks at, why it matters, what SpotterAI does, and where it's limited.</p>
      <div class="rule-grid">
        ${RULE_EXPLANATIONS.map(
          (r) => `
          <article class="rule-card">
            <h4 class="rule-card__name">${esc(r.name)}</h4>
            <p class="rule-card__row"><span class="rule-card__k">Checks</span> ${esc(r.checks)}</p>
            <p class="rule-card__row"><span class="rule-card__k">Why it matters</span> ${esc(r.why)}</p>
            <p class="rule-card__row"><span class="rule-card__k">What SpotterAI does</span> ${esc(r.action)}</p>
            <p class="rule-card__row rule-card__limit"><span class="rule-card__k">Limitations</span> ${esc(r.limitations)}</p>
          </article>`
        ).join("")}
      </div>
    </div>`;

  const principles = `
    <div class="lab-block">
      <h3 class="lab-block__title">Training principles behind the checks</h3>
      <ul class="principles">${TRAINING_PRINCIPLES.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
      <p class="principles__note">${esc(PRINCIPLES_NOTE)}</p>
    </div>`;

  const cols = `
    <div class="lab-block">
      <div class="lab-cols">
        <div class="lab-col lab-col--good">
          <h4>What SpotterAI catches well</h4>
          <ul>${CATCHES.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
        </div>
        <div class="lab-col lab-col--bad">
          <h4>What SpotterAI may miss</h4>
          <ul>${MISSES.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
        </div>
      </div>
    </div>`;

  const examples = `
    <div class="lab-block">
      <h3 class="lab-block__title">Worked examples: bad plans it catches</h3>
      <p class="lab-block__sub">Three intentionally bad inputs, what the evaluator flags, and the safer version it points toward.</p>
      <div class="badplan-grid">
        ${BAD_PLANS.map(
          (e) => `
          <article class="badplan">
            <h4 class="badplan__title">${esc(e.title)}</h4>
            <p class="badplan__plan"><span class="badplan__tag badplan__tag--bad">Bad plan</span> ${esc(e.plan)}</p>
            <p class="badplan__label">What's caught &amp; why it matters</p>
            <ul class="badplan__caught">${e.caught.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
            <p class="badplan__repair"><span class="badplan__tag badplan__tag--fix">Safer version</span> ${esc(e.repair)}</p>
          </article>`
        ).join("")}
      </div>
    </div>`;

  const privacyCol = (title, items, cls) => `
    <div class="privacy-col privacy-col--${cls}">
      <h4>${title}</h4>
      <ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>
    </div>`;
  const privacy = `
    <div class="lab-block">
      <h3 class="lab-block__title">Privacy &amp; data</h3>
      <p class="lab-block__sub">Fitness data is personal, so SpotterAI is explicit about what stays on your device and what is used for AI features.</p>
      <div class="privacy-grid">
        ${privacyCol("Stored locally by default", PRIVACY.local, "local")}
        ${privacyCol("Sent for AI features", PRIVACY.sent, "sent")}
        ${privacyCol("Service providers", PRIVACY.services, "never")}
      </div>
      <p class="privacy-controls">No account is required. The Account menu can export or import <strong>tracker data</strong>, clear local data, and control optional Cloud sync. Current limitation: tracker backups and Cloud sync do not include your generated plan or local profile shell yet.</p>
    </div>`;

  const tech = `
    <div class="lab-block">
      <h3 class="lab-block__title">Technical architecture</h3>
      <p class="lab-block__sub">SpotterAI separates creative AI generation from deterministic safety checks. The AI drafts flexible plans; the evaluator applies consistent rules, structured exercise metadata, and regression-tested checks before a plan is recommended.</p>
      <div class="tech-grid">
        ${ARCH.map(
          ([t, d]) => `<div class="tech"><h5>${esc(t)}</h5><p>${esc(d)}</p></div>`
        ).join("")}
      </div>
    </div>`;

  // History is fetched, so it lands after first paint. The anchor keeps its
  // slot in document order without blocking anything.
  const history = `<div class="lab-block" id="bench-history" hidden></div>`;
  const production = `<div class="lab-block" id="bench-production" hidden></div>`;
  mount.innerHTML = bench + history + production + cols + rules + examples + privacy + principles + tech;
}

/**
 * Fill the history block from the committed record. Fetched, not bundled, so
 * it must never block or break the live benchmark above it: any failure leaves
 * the block hidden and the page reads exactly as it did before this shipped.
 */
async function hydrateHistory() {
  const el = document.getElementById("bench-history");
  if (!el) return;
  let rows = [];
  try {
    const res = await fetch("/docs/benchmark-history.json", { cache: "no-cache" });
    if (!res.ok) return;
    rows = historyRows(await res.json());
  } catch {
    return;
  }
  if (rows.length === 0) return;

  const body = rows
    .map(
      (r) => `<tr class="${r.regressed ? "is-regression" : ""}">
        <td>${esc(r.version)}</td>
        <td>${esc(r.date)}</td>
        <td>${Number(r.riskyCaught)}/${Number(r.riskyTotal)}${r.regressed ? " <span class=\"is-warn\">regression</span>" : ""}</td>
        <td>${Number(r.falsePositives)}</td>
      </tr>`
    )
    .join("");

  el.innerHTML = `
    <div class="lab-block__head">
      <div>
        <h3 class="lab-block__title">Benchmark history</h3>
        <p class="lab-block__sub">One row per evaluator version, written by CI on every change since ${esc(rows[0].date)}. Nothing before that date is shown, because nothing before that date was recorded.</p>
      </div>
    </div>
    <table class="bench-history">
      <thead><tr><th>Version</th><th>First seen</th><th>Risky plans caught</th><th>False positives</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
  el.hidden = false;
}

/**
 * Fill the production block from the telemetry aggregate.
 *
 * The block stays hidden when there is no data. A rendered zero would read as
 * "this check never fires on real plans" when the truth is "nothing has been
 * collected", and those are opposite claims.
 */
async function hydrateProduction() {
  const el = document.getElementById("bench-production");
  if (!el) return;
  let shaped = null;
  try {
    const res = await fetch("/api/audit-telemetry", { cache: "no-cache" });
    if (!res.ok) return;
    shaped = productionRows(await res.json());
  } catch {
    return;
  }
  if (!shaped) return;

  // RULE_EXPLANATIONS is an ARRAY of { id, name, ... }, not a map, and the
  // human label lives on `name`. Built once here rather than scanned per row.
  const labels = new Map(RULE_EXPLANATIONS.map((r) => [r.id, r.name]));
  const labelFor = (id) => labels.get(id) || id;
  const body = shaped.rows
    .map((r) => `<tr><td>${esc(labelFor(r.id))}</td><td>${r.fired}</td><td>${r.rate}%</td></tr>`)
    .join("");

  el.innerHTML = `
    <div class="lab-block__head">
      <div>
        <h3 class="lab-block__title">On real plans <span class="bench__tag">Production telemetry, unverified</span></h3>
        <p class="lab-block__sub">How often each check flagged something across ${shaped.audits} audited plans${shaped.since ? `, since ${esc(shaped.since)}` : ""}. Anonymous counters only: no plan content, no accounts, nothing identifying anyone. Unlike the bundled benchmark above, which anyone can reproduce by running the suite from the repo, this endpoint is public and unauthenticated, so treat these numbers as a direction rather than a proof.</p>
      </div>
    </div>
    <table class="bench-history">
      <thead><tr><th>Check</th><th>Times flagged</th><th>Share of plans</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
  el.hidden = false;
}

// Compact live benchmark summary for the homepage teaser.
function renderTeaser() {
  const el = document.getElementById("home-safety-teaser");
  if (!el) return;
  const b = benchmark();
  const stat = (n, label, cls = "") => `<div class="lab-teaser__stat"><span class="lab-teaser__num ${cls}">${n}</span><span class="lab-teaser__label">${label}</span></div>`;
  el.innerHTML =
    stat(b.total, "test cases") +
    stat(`${b.riskyCaught}/${b.riskyTotal}`, "risky plans caught", "is-ok") +
    stat(b.falsePositives, "false positives", b.falsePositives ? "is-warn" : "is-ok") +
    stat(`${b.expPass}/${b.expTotal}`, "expectations passed", "is-ok");
}

// ----------------------------------------------------------------------------
// Route gate — the Safety Lab (`evals`) route only
// ============================================================================
// The router (router.js `show()`) only toggles `hidden` on route sections; it
// never removes `#evals` from the DOM. Without a gate, `#bench-history`'s
// fetch would fire on every route of the whole app, not just on a visit to
// the Safety Lab. `evalsActive`/`onEvalsRouteChange` are the shared plumbing:
// any hydrator gated the same way (a future telemetry fetch, say) reuses
// these two plus `onceRouteActive` instead of duplicating the guard.
const evalsActive = () => document.getElementById("evals")?.hidden === false;
const onEvalsRouteChange = (onChange) => {
  window.addEventListener("spotter:route", (e) => {
    if (e.detail?.route === "evals") onChange();
  });
};

// Render off the critical path (the benchmark + timing loop shouldn't block first
// paint) and never let a benchmark failure blank the page.
const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1));
idle(() => {
  try {
    if (mount) render();
    renderTeaser();
  } catch {
    if (mount) mount.innerHTML = `<div class="lab-block"><p class="eval-error">Safety Lab couldn't run the local benchmark just now. The app can still audit plans; only the benchmark proof is temporarily unavailable.</p></div>`;
  }
  // Runs at most once, on first arrival at the Safety Lab — not on every page
  // view of the app, and not again on a later revisit. render() above has
  // already built the #bench-history and #bench-production anchors (or, on
  // failure, replaced mount entirely), so each hydrator's own
  // `if (!el) return` covers both cases.
  onceRouteActive(evalsActive, onEvalsRouteChange, hydrateHistory);
  onceRouteActive(evalsActive, onEvalsRouteChange, hydrateProduction);
});
