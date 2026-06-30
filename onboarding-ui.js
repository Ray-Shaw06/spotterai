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
  INTENSITY_PREFS,
  COACHING_STYLES,
  SAFETY_AREAS,
  ONBOARDING_STEPS,
  mapOnboardingToInputs,
  bodyweightKg,
} from "./onboarding.js";
import { saferTargets } from "./nutrition-safety.js";
import { setTargets, setUnit } from "./tracker-store.js";

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

function esc(t) {
  const d = document.createElement("div");
  d.textContent = t == null ? "" : String(t);
  return d.innerHTML;
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify({ step, data })); } catch {}
}
function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    step = raw.step || 0;
    data = raw.data || {};
  } catch { step = 0; data = {}; }
}

// --- field helpers (chips bound to `data`) ---------------------------------
function chips(field, options, multi = false) {
  const sel = data[field];
  return `<div class="onb-chips" data-field="${field}" data-multi="${multi ? 1 : 0}">${options
    .map((o) => {
      const value = typeof o === "object" ? o.value ?? o.label : o;
      const label = typeof o === "object" ? o.label : o;
      const active = multi ? Array.isArray(sel) && sel.includes(value) : sel === value;
      return `<button type="button" class="onb-chip${active ? " is-active" : ""}" data-value="${esc(value)}">${esc(label)}</button>`;
    })
    .join("")}</div>`;
}
function field(label, inner, hint) {
  return `<div class="onb-field"><span class="onb-flabel">${esc(label)}</span>${hint ? `<span class="onb-fhint">${esc(hint)}</span>` : ""}${inner}</div>`;
}
const input = (f, ph, type = "text") => `<input class="input onb-input" data-input="${f}" type="${type}" autocomplete="off" placeholder="${esc(ph)}" value="${esc(data[f] ?? "")}" inputmode="${type === "number" ? "decimal" : "text"}" />`;

// --- steps -----------------------------------------------------------------
function stepGoal() {
  return `<h3 class="onb-title">What's your main goal?</h3>
    <p class="onb-sub">SpotterAI builds a conservative plan around this — you can change it later.</p>
    ${chips("goal", GOAL_OPTIONS)}`;
}
function stepBody() {
  return `<h3 class="onb-title">A little about you</h3>
    <p class="onb-sub">Optional — it helps tailor volume and nutrition targets. Skip anything you'd rather not share.</p>
    ${field("Age range", chips("ageRange", AGE_RANGES))}
    ${field("Units", chips("units", [{ value: "kg", label: "kg" }, { value: "lb", label: "lb" }]))}
    <div class="onb-cols">${field("Height", input("height", "e.g. 178"))}${field("Bodyweight", input("weight", "e.g. 75", "number"))}</div>
    ${field("Sex (optional)", chips("sex", ["Male", "Female", "Prefer not to say"]))}
    ${field("Training experience", chips("trainingAge", TRAINING_AGE_OPTIONS))}`;
}
function stepSchedule() {
  return `<h3 class="onb-title">Your schedule</h3>
    <p class="onb-sub">Pick what's realistic — consistency beats an ambitious plan you can't keep.</p>
    ${field("Days per week", chips("days", DAYS_OPTIONS))}
    ${field("Session length (min)", chips("sessionLength", SESSION_LENGTHS))}
    ${field("Training at", chips("location", ["Gym", "Home"]))}
    ${field("Equipment", chips("equipment", EQUIPMENT_OPTIONS, true), "Select all that apply")}`;
}
function stepSafety() {
  return `<h3 class="onb-title">Anything to keep safe?</h3>
    <p class="onb-sub">SpotterAI uses this to cap risky volume and offer safer swaps. It can't diagnose anything.</p>
    ${field("Any current pain or discomfort?", chips("currentPain", [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]))}
    ${field("Areas to be careful with", chips("safetyAreas", SAFETY_AREAS, true), "Select any that apply")}
    ${field("Movements to avoid (optional)", input("avoid", "e.g. no overhead pressing"))}
    <label class="onb-ack"><input type="checkbox" data-input="ack" ${data.ack ? "checked" : ""} /> <span>I understand SpotterAI provides <strong>general fitness guidance, not medical advice</strong>, and I'll see a professional for pain, injuries, or medical concerns.</span></label>`;
}
function stepPrefs() {
  return `<h3 class="onb-title">Preferences</h3>
    <p class="onb-sub">All optional — these nudge exercise selection and tone.</p>
    <div class="onb-cols">${field("Exercises you like", input("likes", "e.g. rows, hinges"))}${field("Exercises you dislike", input("dislikes", "e.g. burpees"))}</div>
    ${field("Cardio", chips("cardio", CARDIO_PREFS))}
    ${field("Intensity", chips("intensity", INTENSITY_PREFS))}
    ${field("Coaching style", chips("coaching", COACHING_STYLES))}`;
}
const STEP_RENDER = [stepGoal, stepBody, stepSchedule, stepSafety, stepPrefs];

// --- validation (only the essentials block progress) -----------------------
function canAdvance() {
  if (step === 0) return !!data.goal; // need a goal
  if (step === 3) return !!data.ack; // must acknowledge the disclaimer
  return true;
}
function isOptionalStep() {
  return step !== 0 && step !== 3; // goal + safety-ack aren't skippable
}

// --- render ----------------------------------------------------------------
function render() {
  progress.innerHTML = ONBOARDING_STEPS.map((s, i) => `<span class="onb-step${i === step ? " is-active" : ""}${i < step ? " is-done" : ""}">${esc(s)}</span>`).join("");
  body.innerHTML = STEP_RENDER[step]();
  backBtn.style.visibility = step === 0 ? "hidden" : "visible";
  skipBtn.hidden = !isOptionalStep();
  nextBtn.disabled = !canAdvance();
  nextBtn.textContent = step === STEP_RENDER.length - 1 ? "Build my plan" : "Next";
}

function open() {
  load();
  overlay.classList.add("is-open");
  overlay.setAttribute("aria-hidden", "false");
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
  try { localStorage.removeItem(KEY); } catch {}
  close();
  location.hash = "#/"; // the Plan page, where results render
  window.dispatchEvent(new CustomEvent("spotter:generate", { detail: inputs }));
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
      wrap.querySelector(`[data-value="${CSS.escape(value)}"]`)?.classList.toggle("is-active");
    } else {
      data[f] = value;
      wrap.querySelectorAll(".onb-chip").forEach((c) => c.classList.toggle("is-active", c === chip));
    }
    nextBtn.disabled = !canAdvance();
    save();
  });
  body.addEventListener("input", (e) => {
    const el = e.target.closest("[data-input]");
    if (!el) return;
    data[el.dataset.input] = el.type === "checkbox" ? el.checked : el.value;
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
    if (trigger) { e.preventDefault(); open(); }
  });
  window.addEventListener("spotter:onboarding", open);
}
