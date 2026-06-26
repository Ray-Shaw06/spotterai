/**
 * SpotterAI — Workout session UI (Hevy-style)
 * ============================================================================
 * An active workout session: start empty / from a routine / from your AI plan,
 * add exercises from a searchable library, log each set (weight × reps with a
 * done check), see your "previous" numbers, run a live duration timer, then
 * Finish (saved + XP) or Discard. Plus routines and an expandable history.
 *
 * The in-progress session lives in a model object (+ a localStorage draft so a
 * refresh mid-workout doesn't lose it). Typing updates the model without
 * re-rendering, so inputs never lose focus; structural changes re-render.
 */

import { addCustomExercise, addRoutine, addWorkout, getCustomExercises, getLoggedExerciseNames, getRoutines, getState, lastSetFor, removeEntry, removeRoutine, setsOf, subscribe, updateCustomExercise } from "./tracker-store.js";
import { findExercise, isCardio, searchExercises } from "./exercises.js";
import { classifyExercise } from "./ai.js";
import { store } from "./store.js";

const $ = (id) => document.getElementById(id);
const el = {
  idle: $("workout-idle"),
  routineList: $("routine-list"),
  startEmpty: $("start-empty"),
  session: $("workout-session"),
  name: $("session-name"),
  timer: $("session-timer"),
  exercises: $("session-exercises"),
  addEx: $("session-add-exercise"),
  finish: $("session-finish"),
  discard: $("session-discard"),
  saveRoutine: $("session-save-routine"),
  history: $("workout-history"),
  // picker
  picker: $("exercise-picker"),
  search: $("exercise-search"),
  results: $("exercise-results"),
  pickerClose: $("exercise-picker-close"),
};

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const DRAFT_KEY = "spotterai.session.draft";

function esc(t) {
  const d = document.createElement("div");
  d.textContent = t == null ? "" : String(t);
  return d.innerHTML;
}
const unit = () => getState().unit || "kg";

// ----------------------------------------------------------------------------
// Toast (shares #toast-root with the dashboard)
// ----------------------------------------------------------------------------
function toast(html) {
  let root = $("toast-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "toast-root";
    root.className = "toast-root";
    document.body.appendChild(root);
  }
  const t = document.createElement("div");
  t.className = "toast toast--xp";
  t.innerHTML = html;
  root.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 300);
  }, 3000);
}

// ----------------------------------------------------------------------------
// Session state + draft
// ----------------------------------------------------------------------------
let session = null; // { name, startedAt, exercises:[{name,muscle,prev,sets:[{weight,reps,done}]}] }
let timerId = null;

function saveDraft() {
  try {
    if (session) localStorage.setItem(DRAFT_KEY, JSON.stringify(session));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}
function loadDraft() {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
  } catch {
    return null;
  }
}

function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
function tick() {
  if (!session || !el.timer) return;
  el.timer.textContent = fmtTime(Math.max(0, Math.floor((Date.now() - session.startedAt) / 1000)));
}
function startTimer() {
  stopTimer();
  tick();
  timerId = setInterval(tick, 1000);
}
function stopTimer() {
  if (timerId) clearInterval(timerId);
  timerId = null;
}

// ----------------------------------------------------------------------------
// Lifecycle
// ----------------------------------------------------------------------------
function defaultName() {
  const h = new Date().getHours();
  return h < 12 ? "Morning Workout" : h < 17 ? "Afternoon Workout" : "Evening Workout";
}

function startSession(preset) {
  session = preset || { name: defaultName(), startedAt: Date.now(), exercises: [] };
  if (!session.startedAt) session.startedAt = Date.now();
  // Re-attach "previous" references (not stored in routines/plans).
  session.exercises.forEach((ex) => (ex.prev = ex.prev || lastSetFor(ex.name)));
  el.idle.hidden = true;
  el.session.hidden = false;
  el.name.value = session.name;
  renderSession();
  startTimer();
  saveDraft();
}

function showIdle() {
  stopTimer();
  el.session.hidden = true;
  el.idle.hidden = false;
  renderIdle();
}

function discardSession() {
  const hasWork = session?.exercises?.some((ex) => ex.sets.some(setHasWork));
  if (hasWork && !confirm("Discard this workout? Logged sets will be lost.")) return;
  session = null;
  saveDraft();
  showIdle();
}

