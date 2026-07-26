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

import { addCustomFood, addNutrition, addWater, copyMeal, deriveStats, getCustomFoods, getMealTemplates, getRecentFoods, getState, getWater, logMealTemplate, removeEntry, removeMealTemplate, resetAll, saveMealTemplate, setTargets, subscribe, updateNutrition } from "./tracker-store.js";
import { lookupBarcode, searchFoods, searchOpenFoodFacts } from "./foods.js";
import { estimateFood, estimateMealPhoto } from "./ai.js";
import { ring } from "./charts.js";
import { evaluateNutrition, NUTRITION_DISCLAIMER, NUTRITION_WONT_DO } from "./nutrition-safety.js";
import { store } from "./store.js";
import { trackFunnel } from "./analytics.js";
import { aiFailureMessage, classifyAiFailure } from "./ai-errors.js";

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
  safety: $("nutrition-safety"),
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
let aiController = null;
let lastPhotoFile = null;

function photoFailureClass(error) {
  return classifyAiFailure(error, { online: navigator.onLine });
}

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
  renderNutritionSafety();
}

// --- Nutrition safety guardrails + Trust Report ----------------------------
const TIER_LABEL = { critical: "Critical", warning: "Warning" };

function renderNutritionSafety() {
  if (!el.safety) return;
  const s = deriveStats();
  const { flags, trust } = evaluateNutrition({
    targets: getState().targets,
    bodyweight: s.bodyweight?.latest ?? null,
    unit: s.unit,
    goal: store.inputs?.goal || "",
  });

  const verdict = flags.some((f) => f.tier === "critical")
    ? { tone: "critical", text: "An aggressive target needs review" }
    : flags.length
    ? { tone: "warning", text: `${flags.length} target${flags.length > 1 ? "s" : ""} to review` }
    : { tone: "ok", text: "Your targets look reasonable" };

  const flagCards = flags
    .map(
      (f) => `<article class="flag flag--${f.tier}">
        <header class="flag__head"><span class="flag__sev">${TIER_LABEL[f.tier]}</span><span class="flag__label">${esc(f.label)}</span></header>
        <p class="flag__why">${esc(f.why)}</p>
        <p class="flag__row"><span class="flag__row-label">Safer suggestion</span> ${esc(f.fix)}</p>
      </article>`
    )
    .join("");

  const list = (arr, empty) => (arr.length ? `<ul class="trust__list">${arr.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<span class="muted">${empty}</span>`);
  const row = (dt, dd) => `<div class="trust__row"><dt>${dt}</dt><dd>${dd}</dd></div>`;

  el.safety.innerHTML = `
    <div class="card audit nut-safety">
      <div class="audit__head">
        <div class="audit__headline">
          <p class="audit__eyebrow"><span class="eyebrow__dot" aria-hidden="true"></span> Nutrition safety · deterministic</p>
          <h3 class="audit__verdict is-${verdict.tone}">${esc(verdict.text)}</h3>
        </div>
      </div>
      <div class="audit__flags">${flagCards || `<p class="audit__clear">No safety flags on your current targets. These are conservative checks, not a personalized diet.</p>`}</div>
      <details class="card trust nut-trust">
        <summary class="trust__summary">
          <span class="trust__title">Nutrition Trust Report</span>
          <span class="trust__conf trust__conf--${trust.confidence.toLowerCase()}">Confidence: ${trust.confidence}</span>
        </summary>
        <div class="trust__body">
          <dl class="trust__grid">
            ${row("Goal", esc(trust.goal))}
            ${row("Calorie target", trust.kcalTarget ? `${trust.kcalTarget} kcal` : "-")}
            ${row("Protein target", trust.proteinTarget ? `${trust.proteinTarget} g` : "-")}
            ${row("Fat target", trust.fatTarget ? `${trust.fatTarget} g` : "-")}
            ${row("Confidence", `${trust.confidence}: ${esc(trust.whyLimited)}`)}
          </dl>
          <div class="trust__block"><h5>Safer target range</h5><span class="muted">${esc(trust.saferSuggestion)}</span></div>
          <div class="trust__block"><h5>What data was used</h5>${list(trust.dataUsed, "-")}</div>
          <div class="trust__block"><h5>What's missing</h5>${list(trust.dataMissing, "Nothing major.")}</div>
          <p class="trust__disclaimer">${esc(NUTRITION_DISCLAIMER)}</p>
        </div>
      </details>

      <div class="nut-wontdo">
        <div class="nut-wontdo__col nut-wontdo__col--no">
          <h5>What SpotterAI will not do with nutrition</h5>
          <ul>${NUTRITION_WONT_DO.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
        </div>
        <div class="nut-wontdo__col nut-wontdo__col--yes">
          <h5>What it focuses on instead</h5>
          <p>Sustainable habits: regular meals, protein consistency, hydration, moderate targets, and progress trends, not rapid weight loss or extreme restriction.</p>
        </div>
      </div>
    </div>`;
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
        ${macroRow("Protein", c.protein, t.protein, "#6b8fa3")}
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

function ymdAdd(ymdStr, days) {
  const d = new Date(ymdStr + "T12:00:00"); // noon avoids DST edge-cases
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function renderMeals(entries) {
  if (!el.meals) return;
  const yest = ymdAdd(selected, -1);
  const all = getState().nutrition || [];
  el.meals.innerHTML = MEALS.map(([id, label]) => {
    const items = entries.filter((e) => (e.meal || "snacks") === id);
    const kcal = Math.round(items.reduce((v, e) => v + e.kcal, 0));
    const yestCount = all.filter((e) => e.date === yest && (e.meal || "snacks") === id).length;
    // Empty meal + logged yesterday → one-tap repeat. Has items → save as reusable.
    const act = !items.length && yestCount
      ? `<button type="button" class="meal__act" data-act="copy-yest" data-meal="${id}" title="Log the same as yesterday">⟳ Yesterday</button>`
      : items.length
      ? `<button type="button" class="meal__act" data-act="save-meal" data-meal="${id}" title="Save this meal to log in one tap">Save meal</button>`
      : "";
    const rows = items
      .map(
        (e) => `<li class="food-row" data-id="${e.id}">
          <button type="button" class="food-row__main" data-act="edit-food" title="Edit">
            <span class="food-row__name">${esc(e.name)}</span><span class="food-row__sub">${esc(formatQty(e))} · ${e.protein}P ${e.carbs || 0}C ${e.fat || 0}F</span>
          </button>
          <span class="food-row__kcal">${e.kcal}</span>
          <button type="button" class="food-row__del" data-act="del-food" aria-label="Remove">×</button>
        </li>`
      )
      .join("");
    return `<div class="meal">
      <div class="meal__head"><h4 class="meal__name">${label}</h4><span class="meal__head-right">${act}<span class="meal__kcal">${kcal} kcal</span></span></div>
      <ul class="meal__list">${rows || '<li class="muted meal__empty">No food logged.</li>'}</ul>
      <button type="button" class="meal__add" data-act="add-food" data-meal="${id}">+ Add food</button>
    </div>`;
  }).join("");
}

/** Swap a diary row for a compact inline editor (name + totals). */
function openRowEditor(li) {
  const id = li.dataset.id;
  const e = (getState().nutrition || []).find((x) => x.id === id);
  if (!e) return;
  li.classList.add("is-editing");
  li.innerHTML = `
    <form class="food-edit" data-id="${esc(id)}">
      <input class="input input--sm food-edit__name" name="name" value="${esc(e.name)}" aria-label="Food name" />
      <div class="food-edit__grid">
        <label>kcal<input class="input input--sm" name="kcal" type="number" min="0" inputmode="numeric" value="${Math.round(e.kcal)}" /></label>
        <label>P<input class="input input--sm" name="protein" type="number" min="0" inputmode="decimal" value="${e.protein || 0}" /></label>
        <label>C<input class="input input--sm" name="carbs" type="number" min="0" inputmode="decimal" value="${e.carbs || 0}" /></label>
        <label>F<input class="input input--sm" name="fat" type="number" min="0" inputmode="decimal" value="${e.fat || 0}" /></label>
      </div>
      <div class="food-edit__acts">
        <button type="submit" class="btn btn--primary btn--sm">Save</button>
        <button type="button" class="btn-link" data-act="edit-cancel">Cancel</button>
      </div>
    </form>`;
  li.querySelector(".food-edit__name")?.focus();
}
function formatQty(e) {
  if (e.unit) return `${e.qty || 1} × ${e.unit}`;
  return e.qty && e.qty !== 1 ? `${e.qty} servings` : "1 serving";
}

const ML_PER_OZ = 29.5735;
const isImperial = () => getState().unit === "lb";
const waterStepMl = () => (isImperial() ? 240 : 250); // ~8 fl oz
const fmtWater = (ml) => (isImperial() ? `${Math.round(ml / ML_PER_OZ)} fl oz` : `${Math.round(ml)} ml`);

function renderWater() {
  if (!el.water) return;
  const imperial = isImperial();
  const ml = getWater(selected);
  const target = getState().targets.waterMl || 2500;
  const glasses = Math.round(ml / 250);
  el.water.innerHTML = `
    <div class="water__info"><span class="water__amt">${fmtWater(ml)}</span><span class="muted"> / ${fmtWater(target)} · ~${glasses} glasses</span></div>
    <div class="water__bar"><span style="width:${Math.min(100, (ml / target) * 100).toFixed(0)}%"></span></div>
    <div class="water__btns">
      <button type="button" class="btn btn--ghost btn--sm" data-act="water-minus">− ${imperial ? "8 oz" : "250"}</button>
      <button type="button" class="btn btn--ghost btn--sm" data-act="water-plus">+ ${imperial ? "8 oz" : "250 ml"}</button>
      <span class="water__custom">
        <input id="water-custom" class="water-custom" type="number" min="1" max="3000" inputmode="numeric" placeholder="${imperial ? "oz" : "ml"}" aria-label="Custom water amount" />
        <button type="button" class="btn btn--ghost btn--sm" data-act="water-custom">Add</button>
      </span>
    </div>`;
}

// Custom amount → ml (the canonical storage unit).
function customWaterMl(value) {
  const v = Number(value) || 0;
  if (v <= 0) return 0;
  return isImperial() ? Math.round(v * ML_PER_OZ) : Math.round(v);
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
  if (aiController) aiController.abort();
  aiController = null;
  lastPhotoFile = null;
  stopBarcodeScan();
}

// ----------------------------------------------------------------------------
// Barcode scanner (built-in BarcodeDetector + Open Food Facts — $0, no deps)
// ----------------------------------------------------------------------------
let scanStream = null;
let scanTimer = null;

function stopBarcodeScan() {
  clearInterval(scanTimer);
  scanTimer = null;
  if (scanStream) {
    scanStream.getTracks().forEach((t) => t.stop());
    scanStream = null;
  }
}

async function startBarcodeScan() {
  el.results.hidden = true;
  el.search.parentElement.hidden = true;
  el.detail.hidden = false;
  el.detail.innerHTML = `
    <button type="button" class="detail-back" data-act="detail-back">← Back</button>
    <div class="scan-box">
      <video id="scan-video" class="scan-box__video" playsinline muted></video>
      <div class="scan-box__frame" aria-hidden="true"></div>
      <p class="scan-box__hint" id="scan-hint">Point the camera at the barcode…</p>
    </div>`;
  const hint = () => document.getElementById("scan-hint");
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    const video = document.getElementById("scan-video");
    if (!video) return stopBarcodeScan(); // user backed out during the permission prompt
    video.srcObject = scanStream;
    await video.play();
    const detector = new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] });
    let busy = false;
    scanTimer = setInterval(async () => {
      if (busy || !scanStream) return;
      busy = true;
      try {
        const codes = await detector.detect(video);
        const code = codes?.[0]?.rawValue;
        if (code) {
          stopBarcodeScan();
          if (hint()) hint().textContent = `Found ${code}, looking it up…`;
          const food = await lookupBarcode(code).catch(() => null);
          if (food) showDetail(food);
          else showDetail(null, true, { name: "", note: `Barcode ${code} isn't in Open Food Facts (or has no calorie data). Add it manually.` });
        }
      } catch {
        /* detector hiccup on a frame — keep scanning */
      }
      busy = false;
    }, 280);
  } catch {
    stopBarcodeScan();
    if (hint()) hint().textContent = "Couldn't access the camera. Check permissions, or add the food by search instead.";
  }
}

