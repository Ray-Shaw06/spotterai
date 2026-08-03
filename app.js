/**
 * SpotterAI — front-end controller
 * ============================================================================
 * Wires guided onboarding to the serverless generator and the client-side
 * evaluator, then renders the plan, safety score, and list of checks.
 *
 * Flow:
 *   onboarding → mapped inputs → POST /api/generate
 *          → on success: render plan
 *          → on failure / 429 / offline: fall back to a saved sample plan
 *          → either way: run evaluator.js and render the audit
 *
 * No build step: this is a native ES module that imports the evaluator.
 */

import { evaluatePlan, EVALUATOR_VERSION } from "./evaluator.js";
import { repairPlan } from "./repair.js";
import { screenRequest, GENERATOR_BOUNDARY } from "./safety-boundaries.js";
import { ruleForCheck } from "./rule-explanations.js";
import { planConfidence } from "./trust.js";
import { buildAuditEntry, recordAudit, getAuditHistory, auditTrend } from "./trust-history.js";
import { lineChart } from "./charts.js";
import { setPlan, store } from "./store.js";
import { getContext as getTrackerContext, buildAdaptContext } from "./tracker-store.js";
import { adaptPlan } from "./adapt-engine.js";
import { swapExercise, removeExercise, addExercise } from "./plan-edit.js";
import { suggestAlternatives } from "./exercise-data.js";
import { searchExercises } from "./exercises.js";
import { trackFunnel } from "./analytics.js";
import { aiFailureMessage, assertPlanShape, classifyAiFailure, fetchWithTimeout } from "./ai-errors.js";

// ----------------------------------------------------------------------------
// Element references
// ----------------------------------------------------------------------------
const retryBtn = document.getElementById("retry-btn");
const regenerateBtn = document.getElementById("regenerate-btn");
const generatorSection = document.getElementById("generator");

const states = {
  empty: document.getElementById("state-empty"),
  loading: document.getElementById("state-loading"),
  error: document.getElementById("state-error"),
  results: document.getElementById("state-results"),
};

const loadingStepEl = document.getElementById("loading-step");
const errorText = document.getElementById("error-text");
const fallbackNotice = document.getElementById("fallback-notice");
const fallbackMessage = document.getElementById("fallback-message");
const fallbackRetryBtn = document.getElementById("fallback-retry-btn");

const scoreValueEl = document.getElementById("score-value");
const auditVerdict = document.getElementById("audit-verdict");
const auditScore = document.getElementById("audit-score");
const auditCounts = document.getElementById("audit-counts");
const checksList = document.getElementById("checks-list");
const countPass = document.getElementById("count-pass");
const auditPassed = document.getElementById("audit-passed");
const auditPassedList = document.getElementById("audit-passed-list");
const countNotAssessed = document.getElementById("count-not-assessed");
const auditNotAssessed = document.getElementById("audit-not-assessed");
const auditNotAssessedList = document.getElementById("audit-not-assessed-list");
const trustReportEl = document.getElementById("trust-report");
const repairMount = document.getElementById("repair-mount");
const planOutput = document.getElementById("plan-output");
const startFirstWorkoutBtn = document.getElementById("start-first-workout");

// Adaptive coach loop (re-tune the plan from logged training, then re-audit).
const adaptCard = document.getElementById("adapt-card");
const adaptBtn = document.getElementById("adapt-btn");
const adaptHint = document.getElementById("adapt-hint");
const adaptChanges = document.getElementById("adapt-changes");

// Respect the user's motion preference for every animation.
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Cache of fallback sample plans (loaded once, lazily).
let samplePlansPromise = null;

// ----------------------------------------------------------------------------
// Small utilities
// ----------------------------------------------------------------------------

/** Escape user/LLM-provided text before inserting it into the DOM. */
function esc(text) {
  const div = document.createElement("div");
  div.textContent = text == null ? "" : String(text);
  return div.innerHTML;
}

/** Show exactly one state panel, hide the others. */
function showState(name) {
  for (const [key, el] of Object.entries(states)) {
    el.hidden = key !== name;
  }
}

function revealGenerator({ scroll = false } = {}) {
  generatorSection.hidden = false;
  if (scroll) {
    generatorSection.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
      block: "start",
    });
  }
}

function hideGenerator() {
  generatorSection.hidden = true;
}

/** Plain-English label per severity tier. */
const TIER_LABEL = { critical: "Critical", warning: "Warning", suggestion: "Suggestion" };
const TIER_ORDER = { critical: 0, warning: 1, suggestion: 2, pass: 3 };

// ----------------------------------------------------------------------------
// Loading state: cycle friendly step messages
// ----------------------------------------------------------------------------

