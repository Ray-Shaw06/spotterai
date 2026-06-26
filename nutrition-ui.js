/**
 * SpotterAI — Nutrition diary (MyFitnessPal-style)
 * ============================================================================
 * A daily food diary: date navigation, a calories-remaining summary with macro
 * bars, meals (Breakfast / Lunch / Dinner / Snacks), a food search (built-in
 * common foods + Open Food Facts online lookup) with quantity/servings, recent
 * foods, quick-add, water tracking, and editable targets.
 *
 * Display areas re-render on change; inputs in the food picker are short-lived.
 */

import { addCustomFood, addNutrition, addWater, getCustomFoods, getRecentFoods, getState, getWater, removeEntry, resetAll, setTargets, subscribe } from "./tracker-store.js";
import { searchFoods, searchOpenFoodFacts } from "./foods.js";
import { ring } from "./charts.js";

const $ = (id) => document.getElementById(id);
const el = {
  page: $("nut-page"),
  prev: $("nut-prev"),
  next: $("nut-next"),
  todayBtn: $("nut-today"),
  dateLabel: $("nut-date"),
  summary: $("nut-summary"),
  meals: $("nut-meals"),
  water: $("nut-water"),
  weekChart: $("nut-week-chart"),
  targetsForm: $("nut-targets-form"),
  reset: $("nut-reset"),
  // picker
  picker: $("food-picker"),
  search: $("food-search"),
  results: $("food-results"),
  detail: $("food-detail"),
  pickerClose: $("food-picker-close"),
  pickerTitle: $("food-picker-title"),
};

const MEALS = [
  ["breakfast", "Breakfast"],
  ["lunch", "Lunch"],
  ["dinner", "Dinner"],
  ["snacks", "Snacks"],
];
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function esc(t) {
  const d = document.createElement("div");
  d.textContent = t == null ? "" : String(t);
  return d.innerHTML;
}
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

let selected = ymd(new Date());
let pickerMeal = "breakfast";
let offController = null;

