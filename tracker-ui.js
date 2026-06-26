/**
 * SpotterAI — Dashboard UI
 * ============================================================================
 * Renders the gamified tracker: rank card, streak, stat tiles, workout logging,
 * nutrition tracking with target rings, progress charts, and achievements.
 *
 * Pattern: the input forms are static markup (so typing never loses focus);
 * only the read-only display areas are re-rendered on each "spotter:tracker"
 * change event.
 */

import { addBodyweight, addNutrition, addWorkout, deloadCheck, deriveStats, exerciseNamesWithHistory, exerciseProgress, removeEntry, resetAll, setTargets, subscribe, getState } from "./tracker-store.js";
import { barChart, lineChart, ring } from "./charts.js";
import { store } from "./store.js";

const $ = (id) => document.getElementById(id);

// Display containers + forms (present only on pages that include the dashboard).
const els = {
  root: $("dashboard"),
  rank: $("dash-rank"),
  stats: $("dash-stats"),
  weeklyChart: $("chart-weekly"),
  nutrition: $("dash-nutrition"),
  nutritionList: $("nutrition-today-list"),
  nutrition7d: $("chart-nutrition"),
  bwChart: $("chart-bodyweight"),
  bwMeta: $("bodyweight-meta"),
  exPick: $("exercise-progress-pick"),
  exChart: $("chart-exercise"),
  exMeta: $("exercise-progress-meta"),
  deload: $("dash-deload"),
  achievements: $("dash-achievements"),
  recent: $("recent-workouts"),
  // forms
  logForm: $("log-workout-form"),
  lwName: $("lw-name"),
  lwFocus: $("lw-focus"),
  lwExercises: $("lw-exercises"),
  lwAdd: $("lw-add"),
  planPickWrap: $("log-from-plan"),
  planPick: $("plan-day-pick"),
  planLoad: $("plan-day-load"),
  foodForm: $("add-food-form"),
  weightForm: $("add-weight-form"),
  targetsForm: $("targets-form"),
  reset: $("dash-reset"),
};

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
function esc(t) {
  const d = document.createElement("div");
  d.textContent = t == null ? "" : String(t);
  return d.innerHTML;
}
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const ICONS = {
  flag: '<path d="M4 21V4m0 0 4-1 4 1 4-1 4 1v9l-4 1-4-1-4 1-4 1" />',
  flame: '<path d="M12 2s5 4 5 9a5 5 0 0 1-10 0c0-2 1-3 1-3s0 2 2 2c0-3 2-5 2-8z" />',
  dumbbell: '<path d="M6 7v10M3 9v6M18 7v10M21 9v6M6 12h12" />',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />',
  calendar: '<path d="M4 6h16v15H4zM4 10h16M8 3v4M16 3v4" />',
  apple: '<path d="M12 7c0-2 2-4 4-4 0 2-2 4-4 4zm0 0c-3-2-7 0-7 5s4 9 7 9 7-4 7-9-4-7-7-5z" />',
  chart: '<path d="M4 20V4M4 20h16M8 16l4-5 3 3 5-7" />',
};
function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ICONS.chart}</svg>`;
}

// ----------------------------------------------------------------------------
// Toasts (XP / achievement unlocks)
// ----------------------------------------------------------------------------
function toastRoot() {
  let r = $("toast-root");
  if (!r) {
    r = document.createElement("div");
    r.id = "toast-root";
    r.className = "toast-root";
    document.body.appendChild(r);
  }
  return r;
}
function toast(html, kind = "xp") {
  const t = document.createElement("div");
  t.className = `toast toast--${kind}`;
  t.innerHTML = html;
  toastRoot().appendChild(t);
  if (!reducedMotion) requestAnimationFrame(() => t.classList.add("show"));
  else t.classList.add("show");
  setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 300);
  }, 3200);
}
function celebrate(result) {
  if (result?.workout) toast(`<strong>+${result.workout.xp} XP</strong> · ${esc(result.workout.name)} logged`, "xp");
  for (const a of result?.newAchievements || []) toast(`<span class="toast__icon">${icon(a.icon)}</span><div><strong>Achievement unlocked</strong><br>${esc(a.name)} · +${a.xp} XP</div>`, "ach");
}

// ----------------------------------------------------------------------------
// Render (read-only display areas)
// ----------------------------------------------------------------------------
function render() {
  const s = deriveStats();
  renderRank(s);
  renderStats(s);
  renderCharts(s);
  renderExerciseProgress();
  renderDeload();
  renderNutrition(s);
  renderAchievements(s);
  renderRecent(s);
}

// --- Per-exercise progress (estimated 1RM trend) ---------------------------
let exSel = null; // remembered exercise selection
function renderExerciseProgress() {
  if (!els.exChart) return;
  const names = exerciseNamesWithHistory();
  if (els.exPick) {
    if (!names.includes(exSel)) exSel = names[0] || null;
    els.exPick.innerHTML = names.length ? names.map((n) => `<option${n === exSel ? " selected" : ""}>${esc(n)}</option>`).join("") : `<option>No weighted lifts yet</option>`;
    els.exPick.disabled = !names.length;
  }
  if (!exSel) {
    els.exChart.innerHTML = lineChart([], { height: 130 });
    if (els.exMeta) els.exMeta.innerHTML = `<span class="muted">Log a weighted exercise to see its estimated 1RM trend.</span>`;
    return;
  }
  const pts = exerciseProgress(exSel);
  els.exChart.innerHTML = lineChart(pts.map((p) => ({ label: p.label, value: p.e1RM })), { color: "var(--accent)", height: 130 });
  if (els.exMeta) {
    const unit = getState().unit;
    const best = pts.reduce((m, p) => Math.max(m, p.e1RM), 0);
    const top = pts.reduce((m, p) => Math.max(m, p.topWeight), 0);
    els.exMeta.innerHTML = pts.length
      ? `Est. 1RM <strong>${best} ${esc(unit)}</strong> · best set ${top} ${esc(unit)} · ${pts.length} session${pts.length > 1 ? "s" : ""}`
      : `<span class="muted">No weighted sets logged for this lift yet.</span>`;
  }
}

// --- Deload / fatigue flag --------------------------------------------------
let deloadDismissed = false;
function renderDeload() {
  if (!els.deload) return;
  const d = deloadCheck();
  if (!d || !d.recommend || deloadDismissed) {
    els.deload.hidden = true;
    return;
  }
  els.deload.hidden = false;
  els.deload.innerHTML = `
    <span class="deload-flag__icon" aria-hidden="true">⚠️</span>
    <p class="deload-flag__text">${esc(d.reason)}</p>
    <button type="button" class="deload-flag__dismiss" data-act="deload-dismiss" aria-label="Dismiss">×</button>`;
}

function renderRecent(s) {
  if (!els.recent) return;
  els.recent.innerHTML = s.recentWorkouts.length
    ? s.recentWorkouts
        .map(
          (w) => `<li class="workout-row">
            <div class="workout-row__main">
              <span class="workout-row__name">${esc(w.name)}</span>
              ${w.focus ? `<span class="workout-row__focus">${esc(w.focus)}</span>` : ""}
            </div>
            <span class="workout-row__meta">${esc(w.date)}${w.volume ? ` · ${(w.volume / 1000).toFixed(1)}k vol` : ""} · +${w.xp} XP</span>
            <button type="button" class="entry-del" data-id="${w.id}" aria-label="Delete workout">×</button>
          </li>`
        )
        .join("")
    : `<li class="muted">No workouts logged yet — log your first above.</li>`;
}

function renderRank(s) {
  if (!els.rank) return;
  const { tier, next, progress, xpForNext } = s.rank;
  els.rank.innerHTML = `
    <div class="rank-badge" style="--rank:${tier.color}">
      <span class="rank-badge__tier">${esc(tier.name)}</span>
      <span class="rank-badge__level">Lvl ${s.level}</span>
    </div>
    <div class="rank-meta">
      <div class="rank-meta__top">
        <span class="rank-xp">${s.totalXP.toLocaleString()} XP</span>
        <span class="rank-streak" title="Day streak">${icon("flame")} ${s.streakDays}-day streak</span>
      </div>
      <div class="rank-bar"><span style="width:${(progress * 100).toFixed(1)}%; background:${tier.color}"></span></div>
      <p class="rank-next">${next ? `${xpForNext.toLocaleString()} XP to <strong>${esc(next.name)}</strong>` : "Top rank reached — Champion 🏆"}</p>
    </div>`;
}

function renderStats(s) {
  if (!els.stats) return;
  const tiles = [
    { label: "Workouts", value: s.workoutCount },
    { label: "This week", value: `${s.thisWeek.sessions}/${s.thisWeek.target}` },
    { label: "Week volume", value: s.thisWeek.volume ? `${(s.thisWeek.volume / 1000).toFixed(1)}k` : "0" },
    { label: "Day streak", value: s.streakDays },
  ];
  els.stats.innerHTML = tiles.map((t) => `<div class="stat-tile"><span class="stat-tile__value">${esc(t.value)}</span><span class="stat-tile__label">${esc(t.label)}</span></div>`).join("");
}

function renderCharts(s) {
  if (els.weeklyChart) els.weeklyChart.innerHTML = barChart(s.weeklyVolume, { color: "var(--accent)", height: 130 });
  if (els.bwChart) els.bwChart.innerHTML = lineChart(s.bodyweight.series, { color: "#6cb8ff", height: 130 });
  if (els.bwMeta) {
    els.bwMeta.innerHTML = s.bodyweight.latest != null
      ? `<strong>${s.bodyweight.latest} ${esc(s.unit)}</strong>${s.bodyweight.change ? ` · ${s.bodyweight.change > 0 ? "+" : ""}${s.bodyweight.change} ${esc(s.unit)} overall` : ""}`
      : `<span class="muted">Log your weight to see the trend.</span>`;
  }
}

function renderNutrition(s) {
  const n = s.nutritionToday;
  if (els.nutrition) {
    const kcalPct = n.targetKcal ? Math.min(1, n.kcal / n.targetKcal) : 0;
    const protPct = n.targetProtein ? Math.min(1, n.protein / n.targetProtein) : 0;
    els.nutrition.innerHTML = `
      <div class="macro">
        <div class="macro__ring">${ring(n.kcal, n.targetKcal, { color: "var(--accent)", size: 110 })}<div class="macro__center"><span class="macro__val">${n.kcal}</span><span class="macro__sub">/ ${n.targetKcal}</span></div></div>
        <p class="macro__label">Calories</p>
      </div>
      <div class="macro">
        <div class="macro__ring">${ring(n.protein, n.targetProtein, { color: "#6cb8ff", size: 110 })}<div class="macro__center"><span class="macro__val">${n.protein}</span><span class="macro__sub">/ ${n.targetProtein}g</span></div></div>
        <p class="macro__label">Protein</p>
      </div>`;
  }
  if (els.nutrition7d) els.nutrition7d.innerHTML = barChart(s.nutrition7d.map((d) => ({ label: d.label, value: d.kcal })), { color: "var(--accent)", height: 90 });
  if (els.nutritionList) {
    els.nutritionList.innerHTML = n.entries.length
      ? n.entries
          .map((e) => `<li><span>${esc(e.name)}</span><span class="muted">${e.kcal} kcal · ${e.protein}g</span><button type="button" class="entry-del" data-kind="nutrition" data-id="${e.id}" aria-label="Remove">×</button></li>`)
          .join("")
      : `<li class="muted">Nothing logged today.</li>`;
  }
}

function renderAchievements(s) {
  if (!els.achievements) return;
  els.achievements.innerHTML = s.achievements
    .map(
      (a) => `<div class="badge ${a.unlocked ? "is-unlocked" : "is-locked"}" title="${esc(a.desc)}">
        <span class="badge__icon">${a.unlocked ? icon(a.icon) : lockIcon()}</span>
        <span class="badge__name">${esc(a.name)}</span>
        <span class="badge__desc">${esc(a.desc)}</span>
        <span class="badge__xp">+${a.xp} XP</span>
      </div>`
    )
    .join("");
}
function lockIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
}

// ----------------------------------------------------------------------------
// Workout logging form (exercise rows)
// ----------------------------------------------------------------------------
function exerciseRow(prefill = {}) {
  const row = document.createElement("div");
  row.className = "ex-row";
  row.innerHTML = `
    <input class="input lw-ex-name" placeholder="Exercise" value="${esc(prefill.name || "")}" />
    <input class="input lw-ex-sets" type="number" min="0" inputmode="numeric" placeholder="Sets" value="${prefill.sets ?? ""}" />
    <input class="input lw-ex-reps" type="number" min="0" inputmode="numeric" placeholder="Reps" value="${prefill.reps ?? ""}" />
    <input class="input lw-ex-weight" type="number" min="0" inputmode="decimal" placeholder="Wt" value="${prefill.weight ?? ""}" />
    <button type="button" class="ex-row__remove" aria-label="Remove exercise">×</button>`;
  row.querySelector(".ex-row__remove").addEventListener("click", () => row.remove());
  return row;
}

function collectExercises() {
  return [...els.lwExercises.querySelectorAll(".ex-row")]
    .map((r) => ({
      name: r.querySelector(".lw-ex-name").value.trim(),
      sets: r.querySelector(".lw-ex-sets").value,
      reps: r.querySelector(".lw-ex-reps").value,
      weight: r.querySelector(".lw-ex-weight").value,
    }))
    .filter((e) => e.name);
}

// Load a plan day into the form for quick logging.
function refreshPlanPicker() {
  if (!els.planPickWrap) return;
  const plan = store.plan;
  if (!plan || !Array.isArray(plan.days) || !plan.days.length) {
    els.planPickWrap.hidden = true;
    return;
  }
  els.planPickWrap.hidden = false;
  els.planPick.innerHTML = plan.days
    .map((d, i) => `<option value="${i}">${esc(d.day ? d.day + " · " : "")}${esc(d.focus || "Session")}</option>`)
    .join("");
}

function loadPlanDay() {
  const plan = store.plan;
  const i = Number(els.planPick.value);
  const day = plan?.days?.[i];
  if (!day) return;
  els.lwName.value = `${day.focus || "Session"}`;
  els.lwFocus.value = day.focus || "";
  els.lwExercises.innerHTML = "";
  for (const ex of day.exercises || []) {
    const repsNum = parseInt(String(ex.reps).match(/\d+/)?.[0] || "", 10);
    els.lwExercises.appendChild(exerciseRow({ name: ex.name, sets: ex.sets || "", reps: Number.isFinite(repsNum) ? repsNum : "" }));
  }
  if (!els.lwExercises.children.length) els.lwExercises.appendChild(exerciseRow());
  els.lwName.focus();
}

// ----------------------------------------------------------------------------
// Init / wiring
// ----------------------------------------------------------------------------
function init() {
  // Workout form
  if (els.lwExercises && !els.lwExercises.children.length) els.lwExercises.appendChild(exerciseRow());
  els.lwAdd?.addEventListener("click", () => els.lwExercises.appendChild(exerciseRow()));
  els.logForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    const exercises = collectExercises();
    const result = addWorkout({ name: els.lwName.value.trim() || "Workout", focus: els.lwFocus.value.trim(), exercises });
    celebrate(result);
    els.logForm.reset();
    els.lwExercises.innerHTML = "";
    els.lwExercises.appendChild(exerciseRow());
  });

  // Plan-day quick load
  els.planLoad?.addEventListener("click", loadPlanDay);
  refreshPlanPicker();
  window.addEventListener("spotter:plan", refreshPlanPicker);

  // Nutrition
  els.foodForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(els.foodForm);
    if (!String(fd.get("name") || "").trim() && !fd.get("kcal")) return;
    addNutrition({ name: fd.get("name"), kcal: fd.get("kcal"), protein: fd.get("protein") });
    els.foodForm.reset();
  });

  // Bodyweight
  els.weightForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = new FormData(els.weightForm).get("value");
    if (v) addBodyweight({ value: v });
    els.weightForm.reset();
  });

  // Targets
  els.targetsForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(els.targetsForm);
    setTargets({
      kcal: Number(fd.get("kcal")) || getState().targets.kcal,
      protein: Number(fd.get("protein")) || getState().targets.protein,
      weeklyWorkouts: Number(fd.get("weekly")) || getState().targets.weeklyWorkouts,
    });
    toast("<strong>Targets updated</strong>", "xp");
  });
  // Prefill targets inputs from saved state
  if (els.targetsForm) {
    const t = getState().targets;
    els.targetsForm.querySelector('[name="kcal"]').value = t.kcal;
    els.targetsForm.querySelector('[name="protein"]').value = t.protein;
    els.targetsForm.querySelector('[name="weekly"]').value = t.weeklyWorkouts;
  }

  // Per-exercise progress picker
  els.exPick?.addEventListener("change", () => {
    exSel = els.exPick.value;
    renderExerciseProgress();
  });
  // Deload flag dismiss
  els.deload?.addEventListener("click", (e) => {
    if (e.target.closest('[data-act="deload-dismiss"]')) {
      deloadDismissed = true;
      els.deload.hidden = true;
    }
  });

  // Delete nutrition entries (event delegation)
  els.nutritionList?.addEventListener("click", (e) => {
    const btn = e.target.closest(".entry-del");
    if (btn) removeEntry(btn.dataset.kind, btn.dataset.id);
  });
  // Delete logged workouts
  els.recent?.addEventListener("click", (e) => {
    const btn = e.target.closest(".entry-del");
    if (btn) removeEntry("workouts", btn.dataset.id);
  });

  // Reset
  els.reset?.addEventListener("click", () => {
    if (confirm("Reset all tracked workouts, nutrition, and progress? This can't be undone.")) {
      resetAll();
      toast("<strong>Tracker reset</strong>", "xp");
    }
  });

  subscribe(render);
  render();
}

// Start the dashboard (after all consts/functions above are initialized).
if (els.root) init();