function foodOptHtml(f, source) {
  return `<li><button type="button" class="food-opt" data-food='${esc(JSON.stringify(f))}'>
    <span class="food-opt__main"><span class="food-opt__name">${esc(f.name)}</span><span class="food-opt__sub">${esc(f.serving || "")} · ${f.kcal} kcal</span></span>
    <span class="food-opt__tag">${source}</span>
  </button></li>`;
}

function renderResults(q) {
  const builtin = searchFoods(q, 25, getCustomFoods());
  const query = q.trim();
  let html = "";
  // Snap a meal: estimate macros from a photo (Gemini vision).
  html += `<li><button type="button" class="food-opt food-opt--ai" data-act="snap-meal">
    <span class="food-opt__main"><span class="food-opt__name">Snap a meal: macros from a photo</span><span class="food-opt__sub">use your camera to estimate calories</span></span>
    <span class="food-opt__tag food-opt__tag--ai">AI</span></button></li>`;
  // Barcode scan — only where the browser has a built-in detector (Chrome/Edge/Android).
  if ("BarcodeDetector" in window) {
    html += `<li><button type="button" class="food-opt food-opt--ai" data-act="scan-barcode">
      <span class="food-opt__main"><span class="food-opt__name">Scan a barcode</span><span class="food-opt__sub">packaged food → exact label data (Open Food Facts)</span></span>
      <span class="food-opt__tag">|||</span></button></li>`;
  }
  // Estimate-anything: turn whatever the user typed into macros via the AI.
  if (query) {
    html += `<li><button type="button" class="food-opt food-opt--ai" data-act="ai-estimate">
      <span class="food-opt__main"><span class="food-opt__name">Estimate “${esc(query)}” with AI</span><span class="food-opt__sub">calories &amp; macros for anything you type</span></span>
      <span class="food-opt__tag food-opt__tag--ai">AI</span></button></li>`;
  } else {
    // Saved meals — log a whole meal in one tap.
    const templates = getMealTemplates();
    if (templates.length) {
      html += `<li class="food-grouplabel">My meals</li>` + templates
        .map((t) => {
          const kcal = Math.round(t.items.reduce((s, i) => s + (i.kcal || 0), 0));
          return `<li class="food-tpl">
            <button type="button" class="food-opt" data-act="log-template" data-id="${esc(t.id)}">
              <span class="food-opt__main"><span class="food-opt__name">${esc(t.name)}</span><span class="food-opt__sub">${t.items.length} item${t.items.length === 1 ? "" : "s"} · ${kcal} kcal · logs all in one tap</span></span>
              <span class="food-opt__tag">⟳</span>
            </button>
            <button type="button" class="food-tpl__del" data-act="del-template" data-id="${esc(t.id)}" aria-label="Delete saved meal">×</button>
          </li>`;
        })
        .join("");
    }
    const recent = getRecentFoods(8);
    if (recent.length) html += `<li class="food-grouplabel">Recent</li>` + recent.map((f) => foodOptHtml({ ...f, serving: f.unit || "1 serving" }, "recent")).join("");
    html += `<li class="food-grouplabel">Common foods</li>`;
  }
  html += builtin.map((f) => foodOptHtml(f, f.kcal ? "" : "")).join("");
  html += `<li><button type="button" class="food-opt food-opt--quick" data-act="quick-add"><span class="food-opt__main"><span class="food-opt__name">Quick add</span><span class="food-opt__sub">enter calories &amp; macros manually</span></span><span class="food-opt__tag">+</span></button></li>`;
  el.results.innerHTML = html;

  // Online lookup (debounced via the input handler; this just kicks it off).
  if (query.length >= 2) searchOnline(query);
}

