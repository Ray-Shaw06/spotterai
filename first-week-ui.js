/**
 * SpotterAI — first-week guided experience UI
 * ============================================================================
 * Renders a gentle day-by-day card (and a Day-7 review) at the top of the Today
 * screen for new users. Starts the clock when a plan first exists, auto-checks
 * the day's checklist from real logs, and is dismissible (non-annoying).
 */

import { dayContent, weekOneReview, FIRST_WEEK_DAYS } from "./first-week.js";
import { store } from "./store.js";
import { deriveStats, getState, getWater, getPainReports } from "./tracker-store.js";

const mount = document.getElementById("first-week");
const KEY = "spotterai_firstweek";

function esc(t) {
  const d = document.createElement("div");
  d.textContent = t == null ? "" : String(t);
  return d.innerHTML;
}
const ymd = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function daysBetween(a, b) {
  return Math.floor((Date.parse(b + "T00:00") - Date.parse(a + "T00:00")) / 86400000);
}

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; }
}
function persist(v) {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {}
}

/** Stat-derived checklist booleans for the current day. */
function checks() {
  const s = deriveStats();
  const today = ymd();
  const workoutToday = (s.recentWorkouts || []).some((w) => w.date === today);
  const ratedToday = (s.recentWorkouts || []).some((w) => w.date === today && w.difficulty);
  const ratedRecently = (s.recentWorkouts || []).slice(0, 4).some((w) => w.difficulty);
  const todays = (getState().nutrition || []).filter((e) => e.date === today);
  const proteinToday = todays.reduce((p, e) => p + (e.protein || 0), 0) >= (getState().targets.protein || 0) && (getState().targets.protein || 0) > 0;
  const mealToday = todays.length > 0;
  const bwToday = (deriveStats().bodyweight?.series || []).some((b) => b.date === today);
  return {
    hasPlan: !!store.plan,
    workoutToday,
    ratedToday,
    ratedRecently,
    loggedToday: mealToday || bwToday,
    proteinToday,
    waterToday: getWater(today) >= (getState().targets.waterMl || 2500),
  };
}

function render() {
  if (!mount) return;
  const st = load();
  // Only runs for users with a plan; starts the clock the first time we see one.
  if (!store.plan || st.dismissed) { mount.innerHTML = ""; return; }
  if (!st.start) { st.start = ymd(); persist(st); }

  const dayIndex = daysBetween(st.start, ymd());
  if (dayIndex < 0) { mount.innerHTML = ""; return; }

  mount.innerHTML = dayIndex >= FIRST_WEEK_DAYS.length ? reviewCard() : dayCard(dayIndex);
}

function dayCard(dayIndex) {
  const d = dayContent(dayIndex);
  const c = checks();
  const items = d.items
    .map((it) => `<li class="fw-item${c[it.key] ? " is-done" : ""}"><span class="fw-check" aria-hidden="true">${c[it.key] ? "✓" : ""}</span>${it.text}</li>`)
    .join("");
  return `
    <div class="card fw-card">
      <button type="button" class="fw-dismiss" data-fw="dismiss" aria-label="Dismiss first-week guide">×</button>
      <p class="fw-eyebrow">Your first week · Day ${dayIndex + 1} of 7</p>
      <h3 class="fw-title">${d.title}</h3>
      <p class="fw-line">${d.line}</p>
      <ul class="fw-items">${items}</ul>
      <button type="button" class="btn btn--primary btn--sm" data-fw-act="${esc(d.cta.act)}">${esc(d.cta.label)}</button>
    </div>`;
}

function reviewCard() {
  const s = deriveStats();
  const r = weekOneReview({
    sessions: s.thisWeek.sessions,
    target: s.thisWeek.target,
    nutritionDays: s.nutritionDays,
    proteinTargetDays: s.proteinTargetDays,
    painReports: getPainReports().length,
    streakDays: s.streakDays,
  });
  const stat = (v, label) => `<div class="fw-stat"><span class="fw-stat__v">${esc(v)}</span><span class="fw-stat__l">${esc(label)}</span></div>`;
  return `
    <div class="card fw-card fw-card--review">
      <button type="button" class="fw-dismiss" data-fw="dismiss" aria-label="Dismiss">×</button>
      <p class="fw-eyebrow">Your first week</p>
      <h3 class="fw-title">Week 1 review — nice work showing up</h3>
      <div class="fw-stats">
        ${stat(`${r.workouts}${r.target ? "/" + r.target : ""}`, "workouts")}
        ${stat(r.mealsLogged, "days logged")}
        ${stat(r.proteinDays, "protein days")}
        ${stat(r.bestStreak, "best streak")}
        ${stat(r.painReports, "pain check-ins")}
      </div>
      <p class="fw-line"><span class="fw-k">Week 2</span> ${esc(r.suggestion)}</p>
      <div class="fw-actions">
        <button type="button" class="btn btn--primary btn--sm" data-fw-act="adapt">Adapt next week</button>
        <button type="button" class="btn btn--ghost btn--sm" data-fw="dismiss">Done</button>
      </div>
    </div>`;
}

if (mount) {
  mount.addEventListener("click", (e) => {
    if (e.target.closest("[data-fw='dismiss']")) {
      const st = load();
      st.dismissed = true;
      persist(st);
      render();
      return;
    }
    const act = e.target.closest("[data-fw-act]")?.dataset.fwAct;
    if (!act) return;
    if (act === "today") location.hash = "#/today";
    else if (act === "workout") location.hash = "#/dashboard";
    else if (act === "nutrition") location.hash = "#/nutrition";
    else if (act === "progress") location.hash = "#/progress";
    else if (act === "adapt") { location.hash = "#/"; window.dispatchEvent(new CustomEvent("spotter:adapt-request")); }
  });

  window.addEventListener("spotter:plan", render);
  window.addEventListener("spotter:tracker", render);
  window.addEventListener("spotter:route", (e) => { if (e.detail?.route === "today") render(); });
  render();
}
