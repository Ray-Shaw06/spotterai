/**
 * SpotterAI — Split Lab UI
 * ============================================================================
 * Renders the split/workout effectiveness analysis over the user's saved
 * workouts (routines). Lets them quick-start any saved workout at the gym
 * (dispatches "spotter:start-routine", handled by workout-ui), and explains how
 * to add their own. Falls back to analysing the current plan if no routines
 * are saved yet, so the feature is useful from day one.
 */

import { analyzeSplit } from "./split-analyzer.js";
import { getRoutines, removeRoutine } from "./tracker-store.js";
import { store } from "./store.js";

const mount = document.getElementById("split-content");

const MUSCLE_ORDER = ["chest", "back", "shoulders", "biceps", "triceps", "quads", "hamstrings", "glutes", "calves", "core"];
const RATING_LABEL = { balanced: "Well-sized", "too-long": "Very long", "full-body": "Full-body", light: "Short", empty: "Empty" };

function esc(t) {
  const d = document.createElement("div");
  d.textContent = t == null ? "" : String(t);
  return d.innerHTML;
}
const cap = (s) => String(s || "").charAt(0).toUpperCase() + String(s || "").slice(1);

// Plan days → the same { name, exercises:[{name,sets}] } shape the analyzer wants.
function planAsWorkouts() {
  const days = (store.plan && store.plan.days) || [];
  return days
    .filter((d) => (d.exercises || []).length)
    .map((d) => ({ name: d.focus || d.day || "Session", exercises: (d.exercises || []).map((e) => ({ name: e.name, sets: Number(e.sets) || 0 })) }));
}

function scoreHero(a, source) {
  const tone = a.score >= 85 ? "good" : a.score >= 70 ? "ok" : a.score >= 50 ? "warn" : "bad";
  return `
    <div class="split-hero">
      <div class="split-score split-score--${tone}">
        <span class="split-score__n">${a.score}</span>
        <span class="split-score__d">/100</span>
      </div>
      <div class="split-hero__body">
        <p class="split-hero__grade">${esc(a.grade)} split <span class="split-hero__src">· ${esc(source)}</span></p>
        <p class="split-hero__sum">${esc(a.summary)}</p>
      </div>
    </div>`;
}

function volumeBars(a) {
  const { min, max } = a.optimalRange;
  const peak = Math.max(24, ...MUSCLE_ORDER.map((g) => a.weeklySetsByMuscle[g] || 0));
  const rows = MUSCLE_ORDER.map((g) => {
    const v = a.weeklySetsByMuscle[g] || 0;
    const tone = v === 0 ? "none" : v < min ? "low" : v > max ? "high" : "ok";
    const freq = a.frequencyByMuscle[g] || 0;
    return `<div class="vbar">
      <span class="vbar__label">${esc(cap(g))}</span>
      <span class="vbar__track"><span class="vbar__fill vbar__fill--${tone}" style="width:${Math.min(100, (v / peak) * 100)}%"></span></span>
      <span class="vbar__val">${v}<span class="vbar__freq">×${freq}/wk</span></span>
    </div>`;
  }).join("");
  return `<div class="split-card">
    <div class="split-card__head"><h3 class="split-h">Weekly sets per muscle</h3><span class="split-legend">Target ${min}–${max} · <span class="vdot vdot--low"></span>low <span class="vdot vdot--ok"></span>ideal <span class="vdot vdot--high"></span>high</span></div>
    <div class="vbars">${rows}</div>
  </div>`;
}

function balanceCard(a) {
  const b = a.balance;
  const pair = (label, x, y, lx, ly) => {
    const total = x + y || 1;
    return `<div class="bal">
      <div class="bal__head"><span>${esc(lx)} <strong>${x}</strong></span><span><strong>${y}</strong> ${esc(ly)}</span></div>
      <div class="bal__bar"><span class="bal__l" style="width:${(x / total) * 100}%"></span><span class="bal__r" style="width:${(y / total) * 100}%"></span></div>
      <span class="bal__cap">${esc(label)}</span>
    </div>`;
  };
  return `<div class="split-card">
    <h3 class="split-h">Balance</h3>
    <div class="bals">
      ${pair("Push vs pull", b.push, b.pull, "Push", "Pull")}
      ${pair("Upper vs lower", b.upper, b.lower, "Upper", "Lower")}
      ${pair("Quads vs hamstrings", b.quad, b.ham, "Quad", "Ham")}
    </div>
  </div>`;
}

