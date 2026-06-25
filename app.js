/**
 * SpotterAI — front-end controller
 * ============================================================================
 * Wires the form to the serverless generator and the client-side evaluator,
 * then renders the plan, the animated safety score, and the list of checks.
 *
 * Flow:
 *   submit → collect inputs → POST /api/generate
 *          → on success: render plan
 *          → on failure / 429 / offline: fall back to a saved sample plan
 *          → either way: run evaluator.js and render the audit
 *
 * No build step: this is a native ES module that imports the evaluator.
 */

import { evaluatePlan } from "./evaluator.js";

// ----------------------------------------------------------------------------
// Element references
// ----------------------------------------------------------------------------
const form = document.getElementById("plan-form");
const generateBtn = document.getElementById("generate-btn");
const retryBtn = document.getElementById("retry-btn");
const regenerateBtn = document.getElementById("regenerate-btn");

const states = {
  empty: document.getElementById("state-empty"),
  loading: document.getElementById("state-loading"),
  error: document.getElementById("state-error"),
  results: document.getElementById("state-results"),
};

const loadingStepEl = document.getElementById("loading-step");
const errorText = document.getElementById("error-text");
const fallbackNotice = document.getElementById("fallback-notice");

const gaugeProgress = document.getElementById("gauge-progress");
const scoreValueEl = document.getElementById("score-value");
const scoreBandEl = document.getElementById("score-band");
const countPass = document.getElementById("count-pass");
const countWarn = document.getElementById("count-warn");
const countFail = document.getElementById("count-fail");
const checksList = document.getElementById("checks-list");
const planOutput = document.getElementById("plan-output");

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

