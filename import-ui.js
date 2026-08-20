/**
 * SpotterAI — /import: paste any training plan, get the audit
 * ============================================================================
 * The no-account entry point. Someone pastes a plan from a chatbot, a PDF or a
 * coach's email and gets the same flags-first verdict a plan generated here
 * gets. No onboarding, no profile, no signup.
 *
 * Three states, in order:
 *   paste    → textarea + cap counter
 *   confirm  → "we read 4 days and 18 exercises" before we audit anything (T5)
 *   verdict  → flags first, via the shared renderer in audit-view.js
 *
 * The confirm step is the important one. A partial parse that slipped through
 * would otherwise produce a confident verdict on a plan we only half-read, and
 * the person pasting has no way to know we misread them.
 */

import { evaluatePlan, EVALUATOR_VERSION } from "./evaluator.js";
import { allClearText, auditVerdictText, esc, flaggedChecks, renderFlagCard } from "./audit-view.js";
import { fetchWithTimeout } from "./ai-errors.js";
import { sendAuditTelemetry } from "./audit-telemetry-client.js";
import { trackFunnel } from "./analytics.js";

const MAX_TEXT_CHARS = 8000;

// Safe outside a browser so the pure exports (FAILURE_COPY, describeShape) can
// be imported under node:test without a DOM.
const $ = (id) => (typeof document === "undefined" ? null : document.getElementById(id));
const el = {
  view: $("import"),
  paste: $("import-paste"),
  text: $("import-text"),
  count: $("import-count"),
  submit: $("import-submit"),
  loading: $("import-loading"),
  error: $("import-error"),
  errorText: $("import-error-text"),
  errorRetry: $("import-error-retry"),
  confirm: $("import-confirm"),
  confirmText: $("import-confirm-text"),
  confirmGo: $("import-confirm-go"),
  confirmBack: $("import-confirm-back"),
  result: $("import-result"),
  verdict: $("import-verdict"),
  counts: $("import-counts"),
  flags: $("import-flags"),
  passed: $("import-passed"),
  passedList: $("import-passed-list"),
  passedCount: $("import-passed-count"),
  unassessed: $("import-unassessed"),
  unassessedList: $("import-unassessed-list"),
  unassessedCount: $("import-unassessed-count"),
  version: $("import-version"),
  again: $("import-again"),
};

let parsedPlan = null;

/**
 * One message per failure cause (T11).
 *
 * The endpoint returns a `failure_class`; a single "something went wrong" would
 * hide the difference between "you pasted a grocery list" and "our key is rate
 * limited", which are the user's problem and ours respectively.
 */
const FAILURE_COPY = {
  empty: "Paste your plan into the box first.",
  too_short: "That looks too short to be a training plan. Paste the whole thing, including the days, exercises, sets and reps.",
  not_a_plan: "We could not find a training plan in that. Make sure the days and exercises are in there, with sets and reps.",
  rate_limited: "A few too many imports just now. Wait a minute and try again.",
  timeout: "That took too long to read. Try again, or paste a shorter version.",
  unavailable: "The reader is unavailable right now. Your plan was not sent anywhere. Try again shortly.",
  invalid_response: "We could not read the response. Try again.",
  offline: "You are offline. The audit itself runs on your device, but reading a pasted plan needs a connection.",
  unknown: "Something went wrong reading that plan. Try again.",
};

function show(state) {
  for (const k of ["paste", "loading", "error", "confirm", "result"]) {
    if (el[k]) el[k].hidden = k !== state;
  }
}

function updateCount() {
  if (!el.text || !el.count) return;
  const n = el.text.value.length;
  el.count.textContent = `${n.toLocaleString()} / ${MAX_TEXT_CHARS.toLocaleString()}`;
  el.count.classList.toggle("is-over", n > MAX_TEXT_CHARS);
  if (el.submit) el.submit.disabled = n < 40 || n > MAX_TEXT_CHARS;
}

function fail(failureClass) {
  const cls = FAILURE_COPY[failureClass] ? failureClass : "unknown";
  if (el.errorText) el.errorText.textContent = FAILURE_COPY[cls];
  trackFunnel("plan_import_failed", { failure_class: cls });
  show("error");
}

/** "We read 4 training days and 18 exercises." Never audit before this is confirmed. */
function describeShape(shape) {
  const parts = [
    `${shape.trainingDays} training day${shape.trainingDays === 1 ? "" : "s"}`,
    `${shape.exercises} exercise${shape.exercises === 1 ? "" : "s"}`,
  ];
  if (shape.restDays > 0) parts.push(`${shape.restDays} rest day${shape.restDays === 1 ? "" : "s"}`);
  const progression = shape.hasProgression
    ? "It also states how to progress."
    : "It does not say how to progress, which the audit will flag.";
  return `We read ${parts.join(", ")}. ${progression}`;
}

