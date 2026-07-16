# Connected App Spacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply one professional, responsive spacing system to SpotterAI's connected Dashboard, Progress, Nutrition, Quick Log, chart, History, and achievement surfaces.

**Architecture:** Keep the global `.card` surface primitive unchanged and make the connected product-card consumers own their insets. Add dedicated semantic hooks for chart and History empty states, then refine achievement and Nutrition layouts with the existing spacing tokens and breakpoints. Guard the visual contract with a focused static/markup Node test and finish with browser verification across empty and populated states.

**Tech Stack:** Static HTML, CSS custom properties, browser-native ES modules, SVG charts, Node.js 18+ built-in test runner, Vercel development server.

## Global Constraints

- No framework, hosting, or Vercel deployment changes.
- Preserve the PWA, AI endpoints, Firebase sync, service worker, manifest, persistence schemas, evaluator behavior, and existing tests.
- Do not change achievement logic, workout data, chart calculations, or Nutrition behavior.
- Do not add dependencies.
- Preserve unrelated working-tree changes, including the existing `package.json` and `package-lock.json` changes; never stage them in this work.
- Keep the global `.card` rule unchanged.
- Use 24px connected-card insets above 600px and 16px at 600px and below.
- Use a 24px dashboard gutter above 960px and 16px at 960px and below.
- Stack dashboard cards at 720px and below.
- Keep empty chart content at 132px high and empty History content at a 132px minimum height.
- Keep achievement columns at a 150px minimum above 480px and 140px at 480px and below.
- Introduce no new decorative motion, colors, fonts, effects, nested cards, or filler achievement tiles.

## File Map

- Create `test/ui-layout.test.js`: focused regression contracts for shared card spacing, empty states, achievements, and responsive Nutrition behavior.
- Modify `style.css`: connected-card insets, dashboard gutters, empty-state presentation, achievement rhythm, locked-state readability, and responsive breakpoints.
- Modify `charts.js`: return semantic HTML for an empty chart while leaving populated SVG chart calculations unchanged.
- Modify `workout-ui.js`: add a dedicated class to the existing History empty-state row.
- Do not modify `index.html`; the existing connected-section structure and class names already provide the required hooks.

---

### Task 1: Shared connected-card spacing

**Files:**
- Create: `test/ui-layout.test.js`
- Modify: `style.css:2768-2770`
- Modify: `style.css:4081-4094`
- Modify: `style.css:4464-4467`

**Interfaces:**
- Consumes: existing spacing tokens `--space-3`, `--space-4`, and `--space-5`.
- Produces: `.dash-card` and `.quicklog` responsive insets plus `.dash-grid` responsive gutters used by Dashboard, Progress, and Nutrition.

- [ ] **Step 1: Write the failing spacing contract tests**

Create `test/ui-layout.test.js` with:

```js
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

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(root, "style.css"), "utf8");

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
```

- [ ] **Step 2: Run the new tests and verify they fail**

Run:

```bash
node --test test/ui-layout.test.js
```

Expected: both tests fail because `.quicklog` and `.dash-card` have no padding and `.dash-grid` still uses `--space-4` at wide widths.

- [ ] **Step 3: Add desktop insets and the wide dashboard gutter**

Update the existing rules in `style.css` to:

```css
.quicklog {
  padding: var(--space-5);
  margin-bottom: var(--space-5);
}

.dash-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-5);
}

.dash-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-5);
}
```

- [ ] **Step 4: Add the compact-spacing breakpoints**

Replace the existing dashboard media block with:

```css
@media (max-width: 960px) {
  .dash-grid { gap: var(--space-4); }
}

@media (max-width: 720px) {
  .dash-grid { grid-template-columns: 1fr; }
  .dash-stats { grid-template-columns: repeat(2, 1fr); }
}

@media (max-width: 600px) {
  .dash-card,
  .quicklog { padding: var(--space-4); }
}
```

- [ ] **Step 5: Run the focused tests**

Run:

```bash
node --test test/ui-layout.test.js
```

Expected: 2 tests pass, 0 fail.

- [ ] **Step 6: Commit the shared spacing change**

```bash
git add style.css test/ui-layout.test.js
git commit -m "style: normalize connected card spacing"
```

---

### Task 2: Balanced chart and History empty states

**Files:**
- Modify: `test/ui-layout.test.js`
- Modify: `charts.js:9-14`
- Modify: `charts.js:22-24`
- Modify: `charts.js:41-43`
- Modify: `workout-ui.js:655`
- Modify: `style.css:4095-4100`
- Modify: `style.css:4303-4305`
- Modify: `style.css:4321-4330`