// ----------------------------------------------------------------------------
// Day data
// ----------------------------------------------------------------------------
function entriesFor(date) {
  return getState().nutrition.filter((e) => e.date === date);
}
function totals(entries) {
  return entries.reduce((t, e) => ({ kcal: t.kcal + e.kcal, protein: t.protein + e.protein, carbs: t.carbs + (e.carbs || 0), fat: t.fat + (e.fat || 0) }), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
}

// ----------------------------------------------------------------------------
// Render
// ----------------------------------------------------------------------------
function render() {
  renderDate();
  const entries = entriesFor(selected);
  renderSummary(entries);
  renderMeals(entries);
  renderWater();
}

function renderDate() {
  if (!el.dateLabel) return;
  const todayStr = ymd(new Date());
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const label = selected === todayStr ? "Today" : selected === ymd(y) ? "Yesterday" : new Date(selected + "T00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  el.dateLabel.textContent = label;
  el.todayBtn.hidden = selected === todayStr;
}

function renderSummary(entries) {
  if (!el.summary) return;
  const t = getState().targets;
  const c = totals(entries);
  const remaining = Math.round(t.kcal - c.kcal);
  el.summary.innerHTML = `
    <div class="cal-ring">
      ${ring(c.kcal, t.kcal, { color: remaining < 0 ? "var(--danger)" : "var(--accent)", size: 132, stroke: 12 })}
      <div class="cal-ring__center">
        <span class="cal-ring__num">${remaining < 0 ? "+" + Math.abs(remaining) : remaining}</span>
        <span class="cal-ring__sub">${remaining < 0 ? "over" : "remaining"}</span>
      </div>
    </div>
    <div class="cal-meta">
      <div class="cal-line"><span>Goal</span><strong>${t.kcal}</strong></div>
      <div class="cal-line"><span>Food</span><strong>${Math.round(c.kcal)}</strong></div>
      <div class="macro-rows">
        ${macroRow("Protein", c.protein, t.protein, "#6cb8ff")}
        ${macroRow("Carbs", c.carbs, t.carbs, "var(--accent)")}
        ${macroRow("Fat", c.fat, t.fat, "var(--warn)")}
      </div>
    </div>`;
}
function macroRow(label, value, target, color) {
  const pct = target ? Math.min(100, (value / target) * 100) : 0;
  return `<div class="macro-row">
    <div class="macro-row__top"><span>${label}</span><span class="muted">${Math.round(value)} / ${target} g</span></div>
    <div class="macro-bar"><span style="width:${pct.toFixed(0)}%;background:${color}"></span></div>
  </div>`;
}

function renderMeals(entries) {
  if (!el.meals) return;
  el.meals.innerHTML = MEALS.map(([id, label]) => {
    const items = entries.filter((e) => (e.meal || "snacks") === id);
    const kcal = Math.round(items.reduce((v, e) => v + e.kcal, 0));
    const rows = items
      .map(
        (e) => `<li class="food-row" data-id="${e.id}">
          <div class="food-row__main"><span class="food-row__name">${esc(e.name)}</span><span class="food-row__sub">${esc(formatQty(e))} · ${e.protein}P ${e.carbs || 0}C ${e.fat || 0}F</span></div>
          <span class="food-row__kcal">${e.kcal}</span>
          <button type="button" class="food-row__del" data-act="del-food" aria-label="Remove">×</button>
        </li>`
      )
      .join("");
    return `<div class="meal">
      <div class="meal__head"><h4 class="meal__name">${label}</h4><span class="meal__kcal">${kcal} kcal</span></div>
      <ul class="meal__list">${rows || '<li class="muted meal__empty">No food logged.</li>'}</ul>
      <button type="button" class="meal__add" data-act="add-food" data-meal="${id}">+ Add food</button>
    </div>`;
  }).join("");
}
function formatQty(e) {
  if (e.unit) return `${e.qty || 1} × ${e.unit}`;
  return e.qty && e.qty !== 1 ? `${e.qty} servings` : "1 serving";
}

function renderWater() {
  if (!el.water) return;
  const ml = getWater(selected);
  const target = getState().targets.waterMl || 2500;
  const glasses = Math.round(ml / 250);
  el.water.innerHTML = `
    <div class="water__info"><span class="water__amt">${ml} ml</span><span class="muted"> / ${target} ml · ~${glasses} glasses</span></div>
    <div class="water__bar"><span style="width:${Math.min(100, (ml / target) * 100).toFixed(0)}%"></span></div>
    <div class="water__btns">
      <button type="button" class="btn btn--ghost btn--sm" data-act="water-minus">− 250</button>
      <button type="button" class="btn btn--ghost btn--sm" data-act="water-plus">+ 250 ml</button>
    </div>`;
}

// ----------------------------------------------------------------------------
// Food picker
// ----------------------------------------------------------------------------
function openPicker(meal) {
  pickerMeal = meal || "breakfast";
  el.pickerTitle.textContent = `Add to ${MEALS.find((m) => m[0] === pickerMeal)[1]}`;
  el.detail.hidden = true;
  el.results.hidden = false;
  el.search.parentElement.hidden = false;
  el.search.value = "";
  renderResults("");
  el.picker.classList.add("is-open");
  el.picker.setAttribute("aria-hidden", "false");
  setTimeout(() => el.search.focus(), reducedMotion ? 0 : 60);
}
function closePicker() {
  el.picker.classList.remove("is-open");
  el.picker.setAttribute("aria-hidden", "true");
  if (offController) offController.abort();
}

function foodOptHtml(f, source) {
  return `<li><button type="button" class="food-opt" data-food='${esc(JSON.stringify(f))}'>
    <span class="food-opt__main"><span class="food-opt__name">${esc(f.name)}</span><span class="food-opt__sub">${esc(f.serving || "")} · ${f.kcal} kcal</span></span>
    <span class="food-opt__tag">${source}</span>
  </button></li>`;
}

function renderResults(q) {
  const builtin = searchFoods(q, 25, getCustomFoods());
  let html = "";
  if (!q.trim()) {
    const recent = getRecentFoods(8);
    if (recent.length) html += `<li class="food-grouplabel">Recent</li>` + recent.map((f) => foodOptHtml({ ...f, serving: f.unit || "1 serving" }, "recent")).join("");
    html += `<li class="food-grouplabel">Common foods</li>`;
  }
  html += builtin.map((f) => foodOptHtml(f, f.kcal ? "" : "")).join("");
  html += `<li><button type="button" class="food-opt food-opt--quick" data-act="quick-add"><span class="food-opt__main"><span class="food-opt__name">Quick add</span><span class="food-opt__sub">enter calories &amp; macros manually</span></span><span class="food-opt__tag">+</span></button></li>`;
  el.results.innerHTML = html;

  // Online lookup (debounced via the input handler; this just kicks it off).
  if (q.trim().length >= 2) searchOnline(q.trim());
}

let onlineTimer = null;
function searchOnline(q) {
  clearTimeout(onlineTimer);
  onlineTimer = setTimeout(async () => {
    if (offController) offController.abort();
    offController = new AbortController();
    const marker = document.createElement("div");
    marker.id = "off-results";
    marker.innerHTML = `<li class="food-grouplabel">Open Food Facts <span class="muted">· searching…</span></li>`;
    document.getElementById("off-results")?.remove();
    el.results.appendChild(marker);
    try {
      const results = await searchOpenFoodFacts(q, offController.signal);
      marker.innerHTML = results.length
        ? `<li class="food-grouplabel">Open Food Facts</li>` + results.map((f) => foodOptHtml(f, "online")).join("")
        : "";
    } catch (e) {
      if (e.name !== "AbortError") marker.innerHTML = `<li class="food-grouplabel">Open Food Facts <span class="muted">· offline</span></li>`;
    }
  }, 450);
}

// Food detail (quantity + meal + macro preview)
let detailFood = null;
function showDetail(food, quick = false) {
  detailFood = food;
  el.search.parentElement.hidden = true;
  el.results.hidden = true;
  el.detail.hidden = false;
  const mealOpts = MEALS.map(([id, label]) => `<option value="${id}" ${id === pickerMeal ? "selected" : ""}>${label}</option>`).join("");
  if (quick) {
    el.detail.innerHTML = `
      <button type="button" class="detail-back" data-act="detail-back">← Back</button>
      <input id="qa-name" class="input" placeholder="Food name" autocomplete="off" />
      <div class="detail-grid">
        <label class="field-label-sm">Calories<input id="qa-kcal" class="input" type="number" inputmode="numeric" /></label>
        <label class="field-label-sm">Protein (g)<input id="qa-protein" class="input" type="number" inputmode="decimal" /></label>
        <label class="field-label-sm">Carbs (g)<input id="qa-carbs" class="input" type="number" inputmode="decimal" /></label>
        <label class="field-label-sm">Fat (g)<input id="qa-fat" class="input" type="number" inputmode="decimal" /></label>
      </div>
      <label class="field-label-sm">Meal<select id="detail-meal" class="form-select">${mealOpts}</select></label>
      <button type="button" class="btn btn--primary btn--block" data-act="quick-save">Add</button>`;
    setTimeout(() => $("qa-name")?.focus(), 0);
    return;
  }
  el.detail.innerHTML = `
    <button type="button" class="detail-back" data-act="detail-back">← Back</button>
    <p class="detail-food">${esc(food.name)}<span class="muted"> · per ${esc(food.serving || "serving")}</span></p>
    <div class="detail-qty">
      <label class="field-label-sm">Servings<input id="detail-qty" class="input input--sm" type="number" min="0" step="0.25" value="1" inputmode="decimal" /></label>
      <label class="field-label-sm">Meal<select id="detail-meal" class="form-select">${mealOpts}</select></label>
    </div>
    <div id="detail-preview" class="detail-preview"></div>
    <button type="button" class="btn btn--primary btn--block" data-act="detail-save">Add to diary</button>`;
  updatePreview();
  $("detail-qty")?.addEventListener("input", updatePreview);
}
function updatePreview() {
  const q = Number($("detail-qty")?.value) || 0;
  const f = detailFood;
  const p = $("detail-preview");
  if (!p || !f) return;
  p.innerHTML = `<span class="detail-cal">${Math.round(f.kcal * q)} kcal</span><span class="muted">${round1(f.protein * q)}P · ${round1(f.carbs * q)}C · ${round1(f.fat * q)}F</span>`;
}
const round1 = (v) => Math.round((Number(v) || 0) * 10) / 10;

// ----------------------------------------------------------------------------
// Init / wiring
// ----------------------------------------------------------------------------
function init() {
  // Date nav
  el.prev?.addEventListener("click", () => shiftDate(-1));
  el.next?.addEventListener("click", () => shiftDate(1));
  el.todayBtn?.addEventListener("click", () => {
    selected = ymd(new Date());
    render();
  });

  // Meals + summary delegated actions
  el.meals?.addEventListener("click", (e) => {
    const add = e.target.closest('[data-act="add-food"]');
    const del = e.target.closest('[data-act="del-food"]');
    if (add) openPicker(add.dataset.meal);
    else if (del) removeEntry("nutrition", del.closest(".food-row").dataset.id);
  });
  el.water?.addEventListener("click", (e) => {
    if (e.target.closest('[data-act="water-plus"]')) addWater(250, selected);
    else if (e.target.closest('[data-act="water-minus"]')) addWater(-250, selected);
  });

  // Picker
  el.pickerClose?.addEventListener("click", closePicker);
  el.picker?.addEventListener("click", (e) => {
    if (e.target === el.picker) closePicker();
  });
  el.search?.addEventListener("input", () => renderResults(el.search.value));
  el.results?.addEventListener("click", (e) => {
    if (e.target.closest('[data-act="quick-add"]')) return showDetail(null, true);
    const opt = e.target.closest(".food-opt");
    if (opt?.dataset.food) showDetail(JSON.parse(opt.dataset.food));
  });
  el.detail?.addEventListener("click", (e) => {
    if (e.target.closest('[data-act="detail-back"]')) {
      el.detail.hidden = true;
      el.results.hidden = false;
      el.search.parentElement.hidden = false;
    } else if (e.target.closest('[data-act="detail-save"]')) {
      const qty = Number($("detail-qty").value) || 1;
      const f = detailFood;
      const meal = $("detail-meal").value;
      addNutrition({ name: f.name, meal, qty, unit: f.serving || "serving", kcal: f.kcal * qty, protein: f.protein * qty, carbs: f.carbs * qty, fat: f.fat * qty, date: selected });
      if (f.source === "off") addCustomFood(f); // remember online foods for offline reuse
      closePicker();
    } else if (e.target.closest('[data-act="quick-save"]')) {
      const name = $("qa-name").value.trim() || "Quick add";
      const macros = { kcal: $("qa-kcal").value, protein: $("qa-protein").value, carbs: $("qa-carbs").value, fat: $("qa-fat").value };
      addNutrition({ name, meal: $("detail-meal").value, ...macros, date: selected });
      if ($("qa-name").value.trim()) addCustomFood({ name, serving: "1 serving", ...macros }); // save to your foods
      closePicker();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && el.picker.classList.contains("is-open")) closePicker();
  });

  // Targets + reset
  el.targetsForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(el.targetsForm);
    const t = getState().targets;
    setTargets({
      kcal: Number(fd.get("kcal")) || t.kcal,
      protein: Number(fd.get("protein")) || t.protein,
      carbs: Number(fd.get("carbs")) || t.carbs,
      fat: Number(fd.get("fat")) || t.fat,
      waterMl: Number(fd.get("water")) || t.waterMl,
      weeklyWorkouts: Number(fd.get("weekly")) || t.weeklyWorkouts,
    });
  });
  el.reset?.addEventListener("click", () => {
    if (confirm("Reset all tracked data for this profile? This can't be undone.")) resetAll();
  });
  prefillTargets();

  subscribe(() => {
    render();
    prefillTargets();
  });
  render();
}

function shiftDate(delta) {
  const d = new Date(selected + "T00:00");
  d.setDate(d.getDate() + delta);
  selected = ymd(d);
  render();
}
function prefillTargets() {
  if (!el.targetsForm) return;
  const t = getState().targets;
  const set = (n, v) => {
    const f = el.targetsForm.querySelector(`[name="${n}"]`);
    if (f && document.activeElement !== f) f.value = v;
  };
  set("kcal", t.kcal);
  set("protein", t.protein);
  set("carbs", t.carbs);
  set("fat", t.fat);
  set("water", t.waterMl);
  set("weekly", t.weeklyWorkouts);
}

// Start (after all module-level consts/functions above are initialized).
if (el.page) init();
