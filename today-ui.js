/**
 * SpotterAI — "Today" screen (consumer daily home base)
 * ============================================================================
 * Answers one question: "what should I do today?" — pulling from the existing
 * plan (store), tracker stats (deriveStats), and nutrition targets. Read-only
 * orchestration: every action routes into a flow that already exists (workout
 * session, nutrition, progress, plan adapt, Pain Mode).
 */

import { store } from "./store.js";
import { deriveStats, getWater, getState } from "./tracker-store.js";
import { evaluateNutrition } from "./nutrition-safety.js";
import { todaysWorkout, coachNote, trainingDays } from "./today.js";

const content = document.getElementById("today-content");
const dateEl = document.getElementById("today-date");

function esc(t) {
  const d = document.createElement("div");
  d.textContent = t == null ? "" : String(t);
  return d.innerHTML;
}
const ymd = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function estDuration(workout, inputs) {
  if (inputs?.sessionLength) return `~${inputs.sessionLength} min`;
  const sets = (workout.exercises || []).reduce((n, e) => n + (Number(e.sets) || 0), 0);
  return `~${Math.max(30, Math.round((sets * 3.5 + 10) / 5) * 5)} min`;
}

function card(inner, cls = "") {
  return `<div class="card today-card ${cls}">${inner}</div>`;
}
function quickActions(hasPlan) {
  const btn = (act, label, primary) => `<button type="button" class="btn ${primary ? "btn--primary" : "btn--ghost"} btn--sm today-qa" data-act="${act}">${label}</button>`;
  return `<div class="today-quick">
    ${hasPlan ? btn("start", "Start workout", true) : ""}
    <button type="button" class="btn btn--ghost btn--sm today-qa" data-act="meal">Log meal</button>
    <button type="button" class="btn btn--ghost btn--sm today-qa" data-act="weight">Log bodyweight</button>
    <button type="button" class="btn btn--ghost btn--sm today-qa" data-act="pain">Report pain</button>
    ${hasPlan ? `<button type="button" class="btn btn--ghost btn--sm today-qa" data-act="adapt">Adapt my plan</button>` : ""}
  </div>`;
}