const setHasWork = (s) => Number(s.weight) > 0 || Number(s.reps) > 0 || Number(s.durationMin) > 0 || Number(s.distance) > 0;

function finishSession() {
  if (!session) return;
  const exercises = session.exercises
    .map((ex) => ({ name: ex.name, muscle: ex.muscle, sets: ex.sets.filter(setHasWork) }))
    .filter((ex) => ex.sets.length);
  if (!exercises.length) {
    toast("<strong>Log a set first</strong> — add weight &amp; reps to at least one set.");
    return;
  }
  const durationSec = Math.floor((Date.now() - session.startedAt) / 1000);
  const { workout, newAchievements } = addWorkout({ name: el.name.value.trim() || session.name, exercises, durationSec });
  toast(`<strong>+${workout.xp} XP</strong> · ${esc(workout.name)} · ${fmtTime(durationSec)}`);
  for (const a of newAchievements) toast(`<strong>🏆 ${esc(a.name)}</strong> · +${a.xp} XP`);
  session = null;
  saveDraft();
  showIdle();
}

// ----------------------------------------------------------------------------
// Exercises within a session
// ----------------------------------------------------------------------------
// Custom exercises + anything you've logged, merged into the picker search so
// any movement stays findable (and gets remembered).
function exerciseExtras() {
  const out = [];
  const seen = new Set();
  for (const e of [...getCustomExercises(), ...getLoggedExerciseNames()]) {
    const k = e.name.toLowerCase();
    if (seen.has(k) || findExercise(e.name)) continue;
    seen.add(k);
    out.push({ name: e.name, muscle: e.muscle || "", cardio: e.cardio === true });
  }
  return out;
}

// `cardioOverride` (true/false) wins when known (library lookup or AI). Otherwise
// we fall back to the built-in cardio check.
function addExercise(name, muscle, cardioOverride) {
  const cardio = typeof cardioOverride === "boolean" ? cardioOverride : isCardio(name);
  // Persist anything not in the built-in library so it's searchable next time.
  if (!findExercise(name)) addCustomExercise({ name, muscle, cardio });
  const prev = lastSetFor(name);
  session.exercises.push({
    name,
    muscle: muscle || findExercise(name)?.muscle || "",
    cardio,
    prev,
    sets: [cardio ? { durationMin: "", distance: "", done: false } : { weight: "", reps: "", done: false }],
  });
  renderSession();
  saveDraft();
}

// After a custom exercise is added, ask the AI to tag its muscle group + whether
// it's cardio, then patch the stored entry and the live session. Runs in the
// background so the add itself is instant and never blocks on the network.
async function enrichExercise(name) {
  let info;
  try {
    info = await classifyExercise(name);
  } catch {
    return; // AI unavailable — it stays a plain custom entry
  }
  if (!info) return;
  updateCustomExercise(name, info.muscle, info.cardio);

  let changed = false;
  for (const ex of session?.exercises || []) {
    if (ex.name.toLowerCase() !== name.toLowerCase()) continue;
    if (info.muscle && !ex.muscle) {
      ex.muscle = info.muscle;
      changed = true;
    }
    // Switch to cardio (time/distance) only if nothing's been logged yet, so we
    // never wipe sets the user already typed.
    if (info.cardio && !ex.cardio && ex.sets.every((s) => !setHasWork(s))) {
      ex.cardio = true;
      ex.sets = [{ durationMin: "", distance: "", done: false }];
      changed = true;
    }
  }
  if (changed) {
    renderSession();
    saveDraft();
  }
}

