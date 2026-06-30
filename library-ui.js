/**
 * SpotterAI — Exercise Library UI
 * ============================================================================
 * A browsable library backed by the structured exercise DB + movement-pattern
 * cues. Each exercise opens a detail view (how to perform, common mistakes,
 * safety/cautions, regressions/progressions, where it's in your plan) with
 * favorite / dislike and a substitution flow that can swap an exercise in the
 * current plan and re-audit it. Unknown exercises degrade gracefully.
 */

import { EXERCISE_DATA, lookupExercise, suggestAlternatives } from "./exercise-data.js";
import { cuesFor, PATTERN_LABEL } from "./movement-cues.js";
import { patternAnimation } from "./exercise-anim.js";
import { getExercisePrefs, toggleExercisePref, getActiveLimitations } from "./tracker-store.js";
import { store, setPlan } from "./store.js";

const $ = (id) => document.getElementById(id);
const grid = $("lib-grid");
const filtersEl = $("lib-filters");
const searchEl = $("lib-search");
const modal = $("exercise-modal");
const detailEl = $("exercise-detail");
const titleEl = $("exercise-title");
const closeBtn = $("exercise-close");

function esc(t) {
  const d = document.createElement("div");
  d.textContent = t == null ? "" : String(t);
  return d.innerHTML;
}
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const pretty = (s) => cap(String(s || "").replace(/_/g, " "));

const MUSCLES = ["all", "chest", "back", "shoulders", "biceps", "triceps", "quads", "hamstrings", "glutes", "calves", "core"];
let activeMuscle = "all";
let query = "";
let currentName = null;
let mode = "detail"; // "detail" | "swap"

function matches(e) {
  if (activeMuscle !== "all" && !(e.primaryMuscles || []).includes(activeMuscle) && !(e.secondaryMuscles || []).includes(activeMuscle)) return false;
  if (query && !e.name.toLowerCase().includes(query)) return false;
  return true;
}

function renderFilters() {
  if (!filtersEl) return;
  filtersEl.innerHTML = MUSCLES.map((m) => `<button type="button" class="lib-chip${activeMuscle === m ? " is-active" : ""}" data-muscle="${m}">${m === "all" ? "All" : cap(m)}</button>`).join("");
}

function renderGrid() {
  if (!grid) return;
  const prefs = getExercisePrefs();
  const fav = new Set(prefs.favorites);
  const dis = new Set(prefs.disliked);
  const list = EXERCISE_DATA.filter(matches);
  grid.innerHTML = list.length
    ? list
        .map(
          (e) => `<button type="button" class="lib-card" data-name="${esc(e.name)}">
            <span class="lib-card__name">${esc(e.name)}${fav.has(e.name) ? ' <span class="lib-tag lib-tag--fav" title="Favorite">★</span>' : ""}${dis.has(e.name) ? ' <span class="lib-tag lib-tag--dis" title="Disliked">✕</span>' : ""}</span>
            <span class="lib-card__meta">${esc(PATTERN_LABEL[e.movementPattern] || e.movementPattern)} · ${esc((e.primaryMuscles || []).map(cap).join(", "))}</span>
            ${e.difficulty ? `<span class="lib-card__diff">${esc(cap(e.difficulty))}</span>` : ""}
          </button>`
        )
        .join("")
    : `<p class="muted lib-empty">No exercises match. Try a different search or filter.</p>`;
}

function inPlan(name) {
  const found = new Set();
  for (const d of store.plan?.days || []) for (const ex of d.exercises || []) if (ex.name === name) found.add(d.focus || d.day || "your plan");
  return [...found];
}

function openDetail(name) {
  currentName = name;
  mode = "detail";
  renderDetail();
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  setTimeout(() => detailEl.querySelector("button")?.focus(), 50);
}
function close() {
  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");
}

const list = (arr) => (arr && arr.length ? `<ul class="lib-list">${arr.map((x) => `<li>${esc(cap(x))}</li>`).join("")}</ul>` : `<span class="muted">—</span>`);