function render() {
  if (!content) return;
  if (dateEl) dateEl.textContent = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  const plan = store.plan;
  const inputs = store.inputs || {};

  // Empty state: no plan yet.
  if (!plan) {
    content.innerHTML = card(
      `<div class="today-empty">
        <h3 class="today-card__title">Create your first plan to unlock Today</h3>
        <p class="today-card__text">Today gives you a daily workout, nutrition focus, recovery check-in, and a coach note — once you have a plan to work from.</p>
        <a href="#/" data-nav="home" class="btn btn--primary" data-onboard>Build my plan</a>
      </div>`,
      "today-card--empty"
    );
    return;
  }

  const stats = deriveStats();
  const lastWeekSessions = stats.weeklySessions?.length ? stats.weeklySessions[stats.weeklySessions.length - 2]?.value : 0;
  const note = coachNote({ sessions: stats.thisWeek.sessions, target: stats.thisWeek.target, lastWeekSessions, injuries: inputs.injuries });
  const workout = todaysWorkout(plan, stats.thisWeek.sessions || 0);

  // --- A. Today's workout (or a recovery day) ------------------------------
  let workoutCard;
  if (!workout) {
    workoutCard = card(
      `<p class="today-card__eyebrow">Today</p>
       <h3 class="today-card__title">No workout planned today</h3>
       <p class="today-card__text">Recovery is part of the plan. Light movement, good food, and sleep are doing real work.</p>
       <div class="today-card__actions"><button type="button" class="btn btn--ghost btn--sm today-qa" data-act="weight">Log recovery / bodyweight</button></div>`,
      "today-card--rest"
    );
  } else {
    const exRows = (workout.exercises || [])
      .slice(0, 8)
      .map((e) => `<li><span class="today-ex__name">${esc(e.name)}</span><span class="today-ex__sr">${esc(e.sets)}×${esc(e.reps)}${e.rpe ? ` · RPE ${esc(e.rpe)}` : ""}</span></li>`)
      .join("");
    workoutCard = card(
      `<div class="today-card__head">
        <div><p class="today-card__eyebrow">Today's workout · ${esc(estDuration(workout, inputs))}</p><h3 class="today-card__title">${esc(workout.focus || workout.day || "Workout")}</h3></div>
        <span class="today-badge">${esc(plan.goal || "Training")}</span>
      </div>
      <p class="today-warmup"><strong>Warm-up</strong> 5–10 min easy cardio, then 2–3 light ramp-up sets on your first lift.</p>
      <ul class="today-ex">${exRows}</ul>
      ${workout.notes ? `<p class="today-card__text">${esc(workout.notes)}</p>` : ""}
      <div class="today-card__actions">
        <button type="button" class="btn btn--primary btn--sm today-qa" data-act="start">Start workout</button>
        <button type="button" class="btn btn--ghost btn--sm today-qa" data-act="skip">Skip / reschedule</button>
        <button type="button" class="btn btn--ghost btn--sm today-qa" data-act="substitute">Substitute an exercise</button>
      </div>`,
      "today-card--workout"
    );
  }

  // --- C. Coach note -------------------------------------------------------
  const coachCard = card(
    `<p class="today-card__eyebrow">Coach note</p><p class="today-note today-note--${note.tone}">${esc(note.text)}</p>`,
    "today-card--coach"
  );

  // --- B. Nutrition focus --------------------------------------------------
  const n = stats.nutritionToday;
  const proteinLeft = Math.max(0, (n.targetProtein || 0) - (n.protein || 0));
  const targets = getState().targets;
  const water = getWater(ymd());
  const waterTarget = targets.waterMl || 2500;
  const waterLeft = Math.max(0, waterTarget - water);
  const nutAudit = evaluateNutrition({ targets, bodyweight: stats.bodyweight?.latest, unit: stats.unit, goal: inputs.goal || "" });
  const nutFlags = nutAudit.flags.length
    ? `<p class="today-note today-note--warn">${esc(nutAudit.flags[0].label)} — ${esc(nutAudit.flags[0].fix)}</p>`
    : "";
  const nutritionCard = card(
    `<p class="today-card__eyebrow">Nutrition focus</p>
     <div class="today-stats">
       <div class="today-stat"><span class="today-stat__v">${proteinLeft}g</span><span class="today-stat__l">protein left</span></div>
       <div class="today-stat"><span class="today-stat__v">${n.kcal ? Math.max(0, (n.targetKcal || 0) - n.kcal) : n.targetKcal || 0}</span><span class="today-stat__l">kcal left</span></div>
       <div class="today-stat"><span class="today-stat__v">${(waterLeft / 1000).toFixed(1)}L</span><span class="today-stat__l">water left</span></div>
     </div>
     <p class="today-card__text">Habit focus: hit protein across at least 2 meals, and sip water through the day.</p>
     ${nutFlags}
     <div class="today-card__actions"><button type="button" class="btn btn--ghost btn--sm today-qa" data-act="meal">Log a meal</button></div>`,
    "today-card--nutrition"
  );

  // --- D. Recovery / status ------------------------------------------------
  const last = stats.recentWorkouts?.[0];
  const recoveryCard = card(
    `<p class="today-card__eyebrow">Recovery &amp; status</p>
     <p class="today-card__text">${last ? `Last workout: <strong>${esc(last.focus || last.name)}</strong> on ${esc(last.date)}.` : "No workouts logged yet — your first one starts the streak."}</p>
     <p class="today-card__text today-muted">Feeling sore, stiff, or in pain? Report it so SpotterAI can adjust — it never asks you to train through pain.</p>
     <div class="today-card__actions"><button type="button" class="btn btn--ghost btn--sm today-qa" data-act="pain">Pain / soreness check-in</button></div>`,
    "today-card--recovery"
  );

  content.innerHTML = `
    ${quickActions(true)}
    <div class="today-grid">
      ${workoutCard}
      <div class="today-col">${coachCard}${nutritionCard}${recoveryCard}</div>
    </div>`;
}

// Quick actions route into existing flows.
content?.addEventListener("click", (e) => {
  const btn = e.target.closest(".today-qa");
  if (!btn) return;
  const act = btn.dataset.act;
  if (act === "start" || act === "skip" || act === "substitute") location.hash = "#/dashboard";
  else if (act === "meal") location.hash = "#/nutrition";
  else if (act === "weight") location.hash = "#/progress";
  else if (act === "adapt") location.hash = "#/";
  else if (act === "pain") window.dispatchEvent(new CustomEvent("spotter:report-pain"));
});

// Re-render when the plan, tracked data, or route changes (so Today is fresh).
window.addEventListener("spotter:plan", render);
window.addEventListener("spotter:tracker", render);
window.addEventListener("spotter:route", (e) => {
  if (e.detail?.route === "today") render();
});

if (content) render();
