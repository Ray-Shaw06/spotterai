/**
 * Connected product layout guardrails.
 *
 * These tests protect the shared spacing and empty-state hooks without trying
 * to replace browser-based visual verification.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { barChart, lineChart } from "../charts.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(root, "style.css"), "utf8");
const workoutUi = readFileSync(join(root, "workout-ui.js"), "utf8");
const notificationUi = readFileSync(join(root, "notification-ui.js"), "utf8");

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `missing CSS rule for ${selector}`);
  return match[1];
}

function mediaBlocks(condition) {
  const header = `@media ${condition}`;
  const blocks = [];
  let cursor = 0;

  while ((cursor = css.indexOf(header, cursor)) !== -1) {
    const open = css.indexOf("{", cursor + header.length);
    assert.notEqual(open, -1, `missing opening brace for ${header}`);

    let depth = 0;
    let close = -1;
    for (let i = open; i < css.length; i += 1) {
      if (css[i] === "{") depth += 1;
      if (css[i] === "}") depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }

    assert.notEqual(close, -1, `missing closing brace for ${header}`);
    blocks.push(css.slice(open + 1, close));
    cursor = close + 1;
  }

  assert.ok(blocks.length, `missing media query ${header}`);
  return blocks;
}

function assertInMedia(condition, pattern) {
  assert.ok(
    mediaBlocks(condition).some((block) => pattern.test(block)),
    `${pattern} is not declared inside @media ${condition}`
  );
}

test("connected cards own their desktop inset and wide grid gutter", () => {
  assert.match(rule(".quicklog"), /padding:\s*var\(--space-5\)/);
  assert.match(rule(".dash-card"), /padding:\s*var\(--space-5\)/);
  assert.match(rule(".dash-grid"), /gap:\s*var\(--space-5\)/);
});

test("connected cards can shrink inside the narrow Progress grid", () => {
  assert.match(rule(".dash-card"), /min-width:\s*0/);
  assert.match(rule(".exprog__pick"), /min-width:\s*0/);
});

test("connected spacing compacts at the approved breakpoints", () => {
  assertInMedia(
    "(max-width: 960px)",
    /\.dash-grid\s*\{[^}]*gap:\s*var\(--space-4\)/
  );
  assertInMedia(
    "(max-width: 600px)",
    /\.dash-card,\s*\.quicklog\s*\{[^}]*padding:\s*var\(--space-4\)/
  );
});

test("empty charts use a dedicated accessible fixed-height presentation", () => {
  for (const markup of [barChart([]), lineChart([])]) {
    assert.match(markup, /class="chart-empty"/);
    assert.match(markup, /role="img"/);
    assert.match(markup, /aria-label="No data yet"/);
    assert.match(markup, />No data yet<\/span>/);
    assert.doesNotMatch(markup, /<svg/);
  }
  assert.match(rule(".chart-empty"), /height:\s*132px/);
});

test("History uses a centered dedicated empty row", () => {
  assert.match(workoutUi, /<li class="workout-empty muted">No workouts yet\. Start one above\.<\/li>/);
  const empty = rule("#workout-history > .workout-empty:only-child");
  assert.match(empty, /min-height:\s*132px/);
  assert.match(empty, /justify-content:\s*center/);
  assert.match(empty, /border-bottom:\s*0/);
});

test("achievement tiles have readable aligned internal rhythm", () => {
  assert.match(rule(".badges__grid"), /grid-auto-rows:\s*1fr/);

  const badge = rule(".badge");
  assert.match(badge, /gap:\s*var\(--space-2\)/);
  assert.match(badge, /padding:\s*var\(--space-4\)/);
  assert.match(badge, /min-height:\s*10rem/);

  assert.match(rule(".badge__desc"), /line-height:\s*1\.4/);
  assert.match(rule(".badge__xp"), /margin-top:\s*auto/);

  const locked = css.match(/\.badge\.is-locked\s*\{([^}]*)\}/);
  if (locked) assert.doesNotMatch(locked[1], /opacity/);
});

test("achievement columns and Nutrition targets adapt on phones", () => {
  assertInMedia(
    "(max-width: 480px)",
    /\.badges__grid\s*\{[^}]*minmax\(140px,\s*1fr\)/
  );
  assertInMedia(
    "(max-width: 600px)",
    /\.nut-targets\s*\{[^}]*grid-template-columns:\s*1fr/
  );
});

test("notification editors have full-width responsive rows and 44px touch targets", () => {
  assert.match(rule(".notification-editor"), /min-width:\s*0/);
  assert.match(rule(".notification-schedule__row"), /grid-template-columns/);
  assert.match(rule(".notification-control"), /min-height:\s*44px/);
  assert.match(rule(".notification-actions .btn"), /min-height:\s*44px/);
  assertInMedia(
    "(max-width: 600px)",
    /\.notification-schedule__row\s*\{[^}]*grid-template-columns:\s*1fr/
  );
  assert.match(notificationUi, /Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone/);
});

test("onboarding choices enforce a 44px square touch target", () => {
  assert.match(rule(".onb-chip"), /min-height:\s*44px/);
  assert.match(rule(".onb-chip"), /min-width:\s*44px/);
});

test("form-report video markers hit the 44px touch floor and the report wraps at phone width", () => {
  assert.match(rule(".marker-btn"), /min-height:\s*44px/);
  assert.match(rule(".form-report__reps"), /flex-wrap:\s*wrap/);
  assert.match(rule(".form-video__markers"), /flex-wrap:\s*wrap/);
  assert.match(rule(".form-video__player"), /width:\s*100%/);
});