function renderDetail() {
  if (titleEl) titleEl.textContent = currentName;
  const e = lookupExercise(currentName);
  if (!e) {
    detailEl.innerHTML = `<p class="lib-fallback">SpotterAI has limited metadata for “${esc(currentName)}”. You can still log and swap it — detailed coaching cues just aren't available for this one.</p>`;
    return;
  }
  if (mode === "swap") return renderSwap(e);

  const cues = cuesFor(e.movementPattern);
  const prefs = getExercisePrefs();
  const isFav = prefs.favorites.includes(e.name);
  const isDis = prefs.disliked.includes(e.name);
  const where = inPlan(e.name);
  const contra = [...new Set(e.contraindications || [])];
  const modifyIf = contra.length
    ? `Modify or swap if it causes ${contra.map(pretty).map((s) => s.toLowerCase()).join(", ")} pain.`
    : "Modify or swap this exercise if it causes knee, lower-back, shoulder, or wrist pain.";
  const badge = (t) => `<span class="lib-badge">${esc(t)}</span>`;

  detailEl.innerHTML = `
    ${patternAnimation(e.movementPattern, e.primaryMuscles)}
    <div class="lib-badges">${badge(PATTERN_LABEL[e.movementPattern] || e.movementPattern)}${(e.equipment || []).map((q) => badge(cap(q))).join("")}${e.difficulty ? badge(cap(e.difficulty)) : ""}</div>
    <div class="lib-cols2">
      <div><h5 class="lib-h5">Primary muscles</h5>${list(e.primaryMuscles)}</div>
      <div><h5 class="lib-h5">Secondary muscles</h5>${list(e.secondaryMuscles)}</div>
    </div>
    <div class="lib-block"><h5 class="lib-h5">Setup</h5><p class="lib-p">${esc(cues.setup)}</p></div>
    <div class="lib-block"><h5 class="lib-h5">How to perform</h5>${list(cues.howto)}</div>
    <div class="lib-block"><h5 class="lib-h5">Common mistakes</h5>${list(cues.mistakes)}</div>
    <div class="lib-block lib-block--safety">
      <h5 class="lib-h5">Safety &amp; cautions</h5>
      <p class="lib-p">${esc(cues.safety)} ${esc(modifyIf)} <span class="lib-muted">SpotterAI cannot diagnose pain.</span></p>
      ${(e.jointStress || []).length ? `<p class="lib-muted">Loads the: ${[...new Set(e.jointStress)].map(pretty).map((s) => s.toLowerCase()).join(", ")}.</p>` : ""}
    </div>
    <div class="lib-cols2">
      <div><h5 class="lib-h5">Easier (regressions)</h5>${list(e.regressionOptions)}</div>
      <div><h5 class="lib-h5">Harder (progressions)</h5>${list(e.progressionOptions)}</div>
    </div>
    <div class="lib-block"><h5 class="lib-h5">Common substitutions</h5>${list(e.commonSubstitutions)}</div>
    ${where.length ? `<p class="lib-inplan">In your plan: ${esc(where.join(", "))}</p>` : ""}
    <div class="lib-actions">
      <button type="button" class="btn btn--ghost btn--sm" data-act="fav">${isFav ? "★ Favorited" : "☆ Favorite"}</button>
      <button type="button" class="btn btn--ghost btn--sm" data-act="dislike">${isDis ? "✕ Disliked" : "Dislike"}</button>
      <button type="button" class="btn btn--primary btn--sm" data-act="swap">Safer alternatives / substitute</button>
    </div>`;
}

function effectiveLimitations() {
  const fromPain = getActiveLimitations();
  const fromPlan = (store.inputs?.injuries || []).filter((v) => v && v !== "none");
  return [...new Set([...fromPain, ...fromPlan])];
}