const LOADING_STEPS = [
  "Asking the coach for a draft",
  "Validating the response is strict JSON",
  "Running the code-based safety evaluator",
  "Scoring the plan against the rubric",
];
let loadingTimer = null;

function startLoadingSteps() {
  let i = 0;
  loadingStepEl.textContent = LOADING_STEPS[0];
  if (prefersReducedMotion) return;
  loadingTimer = setInterval(() => {
    i = (i + 1) % LOADING_STEPS.length;
    loadingStepEl.textContent = LOADING_STEPS[i];
  }, 1400);
}
function stopLoadingSteps() {
  if (loadingTimer) clearInterval(loadingTimer);
  loadingTimer = null;
}

// ----------------------------------------------------------------------------
// Fallback sample plans
// ----------------------------------------------------------------------------

function loadSamplePlans() {
  if (!samplePlansPromise) {
    samplePlansPromise = fetch("data/sample-plans.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("samples unavailable"))))
      .then((data) => data.plans || [])
      .catch(() => []);
  }
  return samplePlansPromise;
}

/** Pick the saved example that best matches the requested goal. */
async function getFallbackPlan(inputs) {
  const plans = await loadSamplePlans();
  if (!plans.length) return null;
  const match = plans.find((p) => (p.match?.goal || "").toLowerCase() === (inputs.goal || "").toLowerCase());
  return (match || plans[0]).plan;
}

// ----------------------------------------------------------------------------
// Generation
// ----------------------------------------------------------------------------

let lastInputs = null;

async function generate(inputsOverride) {
  const inputs = inputsOverride || lastInputs;
  if (!inputs) {
    window.dispatchEvent(new CustomEvent("spotter:onboarding"));
    return;
  }

  lastInputs = inputs;

  revealGenerator({ scroll: true });
  showState("loading");
  startLoadingSteps();

  let plan = null;
  let usedFallback = false;
  let fallbackFailureClass = "unknown";

  try {
    const res = await fetchWithTimeout("api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(inputs),
    }, 65_000);

    if (res.ok) {
      let data;
      try {
        data = await res.json();
      } catch {
        const error = new Error("The generator returned invalid JSON.");
        error.failureClass = "invalid_response";
        throw error;
      }
      plan = assertPlanShape(data?.plan);
    } else {
      const error = new Error("Plan request failed");
      error.status = res.status;
      throw error;
    }
  } catch (err) {
    fallbackFailureClass = classifyAiFailure(err, { online: navigator.onLine });
    // Network error / offline / running as static file → try the fallback.
    if (!plan) {
      plan = await getFallbackPlan(inputs);
      usedFallback = true;
    }
    if (!plan) {
      stopLoadingSteps();
      errorText.textContent = aiFailureMessage("plan", fallbackFailureClass, { fallback: false });
      showState("error");
      trackFunnel("plan_generation_failed", { failure_class: fallbackFailureClass });
      return;
    }
  }

  stopLoadingSteps();
  publishPlan(plan, inputs);
  renderResults(plan, inputs, usedFallback, { failureClass: fallbackFailureClass });
  // Only a real generated plan counts as success. The fallback is a failure the
  // user can still train on, and `plan_fallback_shown` already records it —
  // firing "succeeded" there gave us an event whose name said success and whose
  // `true` case meant failure, one careless read away from inverting the funnel.
  //
  // `fallback_used` stays, pinned to "false", purely so the existing
  // /funnel/plan_generation_succeeded/false series keeps accumulating in the
  // Vercel dashboard instead of splitting into a new path. It no longer varies.
  if (usedFallback) {
    trackFunnel("plan_fallback_shown", { failure_class: fallbackFailureClass });
  } else {
    trackFunnel("plan_generation_succeeded", { fallback_used: "false" });
    window.dispatchEvent(new CustomEvent("spotter:plan-generated"));
  }
}

// ----------------------------------------------------------------------------
// Rendering: results
// ----------------------------------------------------------------------------

const safetyBoundary = document.getElementById("safety-boundary");
const safetyBoundaryText = document.getElementById("safety-boundary-text");

