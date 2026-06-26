/**
 * SpotterAI — Dashboard + Progress read-only UI
 * ============================================================================
 * Renders the gamified display areas: rank card, stat tiles, achievements, the
 * deload flag (Dashboard), and the weekly-volume / bodyweight / per-exercise
 * charts (Progress) — plus the small "log bodyweight" form.
 *
 * Workout logging lives in workout-ui.js (Hevy-style session), the food diary in
 * nutrition-ui.js, and natural-language logging in quick-log.js. This module only
 * reads: it re-renders on every "spotter:tracker" change.
 */

import { addBodyweight, deloadCheck, deriveStats, exerciseNamesWithHistory, exerciseProgress, getState, subscribe } from "./tracker-store.js";
import { barChart, lineChart } from "./charts.js";

const $ = (id) => document.getElementById(id);

const els = {
  root: $("dashboard"),
  rank: $("dash-rank"),
  stats: $("dash-stats"),
  deload: $("dash-deload"),
  achievements: $("dash-achievements"),
  // Progress page
  weeklyChart: $("chart-weekly"),
  bwChart: $("chart-bodyweight"),
  bwMeta: $("bodyweight-meta"),
  exPick: $("exercise-progress-pick"),
  exChart: $("chart-exercise"),
  exMeta: $("exercise-progress-meta"),
  weightForm: $("add-weight-form"),
};

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
function esc(t) {
  const d = document.createElement("div");
  d.textContent = t == null ? "" : String(t);
  return d.innerHTML;
}

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
// Render
// ----------------------------------------------------------------------------
function render() {
  const s = deriveStats();
  renderRank(s);
  renderStats(s);
  renderCharts(s);
  renderExerciseProgress();
  renderDeload();
  renderAchievements(s);
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

// Per-exercise estimated-1RM trend (Progress page)
let exSel = null;
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

// Deload / fatigue flag (Dashboard)
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
// Init / wiring
// ----------------------------------------------------------------------------
function init() {
  // Log bodyweight (Progress page)
  els.weightForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = new FormData(els.weightForm).get("value");
    if (v) addBodyweight({ value: v });
    els.weightForm.reset();
  });

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

  subscribe(render);
  render();
}

// Start (after all consts/functions above are initialized).
if (els.root) init();
