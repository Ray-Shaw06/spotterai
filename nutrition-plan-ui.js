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
import { buildPlan, prefillFromInputs, validateBodyStats } from "./nutrition-plan.js";
import { planCardModel, planCardHTML, planFormHTML, statsFromForm } from "./plan-card.js";

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
  const inches = stats.heightCm / 2.54;
  return {
    ...stats,
    heightCm: stats.heightCm,
    heightFt: Math.floor(inches / 12),
    heightIn: Math.round(inches % 12),
    unit,
  };
}

export function renderPlanCard({ force = false } = {}) {
  if (!host) return;
  // Never rebuild the form under someone who is typing in it (the render-on-persist
  // trap). An explicit save or cancel is the user's own action, so it always renders.
  if (!force && mode === "form" && host.contains(document.activeElement) && document.activeElement.matches("input, select")) return;

  const unit = getState().unit;
  const stats = getBodyStats();
  if (mode === "form") {
    host.innerHTML = planFormHTML({ unit, values: draft ?? valuesFor(stats, unit), needWeight: bodyweightSeries().length === 0, errors });
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

function readForm(form) {
  const values = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === "radio") {
      if (el.checked) values[el.name] = el.value;
    } else {
      values[el.name] = el.value;
    }
  }
  return values;
}

function save(form) {
  const unit = getState().unit;
  const values = readForm(form);
  draft = values;
  errors = [];

  const needWeight = bodyweightSeries().length === 0;
  if (needWeight && !(Number(values.weight) > 0)) errors.push("weight: enter your current weight");

  const stats = statsFromForm(values, unit);
  const check = validateBodyStats(stats);
  if (!check.ok) errors.push(...check.errors);
  if (errors.length) {
    renderPlanCard({ force: true });
    host.querySelector(".plan__errors")?.scrollIntoView?.({ block: "nearest" });
    return;
  }
  setBodyStats(stats);
  if (needWeight) addBodyweight({ value: Number(values.weight) });
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

host?.addEventListener("submit", (e) => {
  e.preventDefault();
  save(e.target);
});