function renderResults(plan, inputs, usedFallback, { focus = true, failureClass = "unknown", note = "" } = {}) {
  revealGenerator();
  fallbackNotice.hidden = !usedFallback;
  if (usedFallback) {
    fallbackNotice.dataset.failureClass = failureClass;
    fallbackMessage.textContent = `${aiFailureMessage("plan", failureClass, { fallback: true })} Showing a saved example; its safety audit still runs in full.`;
  }

  // Surface a hard safety boundary prominently (never bury it under a plan).
  if (safetyBoundary) {
    const blocked = screenRequest(inputs?.injuryNotes || "").level === "block";
    safetyBoundary.hidden = !blocked;
    if (blocked && safetyBoundaryText) safetyBoundaryText.textContent = GENERATOR_BOUNDARY;
  }

  // Run the pure-code audit, then render it flags-first.
  const audit = evaluatePlan(plan, inputs);

  // Snapshot this audit into the per-profile history (real user plans only, not
  // the saved fallback example). Deduped, so re-renders don't pile up.
  if (!usedFallback) {
    const injuries = (inputs?.injuries || []).filter((v) => v && v !== "none");
    const hasInjuries = injuries.length > 0 || !!(inputs?.injuryNotes || "").trim();
    recordAudit(buildAuditEntry(plan, audit, { hasInjuries, note }));
  }

  renderAudit(audit);
  renderRepair(plan, inputs, audit);
  renderTrustReport(plan, inputs, audit);
  renderPlan(plan);

  // Reveal the "adapt from your training" control; clear any stale change log.
  if (adaptCard) {
    adaptCard.hidden = false;
    if (adaptChanges) adaptChanges.hidden = true;
    updateAdaptHint();
  }

  showState("results");

  if (focus) {
    // Move focus to the results for keyboard + screen-reader users.
    states.results.setAttribute("tabindex", "-1");
    states.results.focus({ preventScroll: true });
    states.results.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
  }
}

// ----------------------------------------------------------------------------
// Audit — flags first. The numeric score is demoted to an optional footnote.
// ----------------------------------------------------------------------------

/** Plain-English verdict, led by severity (never "safe"). */
function auditVerdictText(summary) {
  const { critical, warning, suggestion } = summary;
  const unassessed = summary.not_assessed || 0;
  // v1.3.0: never report a clean verdict without saying how much we could not
  // judge. "No issues flagged" on a plan where four checks never ran is the same
  // false reassurance the not-assessed tier exists to remove.
  const caveat = unassessed > 0 ? `, ${unassessed} not assessed` : "";
  if (critical > 0) return { tone: "critical", text: `${critical} critical issue${critical > 1 ? "s" : ""} to resolve before training${caveat}` };
  if (warning > 0) return { tone: "warning", text: `${warning} issue${warning > 1 ? "s" : ""} to review before training${caveat}` };
  if (suggestion > 0) return { tone: "suggestion", text: `No safety flags: ${suggestion} optional suggestion${suggestion > 1 ? "s" : ""}${caveat}` };
  if (unassessed > 0) return { tone: "suggestion", text: `Nothing flagged, but ${unassessed} check${unassessed > 1 ? "s" : ""} could not be assessed` };
  return { tone: "ok", text: "No issues flagged by the audit" };
}

function renderAudit(audit) {
  const s = audit.summary;
  const verdict = auditVerdictText(s);

  auditVerdict.textContent = verdict.text;
  auditVerdict.className = `audit__verdict is-${verdict.tone}`;

  // Count chips: critical / warnings / suggestions / passed.
  auditCounts.innerHTML = [
    { cls: "is-crit", n: s.critical, label: "critical" },
    { cls: "is-warn", n: s.warning, label: "warnings" },
    { cls: "is-sugg", n: s.suggestion, label: "suggestions" },
    { cls: "is-ok", n: `${s.passed}/${s.total}`, label: "passed" },
  ]
    .concat(s.not_assessed > 0 ? [{ cls: "is-unknown", n: s.not_assessed, label: "not assessed" }] : [])
    .map((c) => `<li class="${c.cls}"><strong>${esc(c.n)}</strong> ${c.label}</li>`)
    .join("");

  // Flag cards (critical → warning → suggestion). Passed checks go in the
  // collapsed disclosure below, so the page leads with what needs attention.
  //
  // `not_assessed` is excluded from BOTH lists (v1.3.0). It is not a problem with
  // the plan, so it must not appear as a flag; and it is not a clean result, so
  // it must not appear as a pass. It gets its own quiet section instead.
  const flagged = audit.checks
    .filter((c) => c.tier !== "pass" && c.tier !== "not_assessed")
    .sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier]);

  checksList.innerHTML = flagged.length
    ? flagged.map(renderFlagCard).join("")
    : `<p class="audit__clear">Every automated check passed. Still your call: the evaluator catches common mistakes, not everything.</p>`;

  // Passed checks (collapsed).
  const passed = audit.checks.filter((c) => c.tier === "pass");
  countPass.textContent = passed.length;
  auditPassed.hidden = passed.length === 0;
  auditPassedList.innerHTML = passed
    .map((c) => `<li><span class="audit__passed-label">${esc(c.label)}</span><span class="audit__passed-detail">${esc(c.detail)}</span></li>`)
    .join("");

  // Not-assessed checks: things we could not judge because we never asked.
  // Rendered as an honest gap the user can close, never as a verdict.
  const notAssessed = audit.checks.filter((c) => c.tier === "not_assessed");
  if (auditNotAssessed && auditNotAssessedList) {
    auditNotAssessed.hidden = notAssessed.length === 0;
    if (countNotAssessed) countNotAssessed.textContent = notAssessed.length;
    auditNotAssessedList.innerHTML = notAssessed
      .map((c) => `<li><span class="audit__passed-label">${esc(c.label)}</span><span class="audit__passed-detail">${esc(c.detail)}</span></li>`)
      .join("");
  }

  // Demoted quality score (no big gauge).
  if (prefersReducedMotion) scoreValueEl.textContent = String(audit.score);
  else animateCount(scoreValueEl, audit.score, 900);
  auditScore.className = `audit__score is-${verdict.tone}`;
}