async function readPlan() {
  const text = el.text?.value || "";
  if (text.trim().length < 40) return fail("too_short");

  show("loading");
  try {
    const res = await fetchWithTimeout(
      "api/import",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) },
      50_000
    );

    let data = null;
    try {
      data = await res.json();
    } catch {
      return fail("invalid_response");
    }

    if (!res.ok) return fail(data?.failure_class || (res.status === 429 ? "rate_limited" : "unknown"));
    if (!data?.plan) return fail("not_a_plan");

    parsedPlan = data.plan;
    if (el.confirmText) el.confirmText.textContent = describeShape(data.shape);
    show("confirm");
  } catch (err) {
    if (navigator.onLine === false) return fail("offline");
    fail(err?.name === "TimeoutError" ? "timeout" : "unavailable");
  }
}

/** Render the audit. Same evaluator, same cards, same copy as a generated plan. */
function renderAudit() {
  if (!parsedPlan) return;

  // No profile on purpose: this person never onboarded. The unassessed checks
  // are the honest consequence, and the not_assessed tier exists to show them.
  const audit = evaluatePlan(parsedPlan, {});
  sendAuditTelemetry(audit, parsedPlan, {}, "import");
  const s = audit.summary;
  const verdict = auditVerdictText(s);

  if (el.verdict) {
    el.verdict.textContent = verdict.text;
    el.verdict.className = `audit__verdict is-${verdict.tone}`;
  }

  if (el.counts) {
    el.counts.innerHTML = [
      { cls: "is-crit", n: s.critical, label: "critical" },
      { cls: "is-warn", n: s.warning, label: "warnings" },
      { cls: "is-sugg", n: s.suggestion, label: "suggestions" },
      { cls: "is-ok", n: `${s.passed}/${s.total}`, label: "passed" },
    ]
      .concat(s.not_assessed > 0 ? [{ cls: "is-unknown", n: s.not_assessed, label: "not assessed" }] : [])
      .map((c) => `<li class="${c.cls}"><strong>${esc(c.n)}</strong> ${c.label}</li>`)
      .join("");
  }

  const flagged = flaggedChecks(audit);
  if (el.flags) {
    el.flags.innerHTML = flagged.length
      ? flagged.map(renderFlagCard).join("")
      : `<p class="audit__clear">${esc(allClearText(s))}</p>`;
  }

  const rows = (list) =>
    list
      .map((c) => `<li><span class="audit__passed-label">${esc(c.label)}</span><span class="audit__passed-detail">${esc(c.detail)}</span></li>`)
      .join("");

  const passed = audit.checks.filter((c) => c.tier === "pass");
  if (el.passedList) el.passedList.innerHTML = rows(passed);
  if (el.passedCount) el.passedCount.textContent = passed.length;
  if (el.passed) el.passed.hidden = passed.length === 0;

  const unassessed = audit.checks.filter((c) => c.tier === "not_assessed");
  if (el.unassessedList) el.unassessedList.innerHTML = rows(unassessed);
  if (el.unassessedCount) el.unassessedCount.textContent = unassessed.length;
  if (el.unassessed) el.unassessed.hidden = unassessed.length === 0;

  if (el.version) el.version.textContent = EVALUATOR_VERSION;

  trackFunnel("plan_imported", { has_progression: String((parsedPlan.progression || "").trim().length > 0) });
  show("result");
}

function reset() {
  parsedPlan = null;
  if (el.text) el.text.value = "";
  updateCount();
  show("paste");
}

export function initImportUi() {
  if (!el.view) return;
  el.text?.addEventListener("input", updateCount);
  el.submit?.addEventListener("click", readPlan);
  el.confirmGo?.addEventListener("click", renderAudit);
  el.confirmBack?.addEventListener("click", () => show("paste"));
  el.errorRetry?.addEventListener("click", () => show("paste"));
  el.again?.addEventListener("click", reset);

  // Opening a flag's "why this rule exists" is the signal that the audit is
  // being read rather than glanced at. Once per visit is enough to know that.
  let flagsOpened = false;
  el.flags?.addEventListener("toggle", (e) => {
    if (!flagsOpened && e.target?.tagName === "DETAILS" && e.target.open) {
      flagsOpened = true;
      trackFunnel("import_flags_opened");
    }
  }, true);

  updateCount();
}

export { FAILURE_COPY, describeShape, MAX_TEXT_CHARS };

if (typeof document !== "undefined") initImportUi();