function renderSession() {
  if (!session) return;
  const u = unit();
  el.exercises.innerHTML = session.exercises
    .map((ex, ei) => {
      const cardio = ex.cardio || isCardio(ex.name);
      const prevText = ex.prev ? `Previous: ${ex.prev.top.weight ? ex.prev.top.weight + u + " × " : ""}${ex.prev.top.reps || ex.prev.sets.length + " sets"}` : "No history yet";
      const head = `${cardio ? "<th>Min</th><th>Dist</th>" : `<th>${u}</th><th>Reps</th>`}`;
      const rows = ex.sets
        .map((s, si) => {
          const prevSet = ex.prev?.sets?.[si];
          const prevCell = prevSet ? `${prevSet.weight ? prevSet.weight + "×" : ""}${prevSet.reps || "–"}` : "–";
          const cells = cardio
            ? `<td><input class="input set-in" data-f="durationMin" type="number" inputmode="decimal" value="${esc(s.durationMin ?? "")}" placeholder="min" /></td>
               <td><input class="input set-in" data-f="distance" type="number" inputmode="decimal" value="${esc(s.distance ?? "")}" placeholder="km" /></td>`
            : `<td><input class="input set-in" data-f="weight" type="number" inputmode="decimal" value="${esc(s.weight ?? "")}" placeholder="${prevSet?.weight ?? ""}" /></td>
               <td><input class="input set-in" data-f="reps" type="number" inputmode="numeric" value="${esc(s.reps ?? "")}" placeholder="${prevSet?.reps ?? ""}" /></td>`;
          return `<tr class="set-row ${s.done ? "is-done" : ""}" data-set="${si}">
            <td class="set-n">${si + 1}</td>
            <td class="set-prev">${cardio ? "–" : prevCell}</td>
            ${cells}
            <td class="set-ctl">
              <button type="button" class="set-done" data-act="toggle-done" aria-label="Mark set done">✓</button>
              <button type="button" class="set-del" data-act="del-set" aria-label="Remove set">×</button>
            </td>
          </tr>`;
        })
        .join("");
      return `<div class="ex-block" data-ex="${ei}">
        <div class="ex-block__head">
          <div class="ex-block__title"><span class="ex-block__name">${esc(ex.name)}</span><span class="ex-block__prev">${esc(prevText)}</span></div>
          <button type="button" class="ex-block__del" data-act="del-ex" aria-label="Remove exercise">×</button>
        </div>
        <table class="set-table">
          <thead><tr><th>Set</th><th>Prev</th>${head}<th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <button type="button" class="add-set" data-act="add-set">+ Add set</button>
      </div>`;
    })
    .join("");
}

// ----------------------------------------------------------------------------
// Idle view (start options + routines + plan)
// ----------------------------------------------------------------------------
function renderIdle() {
  if (!el.routineList) return;
  const routines = getRoutines();
  const planDays = store.plan?.days || [];
  let html = "";

  if (routines.length) {
    html += `<p class="workout-grouplabel">Routines</p>`;
    html += routines
      .map(
        (r) => `<div class="routine" data-id="${r.id}">
          <button type="button" class="routine__start" data-act="start-routine">${esc(r.name)}<span class="routine__meta">${r.exercises.length} exercises</span></button>
          <button type="button" class="routine__del" data-act="del-routine" aria-label="Delete routine">×</button>
        </div>`
      )
      .join("");
  }
  if (planDays.length) {
    html += `<p class="workout-grouplabel">From your plan</p>`;
    html += planDays
      .map((d, i) => `<button type="button" class="routine__start routine__start--plan" data-act="start-plan" data-i="${i}">${esc(d.focus || d.day || "Session")}<span class="routine__meta">${(d.exercises || []).length} exercises</span></button>`)
      .join("");
  }
  el.routineList.innerHTML = html;
}

function sessionFromRoutine(r) {
  return {
    name: r.name,
    startedAt: Date.now(),
    exercises: (r.exercises || []).map((e) => ({
      name: e.name,
      muscle: e.muscle || findExercise(e.name)?.muscle || "",
      cardio: isCardio(e.name),
      sets: (e.sets?.length ? e.sets : [{}]).map((s) => ({ weight: s.weight || "", reps: s.reps || "", done: false })),
    })),
  };
}
function sessionFromPlanDay(day) {
  return {
    name: day.focus || "Session",
    startedAt: Date.now(),
    exercises: (day.exercises || []).map((e) => {
      const repsNum = parseInt(String(e.reps).match(/\d+/)?.[0] || "", 10);
      const count = Math.max(1, Number(e.sets) || 1);
      return {
        name: e.name,
        muscle: findExercise(e.name)?.muscle || "",
        cardio: isCardio(e.name),
        sets: Array.from({ length: count }, () => ({ weight: "", reps: Number.isFinite(repsNum) ? repsNum : "", done: false })),
      };
    }),
  };
}