function renderSwap(e) {
  const lim = effectiveLimitations();
  const eq = (store.inputs?.equipment || []).some((x) => /gym/i.test(x)) ? [] : store.inputs?.equipment || [];
  const alt = suggestAlternatives(e.name, { limitations: lim, equipment: eq });
  const where = inPlan(e.name);

  const swaps = (names) => `<div class="lib-swaps">${names.map((n) => `<button type="button" class="lib-swap" data-swap="${esc(n)}">${esc(cap(n))}</button>`).join("")}</div>`;
  const group = (title, names, note) => (names && names.length ? `<div class="lib-block"><h5 class="lib-h5">${title}</h5>${note ? `<p class="lib-muted">${esc(note)}</p>` : ""}${swaps(names)}</div>` : "");

  detailEl.innerHTML = `
    <button type="button" class="detail-back" data-act="back">← Back to ${esc(e.name)}</button>
    ${lim.length ? `<p class="lib-muted">Filtered for your active limitation(s): ${lim.map(pretty).map((s) => s.toLowerCase()).join(", ")}.</p>` : ""}
    ${group("Safer alternatives", alt.safer, "Avoid movements contraindicated for your limitations.")}
    ${group("Same movement", alt.recommended)}
    ${group("Easier", alt.easier)}
    ${group("Harder", alt.harder)}
    ${alt.recommended.length || alt.safer.length || alt.easier.length || alt.harder.length ? "" : `<p class="lib-muted">No structured alternatives for this one.</p>`}
    <p class="lib-muted">${where.length ? `Tap an alternative to swap it into your plan (${esc(where.join(", "))}) and re-audit.` : "No current plan uses this exercise — tap an alternative to view it."}</p>`;
}

function doSwap(newName) {
  const where = inPlan(currentName);
  if (!store.plan || !where.length) return openDetail(newName); // not in a plan → just view the alternative

  const plan = JSON.parse(JSON.stringify(store.plan));
  for (const d of plan.days || []) for (const ex of d.exercises || []) {
    if (ex.name === currentName) {
      ex.name = newName;
      ex.notes = ex.notes ? `${ex.notes} · swapped in library` : "swapped in library";
    }
  }
  setPlan(plan, store.inputs); // → app.js re-audits + updates the Trust Report

  if (titleEl) titleEl.textContent = newName;
  detailEl.innerHTML = `
    <div class="lib-swapdone">
      <h3 class="lib-h3">Swapped to ${esc(newName)}</h3>
      <p class="lib-p">It trains the same movement pattern, so the swap is reasonable. SpotterAI re-audited your plan with the change and refreshed the Trust Report.</p>
      <div class="lib-actions">
        <button type="button" class="btn btn--primary btn--sm" data-act="view-plan">View updated audit</button>
        <button type="button" class="btn btn--ghost btn--sm" data-act="close">Done</button>
      </div>
    </div>`;
  currentName = newName;
}

// --- Wiring ----------------------------------------------------------------
grid?.addEventListener("click", (e) => {
  const card = e.target.closest(".lib-card");
  if (card) openDetail(card.dataset.name);
});
filtersEl?.addEventListener("click", (e) => {
  const chip = e.target.closest(".lib-chip");
  if (!chip) return;
  activeMuscle = chip.dataset.muscle;
  renderFilters();
  renderGrid();
});
searchEl?.addEventListener("input", () => {
  query = searchEl.value.trim().toLowerCase();
  renderGrid();
});

modal?.addEventListener("click", (e) => {
  if (e.target === modal) return close();
  const swap = e.target.closest(".lib-swap");
  if (swap) return doSwap(swap.dataset.swap);
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (act === "fav") { toggleExercisePref(currentName, "favorites"); renderDetail(); renderGrid(); }
  else if (act === "dislike") { toggleExercisePref(currentName, "disliked"); renderDetail(); renderGrid(); }
  else if (act === "swap") { mode = "swap"; renderDetail(); }
  else if (act === "back") { mode = "detail"; renderDetail(); }
  else if (act === "view-plan") { close(); location.hash = "#/"; }
  else if (act === "close") { close(); }
});
closeBtn?.addEventListener("click", close);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && modal?.classList.contains("is-open")) close();
});

if (grid) {
  renderFilters();
  renderGrid();
}
window.addEventListener("spotter:route", (e) => {
  if (e.detail?.route === "library") renderGrid();
});
