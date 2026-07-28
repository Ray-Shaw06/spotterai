/**
 * SpotterAI — nutrition stats prompt for existing users
 * ============================================================================
 * Users who were already here before targets became stats-based have no
 * bodyStats, so they would silently keep the old bodyweight-only numbers. This
 * shows them a dismissible card on Today, and a short sheet to fill the gap.
 *
 * It never overwrites targets on its own: these users may have tuned theirs by
 * hand, so applying the calculated set is always an explicit tap. Dismissing is
 * permanent (the Nutrition page keeps a link back in) rather than a recurring
 * nag.
 */

import { calculateTargets, NUTRITION_INTENTS, DAILY_ACTIVITY } from "./lib/nutrition-targets.js";
import { AGE_RANGES } from "./onboarding.js";
import { deriveStats, getBodyStats, setBodyStats, setTargets } from "./tracker-store.js";

const mount = document.getElementById("nutrition-prompt");
const KEY = "spotterai_nutrition_prompt";
const LB_TO_KG = 0.45359237;

// These users never answered onboarding's schedule questions, so assume a
// modest training week. Whatever we assume gets PERSISTED on apply, otherwise
// the Nutrition page would recompute from null volume, land on a different
// number, and flag drift against the target the user just accepted.
const ASSUMED_DAYS_PER_WEEK = 3;
const ASSUMED_SESSION_LENGTH = 45;

function esc(t) {
  const d = document.createElement("div");
  d.textContent = t == null ? "" : String(t);
  return d.innerHTML;
}
const dismissed = () => {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
};
const dismiss = () => {
  try { localStorage.setItem(KEY, "1"); } catch { /* storage disabled */ }
};

/** Enough stats to calculate? Height and an eating goal are the usual gaps. */
function isComplete() {
  const b = getBodyStats();
  return !!(b.heightCm && b.ageRange && b.dailyActivity && b.intent);
}

/** Has this person actually used the app? New users get onboarding instead. */
function hasHistory() {
  const s = deriveStats();
  return (s.recentWorkouts?.length || 0) > 0 || (s.bodyweight?.series?.length || 0) > 0;
}

let sheetOpen = false;

/** Saved stats plus the latest logged bodyweight, in calculator shape. */
function draft() {
  const b = getBodyStats();
  const s = deriveStats();
  const raw = s.bodyweight?.latest ?? null;
  return {
    kg: raw == null ? null : s.unit === "lb" ? raw * LB_TO_KG : raw,
    cm: b.heightCm,
    ageRange: b.ageRange,
    sex: b.sex,
    dailyActivity: b.dailyActivity,
    daysPerWeek: b.daysPerWeek || ASSUMED_DAYS_PER_WEEK,
    sessionLength: b.sessionLength || ASSUMED_SESSION_LENGTH,
    intent: b.intent,
  };
}

function chips(field, options, active) {
  return `<div class="np-chips" data-field="${field}">${options
    .map((o) => {
      const value = typeof o === "object" ? o.value : o;
      const label = typeof o === "object" ? o.label : o;
      const on = value === active;
      return `<button type="button" class="onb-chip${on ? " is-active" : ""}" data-value="${esc(value)}" aria-pressed="${on ? "true" : "false"}">${esc(label)}</button>`;
    })
    .join("")}</div>`;
}

/** The live figures under the sheet. Shared by the initial render and edits. */
function previewHtml() {
  const t = calculateTargets(draft());
  if (!t) return `<p class="dash-hint">Add your height and log a bodyweight to see calculated targets.</p>`;
  return `<p class="np-figures">${t.kcal.toLocaleString("en-US")} kcal · ${t.protein}P · ${t.carbs}C · ${t.fat}F</p>
    <p class="dash-hint">${esc(t.basis)}</p>
    ${t.notice ? `<p class="np-notice">${esc(t.notice)}</p>` : ""}`;
}

function sheet() {
  const d = draft();
  const ready = !!calculateTargets(d);
  return `<div class="card np-sheet">
      <h3 class="card-title">Calculate your targets</h3>
      <p class="dash-hint">Saved on this device only. Nothing leaves your browser.</p>
      <label class="field-label-sm">Height (cm)<input id="np-height" class="input" type="number" min="100" max="250" inputmode="numeric" value="${d.cm || ""}" /></label>
      <span class="onb-flabel">Age range</span>${chips("ageRange", AGE_RANGES, d.ageRange)}
      <span class="onb-flabel">Sex (optional)</span>${chips("sex", ["Male", "Female", "Prefer not to say"], d.sex)}
      <span class="onb-flabel">Eating goal</span>${chips("intent", NUTRITION_INTENTS, d.intent)}
      <span class="onb-flabel">Outside training, your day is</span>${chips("dailyActivity", DAILY_ACTIVITY, d.dailyActivity)}
      <div id="np-preview">${previewHtml()}</div>
      <div class="np-actions">
        <button type="button" class="btn btn--ghost btn--sm" data-np="apply"${ready ? "" : " disabled"}>Use these targets</button>
        <button type="button" class="btn-link" data-np="close">Cancel</button>
      </div>
    </div>`;
}

function card() {
  return `<div class="card np-card">
      <p class="np-card__text">SpotterAI can now set your calories and macros from your stats and whether you want to cut, recomp, or bulk. Your current targets stay as they are until you choose to update them.</p>
      <div class="np-actions">
        <button type="button" class="btn btn--ghost btn--sm" data-np="open">Set this up</button>
        <button type="button" class="btn-link" data-np="dismiss">No thanks</button>
      </div>
    </div>`;
}

function render() {
  if (!mount) return;
  if (sheetOpen) { mount.innerHTML = sheet(); return; }
  mount.innerHTML = !dismissed() && hasHistory() && !isComplete() ? card() : "";
}

if (mount) {
  mount.addEventListener("click", (e) => {
    const chip = e.target.closest(".np-chips .onb-chip");
    if (chip) {
      setBodyStats({ [chip.closest(".np-chips").dataset.field]: chip.dataset.value });
      render();
      return;
    }
    const act = e.target.closest("[data-np]")?.dataset.np;
    if (act === "open") { sheetOpen = true; render(); }
    else if (act === "close") { sheetOpen = false; render(); }
    else if (act === "dismiss") { dismiss(); render(); }
    else if (act === "apply") {
      const d = draft();
      const t = calculateTargets(d);
      if (!t) return;
      setTargets({ kcal: t.kcal, protein: t.protein, carbs: t.carbs, fat: t.fat });
      // Persist the training volume this calculation assumed so every other
      // surface recomputes the same number.
      setBodyStats({ daysPerWeek: d.daysPerWeek, sessionLength: d.sessionLength });
      dismiss();
      sheetOpen = false;
      render();
    }
  });
  mount.addEventListener("input", (e) => {
    if (e.target.id !== "np-height") return;
    const cm = Number(e.target.value);
    setBodyStats({ heightCm: cm >= 100 && cm <= 250 ? cm : null });
    const preview = mount.querySelector("#np-preview");
    if (preview) preview.innerHTML = previewHtml();
    const apply = mount.querySelector('[data-np="apply"]');
    if (apply) apply.disabled = !calculateTargets(draft());
  });
  // The Nutrition page's "Set this up" link opens the same sheet.
  window.addEventListener("spotter:nutrition-setup", () => {
    sheetOpen = true;
    render();
    location.hash = "#/today";
  });
  window.addEventListener("spotter:tracker", render);
  window.addEventListener("spotter:profile", render);
  render();
}