// ----------------------------------------------------------------------------
// History
// ----------------------------------------------------------------------------
function renderHistory() {
  if (!el.history) return;
  const workouts = [...getState().workouts].reverse().slice(0, 20);
  const u = unit();
  el.history.innerHTML = workouts.length
    ? workouts
        .map((w) => {
          const setCount = (w.exercises || []).reduce((n, e) => n + setsOf(e).length, 0);
          const dur = w.durationSec ? ` · ${fmtTime(w.durationSec)}` : "";
          const detail = (w.exercises || [])
            .map((e) => {
              const sets = setsOf(e)
                .map((s) => (s.durationMin ? `${s.durationMin}min` : `${s.weight ? s.weight + u + "×" : ""}${s.reps}`))
                .join(", ");
              return `<div class="hist__ex"><strong>${esc(e.name)}</strong><span class="muted">${esc(sets)}</span></div>`;
            })
            .join("");
          return `<li class="hist" data-id="${w.id}">
            <button type="button" class="hist__head" data-act="toggle-hist">
              <span class="hist__main"><span class="hist__name">${esc(w.name)}</span><span class="hist__sub">${esc(w.date)}${dur} · ${setCount} ${setCount === 1 ? "set" : "sets"}</span></span>
              <span class="hist__vol">${w.volume ? (w.volume / 1000).toFixed(1) + "k" : "—"}</span>
            </button>
            <div class="hist__detail" hidden>${detail}<button type="button" class="btn-link-danger" data-act="del-workout">Delete workout</button></div>
          </li>`;
        })
        .join("")
    : `<li class="muted">No workouts yet — start one above.</li>`;
}

// ----------------------------------------------------------------------------
// Exercise picker
// ----------------------------------------------------------------------------
function openPicker() {
  el.picker.classList.add("is-open");
  el.picker.setAttribute("aria-hidden", "false");
  el.search.value = "";
  renderResults("");
  setTimeout(() => el.search.focus(), reducedMotion ? 0 : 60);
}
function closePicker() {
  el.picker.classList.remove("is-open");
  el.picker.setAttribute("aria-hidden", "true");
}
function renderResults(q) {
  const list = searchExercises(q, 40, exerciseExtras());
  let html = list
    .map((e) => {
      const cardioAttr = e.cardio === true ? "1" : e.cardio === false ? "0" : "";
      return `<li><button type="button" class="exercise-opt" data-name="${esc(e.name)}" data-muscle="${esc(e.muscle)}" data-cardio="${cardioAttr}"><span>${esc(e.name)}</span><span class="exercise-opt__muscle">${esc(e.muscle)}</span></button></li>`;
    })
    .join("");
  const trimmed = q.trim();
  if (trimmed && !list.some((e) => e.name.toLowerCase() === trimmed.toLowerCase())) {
    html += `<li><button type="button" class="exercise-opt exercise-opt--custom" data-name="${esc(trimmed)}" data-muscle=""><span>Add "${esc(trimmed)}"</span><span class="exercise-opt__muscle">custom · AI tags it</span></button></li>`;
  }
  el.results.innerHTML = html || `<li class="muted exercise-empty">No matches.</li>`;
}

