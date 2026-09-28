/**
 * SpotterAI — guided onboarding UI
 * ============================================================================
 * A short, mobile-friendly intake (5 steps) that wraps the existing plan
 * generator. Saves progress locally (resume), allows skipping optional fields,
 * and on finish maps to generator inputs, seeds conservative nutrition targets,
 * and asks app.js to generate the plan. Never blocks on unnecessary fields.
 */

import {
  GOAL_OPTIONS,
  TRAINING_AGE_OPTIONS,
  EQUIPMENT_OPTIONS,
  AGE_RANGES,
  SESSION_LENGTHS,
  DAYS_OPTIONS,
  CARDIO_PREFS,
  LEG_DAY_PREFS,
  INTENSITY_PREFS,
  COACHING_STYLES,
  SAFETY_AREAS,
  ONBOARDING_STEPS,
  mapOnboardingToInputs,
} from "./onboarding.js";
import { bodyweightKg, clearMeasurementCorrection, measurementSystem, switchMeasurementSystem, validateMeasurements } from "./measurements.js";
import { saferTargets } from "./nutrition-safety.js";
import { setTargets, setUnit } from "./tracker-store.js";
import { trackFunnel } from "./analytics.js";

const $ = (id) => document.getElementById(id);
const overlay = $("onboarding");
const body = $("onb-body");
const progress = $("onb-progress");
const backBtn = $("onb-back");
const nextBtn = $("onb-next");
const skipBtn = $("onb-skip");
const closeBtn = $("onb-close");

const KEY = "spotterai_onboarding";
let step = 0;
let data = {};

// Pure, so the step markup renders without a DOM (test/field-labels.test.js
// renders every step). Quotes are escaped too, because most of what passes
// through here lands inside an attribute: a quote typed into "Exercises you
// like" used to end the value attribute early.
const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function esc(t) {
  return (t == null ? "" : String(t)).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify({ step, data })); } catch { /* private mode / quota: resume is a convenience, not a requirement */ }
}
function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    step = raw.step || 0;
    data = raw.data || {};
  } catch { step = 0; data = {}; }
}

// --- field helpers (chips bound to the answers `d`) -------------------------
function chips(d, field, options, multi = false) {
  const sel = d[field];
  return `<div class="onb-chips" data-field="${field}" data-multi="${multi ? 1 : 0}">${options
    .map((o) => {
      const value = typeof o === "object" ? o.value ?? o.label : o;
      const label = typeof o === "object" ? o.label : o;
      const active = multi ? Array.isArray(sel) && sel.includes(value) : sel === value;
      return `<button type="button" class="onb-chip${active ? " is-active" : ""}" data-value="${esc(value)}" aria-pressed="${active ? "true" : "false"}">${esc(label)}</button>`;
    })
    .join("")}</div>`;
}
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
// A question and the controls that answer it. The group, named by the question,
// is what a screen reader announces when focus lands on one of its chips; a
// bare span was never read out, so "Yes" arrived without the question it answers.
function field(label, inner, hint) {
  const id = `onb-q-${slug(label)}`;
  const hintHtml = hint ? `<span class="onb-fhint" id="${id}-hint">${esc(hint)}</span>` : "";
  return `<div class="onb-field" role="group" aria-labelledby="${id}"${hint ? ` aria-describedby="${id}-hint"` : ""}><span class="onb-flabel" id="${id}">${esc(label)}</span>${hintHtml}${inner}</div>`;
}
// A free-text answer gets a real <label>: it names the field, and tapping it
// focuses the input. The placeholder is only an example and vanishes on typing.
function textField(d, label, f, ph) {
  const id = `onb-input-${f}`;
  return `<div class="onb-field"><label class="onb-flabel" for="${id}">${esc(label)}</label>${input(d, f, ph, id)}</div>`;
}
const input = (d, f, ph, id) => `<input class="input onb-input" id="${id}" data-input="${f}" type="text" autocomplete="off" placeholder="${esc(ph)}" value="${esc(d[f] ?? "")}" inputmode="text" />`;
function measurementInput(d, f, label, ph, unit, inputmode = "decimal") {
  const error = validateMeasurements(d).errors[f] || "";
  const errorId = `onb-error-${f}`;
  return `<div class="onb-measurement-input"><input class="input onb-input" data-input="${f}" type="text" autocomplete="off" placeholder="${esc(ph)}" value="${esc(d[f] ?? "")}" aria-label="${esc(label)}" inputmode="${inputmode}" aria-invalid="${error ? "true" : "false"}" aria-describedby="${errorId}" /><span class="onb-unit" aria-hidden="true">${esc(unit)}</span></div><span class="onb-error" id="${errorId}" role="alert">${esc(error)}</span>`;
}