/** One flag card: what / why it matters / suggested fix / safer alternatives. */
function renderFlagCard(c, i) {
  const alts = Array.isArray(c.alternatives) && c.alternatives.length
    ? `<p class="flag__row"><span class="flag__row-label">Safer alternatives</span> ${esc(c.alternatives.join(" · "))}</p>`
    : "";
  const fix = c.fix ? `<p class="flag__row"><span class="flag__row-label">Suggested fix</span> ${esc(c.fix)}</p>` : "";
  const rule = ruleForCheck(c.id);
  const why = rule
    ? `<details class="flag__rule"><summary>Why this rule exists</summary><p class="flag__rule-body">${esc(rule.why)} <span class="flag__rule-lim">Limitation: ${esc(rule.limitations)}</span></p></details>`
    : "";
  return `
    <article class="flag flag--${c.tier}" style="--i:${i}">
      <header class="flag__head">
        <span class="flag__sev">${TIER_LABEL[c.tier] || c.tier}</span>
        <span class="flag__label">${esc(c.label)}</span>
      </header>
      <p class="flag__why">${esc(c.detail)}</p>
      ${fix}
      ${alts}
      ${why}
    </article>`;
}

function animateCount(el, target, duration) {
  const start = performance.now();
  function tick(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
    el.textContent = String(Math.round(eased * target));
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ----------------------------------------------------------------------------
// Trust Report — a transparent "who made this / what was checked / how confident"
// summary attached to every generated plan.
// ----------------------------------------------------------------------------

/** Short relative time for the audit-history list ("just now", "3d ago", date). */
function relTime(ts) {
  const diff = Date.now() - Number(ts || 0);
  if (!Number.isFinite(diff) || diff < 0) return "";
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(Number(ts)).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** The "watch the plan improve over versions" block, shown once there are 2+ audits. */
function trustHistoryBlock() {
  const history = getAuditHistory();
  if (history.length < 2) return "";
  const trend = auditTrend(history);
  const up = trend.delta >= 0;
  const chart = lineChart(
    history.map((h) => ({ label: h.version, value: h.score })),
    { height: 96 }
  );
  const rows = [...history]
    .reverse()
    .map(
      (h) => `<li class="trust__ver">
        <span class="trust__ver-tag">${esc(h.version)}</span>
        <span class="trust__ver-score">${h.score}</span>
        <span class="trust__conf trust__conf--${h.level.toLowerCase()}">${h.level}</span>
        <span class="trust__ver-when muted">${relTime(h.at)}</span>
        ${h.note ? `<span class="trust__ver-note muted">${esc(h.note)}</span>` : ""}
      </li>`
    )
    .join("");
  return `<div class="trust__block trust__history">
      <h5>Audit history
        <span class="trust__trend trust__trend--${up ? "up" : "down"}">${up ? "▲" : "▼"} ${up ? "+" : ""}${trend.delta} over ${trend.points} versions</span>
      </h5>
      <div class="trust__spark">${chart}</div>
      <ol class="trust__vers">${rows}</ol>
    </div>`;
}

function renderTrustReport(plan, inputs, audit) {
  if (!trustReportEl) return;
  const s = audit.summary;
  const injuries = (inputs?.injuries || []).filter((v) => v && v !== "none");
  const hasInjuries = injuries.length > 0 || !!(inputs?.injuryNotes || "").trim();
  const conf = planConfidence(s, { hasInjuries });

  const limitations = [
    injuries.length ? `Injuries: ${injuries.join(", ")}` : null,
    (inputs?.injuryNotes || "").trim() ? `Notes: ${inputs.injuryNotes.trim()}` : null,
    inputs?.experience ? `Experience: ${inputs.experience}` : null,
    inputs?.equipment?.length ? `Equipment: ${inputs.equipment.join(", ")}` : null,
    inputs?.daysPerWeek ? `Schedule: ${inputs.daysPerWeek} days/week` : null,
  ].filter(Boolean);

  const concerns = audit.checks.filter((c) => c.tier === "critical" || c.tier === "warning").map((c) => c.label);
  const edits = audit.checks.filter((c) => c.fix).map((c) => c.fix);

  const row = (dt, dd) => `<div class="trust__row"><dt>${dt}</dt><dd>${dd}</dd></div>`;
  const list = (arr, empty) => (arr.length ? `<ul class="trust__list">${arr.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<span class="muted">${empty}</span>`);

  trustReportEl.innerHTML = `
    <details class="card trust">
      <summary class="trust__summary">
        <span class="trust__title">Trust Report</span>
        <span class="trust__conf trust__conf--${conf.level.toLowerCase()}">Confidence: ${conf.level}</span>
      </summary>
      <div class="trust__body">
        <dl class="trust__grid">
          ${row("Plan version", `${esc(plan.version || "v1")}`)}
          ${row("Generated by", "AI workout generator")}
          ${row("Audited by", "SpotterAI deterministic evaluator")}
          ${row("Evaluator version", esc(EVALUATOR_VERSION))}
          ${row("Checks run", `${s.total}`)}
          ${row("Checks passed", `${s.passed}/${s.total}`)}
          ${row("Confidence", `${conf.level}: ${esc(conf.why)}`)}
        </dl>
        ${trustHistoryBlock()}
        <div class="trust__block"><h5>User limitations considered</h5>${list(limitations, "No limitations were provided.")}</div>
        <div class="trust__block"><h5>Main concerns</h5>${list(concerns, "No critical issues or warnings.")}</div>
        <div class="trust__block"><h5>Recommended edits</h5>${list(edits, "No edits recommended.")}</div>
        <p class="trust__disclaimer">SpotterAI can catch common programming issues, but it cannot guarantee safety or replace a qualified coach, clinician, or medical professional.</p>
      </div>
    </details>`;
}

// ----------------------------------------------------------------------------
// Plan repair — deterministic before/after, with apply / keep-original.
// ----------------------------------------------------------------------------

let pendingRepair = null;

function renderRepair(plan, inputs, audit) {
  if (!repairMount) return;
  const flags = audit.summary.critical + audit.summary.warning;
  pendingRepair = null;

  if (flags === 0) {
    repairMount.innerHTML = "";
    return;
  }

  const repair = repairPlan(plan, inputs);
  if (!repair.changes.length) {
    repairMount.innerHTML = "";
    return;
  }
  pendingRepair = { repair, inputs };

  const b = repair.before.summary;
  const a = repair.after.summary;
  const bFlags = b.critical + b.warning;
  const aFlags = a.critical + a.warning;
  const noun = (n) => `${n} issue${n === 1 ? "" : "s"}`;

  repairMount.innerHTML = `
    <div class="card repair">
      <div class="repair__head">
        <p class="repair__eyebrow"><span class="eyebrow__dot" aria-hidden="true"></span> Plan repair · deterministic</p>
        <h3 class="repair__title">A safer version is available</h3>
        <p class="repair__sub">SpotterAI turned each flag into a concrete edit (preserving your goal and days), then re-audited the result.</p>
      </div>
      <div class="repair__compare">
        <div class="repair__col">
          <span class="repair__col-label">Original</span>
          <span class="repair__col-flags is-warn">${noun(bFlags)}</span>
          <span class="repair__col-score">quality ${repair.before.score}</span>
        </div>
        <span class="repair__arrow" aria-hidden="true">→</span>
        <div class="repair__col repair__col--after">
          <span class="repair__col-label">Repaired · ${esc(repair.plan.version || "v2")}</span>
          <span class="repair__col-flags ${aFlags ? "is-warn" : "is-ok"}">${noun(aFlags)}</span>
          <span class="repair__col-score">quality ${repair.after.score}</span>
        </div>
      </div>
      <ul class="repair__changes">
        ${repair.changes
          .map(
            (c) => `<li>
              <span class="repair__issue">${esc(c.issue)}</span>
              <span class="repair__fix">${esc(c.fix)}</span>
              ${c.why ? `<span class="repair__why"><span class="repair__k">Why this helps</span> ${esc(c.why)}</span>` : ""}
              ${c.tradeoff ? `<span class="repair__tradeoff"><span class="repair__k">Tradeoff</span> ${esc(c.tradeoff)}</span>` : ""}
            </li>`
          )
          .join("")}
      </ul>
      <div class="repair__actions">
        <button type="button" class="btn btn--primary btn--sm" data-repair="apply">Apply safer version</button>
        <button type="button" class="btn btn--ghost btn--sm" data-repair="keep">Keep original</button>
      </div>
      <p class="repair__caution" hidden>Keeping the original plan. The flags above still apply. Review them before training, especially anything marked critical, and consider a qualified coach for injuries or pain.</p>
    </div>`;
}

repairMount?.addEventListener("click", (e) => {
  if (e.target.closest('[data-repair="apply"]') && pendingRepair) {
    const { repair, inputs } = pendingRepair;
    publishPlan(repair.plan, inputs);
    renderResults(repair.plan, inputs, false);
  } else if (e.target.closest('[data-repair="keep"]')) {
    const caution = repairMount.querySelector(".repair__caution");
    if (caution) caution.hidden = false;
    repairMount.querySelectorAll(".repair__actions button").forEach((b) => (b.disabled = true));
  }
});

function renderPlan(plan) {
  const dayCards = (plan.days || [])
    .map(
      (day, idx) => `
      <article class="day-card" style="--i:${idx}">
        <header class="day-card__head">
          <span class="day-card__day">${esc(day.day)}</span>
          <h4 class="day-card__focus">${esc(day.focus)}</h4>
        </header>
        <div class="day-card__table-wrap">
          <table class="ex-table ex-table--editable">
            <thead>
              <tr>
                <th scope="col">Exercise</th>
                <th scope="col" class="num">Sets</th>
                <th scope="col" class="num">Reps</th>
                <th scope="col" class="num">RPE</th>
                <th scope="col" class="num"><span class="sr-only">Edit</span></th>
              </tr>
            </thead>
            <tbody>
              ${(day.exercises || [])
                .map(
                  (ex) => `
                <tr>
                  <td>
                    <span class="ex-name">${esc(ex.name)}</span>
                    ${ex.notes ? `<span class="ex-note">${esc(ex.notes)}</span>` : ""}
                  </td>
                  <td class="num">${esc(ex.sets)}</td>
                  <td class="num">${esc(ex.reps)}</td>
                  <td class="num">${ex.rpe == null || ex.rpe === "" ? "-" : esc(ex.rpe)}</td>
                  <td class="ex-row-acts">
                    <button type="button" class="ex-act" data-act="ex-swap" data-day="${idx}" data-name="${esc(ex.name)}" title="Substitute" aria-label="Substitute ${esc(ex.name)}">⇄</button>
                    <button type="button" class="ex-act ex-act--del" data-act="ex-remove" data-day="${idx}" data-name="${esc(ex.name)}" title="Remove" aria-label="Remove ${esc(ex.name)}">×</button>
                  </td>
                </tr>`
                )
                .join("")}
            </tbody>
          </table>
        </div>
        <div class="day-edit" data-day-edit="${idx}"></div>
        <button type="button" class="day-add" data-act="day-add" data-day="${idx}">+ Add exercise</button>
      </article>`
    )
    .join("");

  const notes = `
    <div class="plan-notes">
      ${plan.progression ? `<div class="plan-note"><h5>Progression</h5><p>${esc(plan.progression)}</p></div>` : ""}
      ${plan.general_notes ? `<div class="plan-note"><h5>General notes</h5><p>${esc(plan.general_notes)}</p></div>` : ""}
    </div>`;

  planOutput.innerHTML = `
    <header class="plan__head">
      <div>
        <p class="plan__eyebrow">Your program</p>
        <h3 class="plan__title">${esc(plan.program_name)}</h3>
      </div>
      <dl class="plan__facts">
        <div><dt>Goal</dt><dd>${esc(plan.goal)}</dd></div>
        <div><dt>Days / week</dt><dd>${esc(plan.days_per_week)}</dd></div>
      </dl>
    </header>
    <div class="day-grid">${dayCards}</div>
    ${notes}`;
}

// ----------------------------------------------------------------------------
// Adaptive coach loop: re-tune the plan from logged training, then re-audit.
// ----------------------------------------------------------------------------

// When app.js itself sets the plan (generate/adapt), it re-renders directly —
// so the spotter:plan listener (which handles EXTERNAL changes like a profile
// switch) must not also render. This flag suppresses that during self-updates.
let suppressPlanRender = false;

/** Persist + broadcast the plan without triggering our own re-render. */
function publishPlan(plan, inputs) {
  suppressPlanRender = true;
  setPlan(plan, inputs);
  suppressPlanRender = false;
}

/** Enable/disable the adapt button based on whether there's logged training. */
function updateAdaptHint() {
  if (!adaptBtn) return;
  const hasData = !!getTrackerContext();
  adaptBtn.disabled = !hasData;
  if (adaptHint) {
    adaptHint.hidden = hasData;
    adaptHint.classList.remove("adapt-hint--error");
    if (!hasData) adaptHint.textContent = "Log a workout or two on the Dashboard first, then I'll tailor this plan to what you've actually been doing.";
  }
}

function showAdaptError(msg) {
  if (!adaptHint) return;
  adaptHint.hidden = false;
  adaptHint.classList.add("adapt-hint--error");
  adaptHint.textContent = msg;
}

function renderAdaptChanges(summary, changes) {
  if (!adaptChanges) return;
  const items = (changes || []).map((c) => `<li>${esc(c)}</li>`).join("");
  adaptChanges.innerHTML = `
    <div class="adapt-changes__head">
      <span class="adapt-changes__badge">Adapted from your training</span>
      ${summary ? `<p class="adapt-changes__summary">${esc(summary)}</p>` : ""}
    </div>
    ${items ? `<p class="adapt-changes__label">What changed &amp; why</p><ul class="adapt-changes__list">${items}</ul>` : ""}`;
  adaptChanges.hidden = false;
}

function adapt() {
  if (!store.plan) return;
  const context = buildAdaptContext(store.plan);
  if (!context) {
    updateAdaptHint();
    return;
  }

  adaptBtn.disabled = true;
  adaptBtn.classList.add("is-loading");
  const label = adaptBtn.textContent;
  adaptBtn.textContent = "Adapting from your training…";
  if (adaptHint) adaptHint.hidden = true;

  try {
    // Fully offline + deterministic: same evaluator re-audits every change.
    const { plan, changes, summary, adapted } = adaptPlan(store.plan, context, store.inputs);
    if (!adapted) {
      showAdaptError("Your plan already matches your recent training, nothing to change yet. Keep logging and try again in a week.");
      return;
    }
    // Replace the current plan (persist + let chat/workout see it), re-audit,
    // re-render, then surface what changed and why.
    publishPlan(plan, store.inputs);
    renderResults(plan, store.inputs, false, { note: summary });
    renderAdaptChanges(summary, changes);
  } catch {
    showAdaptError("Couldn't adapt the plan just now. Please try again.");
  } finally {
    adaptBtn.classList.remove("is-loading");
    adaptBtn.textContent = label;
    adaptBtn.disabled = false;
  }
}

// ----------------------------------------------------------------------------
// Events
// ----------------------------------------------------------------------------

// Guided onboarding finishes with a mapped input set and asks us to generate.
window.addEventListener("spotter:generate", (e) => {
  if (e.detail) generate(e.detail);
});

// First-week "Adapt next week" CTA — run the adaptive loop once results are up.
window.addEventListener("spotter:adapt-request", () => {
  setTimeout(() => { if (store.plan && adaptBtn && !adaptBtn.disabled) adapt(); }, 350);
});

retryBtn.addEventListener("click", () => generate());
fallbackRetryBtn?.addEventListener("click", () => generate());

regenerateBtn.addEventListener("click", () => {
  if (adaptCard) adaptCard.hidden = true;
  showState("empty");
  hideGenerator();
  window.dispatchEvent(new CustomEvent("spotter:onboarding"));
});

adaptBtn?.addEventListener("click", adapt);

startFirstWorkoutBtn?.addEventListener("click", () => {
  window.dispatchEvent(new CustomEvent("spotter:start-plan-day", { detail: { index: 0, source: "plan" } }));
});

// External plan changes (e.g. switching profile) — render that plan, or the
// empty state if the new profile has none. Self-updates are suppressed above.
window.addEventListener("spotter:plan", (e) => {
  if (suppressPlanRender) return;
  const plan = e.detail?.plan;
  if (plan) {
    renderResults(plan, e.detail.inputs, false, { focus: false });
  } else {
    if (adaptCard) adaptCard.hidden = true;
    showState("empty");
    hideGenerator();
  }
});

// Logging a workout enables the adapt button live (if results are on screen).
window.addEventListener("spotter:tracker", () => {
  if (adaptCard && !adaptCard.hidden) updateAdaptHint();
});

// ----------------------------------------------------------------------------
// Plan editor: substitute / remove / add exercises on the plan page. Every edit
// goes through the shared plan-edit primitives, then setPlan → full re-audit.
// ----------------------------------------------------------------------------
function planLimitations() { return store.inputs?.injuries || []; }
function planEquipment() {
  const eq = store.inputs?.equipment || [];
  return eq.some((x) => /gym/i.test(x)) ? [] : eq; // a full gym → don't filter
}
function commitPlan(result) {
  if (result && result.changed) setPlan(result.plan, store.inputs); // → re-audit + re-render
}
function dayEditBox(day) {
  return planOutput.querySelector(`[data-day-edit="${day}"]`);
}
function altPool(name) {
  const a = suggestAlternatives(name, { limitations: planLimitations(), equipment: planEquipment() });
  return [...new Set([...(a.safer || []), ...(a.recommended || []), ...(a.easier || []), ...(a.harder || [])])].slice(0, 8);
}
function renderSwapPanel(day, name) {
  const box = dayEditBox(day);
  if (!box) return;
  const chips = altPool(name);
  box.innerHTML = `
    <div class="ex-edit-panel">
      <p class="ex-edit-title">Substitute <strong>${esc(name)}</strong></p>
      ${chips.length ? `<div class="ex-edit-chips">${chips.map((n) => `<button type="button" class="ex-edit-chip" data-act="ex-swap-to" data-day="${day}" data-from="${esc(name)}" data-to="${esc(n)}">${esc(n)}</button>`).join("")}</div>` : `<p class="ex-edit-muted">No structured alternatives. Search any exercise below.</p>`}
      <input type="search" class="input ex-edit-search" data-edit-search="swap" data-day="${day}" data-from="${esc(name)}" placeholder="…or search any exercise" aria-label="Search a replacement exercise" />
      <div class="ex-edit-results" data-edit-results></div>
      <button type="button" class="btn-link ex-edit-cancel" data-act="ex-edit-cancel" data-day="${day}">Cancel</button>
    </div>`;
  box.querySelector(".ex-edit-search")?.focus();
}
function renderAddPanel(day) {
  const box = dayEditBox(day);
  if (!box) return;
  box.innerHTML = `
    <div class="ex-edit-panel">
      <p class="ex-edit-title">Add an exercise</p>
      <input type="search" class="input ex-edit-search" data-edit-search="add" data-day="${day}" placeholder="Search exercises…" aria-label="Search an exercise to add" />
      <div class="ex-edit-results" data-edit-results></div>
      <button type="button" class="btn-link ex-edit-cancel" data-act="ex-edit-cancel" data-day="${day}">Cancel</button>
    </div>`;
  box.querySelector(".ex-edit-search")?.focus();
}
function renderEditResults(inp) {
  const panel = inp.closest(".ex-edit-panel");
  const box = panel?.querySelector("[data-edit-results]");
  if (!box) return;
  const mode = inp.dataset.editSearch;
  const day = inp.dataset.day;
  const from = inp.dataset.from || "";
  const q = inp.value.trim();
  const act = mode === "swap" ? "ex-swap-to" : "ex-add";
  const data = (name) => (mode === "swap" ? `data-from="${esc(from)}" data-to="${esc(name)}"` : `data-name="${esc(name)}"`);
  const results = q.length >= 2 ? searchExercises(q, 8).map((e) => e.name) : [];
  let html = results.map((n) => `<button type="button" class="ex-edit-result" data-act="${act}" data-day="${day}" ${data(n)}>${esc(n)}</button>`).join("");
  if (q.length >= 2 && !results.some((n) => n.toLowerCase() === q.toLowerCase())) {
    html += `<button type="button" class="ex-edit-result ex-edit-result--custom" data-act="${act}" data-day="${day}" ${data(q)}>Use “${esc(q)}”</button>`;
  }
  box.innerHTML = html;
}

planOutput.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const act = btn.dataset.act;
  const day = btn.dataset.day != null ? Number(btn.dataset.day) : null;
  if (act === "ex-remove") commitPlan(removeExercise(store.plan, { name: btn.dataset.name, day }));
  else if (act === "ex-swap") renderSwapPanel(day, btn.dataset.name);
  else if (act === "day-add") renderAddPanel(day);
  else if (act === "ex-swap-to") commitPlan(swapExercise(store.plan, { from: btn.dataset.from, to: btn.dataset.to, day }));
  else if (act === "ex-add") commitPlan(addExercise(store.plan, { name: btn.dataset.name, day }));
  else if (act === "ex-edit-cancel") { const b = dayEditBox(day); if (b) b.innerHTML = ""; }
});
planOutput.addEventListener("input", (e) => {
  const inp = e.target.closest("[data-edit-search]");
  if (inp) renderEditResults(inp);
});

// Restore a saved plan for this profile (survives refresh) without yanking
// scroll/focus, so the adaptive loop works across sessions.
if (store.plan) renderResults(store.plan, store.inputs, false, { focus: false });