// AI estimate: ask the server to turn the free-text food into macros, then show
// the normal serving detail (editable by servings). Falls back to manual quick
// add if the AI is unavailable (e.g. static preview with no backend).
async function aiEstimate(query) {
  if (!query) return;
  if (aiController) aiController.abort();
  if (offController) offController.abort();
  const controller = new AbortController();
  aiController = controller;
  showDetailLoading(query);
  try {
    const food = await estimateFood(query, controller.signal);
    if (aiController !== controller) return;
    showDetail(food);
  } catch (e) {
    if (aiController !== controller || e.name === "AbortError") return;
    const failureClass = photoFailureClass(e);
    showDetail(null, true, { name: query, note: `${aiFailureMessage("food", failureClass, { fallback: true })} Enter the macros yourself.` });
  } finally {
    if (aiController === controller) aiController = null;
  }
}

function showDetailLoading(query) {
  el.search.parentElement.hidden = true;
  el.results.hidden = true;
  el.detail.hidden = false;
  el.detail.innerHTML = `
    <button type="button" class="detail-back" data-act="detail-back">← Back</button>
    <div class="detail-loading">
      <span class="spinner" aria-hidden="true"></span>
      <p>Estimating <strong>${esc(query)}</strong>…</p>
      <p class="muted">Asking the AI for calories &amp; macros.</p>
    </div>`;
}

