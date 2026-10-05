/**
 * SpotterAI — nutrition plan card (pure view model + markup)
 * ============================================================================
 * The Food diary's "Your nutrition plan": the targets, why they are what they
 * are, and an inline form for the few numbers it needs. No DOM access, so the
 * copy and the structure can be pinned by tests; nutrition-plan-ui.js draws it.
 *
 * TONE IS A REQUIREMENT. It says what the numbers are and where they came from,
 * never that a user is behind, and it never claims research backing for them.
 * The form is inline, not a modal: nothing here needs to interrupt anyone.
 */

import { AGE_RANGES, SESSION_LENGTHS } from "./onboarding.js";
import { DAILY_ACTIVITY, NUTRITION_INTENTS } from "./lib/nutrition-targets.js";

/** The plan has to differ from the saved targets by at least this much to be worth offering. */
export const APPLY_MIN_DELTA_KCAL = 25;

const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const TITLE = '<h2 class="card-title">Your nutrition plan</h2>';

/**
 * @returns {{ state: "setup" } | { state: "plan", targets, basis, proteinPerKg, confidence, limitations, notice, canApply }}
 */
export function planCardModel({ bodyStats, plan, current = {} } = {}) {
  if (bodyStats && !plan) return { state: "weight", cta: "Add my weight" };
  if (!bodyStats || !plan) return { state: "setup", cta: "Get my targets" };
  return {
    state: "plan",
    targets: plan.targets,
    basis: plan.basis,
    proteinPerKg: plan.proteinPerKg,
    confidence: plan.confidence,
    limitations: plan.limitations,
    notice: plan.notice,
    canApply: Math.abs(plan.targets.kcal - (Number(current.kcal) || 0)) >= APPLY_MIN_DELTA_KCAL,
  };
}

export function planCardHTML(m) {
  if (m.state === "weight") {
    return `${TITLE}
      <p class="plan__lead">Add a weigh-in to see your plan. It is built from your saved stats and your current weight.</p>
      <div class="today-card__actions"><button type="button" class="btn btn--primary btn--sm" data-plan-act="open">${esc(m.cta)}</button></div>`;
  }
  if (m.state === "setup") {
    return `${TITLE}
      <p class="plan__lead">Answer a few questions and get calorie and protein targets built from your own numbers. They stay on this device.</p>
      <div class="today-card__actions"><button type="button" class="btn btn--primary btn--sm" data-plan-act="open">${esc(m.cta)}</button></div>`;
  }
  const t = m.targets;
  const num = (label, value) => `<div class="plan__num"><dt>${label}</dt><dd>${value}</dd></div>`;
  const confidence = m.confidence === "High" ? "Confidence: High" : "Confidence: Medium, because sex was left blank";
  return `${TITLE}
    <dl class="plan__nums">${num("Calories", t.kcal.toLocaleString("en-US"))}${num("Protein", `${t.protein} g`)}${num("Carbs", `${t.carbs} g`)}${num("Fat", `${t.fat} g`)}</dl>
    <p class="plan__basis">${esc(m.basis)}</p>
    <p class="plan__line">Protein is about ${esc(m.proteinPerKg)} g per kg of bodyweight.</p>
    <p class="plan__line">${esc(confidence)}</p>
    ${m.notice ? `<p class="plan__notice">${esc(m.notice)}</p>` : ""}
    <p class="plan__limits">${esc(m.limitations)}</p>
    <div class="today-card__actions">
      ${m.canApply ? '<button type="button" class="btn btn--primary btn--sm" data-plan-act="apply">Use these targets</button>' : ""}
      <button type="button" class="btn btn--ghost btn--sm" data-plan-act="edit">Edit my stats</button>
    </div>`;
}

const FIELD_MESSAGES = (e) => String(e).replace(/^[A-Za-z]+:\s*/, "");

function radioGroup(legend, name, options, selected, optional = false) {
  const items = options
    .map((o) => `<label class="plan-chip"><input type="radio" name="${name}" value="${esc(o.value)}"${String(o.value) === String(selected) ? " checked" : ""}><span>${esc(o.label)}</span></label>`)
    .join("");
  return `<fieldset class="plan__group"><legend>${legend}${optional ? ' <span class="plan__opt">Optional</span>' : ""}</legend><div class="plan__chips">${items}</div></fieldset>`;
}

function selectField(label, name, options, selected) {
  const opts = options.map((o) => `<option value="${esc(o.value)}"${String(o.value) === String(selected) ? " selected" : ""}>${esc(o.label)}</option>`).join("");
  return `<label class="plan__field">${label}<select class="input" name="${name}">${opts}</select></label>`;
}