function flagsCard(a) {
  if (!a.flags.length) {
    return `<div class="split-card"><h3 class="split-h">Findings</h3><p class="split-pass">✓ No imbalances flagged — every major muscle sits in a sensible weekly range.</p></div>`;
  }
  const order = { warning: 0, suggestion: 1, critical: -1 };
  const items = [...a.flags].sort((x, y) => (order[x.tier] ?? 2) - (order[y.tier] ?? 2)).map((f) => `
    <li class="sflag sflag--${esc(f.tier)}">
      <span class="sflag__tier">${f.tier === "warning" ? "Address" : f.tier === "critical" ? "Important" : "Tweak"}</span>
      <div><strong>${esc(f.title)}</strong><p>${esc(f.detail)}</p></div>
    </li>`).join("");
  return `<div class="split-card"><h3 class="split-h">Findings &amp; fixes</h3><ul class="sflags">${items}</ul></div>`;
}

function workoutsCard(a, routines) {
  if (!routines.length) {
    return `<div class="split-card split-empty">
      <h3 class="split-h">Your saved workouts</h3>
      <p class="split-note">You haven't saved any workouts yet. Build a session on the <a href="#/dashboard" data-nav="dashboard">Dashboard</a> (add your own exercises), then hit <strong>“Save as routine”</strong> — it'll show up here to quick-start at the gym and feed this analysis.</p>
    </div>`;
  }
  const cards = a.perWorkout.map((w, i) => {
    const r = routines[i];
    return `<div class="wcard wcard--${esc(w.rating)}">
      <div class="wcard__top">
        <strong class="wcard__name">${esc(w.name)}</strong>
        <span class="wcard__badge">${esc(RATING_LABEL[w.rating] || w.rating)}</span>
      </div>
      <p class="wcard__meta">${w.sets} sets · ${w.groupsHit} muscle group${w.groupsHit === 1 ? "" : "s"}${w.top.length ? " · " + w.top.map(cap).join(", ") : ""}</p>
      <p class="wcard__note">${esc(w.note)}</p>
      <div class="wcard__actions">
        <button type="button" class="btn btn--primary btn--sm" data-start="${esc(r.id)}">Quick start</button>
        <button type="button" class="btn-link-danger wcard__del" data-del="${esc(r.id)}">Delete</button>
      </div>
    </div>`;
  }).join("");
  return `<div class="split-card">
    <div class="split-card__head"><h3 class="split-h">Your saved workouts</h3><span class="split-legend">${routines.length} saved · run each ~1×/week</span></div>
    <div class="wcards">${cards}</div>
  </div>`;
}

function render() {
  if (!mount) return;
  const routines = getRoutines();
  const usingRoutines = routines.length > 0;
  const workouts = usingRoutines ? routines : planAsWorkouts();
  const source = usingRoutines ? "your saved workouts" : "your current plan";

  if (!workouts.length) {
    mount.innerHTML = `<div class="split-card split-empty">
      <h3 class="split-h">Nothing to analyse yet</h3>
      <p class="split-note">Save the workouts you run — build a session on the <a href="#/dashboard" data-nav="dashboard">Dashboard</a> and tap <strong>“Save as routine”</strong>, or <a href="#/" data-nav="home">build a plan</a>. Then come back to quick-start them and see how effective your split is.</p>
    </div>`;
    return;
  }

  const a = analyzeSplit(workouts);
  mount.innerHTML = `
    ${scoreHero(a, source)}
    ${!usingRoutines ? `<p class="split-tip">Analysing your generated plan. Save workouts as routines on the Dashboard to track and quick-start the split you actually run.</p>` : ""}
    <div class="split-grid">
      ${volumeBars(a)}
      ${balanceCard(a)}
    </div>
    ${flagsCard(a)}
    ${workoutsCard(a, usingRoutines ? routines : [])}`;
}

if (mount) {
  mount.addEventListener("click", (e) => {
    const start = e.target.closest("[data-start]");
    if (start) {
      window.dispatchEvent(new CustomEvent("spotter:start-routine", { detail: { id: start.dataset.start } }));
      return;
    }
    const del = e.target.closest("[data-del]");
    if (del && confirm("Delete this saved workout?")) {
      removeRoutine(del.dataset.del);
      render();
    }
  });
  window.addEventListener("spotter:route", (e) => { if (e.detail?.route === "split") render(); });
  window.addEventListener("spotter:tracker", () => { if (document.querySelector('[data-view="split"]:not([hidden])')) render(); });
  window.addEventListener("spotter:plan", () => { if (document.querySelector('[data-view="split"]:not([hidden])')) render(); });
  render();
}
