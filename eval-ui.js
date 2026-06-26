/**
 * SpotterAI — Evals page (red-team report for the evaluator)
 * ============================================================================
 * Renders the eval-suite results as a live, model-eval-style report: a battery
 * of good/bad plans, each with expectations and the auditor's actual output.
 * Same source of truth as the CI gate (test/eval-suite.test.js).
 */

import { runEvalSuite } from "./eval-suite.js";

const page = document.getElementById("eval-page");
const rerun = document.getElementById("eval-rerun");

function esc(t) {
  const d = document.createElement("div");
  d.textContent = t == null ? "" : String(t);
  return d.innerHTML;
}

function render() {
  if (!page) return;
  const results = runEvalSuite();
  const totalExp = results.reduce((n, r) => n + r.expectations.length, 0);
  const passExp = results.reduce((n, r) => n + r.expectations.filter((e) => e.ok).length, 0);
  const casesPass = results.filter((r) => r.passed).length;
  const allGreen = casesPass === results.length;

  const summary = `<div class="eval-summary ${allGreen ? "is-pass" : "is-fail"}">
    <span class="eval-summary__big">${casesPass}/${results.length}</span>
    <span class="eval-summary__label">cases passing · ${passExp}/${totalExp} expectations met</span>
  </div>`;

  const cards = results
    .map(
      (r, i) => `
    <div class="eval-case ${r.passed ? "is-pass" : "is-fail"}">
      <button type="button" class="eval-case__head" data-i="${i}" aria-expanded="false">
        <span class="eval-case__status">${r.passed ? "✓" : "✗"}</span>
        <span class="eval-case__main"><span class="eval-case__name">${esc(r.name)}</span><span class="eval-case__desc">${esc(r.desc)}</span></span>
        <span class="eval-case__score">${r.score}<small>/100</small></span>
      </button>
      <div class="eval-case__body" hidden>
        <p class="eval-case__sub">Expectations</p>
        <ul class="eval-exp">${r.expectations.map((e) => `<li class="${e.ok ? "ok" : "bad"}">${e.ok ? "✓" : "✗"} ${esc(e.desc)}</li>`).join("")}</ul>
        <p class="eval-case__sub">Auditor output</p>
        <ul class="eval-checks">${r.checks.map((c) => `<li class="eval-check eval-check--${c.status}"><span class="eval-check__badge">${esc(c.status)}</span><div><strong>${esc(c.label)}</strong><span class="muted">${esc(c.detail)}</span></div></li>`).join("")}</ul>
      </div>
    </div>`
    )
    .join("");

  page.innerHTML = summary + `<div class="eval-cases">${cards}</div>`;
}

page?.addEventListener("click", (e) => {
  const head = e.target.closest(".eval-case__head");
  if (!head) return;
  const body = head.nextElementSibling;
  const open = body.hidden;
  body.hidden = !open;
  head.setAttribute("aria-expanded", open ? "true" : "false");
});
rerun?.addEventListener("click", render);

if (page) render();