// ----------------------------------------------------------------------------
// Wiring
// ----------------------------------------------------------------------------
function init() {
  // Idle: start buttons
  el.startEmpty?.addEventListener("click", () => startSession());
  el.routineList?.addEventListener("click", (e) => {
    const start = e.target.closest('[data-act="start-routine"]');
    const del = e.target.closest('[data-act="del-routine"]');
    const plan = e.target.closest('[data-act="start-plan"]');
    if (start) {
      const r = getRoutines().find((x) => x.id === start.closest(".routine").dataset.id);
      if (r) startSession(sessionFromRoutine(r));
    } else if (del) {
      removeRoutine(del.closest(".routine").dataset.id);
    } else if (plan) {
      const day = store.plan?.days?.[Number(plan.dataset.i)];
      if (day) startSession(sessionFromPlanDay(day));
    }
  });

  // Session: name + finish/discard + add exercise + save routine
  el.name?.addEventListener("input", () => {
    if (session) {
      session.name = el.name.value;
      saveDraft();
    }
  });
  el.finish?.addEventListener("click", finishSession);
  el.discard?.addEventListener("click", discardSession);
  el.addEx?.addEventListener("click", openPicker);
  el.saveRoutine?.addEventListener("click", () => {
    if (!session?.exercises.length) return;
    const name = prompt("Name this routine:", session.name);
    if (name == null) return;
    addRoutine({ name: name || session.name, exercises: session.exercises });
    toast(`<strong>Routine saved</strong> · ${esc(name || session.name)}`);
  });

  // Session exercise interactions (delegated)
  el.exercises?.addEventListener("input", (e) => {
    const input = e.target.closest(".set-in");
    if (!input || !session) return;
    const ei = Number(input.closest(".ex-block").dataset.ex);
    const si = Number(input.closest(".set-row").dataset.set);
    session.exercises[ei].sets[si][input.dataset.f] = input.value;
    saveDraft();
  });
  el.exercises?.addEventListener("click", (e) => {
    if (!session) return;
    const block = e.target.closest(".ex-block");
    if (!block) return;
    const ei = Number(block.dataset.ex);
    const ex = session.exercises[ei];
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "del-ex") {
      session.exercises.splice(ei, 1);
      renderSession();
      saveDraft();
    } else if (act === "add-set") {
      const last = ex.sets[ex.sets.length - 1] || {};
      ex.sets.push(ex.cardio ? { durationMin: "", distance: "", done: false } : { weight: last.weight || "", reps: last.reps || "", done: false });
      renderSession();
      saveDraft();
    } else if (act === "del-set") {
      const si = Number(e.target.closest(".set-row").dataset.set);
      ex.sets.splice(si, 1);
      if (!ex.sets.length) ex.sets.push(ex.cardio ? { durationMin: "", distance: "", done: false } : { weight: "", reps: "", done: false });
      renderSession();
      saveDraft();
    } else if (act === "toggle-done") {
      const si = Number(e.target.closest(".set-row").dataset.set);
      ex.sets[si].done = !ex.sets[si].done;
      e.target.closest(".set-row").classList.toggle("is-done", ex.sets[si].done);
      saveDraft();
    }
  });

  // Picker
  el.pickerClose?.addEventListener("click", closePicker);
  el.picker?.addEventListener("click", (e) => {
    if (e.target === el.picker) closePicker();
  });
  el.search?.addEventListener("input", () => renderResults(el.search.value));
  el.results?.addEventListener("click", (e) => {
    const opt = e.target.closest(".exercise-opt");
    if (!opt || !session) return;
    const name = opt.dataset.name;
    const cardioAttr = opt.dataset.cardio;
    const cardio = cardioAttr === "1" ? true : cardioAttr === "0" ? false : undefined;
    const isNewCustom = opt.classList.contains("exercise-opt--custom") && !findExercise(name);

    // Register the exercise immediately so it ALWAYS lands in the session.
    addExercise(name, opt.dataset.muscle, cardio);
    closePicker();

    // For a brand-new custom movement, classify it (muscle + cardio) in the
    // background so any machine/dumbbell/barbell exercise gets tagged correctly
    // without making the add wait on the network.
    if (isNewCustom) enrichExercise(name);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && el.picker.classList.contains("is-open")) closePicker();
  });

  // History (delegated)
  el.history?.addEventListener("click", (e) => {
    const li = e.target.closest(".hist");
    if (!li) return;
    if (e.target.closest('[data-act="toggle-hist"]')) {
      const d = li.querySelector(".hist__detail");
      d.hidden = !d.hidden;
    } else if (e.target.closest('[data-act="del-workout"]')) {
      if (confirm("Delete this workout?")) removeEntry("workouts", li.dataset.id);
    }
  });

  // Re-render history + idle routines when data changes (logged/synced).
  subscribe(() => {
    renderHistory();
    if (!el.idle.hidden) renderIdle();
  });
  window.addEventListener("spotter:plan", () => {
    if (!el.idle.hidden) renderIdle();
  });

  // Restore an in-progress draft, else show idle.
  const draft = loadDraft();
  if (draft && Array.isArray(draft.exercises) && draft.exercises.length) startSession(draft);
  else showIdle();
  renderHistory();
}

// Start (after all module-level consts/functions above are initialized).
if (el.session && el.idle) init();
