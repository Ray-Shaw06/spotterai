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

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `missing CSS rule for ${selector}`);
  return match[1];
}

test("connected cards own their desktop inset and wide grid gutter", () => {
  assert.match(rule(".quicklog"), /padding:\s*var\(--space-5\)/);
  assert.match(rule(".dash-card"), /padding:\s*var\(--space-5\)/);
  assert.match(rule(".dash-grid"), /gap:\s*var\(--space-5\)/);
});

test("connected spacing compacts at the approved breakpoints", () => {
  assert.match(
    css,
    /@media \(max-width: 960px\)\s*\{[\s\S]*?\.dash-grid\s*\{[^}]*gap:\s*var\(--space-4\)/
  );
  assert.match(
    css,
    /@media \(max-width: 600px\)\s*\{[\s\S]*?\.dash-card,\s*\.quicklog\s*\{[^}]*padding:\s*var\(--space-4\)/
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
  assert.match(rule(".badges"), /grid-auto-rows:\s*1fr/);

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
  assert.match(
    css,
    /@media \(max-width: 480px\)\s*\{[\s\S]*?\.badges\s*\{[^}]*minmax\(140px,\s*1fr\)/
  );
  assert.match(
    css,
    /@media \(max-width: 600px\)\s*\{[\s\S]*?\.nut-targets\s*\{[^}]*grid-template-columns:\s*1fr/
  );
});