// --- steps -----------------------------------------------------------------
function stepGoal(d) {
  return `<h3 class="onb-title" id="onb-q-goal">What's your main goal?</h3>
    <p class="onb-sub">SpotterAI builds a conservative plan around this. You can change it later.</p>
    <div role="group" aria-labelledby="onb-q-goal">${chips(d, "goal", GOAL_OPTIONS)}</div>`;
}
function stepBody(d) {
  const imperial = measurementSystem(d) === "imperial";
  return `<h3 class="onb-title">A little about you</h3>
    <p class="onb-sub">Optional. Weight can help set a starting nutrition range; height is saved only while you complete setup.</p>
    ${field("Age range", chips(d, "ageRange", AGE_RANGES))}
    ${field("Units", chips(d, "units", [{ value: "kg", label: "Metric" }, { value: "lb", label: "Imperial" }]))}
    <div class="onb-cols">${imperial
      ? `${field("Height", `<div class="onb-height-pair">${measurementInput(d, "heightFt", "Height in feet", "e.g. 5", "ft", "numeric")}${measurementInput(d, "heightIn", "Height in inches", "e.g. 10", "in", "numeric")}</div>`)}`
      : field("Height", measurementInput(d, "height", "Height in centimetres", "e.g. 178", "cm"))
    }${field("Bodyweight", measurementInput(d, "weight", imperial ? "Bodyweight in pounds" : "Bodyweight in kilograms", imperial ? "e.g. 165" : "e.g. 75", imperial ? "lb" : "kg"))}</div>
    ${field("Sex (optional)", chips(d, "sex", ["Male", "Female", "Prefer not to say"]))}
    ${field("Training experience", chips(d, "trainingAge", TRAINING_AGE_OPTIONS))}`;
}
function stepSchedule(d) {
  return `<h3 class="onb-title">Your schedule</h3>
    <p class="onb-sub">Pick what's realistic. Consistency beats an ambitious plan you can't keep.</p>
    ${field("Days per week", chips(d, "days", DAYS_OPTIONS))}
    ${field("Session length (min)", chips(d, "sessionLength", SESSION_LENGTHS))}
    ${field("Training at", chips(d, "location", ["Gym", "Home"]))}
    ${field("Equipment", chips(d, "equipment", EQUIPMENT_OPTIONS, true), "Select all that apply")}`;
}
function stepSafety(d) {
  return `<h3 class="onb-title">Anything to keep safe?</h3>
    <p class="onb-sub">SpotterAI uses this to cap risky volume and offer safer swaps. It can't diagnose anything.</p>
    ${field("Any current pain or discomfort?", chips(d, "currentPain", [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]))}
    ${field("Areas to be careful with", chips(d, "safetyAreas", SAFETY_AREAS, true), "Select any that apply")}
    ${textField(d, "Movements to avoid (optional)", "avoid", "e.g. no overhead pressing")}
    <label class="onb-ack"><input type="checkbox" data-input="ack" ${d.ack ? "checked" : ""} /> <span>I understand SpotterAI provides <strong>general fitness guidance, not medical advice</strong>, and I'll see a professional for pain, injuries, or medical concerns.</span></label>`;
}
function stepPrefs(d) {
  return `<h3 class="onb-title">Preferences</h3>
    <p class="onb-sub">All optional. These nudge exercise selection and tone.</p>
    <div class="onb-cols">${textField(d, "Exercises you like", "likes", "e.g. rows, hinges")}${textField(d, "Exercises you dislike", "dislikes", "e.g. burpees")}</div>
    ${field("Cardio", chips(d, "cardio", CARDIO_PREFS))}
    ${field("Leg days", chips(d, "legDays", LEG_DAY_PREFS), "Runners often replace leg days with runs. Say so and the plan stops prescribing sessions you skip.")}
    ${field("Intensity", chips(d, "intensity", INTENSITY_PREFS))}
    ${field("Coaching style", chips(d, "coaching", COACHING_STYLES))}`;
}
const STEP_RENDER = [stepGoal, stepBody, stepSchedule, stepSafety, stepPrefs];

/** Markup for intake step `i` with answers `d`. Pure: no DOM, no module state. */
export function stepMarkup(i, d) {
  return STEP_RENDER[i](d);
}

// --- validation (only the essentials block progress) -----------------------
function canAdvance() {
  if (step === 0) return !!data.goal; // need a goal
  if (step === 1) return validateMeasurements(data).valid;
  if (step === 3) return !!data.ack; // must acknowledge the disclaimer
  return true;
}

function updateMeasurementErrors() {
  const { errors } = validateMeasurements(data);
  body.querySelectorAll("[data-input=height], [data-input=heightFt], [data-input=heightIn], [data-input=weight]").forEach((el) => {
    const error = errors[el.dataset.input] || "";
    el.setAttribute("aria-invalid", error ? "true" : "false");
    const message = body.querySelector(`#onb-error-${el.dataset.input}`);
    if (message) message.textContent = error;
  });
}
function isOptionalStep() {
  return step !== 0 && step !== 3; // goal + safety-ack aren't skippable
}