**Interfaces:**
- Consumes: `barChart(series, options)` and `lineChart(series, options)` returning HTML strings; `renderHistory()` writing list-item markup to `#workout-history`.
- Produces: `.chart-empty` accessible empty-state markup and `.workout-empty` History markup consumed by focused CSS rules.

- [ ] **Step 1: Extend the regression test with empty-state contracts**

Add this import beside the existing imports in `test/ui-layout.test.js`:

```js
import { barChart, lineChart } from "../charts.js";
```

Add this source fixture after the existing `css` fixture:

```js
const workoutUi = readFileSync(join(root, "workout-ui.js"), "utf8");
```

Append these tests:

```js
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
```

- [ ] **Step 2: Run the focused tests and verify the new cases fail**

Run:

```bash
node --test test/ui-layout.test.js
```

Expected: the original 2 tests pass; the new chart and History tests fail because both still use generic SVG/list-row markup.

- [ ] **Step 3: Replace only the chart no-data renderer**

Replace `emptyChart` in `charts.js` with:

```js
function emptyChart(msg = "No data yet") {
  return `<div class="chart-empty" role="img" aria-label="${msg}">
    <span>${msg}</span>
  </div>`;
}
```

Change the empty branches without touching populated chart calculations:

```js
if (!series || !series.length) return emptyChart();
```

and:

```js
if (!series || !series.length || series.every((p) => !p.value)) return emptyChart();
```

- [ ] **Step 4: Add the chart empty-state presentation**

Add after the existing `.chart, .ring` rule in `style.css`:

```css
.chart-empty {
  position: relative;
  display: grid;
  place-items: center;
  width: 100%;
  height: 132px;
  font-size: var(--fs-small);
  color: var(--text-faint);
}
.chart-empty::after {
  content: "";
  position: absolute;
  right: 10px;
  bottom: 12px;
  left: 10px;
  height: 2px;
  background: var(--border);
}
```

- [ ] **Step 5: Give History a semantic empty hook and balanced layout**

Change the empty branch in `workout-ui.js` to:

```js
: `<li class="workout-empty muted">No workouts yet. Start one above.</li>`;
```

Add `flex: 1` to the existing History container rule:

```css
#workout-history {
  flex: 1;
  max-height: 460px;
  overflow-y: auto;
  scrollbar-width: thin;
}
```

Add after `.entry-list li`:

```css
#workout-history > .workout-empty:only-child {
  min-height: 132px;
  justify-content: center;
  padding: var(--space-4);
  text-align: center;
  border-bottom: 0;
}
```

- [ ] **Step 6: Run the focused and existing accessibility tests**

Run:

```bash
node --test test/ui-layout.test.js test/a11y.test.js
```

Expected: all tests pass; the empty chart remains labelled as an image and the History copy remains in the DOM.

- [ ] **Step 7: Commit the empty-state change**

```bash
git add charts.js workout-ui.js style.css test/ui-layout.test.js
git commit -m "style: balance dashboard empty states"
```

---

### Task 3: Achievement rhythm and mobile Nutrition layout

**Files:**
- Modify: `test/ui-layout.test.js`
- Modify: `style.css:4390-4420`
- Modify: `style.css:4464-4467`
- Modify: `style.css:5215-5216`
- Modify: `style.css:5302-5304`

**Interfaces:**
- Consumes: existing `.badges`, `.badge`, `.badge__desc`, `.badge__xp`, `.badge.is-locked`, and `.nut-targets` markup hooks.
- Produces: equal-height achievement rows with aligned XP labels, readable locked tiles, a 140px phone column minimum, and single-column Nutrition targets at 600px and below.

- [ ] **Step 1: Add achievement and Nutrition layout tests**

Append to `test/ui-layout.test.js`:

```js
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
```

- [ ] **Step 2: Run the focused tests and verify the new cases fail**

Run:

```bash
node --test test/ui-layout.test.js
```

Expected: shared spacing and empty-state tests pass; achievement and Nutrition cases fail on the current 4px tile gap, 12px tile inset, whole-tile opacity, and two-column phone layout.

- [ ] **Step 3: Normalize achievement grid and tile rhythm**

Update the achievement rules in `style.css` to:

