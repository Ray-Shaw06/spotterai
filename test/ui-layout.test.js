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

/** The sheet minus comments and every @media / @container / @supports block:
 *  only the rules that apply at every width. */
function unconditionalCss() {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  let out = "";
  let cursor = 0;
  for (const m of bare.matchAll(/@(media|container|supports)\b/g)) {
    if (m.index < cursor) continue;
    out += bare.slice(cursor, m.index);
    let depth = 0;
    let i = bare.indexOf("{", m.index);
    for (; i < bare.length; i += 1) {
      if (bare[i] === "{") depth += 1;
      if (bare[i] === "}" && --depth === 0) break;
    }
    cursor = i + 1;
  }
  return out + bare.slice(cursor);
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

test("calendar export and rest-alert controls have full-width fields and 44px touch targets", () => {
  assert.match(rule(".calendar-export"), /min-width:\s*0/);
  assert.match(rule(".calendar-export__actions .btn"), /min-height:\s*44px/);
  assert.match(rule(".toggle-row"), /min-height:\s*44px/);
  assertInMedia(
    "(max-width: 600px)",
    /\.calendar-export__actions \.btn\s*\{[^}]*width:\s*100%/
  );
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

test("only the sidebar's own rules position it, so the mobile top bar and tab bar stay fixed", () => {
  // A later grouped rule like `.app-shell, .sidebar { position: relative }`
  // wins the cascade over both the desktop sticky rule and the mobile fixed
  // rule: the sidebar scrolls away and its z-index traps the bottom tab bar
  // under the page.
  const positioners = [];
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const list = selectors.replace(/\/\*[\s\S]*?\*\//g, "").split(",").map((s) => s.trim());
    if (list.includes(".sidebar") && /(^|;|\s)position\s*:/.test(body)) {
      positioners.push({ list, position: body.match(/position\s*:\s*([^;]+)/)[1].trim() });
    }
  }
  assert.deepEqual(
    positioners.map((p) => p.position),
    ["sticky", "fixed"],
    `unexpected rules positioning .sidebar: ${JSON.stringify(positioners)}`
  );
  assert.ok(positioners.every((p) => p.list.length === 1), "position .sidebar in its own rule, not a grouped one");
});

test("text fields are 16px on touch screens, so iOS never zooms the page into them", () => {
  // iOS Safari zooms into any focused field under 16px, and an installed PWA
  // often stays zoomed: the food search pushed Snap / Estimate out of view and
  // the meal cards ran past the screen edge.
  assertInMedia("(pointer: coarse)", /input[^{]*,[^{]*textarea[^{]*,[^{]*select[^{]*\{[^}]*font-size:\s*max\(16px/);
});

test("every modal dialog sits outside the app shell, above the fixed top bar and tab bar", () => {
  // .app-main is its own stacking layer (z-index 1) under the mobile top bar
  // and tab bar (z-index 50). A modal inside it is drawn under both.
  const html = readFileSync(join(root, "index.html"), "utf8");
  const shellEnd = html.indexOf("<!-- /.app-shell -->");
  assert.notEqual(shellEnd, -1, "app shell close marker");
  for (const [tag] of html.matchAll(/<[^>]*aria-modal="true"[^>]*>/g)) {
    assert.ok(html.indexOf(tag) > shellEnd, `${tag.match(/id="([^"]+)"/)?.[1]} is inside the app shell`);
  }
});

test("the landing hero fits a phone: its column can shrink, and the score note wraps when the card is narrow", () => {
  // .hero clips overflow, so anything that makes the single phone column wider
  // than the screen cuts the copy off mid-word instead of scrolling, and a
  // scrollWidth check still reads 0. On 2026-09-27 a `1fr` track (its minimum is
  // the content's min-content width) plus a nowrap score note held that column
  // at 419px on every screen narrower than about 436px.
  assertInMedia("(max-width: 900px)", /\.hero__inner\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.doesNotMatch(
    unconditionalCss(),
    /\.audit-card__scorenote\s*\{[^}]*white-space:\s*nowrap/,
    "an unconditional nowrap on the score note sets the hero column's minimum width"
  );
});

test("a closed dialog leaves the tab order instead of only turning transparent", () => {
  // A panel faded to opacity 0 keeps every control inside it focusable. On
  // 2026-09-27 Tab walked past the last control on every page into the closed
  // coach panel's Close, Message and Send, all invisible and aria-hidden.
  // visibility: hidden or display: none is what takes a closed dialog out.
  const html = readFileSync(join(root, "index.html"), "utf8");
  const firstRule = (selector) =>
    css.match(new RegExp(`(?:^|[\\s,}])${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
  const dialogs = [...html.matchAll(/<[^>]*role="dialog"[^>]*>/g)].map(([tag]) => ({
    id: tag.match(/id="([^"]+)"/)?.[1],
    classes: tag.match(/class="([^"]+)"/)?.[1].split(/\s+/) ?? [],
  }));
  assert.ok(dialogs.length >= 8, `expected the eight dialogs in index.html, found ${dialogs.length}`);
  for (const { id, classes } of dialogs) {
    const closed = classes.map((c) => firstRule(`.${c}`)).join(";");
    const open = classes.map((c) => firstRule(`.${c}.is-open`)).join(";");
    assert.match(closed, /visibility:\s*hidden|display:\s*none/, `#${id} only fades when closed, so its controls stay focusable`);
    assert.match(open, /visibility:\s*visible|display:\s*(?!none)[a-z]/, `#${id} is never shown again when opened`);
  }
});

test("the quick-add food name keeps a full-width field under its label", () => {
  // Giving it a real <label class="field-label-sm"> also handed it the 120px
  // cap meant for macro numbers, and food names run long.
  const nutritionUi = readFileSync(join(root, "nutrition-ui.js"), "utf8");
  assert.match(nutritionUi, /<label class="field-label-sm detail-name">Food name<input id="qa-name"/);
  assert.match(rule(".detail-name"), /flex-direction:\s*column/);
  assert.match(rule(".detail-name .input"), /max-width:\s*none/);
});

test("on a narrow audit card the four counts sit two by two, so none is left alone on a row", () => {
  // Once the card fit a phone, "8/11 passed" wrapped onto a line of its own,
  // which the readout's own notes say reads as a fifth, missing category.
  assert.match(
    css,
    /@container \(width < 420px\)\s*\{[^{}]*\.audit-card__counts\s*\{[^}]*grid-template-columns:\s*repeat\(2,/
  );
});

test("buttons, filter chips and the small nutrition controls reach 44px on touch screens", () => {
  // Measured at 375px with the touch rules on (2026-09-29): "+ Add food" at
  // 29px, the Safety Lab filters at 31px, the custom water field at 32px, the
  // sort menu at 34px and every landing button at 42px. Add food is tapped
  // several times a day, one-handed.
  // Library filter chips (32px) and the exercise menus (41px) were the last
  // two on the 2026-09-29 live audit.
  for (const selector of [".btn", ".meal__add", ".eval-filter", ".water-custom", ".eval-sort select", ".lib-chip", ".form-select"]) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assertInMedia("(pointer: coarse)", new RegExp(`${escaped}(?![\\w-])[^{]*\\{[^}]*min-height:\\s*44px`));
  }
});

test("the launcher's reserve on the stat rail is a track of its own, only where the rail can sit under it", () => {
  // The reserve used to be 150px of padding on the last stat, which set that
  // column's minimum at 254px; between 721 and 1000px the other three paid
  // for it, down to 131px at 721. As its own track, the four stats share what
  // is left equally. Below 901px the hero stacks, the rail sits below the fold
  // and the launcher tucks away as you scroll to it, so nothing needs clearing.
  assert.ok(!/\.tele li:last-child\s*\{[^}]*padding-right/.test(css), "no stat should pay for the launcher out of its own width");
  assertInMedia("(min-width: 901px)", /\.tele\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*1fr\)\s+minmax\(0,\s*150px\)/);
});

test("nothing animates a property that reflows the page", () => {
  // Width, height, margin and padding transitions run layout on every frame.
  // The three that were here (rank, macro and water bars) never even ran:
  // each render rebuilds its bar, and a new element has nothing to animate
  // from. Offsets on positioned elements (the skip link's top) do not reflow
  // anything around them, so they are not caught here.
  const REFLOW = /(?<![\w-])(?:width|height|min-width|min-height|max-width|max-height|margin(?:-\w+)?|padding(?:-\w+)?|grid-template-\w+)\b/;
  const offenders = [];
  for (const [, selectors, body] of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const [, value] of body.matchAll(/transition(?:-property)?\s*:\s*([^;]+)/g)) {
      if (REFLOW.test(value)) offenders.push(`${selectors.trim().replace(/\s+/g, " ")} { transition: ${value.trim()} }`);
    }
  }
  assert.deepEqual(offenders, [], "animate transform or opacity instead");
});

test("the form check fits a 320px phone: its column can shrink, and the exercise row gives way", () => {
  // On a 320px touch screen the exercise menu's widest option set the stacked
  // column at 345px, 41px past the screen edge (found 2026-09-29, on prod as
  // well as this branch). The row holding it could not shrink below its
  // content, and a 1fr track grows to fit whatever cannot shrink.
  assertInMedia("(max-width: 900px)", /\.form-check\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(rule(".form-pick"), /min-width:\s*0/, "the exercise row must be allowed to shrink, so the menu inside it can");
});

test("the benchmark history table fits a 320px phone", () => {
  // Four columns with 12px of padding either side came to 310px in a 288px
  // column once its headers reached the 11px floor.
  assertInMedia("(max-width: 480px)", /\.bench-history th,\s*\.bench-history td\s*\{[^}]*padding-inline:\s*var\(--space-2\)/);
});
