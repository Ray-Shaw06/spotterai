/**
 * SpotterAI — Food diary "Your nutrition plan" (DOM wiring)
 * ============================================================================
 * Draws plan-card.js into #nut-plan and handles its few buttons. Every decision
 * (what the plan says, whether it differs enough to offer, what a form value
 * means) lives in pure modules; this file only reads the form and calls the
 * store. The setup form is inline, never a modal.
 */

import { store } from "./store.js";
import { addBodyweight, bodyweightSeries, getBodyStats, getState, setBodyStats, setTargets } from "./tracker-store.js";
import { buildPlan, prefillFromInputs, validateBodyStats, validateWeight } from "./nutrition-plan.js";
import { planCardModel, planCardHTML, planFormHTML, statsFromForm, heightToFtIn, formValues, draftForUnit } from "./plan-card.js";

const host = document.getElementById("nut-plan");

let mode = "view"; // "view" | "form"
let draft = null; // what the user has typed, so a failed save does not wipe it
let errors = [];

function latestKg() {
  const series = bodyweightSeries();
  return series.length ? series[series.length - 1].kg : null;
}

/** Form values for the current stats, or sensible defaults from the training plan. */
function valuesFor(stats, unit) {
  if (!stats) return { ...prefillFromInputs(store.inputs) };
  const { ft, inch } = heightToFtIn(stats.heightCm);
  return { ...stats, heightFt: ft, heightIn: inch, unit };
}

export function renderPlanCard({ force = false } = {}) {
  if (!host) return;
  // Never rebuild the form under someone who is typing in it (the render-on-persist
  // trap). An explicit save or cancel is the user's own action, so it always renders.
  if (!force && mode === "form" && host.contains(document.activeElement) && document.activeElement.matches("input, select")) return;

  const unit = getState().unit;
  const stats = getBodyStats();
  if (mode === "form") {
    host.innerHTML = planFormHTML({ unit, values: draftForUnit(draft, unit) ?? valuesFor(stats, unit), needWeight: bodyweightSeries().length === 0, errors });
    return;
  }
  const plan = buildPlan({ bodyStats: stats, kg: latestKg() });
  host.innerHTML = planCardHTML(planCardModel({ bodyStats: stats, plan, current: getState().targets }));
}

function openForm() {
  mode = "form";
  draft = null;
  errors = [];
  renderPlanCard({ force: true });
  host.querySelector("input, select")?.focus();
}

function closeForm() {
  mode = "view";
  draft = null;
  errors = [];
  renderPlanCard({ force: true });
}

function save(form) {
  const unit = getState().unit;
  const values = formValues(form.elements);
  draft = { ...values, _unit: unit };
  errors = [];

  const needWeight = bodyweightSeries().length === 0;
  const weight = validateWeight(values.weight, unit);
  if (needWeight && !weight.ok) errors.push(...weight.errors);

  const stats = statsFromForm(values, unit);
  const check = validateBodyStats(stats);
  if (!check.ok) errors.push(...check.errors);
  if (errors.length) {
    renderPlanCard({ force: true });
    // Put focus on the errors (they are announced too), so a keyboard user keeps their place.
    const list = host.querySelector(".plan__errors");
    list?.focus?.();
    list?.scrollIntoView?.({ block: "nearest" });
    return;
  }
  setBodyStats(stats);
  if (needWeight) addBodyweight({ value: weight.value });
  closeForm();
}

function applyPlan() {
  const plan = buildPlan({ bodyStats: getBodyStats(), kg: latestKg() });
  if (!plan) return;
  setTargets(plan.targets);
}

host?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-plan-act]");
  if (!btn) return;
  const act = btn.dataset.planAct;
  if (act === "open" || act === "edit") openForm();
  else if (act === "cancel") closeForm();
  else if (act === "apply") applyPlan();
});

// Keep what the user has typed as they type, so any re-render restores it.
for (const type of ["input", "change"]) {
  host?.addEventListener(type, (e) => {
    if (mode === "form" && e.target.form) draft = { ...formValues(e.target.form.elements), _unit: getState().unit };
  });
}

host?.addEventListener("submit", (e) => {
  e.preventDefault();
  save(e.target);
});

// A different profile is a different person: an open form or a half-typed draft must not follow the switch.
window.addEventListener("spotter:profile", () => {
  mode = "view";
  draft = null;
  errors = [];
  renderPlanCard({ force: true });
});
