/**
 * SpotterAI — Safety Lab red-team report
 * ============================================================================
 * Renders the eval-suite as a filterable proof center: a compact pass/fail
 * summary, scenario-typed cases (good / risky / edge / false-positive guard),
 * expected-vs-actual, key flags triggered, and the full auditor output.
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

const TYPE_LABEL = { good: "Good plan", risky: "Risky plan", edge: "Edge case", guard: "False-positive guard" };
const FILTER_LABEL = { all: "All", passed: "Passed", failed: "Failed", risky: "Risky plans", guard: "False-positive guards" };

let filter = "all";

function matchesFilter(r) {
  if (filter === "passed") return r.passed;
  if (filter === "failed") return !r.passed;
  if (filter === "risky") return r.type === "risky";
  if (filter === "guard") return r.type === "guard";
  return true;
}

function render() {
  if (!page) return;
  const results = runEvalSuite();
  const totalExp = results.reduce((n, r) => n + r.expectations.length, 0);
  const passExp = results.reduce((n, r) => n + r.expectations.filter((e) => e.ok).length, 0);
  const casesPass = results.filter((r) => r.passed).length;
  const allGreen = casesPass === results.length;

  const summary = `<div class="eval-summary ${allGreen ? "is-pass" : "is-fail"}">
    <span class="eval-summary__big">${passExp}/${totalExp}</span>
    <span class="eval-summary__label">expectations passed across ${results.length} test cases · ${casesPass}/${results.length} cases green</span>
  </div>`;

  const counts = {
    all: results.length,
    passed: casesPass,
    failed: results.length - casesPass,
    risky: results.filter((r) => r.type === "risky").length,
    guard: results.filter((r) => r.type === "guard").length,
  };
  const filters = `<div class="eval-filters" role="tablist">${["all", "passed", "failed", "risky", "guard"]
    .map((f) => `<button type="button" class="eval-filter ${filter === f ? "is-active" : ""}" data-filter="${f}">${FILTER_LABEL[f]} <span class="eval-filter__n">${counts[f]}</span></button>`)
    .join("")}</div>`;

  const cards = results
    .filter(matchesFilter)
    .map(
      (r) => `
    <div class="eval-case eval-case--${r.type} ${r.passed ? "is-pass" : "is-fail"}">
      <button type="button" class="eval-case__head" aria-expanded="false">
        <span class="eval-case__status">${r.passed ? "✓" : "✗"}</span>
        <span class="eval-case__main">
          <span class="eval-case__name">${esc(r.name)} <span class="eval-case__type eval-case__type--${r.type}">${TYPE_LABEL[r.type]}</span></span>
          <span class="eval-case__desc">${esc(r.desc)}</span>
        </span>
        <span class="eval-case__score">${r.score}<small>/100</small></span>
      </button>
      <div class="eval-case__body" hidden>
        <p class="eval-case__sub">Expected vs actual</p>
        <ul class="eval-exp">${r.expectations.map((e) => `<li class="${e.ok ? "ok" : "bad"}">${e.ok ? "✓" : "✗"} ${esc(e.desc)}</li>`).join("")}</ul>
        ${r.flagged.length ? `<p class="eval-case__sub">Key flags triggered</p><div class="eval-flagchips">${r.flagged.map((f) => `<span class="eval-chip">${esc(f)}</span>`).join("")}</div>` : `<p class="eval-case__sub eval-case__sub--muted">No flags triggered.</p>`}
        <p class="eval-case__sub">Auditor output</p>
        <ul class="eval-checks">${r.checks.map((c) => `<li class="eval-check eval-check--${c.status}"><span class="eval-check__badge">${esc(c.status)}</span><div><strong>${esc(c.label)}</strong><span class="muted">${esc(c.detail)}</span></div></li>`).join("")}</ul>
      </div>
    </div>`
    )
    .join("");

  page.innerHTML = summary + filters + `<div class="eval-cases">${cards || '<p class="muted eval-empty">No cases match this filter.</p>'}</div>`;
}

page?.addEventListener("click", (e) => {
  const filterBtn = e.target.closest(".eval-filter");
  if (filterBtn) {
    filter = filterBtn.dataset.filter;
    render();
    return;
  }
  const head = e.target.closest(".eval-case__head");
  if (!head) return;
  const body = head.nextElementSibling;
  const open = body.hidden;
  body.hidden = !open;
  head.setAttribute("aria-expanded", open ? "true" : "false");
});
rerun?.addEventListener("click", render);

if (page) render();
