/**
 * SpotterAI — shared audit rendering (pure)
 * ============================================================================
 * The flags-first audit is now rendered on two surfaces: the plan you generated
 * here, and a plan you pasted in at /import. They must look and read identically,
 * because the product's claim is that an imported plan gets the same treatment.
 *
 * test/cross-path-sweep.test.js proves the two paths produce the same AUDIT.
 * This module is why they produce the same PAGE. Anything the home view and the
 * import view both draw lives here, so a change to one cannot quietly diverge
 * from the other.
 *
 * Pure string builders, no DOM writes, so they are testable without a browser.
 */

import { ruleForCheck } from "./rule-explanations.js";

export { ruleForCheck };

export const TIER_LABEL = { critical: "Critical", warning: "Warning", suggestion: "Suggestion" };
export const TIER_ORDER = { critical: 0, warning: 1, suggestion: 2, pass: 3, not_assessed: 4 };

/** Escape for interpolation into innerHTML. */
export function esc(text) {
  const div = document.createElement("div");
  div.textContent = text == null ? "" : String(text);
  return div.innerHTML;
}

/**
 * Plain-English verdict, led by severity, never by the word "safe".
 *
 * Unassessed checks are always named. A clean verdict that hides how much we
 * could not judge is the same false reassurance the not_assessed tier exists to
 * remove, and it would be worst here: an imported plan has no profile, so it has
 * the most unassessed checks of anything the product renders.
 */
export function auditVerdictText(summary) {
  const { critical, warning, suggestion } = summary;
  const unassessed = summary.not_assessed || 0;
  const caveat = unassessed > 0 ? `, ${unassessed} not assessed` : "";
  if (critical > 0) return { tone: "critical", text: `${critical} critical issue${critical > 1 ? "s" : ""} to resolve before training${caveat}` };
  if (warning > 0) return { tone: "warning", text: `${warning} issue${warning > 1 ? "s" : ""} to review before training${caveat}` };
  if (suggestion > 0) return { tone: "suggestion", text: `No safety flags: ${suggestion} optional suggestion${suggestion > 1 ? "s" : ""}${caveat}` };
  if (unassessed > 0) return { tone: "suggestion", text: `Nothing flagged, but ${unassessed} check${unassessed > 1 ? "s" : ""} could not be assessed` };
  return { tone: "ok", text: "No issues flagged by the audit" };
}

/** One flag card: what is wrong, the fix, safer alternatives, and why the rule exists. */
export function renderFlagCard(c, i = 0) {
  const alts = Array.isArray(c.alternatives) && c.alternatives.length
    ? `<p class="flag__row"><span class="flag__row-label">Safer alternatives</span> ${esc(c.alternatives.join(" · "))}</p>`
    : "";
  const fix = c.fix ? `<p class="flag__row"><span class="flag__row-label">Suggested fix</span> ${esc(c.fix)}</p>` : "";
  const rule = ruleForCheck(c.id);
  const why = rule
    ? `<details class="flag__rule"><summary>Why this rule exists</summary><p class="flag__rule-body">${esc(rule.why)} <span class="flag__rule-lim">Limitation: ${esc(rule.limitations)}</span></p></details>`
    : "";
  return `
    <article class="flag flag--${c.tier}" style="--i:${i}">
      <header class="flag__head">
        <span class="flag__sev">${TIER_LABEL[c.tier] || c.tier}</span>
        <span class="flag__label">${esc(c.label)}</span>
      </header>
      <p class="flag__why">${esc(c.detail)}</p>
      ${fix}
      ${alts}
      ${why}
    </article>`;
}

/** Flags only, severity-ordered. Excludes passes AND unassessed checks. */
export function flaggedChecks(audit) {
  return audit.checks
    .filter((c) => c.tier !== "pass" && c.tier !== "not_assessed")
    .sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier]);
}

/**
 * The all-pass empty state (T10).
 *
 * A plan with nothing flagged still must not read as "certified". The evaluator
 * checks a fixed rubric; silence from it means the rubric found nothing, not
 * that the plan is right for this person. When checks could not be assessed,
 * say so here too rather than leaving an unqualified clean bill of health.
 */
export function allClearText(summary) {
  const unassessed = summary?.not_assessed || 0;
  if (unassessed > 0) {
    return `Every check we could run passed, and ${unassessed} could not be assessed because we do not have your training experience or equipment. Fill those in and the audit gets sharper. Still your call: the evaluator catches common mistakes, not everything.`;
  }
  return "Every automated check passed. Still your call: the evaluator catches common mistakes, not everything.";
}