```css
.badges {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  grid-auto-rows: 1fr;
  gap: var(--space-3);
}
.badge {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  min-height: 10rem;
  padding: var(--space-4);
  text-align: center;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
}
.badge__desc {
  font-size: 0.72rem;
  line-height: 1.4;
  color: var(--text-faint);
}
.badge__xp {
  margin-top: auto;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--text-muted);
}
```

Delete only this rule:

```css
.badge.is-locked { opacity: 0.5; }
```

Keep `.badge.is-locked .badge__icon` unchanged so the locked state remains visually distinct.

- [ ] **Step 4: Add the achievement phone breakpoint**

Add after the 600px connected-card media block:

```css
@media (max-width: 480px) {
  .badges { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); }
}
```

- [ ] **Step 5: Collapse Nutrition targets after their base rule**

Extend the existing Nutrition media block near the end of the Nutrition section to:

```css
@media (max-width: 600px) {
  .nut-meals,
  .nut-targets { grid-template-columns: 1fr; }
  .nut-targets .dash-actions { grid-column: auto; }
}
```

- [ ] **Step 6: Run the focused tests**

Run:

```bash
node --test test/ui-layout.test.js
```

Expected: 6 tests pass, 0 fail.

- [ ] **Step 7: Commit the achievement and Nutrition refinement**

```bash
git add style.css test/ui-layout.test.js
git commit -m "style: refine achievement and nutrition layout"
```

---

### Task 4: Full visual and regression verification

**Files:**
- Verify: `style.css`
- Verify: `charts.js`
- Verify: `workout-ui.js`
- Verify: `test/ui-layout.test.js`

**Interfaces:**
- Consumes: the completed connected-card, empty-state, achievement, and responsive layout contracts from Tasks 1-3.
- Produces: a verified implementation with zero unresolved detector findings, zero test failures, and browser evidence across the approved routes and viewports.

- [ ] **Step 1: Run the focused layout suite**

Run:

```bash
node --test test/ui-layout.test.js
```

Expected: 6 tests pass, 0 fail.

- [ ] **Step 2: Run the complete existing test suite**

Run:

```bash
npm test
```

Expected: process exits 0 with 0 failing tests.

- [ ] **Step 3: Run the mechanical layout detector**

Run:

```bash
node /Users/rehaanshaw/.agents/skills/impeccable/scripts/detect.mjs --json --scope layout index.html style.css tracker-ui.js workout-ui.js charts.js
```

Expected:

```json
[]
```

- [ ] **Step 4: Start the existing Vercel development server**

Run in a persistent terminal:

```bash
npm run dev
```

Expected: Vercel reports a local HTTP URL and serves the existing app without build errors.

- [ ] **Step 5: Verify empty-profile layouts in the browser**

Open each route at the listed viewport widths:

```text
http://localhost:3000/#/dashboard  — 1440, 1280, 960, 768, 390, 320
http://localhost:3000/#/progress   — 1440, 960, 390, 320
http://localhost:3000/#/nutrition  — 1440, 960, 390, 320
```

At every width, confirm:

- Card content has a visible, even inset and no heading touches a border.
- Dashboard gutters are 24px above 960px and 16px at 960px and below.
- Dashboard cards stack at 720px and below with no horizontal overflow.
- “No data yet” is vertically balanced in a 132px area and its baseline stays inside the card.
- “No workouts yet. Start one above.” is centered without a row divider.
- Quick Log aligns with the connected cards above 600px and compacts to 16px at 600px and below.
- Nutrition targets become one column at 600px and below.

- [ ] **Step 6: Verify populated/demo-profile layouts in the browser**

From the empty Dashboard, activate **Load demo data**, then revisit Dashboard, Progress, and Nutrition at 1440px, 768px, 390px, and 320px. Confirm:

- Populated charts remain unchanged in meaning, labels, and calculations.
- History rows expand and remain scrollable with the 460px maximum height.
- Achievement tiles keep equal rhythm, XP labels align, locked copy is readable, and long descriptions are not clipped.
- The final achievement row remains left-aligned without filler tiles.
- Quick Log, workout logging, Nutrition forms, water controls, and bodyweight logging remain usable.
- Focus indicators and 44px-class coarse-pointer targets are not clipped by the new insets.

- [ ] **Step 7: Confirm only intended files changed**

Run:

```bash
git status --short
git diff --check
git diff -- style.css charts.js workout-ui.js test/ui-layout.test.js
```

Expected: no whitespace errors; the diff contains only the planned implementation files. The pre-existing `package.json` and `package-lock.json` changes remain unstaged and unchanged by this work.
