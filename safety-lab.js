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

import { CASES, runEvalSuite } from "./eval-suite.js";
import { evaluatePlan, EVALUATOR_VERSION } from "./evaluator.js";
import { RULE_EXPLANATIONS, TRAINING_PRINCIPLES, PRINCIPLES_NOTE } from "./rule-explanations.js";

const mount = document.getElementById("safety-lab");

function esc(t) {
  const d = document.createElement("div");
  d.textContent = t == null ? "" : String(t);
  return d.innerHTML;
}

// A case is "risky" if it expects the evaluator to flag something.
const isRisky = (c) => c.expect.some((e) => (e.status && e.status !== "pass") || "scoreAtMost" in e);

/** Real benchmark numbers from the suite + a measured average audit time. */
function benchmark() {
  const results = runEvalSuite();
  const paired = CASES.map((c, i) => ({ c, r: results[i] }));
  const risky = paired.filter((x) => isRisky(x.c));
  const safe = paired.filter((x) => !isRisky(x.c));

  const riskyCaught = risky.filter((x) => x.r.passed).length;
  const falsePositives = safe.filter((x) => !x.r.passed).length;
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
  local: ["Workout logs", "Meal logs", "Progress data", "Profiles", "Webcam video (form check)"],
  sent: ["Workout-generation inputs", "Plan context", "Coach chat messages", "Adaptation context"],
  never: ["Raw webcam video (form check runs on-device)", "Local-only profile data, unless you include it in a generation request"],
};

const ARCH = [
  ["AI plan generation", "A serverless function holds the API key and prompts Gemini for a strict-JSON weekly plan."],
  ["Deterministic evaluator", "Pure code (no LLM) scores the plan against a fixed, versioned rubric — the same logic in the app and in CI."],
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
          <h3 class="lab-block__title">Evaluator benchmark <span class="bench__tag">Bundled local benchmark</span></h3>
          <p class="lab-block__sub">SpotterAI runs known-good and intentionally risky plans through the same evaluator used in the app. These tests help catch regressions and make the guardrails more transparent. Computed live in your browser from the bundled suite — the same suite is gated in CI.</p>
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
      <p class="lab-block__sub">Every check in plain English — what it looks at, why it matters, what SpotterAI does, and where it's limited.</p>
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
      <h3 class="lab-block__title">Worked examples — bad plans it catches</h3>
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
        ${privacyCol("Stays on your device", PRIVACY.local, "local")}
        ${privacyCol("May be sent to AI", PRIVACY.sent, "sent")}
        ${privacyCol("Never sent", PRIVACY.never, "never")}
      </div>
      <p class="privacy-controls">You're in control: <strong>export</strong>, <strong>import</strong>, <strong>delete local data</strong>, or <strong>reset the demo profile</strong> from the account menu (bottom-left). No account is required and there are no third-party trackers.</p>
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

  mount.innerHTML = bench + cols + rules + examples + privacy + principles + tech;
}

// Render off the critical path (the benchmark + timing loop shouldn't block first
// paint) and never let a benchmark failure blank the page.
if (mount) {
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1));
  idle(() => {
    try {
      render();
    } catch {
      mount.innerHTML = `<div class="lab-block"><p class="eval-error">Safety Lab couldn't run the local benchmark just now. The app can still audit plans — benchmark proof is temporarily unavailable.</p></div>`;
    }
  });
}