// Snap a meal: estimate macros from a photo. Downscale client-side first so the
// upload stays small, then reuse the normal serving detail (or fall back to a
// manual quick add if the AI is unavailable).
async function handlePhoto(file) {
  if (!file || !file.type.startsWith("image/")) return;
  lastPhotoFile = file;
  if (aiController) aiController.abort();
  if (offController) offController.abort();
  const controller = new AbortController();
  aiController = controller;
  showDetailLoading("your meal photo");
  try {
    const dataUrl = await fileToScaledDataUrl(file);
    if (aiController !== controller) return;
    const food = await estimateMealPhoto(dataUrl, controller.signal);
    if (aiController !== controller) return;
    showDetail(food);
    lastPhotoFile = null;
    trackFunnel("meal_photo_succeeded");
  } catch (e) {
    if (aiController !== controller || e.name === "AbortError") return;
    const failureClass = photoFailureClass(e);
    showDetail(null, true, {
      name: "",
      note: `${aiFailureMessage("photo", failureClass, { fallback: true })} Add the food manually, or try this photo again.`,
      retryPhoto: true,
    });
    trackFunnel("meal_photo_failed", { failure_class: failureClass });
  } finally {
    if (aiController === controller) aiController = null;
  }
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not load image"));
    };
    img.src = url;
  });
}