/** Inline status icons for the check rows. */
const STATUS_ICON = {
  pass: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M20 6L9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  warn: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4m0 4h.01" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  fail: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM15 9l-6 6m0-6l6 6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

const STATUS_LABEL = { pass: "Pass", warn: "Review", fail: "Flagged" };

// ----------------------------------------------------------------------------
// Reading the form
// ----------------------------------------------------------------------------

function getFormData() {
  const fd = new FormData(form);
  const equipment = fd.getAll("equipment").map(String);

  // Injuries: collect checked values, but ignore the sentinel "none".
  const injuries = fd.getAll("injuries").map(String).filter((v) => v !== "none");

  return {
    goal: fd.get("goal") || "General",
    experience: fd.get("experience") || "Beginner",
    daysPerWeek: Number(fd.get("daysPerWeek")) || 4,
    sessionLength: Number(fd.get("sessionLength")) || 60,
    equipment: equipment.length ? equipment : ["bodyweight"],
    injuries,
    injuryNotes: (fd.get("injuryNotes") || "").toString().trim(),
  };
}

// ----------------------------------------------------------------------------
// Injury chips: "None" is mutually exclusive with the specific-injury chips.
// ----------------------------------------------------------------------------

function wireInjuryExclusivity() {
  const boxes = [...form.querySelectorAll('input[name="injuries"]')];
  const none = boxes.find((b) => b.value === "none");
  const others = boxes.filter((b) => b.value !== "none");

  none?.addEventListener("change", () => {
    if (none.checked) others.forEach((b) => (b.checked = false));
  });
  others.forEach((b) =>
    b.addEventListener("change", () => {
      if (b.checked && none) none.checked = false;
      // If nothing specific is checked, re-check "None" for a tidy default.
      if (none && !others.some((o) => o.checked)) none.checked = true;
    })
  );
}

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

async function generate() {
  const inputs = getFormData();
  lastInputs = inputs;

  generateBtn.disabled = true;
  showState("loading");
  startLoadingSteps();

  let plan = null;
  let usedFallback = false;

  try {
    const res = await fetch("api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(inputs),
    });

    if (res.ok) {
      const data = await res.json();
      plan = data.plan;
    } else {
      // 429 (rate limit) or any server error → graceful saved-example fallback.
      plan = await getFallbackPlan(inputs);
      usedFallback = true;
      if (!plan) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Request failed (${res.status}).`);
      }
    }
  } catch (err) {
    // Network error / offline / running as static file → try the fallback.
    if (!plan) {
      plan = await getFallbackPlan(inputs);
      usedFallback = true;
    }
    if (!plan) {
      stopLoadingSteps();
      generateBtn.disabled = false;
      errorText.textContent =
        "We couldn't reach the generator and no saved example was available. Check your connection and try again.";
      showState("error");
      return;
    }
  }

  stopLoadingSteps();
  generateBtn.disabled = false;
  renderResults(plan, inputs, usedFallback);
}

// ----------------------------------------------------------------------------
// Rendering: results
// ----------------------------------------------------------------------------

function renderResults(plan, inputs, usedFallback) {
  fallbackNotice.hidden = !usedFallback;

  // Run the pure-code audit.
  const audit = evaluatePlan(plan, inputs);

  renderChecks(audit.checks);
  renderPlan(plan);
  showState("results");

  // Animate the gauge once the panel is visible.
  renderScore(audit.score);

  // Move focus to the results for keyboard + screen-reader users.
  states.results.setAttribute("tabindex", "-1");
  states.results.focus({ preventScroll: true });
  states.results.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
}

/** Map a score to a band: color class + plain-language label (never "safe"). */
function scoreBand(score) {
  if (score >= 85) return { cls: "is-excellent", label: "Few concerns flagged" };
  if (score >= 70) return { cls: "is-good", label: "Some concerns to review" };
  if (score >= 50) return { cls: "is-caution", label: "Several concerns" };
  return { cls: "is-danger", label: "Multiple serious flags" };
}

function renderScore(score) {
  const band = scoreBand(score);

  // Color the gauge + band by removing prior band classes and adding the new one.
  const bandClasses = ["is-excellent", "is-good", "is-caution", "is-danger"];
  gaugeProgress.classList.remove(...bandClasses);
  scoreBandEl.classList.remove(...bandClasses);
  gaugeProgress.classList.add(band.cls);
  scoreBandEl.classList.add(band.cls);
  scoreBandEl.textContent = band.label;

  // Ring geometry: r = 84 → circumference.
  const r = 84;
  const circumference = 2 * Math.PI * r;
  gaugeProgress.style.strokeDasharray = `${circumference}`;

  if (prefersReducedMotion) {
    gaugeProgress.style.strokeDashoffset = `${circumference * (1 - score / 100)}`;
    scoreValueEl.textContent = String(score);
    return;
  }

  // Start empty, then animate the ring fill on the next frame (CSS transition).
  gaugeProgress.style.strokeDashoffset = `${circumference}`;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      gaugeProgress.style.strokeDashoffset = `${circumference * (1 - score / 100)}`;
    });
  });

  // Count the number up to the score.
  animateCount(scoreValueEl, score, 1100);
}

function animateCount(el, target, duration) {
  const start = performance.now();
  function tick(now) {
    const t = Math.min(1, (now - start) / duration);
    // easeOutCubic for a lively-but-settling count.
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = String(Math.round(eased * target));
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function renderChecks(checks) {
  const counts = { pass: 0, warn: 0, fail: 0 };
  for (const c of checks) counts[c.status] = (counts[c.status] || 0) + 1;
  countPass.textContent = counts.pass;
  countWarn.textContent = counts.warn;
  countFail.textContent = counts.fail;

  // Sort so the most serious flags surface first.
  const order = { fail: 0, warn: 1, pass: 2 };
  const sorted = [...checks].sort((a, b) => order[a.status] - order[b.status]);

  checksList.innerHTML = sorted
    .map(
      (c, i) => `
      <li class="check check--${c.status}" style="--i:${i}">
        <span class="check__icon">${STATUS_ICON[c.status] || ""}</span>
        <div class="check__body">
          <div class="check__head">
            <span class="check__label">${esc(c.label)}</span>
            <span class="check__badge check__badge--${c.status}">${STATUS_LABEL[c.status]}</span>
          </div>
          <p class="check__detail">${esc(c.detail)}</p>
        </div>
      </li>`
    )
    .join("");
}

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
          <table class="ex-table">
            <thead>
              <tr>
                <th scope="col">Exercise</th>
                <th scope="col" class="num">Sets</th>
                <th scope="col" class="num">Reps</th>
                <th scope="col" class="num">RPE</th>
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
                  <td class="num">${ex.rpe == null || ex.rpe === "" ? "—" : esc(ex.rpe)}</td>
                </tr>`
                )
                .join("")}
            </tbody>
          </table>
        </div>
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
// Events
// ----------------------------------------------------------------------------

form.addEventListener("submit", (e) => {
  e.preventDefault();
  generate();
});

retryBtn.addEventListener("click", () => generate());

regenerateBtn.addEventListener("click", () => {
  showState("empty");
  form.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
});

wireInjuryExclusivity();