// --- render ----------------------------------------------------------------
function focusChip(field, value) {
  body.querySelector(`.onb-chips[data-field="${CSS.escape(field)}"] [data-value="${CSS.escape(value)}"]`)?.focus();
}

function render({ focusField, focusValue } = {}) {
  progress.innerHTML = ONBOARDING_STEPS.map((s, i) => `<span class="onb-step${i === step ? " is-active" : ""}${i < step ? " is-done" : ""}">${esc(s)}</span>`).join("");
  body.innerHTML = stepMarkup(step, data);
  backBtn.style.visibility = step === 0 ? "hidden" : "visible";
  skipBtn.hidden = !isOptionalStep();
  skipBtn.disabled = !canAdvance();
  nextBtn.disabled = !canAdvance();
  nextBtn.textContent = step === STEP_RENDER.length - 1 ? "Build my plan" : "Next";
  if (focusField && focusValue != null) focusChip(focusField, focusValue);
}

function open(source = "plan") {
  load();
  overlay.classList.add("is-open");
  overlay.setAttribute("aria-hidden", "false");
  trackFunnel("onboarding_started", { source });
  render();
  setTimeout(() => overlay.querySelector(".onb-chip, .onb-input")?.focus(), 50);
}
function close() {
  overlay.classList.remove("is-open");
  overlay.setAttribute("aria-hidden", "true");
}

function finish() {
  const inputs = mapOnboardingToInputs(data);
  // Apply the chosen measurement system (kg/lb → also drives ml/floz, km/mi).
  setUnit(data.units === "lb" ? "lb" : "kg");
  // Seed conservative nutrition targets from bodyweight + goal.
  const kg = bodyweightKg(data);
  if (kg) {
    const s = saferTargets({ bodyweight: kg, unit: "kg", goal: inputs.goal });
    if (s) setTargets({ kcal: Math.round((s.kcalLow + s.kcalHigh) / 2), protein: Math.round((s.proteinLow + s.proteinHigh) / 2) });
  }
  try { localStorage.removeItem(KEY); } catch { /* nothing to clean up if storage is unavailable */ }
  close();
  location.hash = "#/"; // the Plan page, where results render
  window.dispatchEvent(new CustomEvent("spotter:generate", { detail: inputs }));
  trackFunnel("onboarding_completed");
}

// --- wiring ----------------------------------------------------------------
if (overlay && body) {
  body.addEventListener("click", (e) => {
    const chip = e.target.closest(".onb-chip");
    if (!chip) return;
    const wrap = chip.closest(".onb-chips");
    const f = wrap.dataset.field;
    const value = chip.dataset.value;
    if (wrap.dataset.multi === "1") {
      const arr = Array.isArray(data[f]) ? [...data[f]] : [];
      data[f] = arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
      const active = data[f].includes(value);
      chip.classList.toggle("is-active", active);
      chip.setAttribute("aria-pressed", active ? "true" : "false");
    } else {
      data = f === "units" ? switchMeasurementSystem(data, value === "lb" ? "imperial" : "metric") : { ...data, [f]: value };
      wrap.querySelectorAll(".onb-chip").forEach((c) => {
        const active = c === chip;
        c.classList.toggle("is-active", active);
        c.setAttribute("aria-pressed", active ? "true" : "false");
      });
    }
    save();
    if (f === "units") render({ focusField: f, focusValue: value });
    else nextBtn.disabled = !canAdvance();
  });
  body.addEventListener("input", (e) => {
    const el = e.target.closest("[data-input]");
    if (!el) return;
    data = clearMeasurementCorrection(data, el.dataset.input);
    data[el.dataset.input] = el.type === "checkbox" ? el.checked : el.value;
    updateMeasurementErrors();
    skipBtn.disabled = !canAdvance();
    nextBtn.disabled = !canAdvance();
    save();
  });

  nextBtn.addEventListener("click", () => {
    if (!canAdvance()) return;
    if (step === STEP_RENDER.length - 1) return finish();
    step += 1;
    save();
    render();
    body.scrollTop = 0;
  });
  backBtn.addEventListener("click", () => {
    if (step > 0) { step -= 1; save(); render(); }
  });
  skipBtn.addEventListener("click", () => {
    if (step < STEP_RENDER.length - 1) { step += 1; save(); render(); }
    else finish();
  });
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && overlay.classList.contains("is-open")) close(); });

  // Entry points: any [data-onboard] control opens the guided flow.
  document.addEventListener("click", (e) => {
    const trigger = e.target.closest("[data-onboard]");
    if (trigger) {
      e.preventDefault();
      const source = trigger.closest("#today") ? "today" : "landing";
      trackFunnel("landing_cta_clicked", {
        source: source === "today" ? "today" : trigger.closest(".final-cta") ? "final" : "hero",
      });
      open(source);
    }
  });
  window.addEventListener("spotter:onboarding", (e) => open(e.detail?.source || "plan"));
}