/** The inline setup form. `values` prefills it; `errors` are shown without field keys. */
export function planFormHTML({ unit = "kg", values = {}, needWeight = false, errors = [] } = {}) {
  const v = values;
  const height =
    unit === "lb"
      ? `<div class="plan__pair"><label class="plan__field">Height, feet<input class="input" name="heightFt" type="number" min="3" max="8" inputmode="numeric" value="${esc(v.heightFt ?? "")}"></label>
         <label class="plan__field">inches<input class="input" name="heightIn" type="number" min="0" max="11" inputmode="numeric" value="${esc(v.heightIn ?? "")}"></label></div>`
      : `<label class="plan__field">Height, cm<input class="input" name="heightCm" type="number" min="100" max="250" inputmode="numeric" value="${esc(v.heightCm ?? "")}"></label>`;
  const days = Array.from({ length: 8 }, (_, i) => ({ value: i, label: i === 0 ? "None" : `${i} day${i === 1 ? "" : "s"}` }));
  const lengths = SESSION_LENGTHS.map((m) => ({ value: m, label: `${m} minutes` }));
  const err = errors.length ? `<ul class="plan__errors" role="alert" tabindex="-1">${errors.map((e) => `<li>${esc(FIELD_MESSAGES(e))}</li>`).join("")}</ul>` : "";
  return `${TITLE}
    <form class="plan__form" novalidate>
      ${err}
      ${height}
      ${radioGroup("Age range", "ageRange", AGE_RANGES.map((a) => ({ value: a, label: a })), v.ageRange)}
      ${radioGroup("Sex", "sex", [{ value: "Male", label: "Male" }, { value: "Female", label: "Female" }, { value: "", label: "Prefer not to say" }], v.sex ?? "", true)}
      ${radioGroup("How active is your day", "dailyActivity", DAILY_ACTIVITY.map((d) => ({ value: d.value, label: d.label })), v.dailyActivity)}
      <fieldset class="plan__group"><legend>Training</legend><div class="plan__pair">${selectField("Training days a week", "daysPerWeek", days, v.daysPerWeek ?? 3)}${selectField("Session length", "sessionLength", lengths, v.sessionLength ?? 45)}</div></fieldset>
      ${radioGroup("Eating goal", "intent", NUTRITION_INTENTS.map((i) => ({ value: i.value, label: i.label })), v.intent ?? "recomp")}
      ${needWeight ? `<label class="plan__field">Current weight, ${unit === "lb" ? "lb" : "kg"}<input class="input" name="weight" type="number" step="0.1" min="20" inputmode="decimal" value="${esc(v.weight ?? "")}"></label>` : ""}
      <div class="today-card__actions">
        <button type="submit" class="btn btn--primary btn--sm">Calculate my plan</button>
        <button type="button" class="btn btn--ghost btn--sm" data-plan-act="cancel">Cancel</button>
      </div>
    </form>`;
}

/** Whole feet and inches for a height in cm. Rounds once, so inches are always 0 to 11. */
export function heightToFtIn(cm) {
  const total = Math.round(Number(cm) / 2.54);
  return { ft: Math.floor(total / 12), inch: total % 12 };
}

const KG_PER_LB = 1 / 2.2046226218;

/**
 * A draft carried across a kg/lb switch: height and weight are converted so nothing the
 * user typed is blanked. A draft with no unit tag, or already in this unit, is returned as is.
 */
export function draftForUnit(draft, unit) {
  if (!draft || !draft._unit || draft._unit === unit) return draft;
  const out = { ...draft, _unit: unit };
  const has = (v) => v !== "" && v != null && Number.isFinite(Number(v));
  if (unit === "lb") {
    if (has(draft.heightCm)) {
      const { ft, inch } = heightToFtIn(draft.heightCm);
      out.heightFt = ft;
      out.heightIn = inch;
    }
    delete out.heightCm;
    if (has(draft.weight)) out.weight = (Number(draft.weight) / KG_PER_LB).toFixed(1);
  } else {
    const cm = statsFromForm({ heightFt: draft.heightFt, heightIn: draft.heightIn }, "lb").heightCm;
    if (Number.isFinite(cm)) out.heightCm = cm;
    delete out.heightFt;
    delete out.heightIn;
    if (has(draft.weight)) out.weight = (Number(draft.weight) * KG_PER_LB).toFixed(1);
  }
  return out;
}

/** The current values of a form's elements: checked radios, selects, typed text. Pure, so a draft can be kept as the user types. */
export function formValues(elements) {
  const values = {};
  for (const el of elements) {
    if (!el.name) continue;
    if (el.type === "radio") {
      if (el.checked) values[el.name] = el.value;
    } else {
      values[el.name] = el.value;
    }
  }
  return values;
}

/** Form values to the shape `validateBodyStats` takes; feet and inches become centimetres. */
export function statsFromForm(values = {}, unit = "kg") {
  let heightCm = NaN;
  if (unit === "lb") {
    const inches = (Number(values.heightFt) || 0) * 12 + (Number(values.heightIn) || 0);
    if (inches > 0) heightCm = Math.round(inches * 2.54);
  } else if (values.heightCm !== "" && values.heightCm != null) {
    heightCm = Number(values.heightCm);
  }
  return {
    heightCm,
    ageRange: values.ageRange,
    sex: values.sex ?? "",
    dailyActivity: values.dailyActivity,
    daysPerWeek: values.daysPerWeek,
    sessionLength: values.sessionLength,
    intent: values.intent,
  };
}
