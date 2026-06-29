/**
 * SpotterAI — Pain Mode UI
 * ============================================================================
 * A conservative pain check-in. Opened by the `spotter:report-pain` event (from
 * the Today screen, workout logging, or the form check). Collects location +
 * severity + timing, runs the pure assessment (pain.js), logs it, and — when the
 * location maps to an evaluator injury — adds it as a limitation and re-audits
 * the current plan. It never diagnoses or prescribes rehab.
 */

import {
  assessPain,
  PAIN_LOCATIONS,
  PAIN_SEVERITIES,
  PAIN_TIMINGS,
  PAIN_LOCATION_LABEL,
  PAIN_SEVERITY_LABEL,
} from "./pain.js";
import { addPainReport } from "./tracker-store.js";
import { store, setPlan } from "./store.js";

const modal = document.getElementById("pain-modal");
const content = document.getElementById("pain-content");
const closeBtn = document.getElementById("pain-close");

function esc(t) {
  const d = document.createElement("div");
  d.textContent = t == null ? "" : String(t);
  return d.innerHTML;
}

const TIMING_LABEL = { warmup: "During warm-up", during_set: "During a set", after: "After workout", ongoing: "Ongoing" };

const sel = { location: null, severity: null, timing: null };

function open() {
  Object.assign(sel, { location: null, severity: null, timing: null });
  renderIntake();
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  setTimeout(() => modal.querySelector(".pain-chip")?.focus(), 50);
}
function close() {
  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");
}

const chip = (group, value, label) => `<button type="button" class="pain-chip${sel[group] === value ? " is-active" : ""}" data-group="${group}" data-value="${value}">${esc(label)}</button>`;

function renderIntake() {
  content.innerHTML = `
    <p class="pain-intro">SpotterAI can't diagnose pain — this just helps it adjust your plan conservatively.</p>
    <div class="pain-field"><span class="pain-label">Where is it?</span><div class="pain-chips">${PAIN_LOCATIONS.map((l) => chip("location", l, PAIN_LOCATION_LABEL[l])).join("")}</div></div>
    <div class="pain-field"><span class="pain-label">How bad?</span><div class="pain-chips">${PAIN_SEVERITIES.map((s) => chip("severity", s, PAIN_SEVERITY_LABEL[s])).join("")}</div></div>
    <div class="pain-field"><span class="pain-label">When?</span><div class="pain-chips">${PAIN_TIMINGS.map((t) => chip("timing", t, TIMING_LABEL[t])).join("")}</div></div>
    <div class="pain-field"><label class="pain-label" for="pain-note">Anything else? (optional)</label><input id="pain-note" class="input" autocomplete="off" placeholder="e.g. left knee, only on the way down" /></div>
    <button type="button" id="pain-submit" class="btn btn--primary" ${!sel.location || !sel.severity ? "disabled" : ""}>Get guidance</button>`;
}

function renderResponse(res, changed) {
  content.innerHTML = `
    <div class="pain-result pain-result--${res.tone}">
      <h3 class="pain-result__headline">${esc(res.headline)}</h3>
      <ul class="pain-result__advice">${res.advice.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>
      ${changed ? `<p class="pain-changed">✓ ${esc(changed)}</p>` : ""}
      <p class="pain-disclaimer">${esc(res.disclaimer)}</p>
      <div class="pain-result__actions">
        <button type="button" id="pain-done" class="btn btn--primary">Done</button>
        ${res.injuryKey && store.plan ? `<button type="button" id="pain-view-audit" class="btn btn--ghost">View updated audit</button>` : ""}
      </div>
    </div>`;
}

function submit() {
  if (!sel.location || !sel.severity) return;
  const note = content.querySelector("#pain-note")?.value || "";
  const res = assessPain({ location: sel.location, severity: sel.severity });
  addPainReport({ location: sel.location, severity: sel.severity, timing: sel.timing, note, injuryKey: res.injuryKey });

  let changed;
  if (res.addLimitation && res.injuryKey && store.plan) {
    const inputs = store.inputs || {};
    const injuries = [...new Set([...(inputs.injuries || []).filter((v) => v && v !== "none"), res.injuryKey])];
    setPlan(store.plan, { ...inputs, injuries }); // → re-audit (app.js listens to spotter:plan)
    changed = `Logged ${res.label.toLowerCase()} as a limitation and re-audited your current plan.`;
  } else if (res.injuryKey) {
    changed = `Logged ${res.label.toLowerCase()} as a limitation — your next plan and adaptation will account for it.`;
  } else {
    changed = "Logged for your records and adaptation context.";
  }
  renderResponse(res, changed);
}

if (modal && content) {
  modal.addEventListener("click", (e) => {
    if (e.target === modal) return close();
    const chipBtn = e.target.closest(".pain-chip");
    if (chipBtn) {
      sel[chipBtn.dataset.group] = chipBtn.dataset.value;
      chipBtn.parentElement.querySelectorAll(".pain-chip").forEach((c) => c.classList.toggle("is-active", c === chipBtn));
      const submitBtn = content.querySelector("#pain-submit");
      if (submitBtn) submitBtn.disabled = !sel.location || !sel.severity;
      return;
    }
    if (e.target.closest("#pain-submit")) return submit();
    if (e.target.closest("#pain-done")) return close();
    if (e.target.closest("#pain-view-audit")) {
      close();
      location.hash = "#/";
    }
  });
  closeBtn?.addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.classList.contains("is-open")) close();
  });
  window.addEventListener("spotter:report-pain", open);
}