async function fileToScaledDataUrl(file, maxDim = 1024, quality = 0.72) {
  const img = await loadImage(file);
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", quality);
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
function showDetail(food, quick = false, opts = {}) {
  detailFood = food;
  el.search.parentElement.hidden = true;
  el.results.hidden = true;
  el.detail.hidden = false;
  const mealOpts = MEALS.map(([id, label]) => `<option value="${id}" ${id === pickerMeal ? "selected" : ""}>${label}</option>`).join("");
  if (quick) {
    el.detail.innerHTML = `
      <button type="button" class="detail-back" data-act="detail-back">← Back</button>
      ${opts.note ? `<p class="detail-note">${esc(opts.note)}</p>` : ""}
      <input id="qa-name" class="input" placeholder="Food name" autocomplete="off" value="${esc(opts.name || "")}" />
      <div class="detail-grid">
        <label class="field-label-sm">Calories<input id="qa-kcal" class="input" type="number" inputmode="numeric" /></label>
        <label class="field-label-sm">Protein (g)<input id="qa-protein" class="input" type="number" inputmode="decimal" /></label>
        <label class="field-label-sm">Carbs (g)<input id="qa-carbs" class="input" type="number" inputmode="decimal" /></label>
        <label class="field-label-sm">Fat (g)<input id="qa-fat" class="input" type="number" inputmode="decimal" /></label>
      </div>
      <label class="field-label-sm">Meal<select id="detail-meal" class="form-select">${mealOpts}</select></label>
      ${opts.retryPhoto ? `<div class="detail-recovery"><button type="button" class="btn btn--ghost btn--block" data-act="retry-photo">Try this photo again</button></div>` : ""}
      <button type="button" class="btn btn--primary btn--block" data-act="quick-save">Add</button>`;
    setTimeout(() => (opts.name ? $("qa-kcal") : $("qa-name"))?.focus(), 0);
    return;
  }
  const ai = food.source === "ai";
  const rangeHint = ai && food.kcalLow && food.kcalHigh ? ` AI range ${food.kcalLow}–${food.kcalHigh} kcal.` : "";
  el.detail.innerHTML = `
    <button type="button" class="detail-back" data-act="detail-back">← Back</button>
    <p class="detail-food">${esc(food.name)}<span class="muted"> · per ${esc(food.serving || "serving")}</span></p>
    ${ai ? `<p class="detail-uncertainty"><strong>AI estimate: these vary a lot.</strong>${esc(rangeHint)} Tweak the numbers below to match what you actually ate before saving.</p>` : ""}
    ${ai ? `<div class="detail-grid">
      <label class="field-label-sm">Calories<input id="detail-kcal" class="input" type="number" min="0" inputmode="numeric" value="${Math.round(food.kcal)}" /></label>
      <label class="field-label-sm">Protein (g)<input id="detail-protein" class="input" type="number" min="0" inputmode="decimal" value="${round1(food.protein)}" /></label>
      <label class="field-label-sm">Carbs (g)<input id="detail-carbs" class="input" type="number" min="0" inputmode="decimal" value="${round1(food.carbs)}" /></label>
      <label class="field-label-sm">Fat (g)<input id="detail-fat" class="input" type="number" min="0" inputmode="decimal" value="${round1(food.fat)}" /></label>
    </div>` : ""}
    <div class="detail-qty">
      <label class="field-label-sm">Servings<input id="detail-qty" class="input input--sm" type="number" min="0" step="0.25" value="1" inputmode="decimal" /></label>
      <label class="field-label-sm">Meal<select id="detail-meal" class="form-select">${mealOpts}</select></label>
    </div>
    <div id="detail-preview" class="detail-preview"></div>
    <button type="button" class="btn btn--primary btn--block" data-act="detail-save">Add to diary</button>`;
  updatePreview();
  ["detail-qty", "detail-kcal", "detail-protein", "detail-carbs", "detail-fat"].forEach((id) => $(id)?.addEventListener("input", updatePreview));
}
// Per-serving macros to log: the user's edited values for an AI estimate, else
// the food's stored values.
function detailMacros() {
  const f = detailFood;
  if (f && f.source === "ai" && $("detail-kcal")) {
    return {
      kcal: Number($("detail-kcal").value) || 0,
      protein: Number($("detail-protein").value) || 0,
      carbs: Number($("detail-carbs").value) || 0,
      fat: Number($("detail-fat").value) || 0,
    };
  }
  return { kcal: f.kcal, protein: f.protein, carbs: f.carbs, fat: f.fat };
}
function updatePreview() {
  const q = Number($("detail-qty")?.value) || 0;
  const m = detailMacros();
  const p = $("detail-preview");
  if (!p || !detailFood) return;
  p.innerHTML = `<span class="detail-cal">${Math.round(m.kcal * q)} kcal</span><span class="muted">${round1(m.protein * q)}P · ${round1(m.carbs * q)}C · ${round1(m.fat * q)}F</span>`;
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
    const edit = e.target.closest('[data-act="edit-food"]');
    const copyYest = e.target.closest('[data-act="copy-yest"]');
    const saveMeal = e.target.closest('[data-act="save-meal"]');
    if (add) openPicker(add.dataset.meal);
    else if (del) removeEntry("nutrition", del.closest(".food-row").dataset.id);
    else if (edit) openRowEditor(edit.closest(".food-row"));
    else if (e.target.closest('[data-act="edit-cancel"]')) render();
    else if (copyYest) {
      copyMeal({ meal: copyYest.dataset.meal, date: selected }); // re-renders via spotter:tracker
    } else if (saveMeal) {
      const meal = saveMeal.dataset.meal;
      const items = (getState().nutrition || []).filter((x) => x.date === selected && (x.meal || "snacks") === meal);
      const label = MEALS.find((m) => m[0] === meal)?.[1] || "Meal";
      const name = prompt("Name this meal (it'll appear at the top of “Add food” to log in one tap):", `My usual ${label.toLowerCase()}`);
      if (name == null) return;
      saveMealTemplate({ name: name || `My ${label}`, entries: items });
      render();
    }
  });
  // Inline row editor → save the edited totals in place.
  el.meals?.addEventListener("submit", (e) => {
    const form = e.target.closest(".food-edit");
    if (!form) return;
    e.preventDefault();
    const fd = new FormData(form);
    updateNutrition(form.dataset.id, {
      name: fd.get("name"),
      kcal: fd.get("kcal"),
      protein: fd.get("protein"),
      carbs: fd.get("carbs"),
      fat: fd.get("fat"),
    }); // persist() fires spotter:tracker → re-render
  });
  el.water?.addEventListener("click", (e) => {
    if (e.target.closest('[data-act="water-plus"]')) addWater(waterStepMl(), selected);
    else if (e.target.closest('[data-act="water-minus"]')) addWater(-waterStepMl(), selected);
    else if (e.target.closest('[data-act="water-custom"]')) {
      const inp = document.getElementById("water-custom");
      const ml = customWaterMl(inp?.value);
      if (ml > 0) addWater(ml, selected); // re-render clears the field
    }
  });
  // Enter in the custom field adds it too.
  el.water?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.id === "water-custom") {
      e.preventDefault();
      const ml = customWaterMl(e.target.value);
      if (ml > 0) addWater(ml, selected);
    }
  });

  // Picker
  el.pickerClose?.addEventListener("click", closePicker);
  el.picker?.addEventListener("click", (e) => {
    if (e.target === el.picker) closePicker();
  });

  // Hidden file input that powers "Snap a meal" (opens the camera on mobile).
  el.photoInput = document.createElement("input");
  el.photoInput.type = "file";
  el.photoInput.accept = "image/*";
  el.photoInput.setAttribute("capture", "environment");
  el.photoInput.hidden = true;
  el.picker?.appendChild(el.photoInput);
  el.photoInput.addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) handlePhoto(f);
  });
  el.search?.addEventListener("input", () => renderResults(el.search.value));
  el.results?.addEventListener("click", (e) => {
    if (e.target.closest('[data-act="snap-meal"]')) return el.photoInput?.click();
    if (e.target.closest('[data-act="scan-barcode"]')) return startBarcodeScan();
    if (e.target.closest('[data-act="ai-estimate"]')) return aiEstimate(el.search.value.trim());
    if (e.target.closest('[data-act="quick-add"]')) return showDetail(null, true);
    const tpl = e.target.closest('[data-act="log-template"]');
    if (tpl) {
      logMealTemplate(tpl.dataset.id, pickerMeal, selected);
      return closePicker();
    }
    const delTpl = e.target.closest('[data-act="del-template"]');
    if (delTpl) {
      if (confirm("Delete this saved meal?")) {
        removeMealTemplate(delTpl.dataset.id);
        renderResults(el.search.value);
      }
      return;
    }
    const opt = e.target.closest(".food-opt");
    if (opt?.dataset.food) showDetail(JSON.parse(opt.dataset.food));
  });
  el.detail?.addEventListener("click", (e) => {
    if (e.target.closest('[data-act="detail-back"]')) {
      if (aiController) aiController.abort();
      aiController = null;
      lastPhotoFile = null;
      stopBarcodeScan();
      el.detail.hidden = true;
      el.results.hidden = false;
      el.search.parentElement.hidden = false;
    } else if (e.target.closest('[data-act="retry-photo"]')) {
      if (lastPhotoFile) handlePhoto(lastPhotoFile);
    } else if (e.target.closest('[data-act="detail-save"]')) {
      const qty = Number($("detail-qty").value) || 1;
      const f = detailFood;
      const meal = $("detail-meal").value;
      const m = detailMacros(); // edited per-serving values for AI estimates
      addNutrition({ name: f.name, meal, qty, unit: f.serving || "serving", kcal: m.kcal * qty, protein: m.protein * qty, carbs: m.carbs * qty, fat: m.fat * qty, date: selected });
      if (f.source === "off" || f.source === "ai") addCustomFood({ ...f, ...m }); // remember with the corrected macros
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
