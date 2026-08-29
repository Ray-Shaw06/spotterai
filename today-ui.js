/**
 * SpotterAI — "Today" screen (consumer daily home base)
 * ============================================================================
 * Answers one question: "what should I do today?" — pulling from the existing
 * plan (store), tracker stats (deriveStats), and nutrition targets. Read-only
 * orchestration: every action routes into a flow that already exists (workout
 * session, nutrition, progress, plan adapt, Pain Mode).
 */

import { store } from "./store.js";
import { deriveStats, getWater, getState, dayCounts, daysSinceBodyweight, dateDaysAgo } from "./tracker-store.js";
import { evaluateNutrition } from "./nutrition-safety.js";
import { todaysWorkout, coachNote, trainingDays, weekStrip } from "./today.js";
import { openItems, catchUpSummary } from "./catch-up.js";
import { isCardioEntry } from "./lib/plan.js";

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
  const exercises = workout.exercises || [];
  // Cardio contributes its own prescribed minutes. Counting a 40-minute run as
  // one "set" put a run day at the 30-minute floor, which is not a small error.
  const cardioMinutes = exercises.filter(isCardioEntry).reduce((n, e) => n + (Number(e.durationMin) || 0), 0);
  const sets = exercises.filter((e) => !isCardioEntry(e)).reduce((n, e) => n + (Number(e.sets) || 0), 0);
  const lifting = sets ? sets * 3.5 + 10 : 0;
  return `~${Math.max(sets ? 30 : 10, Math.round((lifting + cardioMinutes) / 5) * 5)} min`;
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
        <p class="today-card__text">Today gives you a daily workout, nutrition focus, recovery check-in, and a coach note, once you have a plan to work from.</p>
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

  // --- A. Today's workout (or an honest rest day) --------------------------
  const weekDone = (stats.thisWeek.sessions || 0) >= trainingDays(plan).length;
  let workoutCard;
  if (!workout) {
    workoutCard = card(
      weekDone
        ? `<p class="today-card__eyebrow">Rest day: earned</p>
           <h3 class="today-card__title">Week complete: ${stats.thisWeek.sessions}/${trainingDays(plan).length} sessions</h3>
           <p class="today-card__text">You've done every planned session this week. More isn't better here. Recovery is where the adaptation happens. Next week picks up fresh.</p>
           <div class="today-card__actions"><button type="button" class="btn btn--ghost btn--sm today-qa" data-act="weight">Log recovery / bodyweight</button><button type="button" class="btn btn--ghost btn--sm today-qa" data-act="adapt">Adapt next week</button></div>`
        : `<p class="today-card__eyebrow">Today</p>
           <h3 class="today-card__title">No workout planned today</h3>
           <p class="today-card__text">Recovery is part of the plan. Light movement, good food, and sleep are doing real work.</p>
           <div class="today-card__actions"><button type="button" class="btn btn--ghost btn--sm today-qa" data-act="weight">Log recovery / bodyweight</button></div>`,
      "today-card--rest"
    );
  } else {
    // Command-center hero: giant session readout left, numbered exercise
    // manifest right, one dominant START control.
    // Cardio is one continuous effort, so "1×35 min" is the wrong readout for
    // it. Minutes and stated intensity are what the session actually asks for.
    const rx = (e) => {
      if (!isCardioEntry(e)) return `${esc(e.sets)}×${esc(e.reps)}${e.rpe ? ` <em>@${esc(e.rpe)}</em>` : ""}`;
      const mins = Number(e.durationMin) > 0 ? `${e.durationMin} min` : esc(e.reps || "cardio");
      return `${esc(mins)}${e.intensity ? ` <em>${esc(e.intensity)}</em>` : ""}`;
    };
    const exRows = (workout.exercises || [])
      .slice(0, 8)
      .map((e) => `<li class="cmd-ex"><span class="cmd-ex__name">${esc(e.name)}</span><span class="cmd-ex__rx">${rx(e)}</span></li>`)
      .join("");
    workoutCard = `
      <div class="cmd today-card--workout">
        <div class="cmd__main">
          <p class="cmd__eyebrow">Today's session · ${esc(estDuration(workout, inputs))} · ${esc(plan.goal || "Training")}</p>
          <h3 class="cmd__title">${esc(workout.focus || workout.day || "Workout")}</h3>
          <p class="cmd__warmup"><strong>Warm-up</strong> 5–10 min easy cardio, then 2–3 light ramp-up sets on your first lift.</p>
          ${workout.notes ? `<p class="cmd__note">${esc(workout.notes)}</p>` : ""}
          <div class="cmd__actions">
            <button type="button" class="btn btn--primary cmd__start today-qa" data-act="start">Start workout</button>
            <button type="button" class="btn-link today-qa" data-act="skip">Skip / reschedule</button>
            <button type="button" class="btn-link today-qa" data-act="substitute">Substitute</button>
          </div>
        </div>
        <div class="cmd__manifest">
          <p class="cmd__manifest-label">Exercise manifest</p>
          <ol class="cmd__list">${exRows}</ol>
        </div>
      </div>`;
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
    ? `<p class="today-note today-note--warn">${esc(nutAudit.flags[0].label)}: ${esc(nutAudit.flags[0].fix)}</p>`
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
     <p class="today-card__text">${last ? `Last workout: <strong>${esc(last.focus || last.name)}</strong> on ${esc(last.date)}.` : "No workouts logged yet. Your first one starts the streak."}</p>
     <p class="today-card__text today-muted">Feeling sore, stiff, or in pain? Report it so SpotterAI can adjust. It never asks you to train through pain.</p>
     <div class="today-card__actions"><button type="button" class="btn btn--ghost btn--sm today-qa" data-act="pain">Pain / soreness check-in</button></div>`,
    "today-card--recovery"
  );

  // --- Catch-up: what is still unlogged ------------------------------------
  // The app cannot reach you when it is closed, so the moment you open it, it
  // owes you a straight answer about what is still open. Renders nothing at all
  // on a fully logged day.
  const todayCounts = dayCounts(ymd());
  const yCounts = dayCounts(dateDaysAgo(1));
  const items = openItems({
    hour: new Date().getHours(),
    hasPlan: true,
    trainingDayDue: !!workout,
    workoutsToday: todayCounts.workouts,
    nutritionToday: todayCounts.nutrition,
    workoutsYesterday: yCounts.workouts,
    nutritionYesterday: yCounts.nutrition,
    daysSinceBodyweight: daysSinceBodyweight(),
  });
  const catchUpCard = items.length
    ? card(
        `<p class="today-card__eyebrow">Catch-up</p>
         <p class="today-card__title today-card__title--sm">${esc(catchUpSummary(items))}</p>
         <ul class="catchup-list">${items
           .map(
             (it) => `<li class="catchup-item">
               <span class="catchup-item__text"><strong>${esc(it.label)}</strong><span class="catchup-item__hint">${esc(it.hint)}</span></span>
               <button type="button" class="btn btn--ghost btn--sm today-qa" data-act="catchup" data-catchup="${esc(it.act)}" data-scope="${esc(it.scope)}">${it.act === "backfill" ? "Fill it in" : "Log it"}</button>
             </li>`
           )
           .join("")}</ul>`,
        "today-card--catchup"
      )
    : "";

  // --- Week at a glance ----------------------------------------------------
  const strip = weekStrip(plan, stats.thisWeek.sessions || 0);
  const stripHtml = strip.length
    ? `<div class="week-strip" role="list" aria-label="This week's sessions">
        <span class="week-strip__label">This week</span>
        ${strip
          .map(
            (s) => `<span role="listitem" class="week-chip week-chip--${s.state}" title="${esc(s.label)}">
              <span class="week-chip__dot" aria-hidden="true">${s.state === "done" ? "✓" : ""}</span>${esc(s.label)}
            </span>`
          )
          .join("")}
      </div>`
    : "";

  content.innerHTML = `
    ${quickActions(true)}
    ${stripHtml}
    ${catchUpCard}
    ${workoutCard}
    <div class="today-telemetry">${coachCard}${nutritionCard}${recoveryCard}</div>`;
}

// Quick actions route into existing flows.
content?.addEventListener("click", (e) => {
  const btn = e.target.closest(".today-qa");
  if (!btn) return;
  const act = btn.dataset.act;
  if (act === "catchup") {
    const kind = btn.dataset.catchup;
    if (kind === "backfill") {
      // Never write yesterday for the user. "Repeat the last session onto
      // yesterday" would be the app asserting a workout happened, and the
      // whole product rule is that it proposes and you approve. This opens the
      // logger dated yesterday instead; the repeat button is offered there.
      location.hash = "#/dashboard";
      window.dispatchEvent(new CustomEvent("spotter:log-for-date", { detail: { date: dateDaysAgo(1) } }));
      return;
    }
    if (kind === "meal") location.hash = "#/nutrition";
    else if (kind === "weight") location.hash = "#/progress";
    else location.hash = "#/dashboard";
    return;
  }
  if (act === "start") {
    // Open the workout tracker WITH today's session loaded — no hunting for it.
    const workout = store.plan ? todaysWorkout(store.plan, deriveStats().thisWeek.sessions || 0) : null;
    const index = workout ? (store.plan.days || []).indexOf(workout) : -1;
    if (index >= 0) window.dispatchEvent(new CustomEvent("spotter:start-plan-day", { detail: { index } }));
    else location.hash = "#/dashboard";
  } else if (act === "skip" || act === "substitute") location.hash = "#/dashboard";
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
