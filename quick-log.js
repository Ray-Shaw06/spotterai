/**
 * SpotterAI — Quick Log (natural language + voice)
 * ============================================================================
 * Type or speak a plain-English note ("bench 3x5 at 60kg", "ate a chicken
 * burrito and a banana"); /api/parse turns it into a structured workout or
 * nutrition entry; you CONFIRM a preview; it's written to the tracker. The AI
 * proposes, you approve — nothing is logged silently.
 *
 * Voice uses the browser's Web Speech API when available (graceful if not).
 * Self-contained: it just calls the tracker mutations, and the dashboard
 * re-renders itself via the spotter:tracker event.
 */

import { addNutrition, addWorkout } from "./tracker-store.js";
import { findExercise } from "./exercises.js";

const $ = (id) => document.getElementById(id);
const el = {
  wrap: $("quicklog"),
  form: $("quicklog-form"),
  input: $("quicklog-input"),
  mic: $("quicklog-mic"),
  send: $("quicklog-send"),
  result: $("quicklog-result"),
};

function esc(t) {
  const d = document.createElement("div");
  d.textContent = t == null ? "" : String(t);
  return d.innerHTML;
}
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
function mealByHour() {
  const h = new Date().getHours();
  return h < 11 ? "breakfast" : h < 15 ? "lunch" : h < 21 ? "dinner" : "snacks";
}

let busy = false;
let pending = null; // parsed result awaiting the user's confirm

// ----------------------------------------------------------------------------
// Parse → preview
// ----------------------------------------------------------------------------
async function submitText(text) {
  text = String(text || "").trim();
  if (!text || busy) return;
  busy = true;
  pending = null;
  el.send.disabled = true;
  el.result.hidden = false;
  el.result.innerHTML = `<p class="ql-loading"><span class="spinner spinner--sm" aria-hidden="true"></span> Reading “${esc(text)}”…</p>`;

  try {
    const res = await fetch("api/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      const msg =
        res.status === 429 ? "Rate-limited right now — try again shortly." : res.status === 503 ? "The AI's briefly overloaded — try again in a few seconds." : d.error || "Couldn't log that right now.";
      el.result.innerHTML = `<p class="ql-note">${esc(msg)}</p>`;
      return;
    }
    renderPreview(await res.json());
  } catch {
    el.result.innerHTML = `<p class="ql-note">Couldn't reach the parser. It needs the live backend (deployed, or <code>vercel dev</code>).</p>`;
  } finally {
    busy = false;
    el.send.disabled = false;
  }
}

function exLine(e) {
  const s = e.sets;
  const uniform = s.every((x) => x.weight === s[0].weight && x.reps === s[0].reps);
  const summary = uniform ? `${s.length}×${s[0].reps}${s[0].weight ? ` @ ${s[0].weight}` : ""}` : `${s.length} sets`;
  return `<li><span class="ql-name">${esc(e.name)}</span><span class="ql-meta">${esc(summary)}</span></li>`;
}
function foodLine(i) {
  return `<li><span class="ql-name">${esc(i.name)}</span><span class="ql-meta">${i.kcal} kcal · ${i.protein}P ${i.carbs}C ${i.fat}F</span></li>`;
}

function renderPreview(data) {
  if (!data || data.kind === "unknown") {
    pending = null;
    el.result.innerHTML = `<p class="ql-note">${esc((data && data.note) || "I couldn't tell if that's a workout or a meal.")}</p>`;
    el.result.hidden = false;
    return;
  }
  pending = data;
  let body = "";
  if (data.kind === "workout") {
    const w = data.workout;
    body = `<p class="ql-title">Log workout — <strong>${esc(w.name)}</strong></p><ul class="ql-list">${w.exercises.map(exLine).join("")}</ul>`;
  } else {
    const n = data.nutrition;
    const meal = n.meal || mealByHour();
    const total = n.items.reduce((s, i) => s + i.kcal, 0);
    body = `<p class="ql-title">Log to <strong>${esc(cap(meal))}</strong> · ${total} kcal</p><ul class="ql-list">${n.items.map(foodLine).join("")}</ul>`;
  }
  el.result.innerHTML = `${body}
    <div class="ql-actions">
      <button type="button" class="btn btn--ghost btn--sm" data-act="ql-cancel">Cancel</button>
      <button type="button" class="btn btn--primary btn--sm" data-act="ql-confirm">Confirm &amp; log</button>
    </div>`;
  el.result.hidden = false;
}

// ----------------------------------------------------------------------------
// Confirm → write to the tracker
// ----------------------------------------------------------------------------
function confirmLog() {
  if (!pending) return;
  if (pending.kind === "workout") {
    const w = pending.workout;
    const { workout } = addWorkout({
      name: w.name,
      exercises: w.exercises.map((e) => ({
        name: e.name,
        muscle: findExercise(e.name)?.muscle || "",
        sets: e.sets.map((s) => ({ weight: s.weight, reps: s.reps })),
      })),
    });
    success(`Logged <strong>${esc(workout.name)}</strong> · +${workout.xp} XP`);
  } else if (pending.kind === "nutrition") {
    const n = pending.nutrition;
    const meal = n.meal || mealByHour();
    for (const it of n.items) addNutrition({ name: it.name, meal, kcal: it.kcal, protein: it.protein, carbs: it.carbs, fat: it.fat });
    const total = n.items.reduce((s, i) => s + i.kcal, 0);
    success(`Logged ${n.items.length} item${n.items.length > 1 ? "s" : ""} to ${esc(cap(meal))} · ${total} kcal`);
  }
  pending = null;
  el.input.value = "";
}

function success(html) {
  el.result.innerHTML = `<p class="ql-success">✓ ${html}</p>`;
  el.result.hidden = false;
  setTimeout(() => {
    if (el.result.querySelector(".ql-success")) el.result.hidden = true;
  }, 4500);
}

// ----------------------------------------------------------------------------
// Voice (Web Speech API)
// ----------------------------------------------------------------------------
function setupVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR || !el.mic) {
    if (el.mic) el.mic.hidden = true; // no support → hide the mic, typing still works
    return;
  }
  const rec = new SR();
  rec.lang = "en-US";
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec.onresult = (e) => {
    const said = e.results?.[0]?.[0]?.transcript || "";
    el.input.value = said;
    if (said) submitText(said);
  };
  const stop = () => el.mic.classList.remove("is-recording");
  rec.onend = stop;
  rec.onerror = stop;
  el.mic.addEventListener("click", () => {
    try {
      rec.start();
      el.mic.classList.add("is-recording");
    } catch {
      /* already started / blocked — ignore */
    }
  });
}

// ----------------------------------------------------------------------------
// Wiring
// ----------------------------------------------------------------------------
function init() {
  el.form.addEventListener("submit", (e) => {
    e.preventDefault();
    submitText(el.input.value);
  });
  el.result.addEventListener("click", (e) => {
    if (e.target.closest('[data-act="ql-confirm"]')) confirmLog();
    else if (e.target.closest('[data-act="ql-cancel"]')) {
      pending = null;
      el.result.hidden = true;
      el.input.focus();
    }
  });
  setupVoice();
}

// Start (after all module-level consts/functions above are initialized).
if (el.form && el.input) init();
