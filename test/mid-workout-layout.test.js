/**
 * Mid-workout layout guardrails.
 *
 * Measured on a 375x812 viewport with three exercises added, the Dashboard put
 * 79 interactive controls on screen during a live workout and only 36 of them
 * belonged to the session. 608px of page furniture — a section header with no
 * controls at all, a first-run welcome card, the Train/Stats/History tabs, the
 * Quick log box — sat ABOVE the session, and the first weight input landed
 * 1185px down. A screen and a half of scrolling to reach the one field you are
 * there to fill in, standing over a loaded barbell.
 *
 * Three fixes, guarded here:
 *
 *   1. `body.session-live` collapses the furniture for the duration of the
 *      session. workout-ui.js owns the class; both edges of the toggle matter,
 *      because a session that starts the takeover and never ends it leaves the
 *      Dashboard permanently gutted.
 *   2. The rest timer and Finish move OUT of the session card into a fixed
 *      #session-bar. Putting either back inside is the regression.
 *   3. The set table's done tick becomes a real 44px target, and the delete
 *      cross deliberately does not — see the test at the bottom.
 *
 * There is no DOM harness in this project, so these are source-structure
 * assertions in the style of ui-layout.test.js. They cannot prove the pixels;
 * they prove the decisions that produce them.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "index.html"), "utf8");
const css = readFileSync(join(root, "style.css"), "utf8");
const workoutUi = readFileSync(join(root, "workout-ui.js"), "utf8");

const at = (needle) => {
  const i = html.indexOf(needle);
  assert.notEqual(i, -1, `index.html no longer contains ${needle}`);
  return i;
};

/**
 * Body of the LAST rule matching `selector`. Last, not first: this stylesheet
 * is built in additive layers that override by cascade order, so the first
 * `.rest-preset { ... }` in the file is the one that lost.
 */
function rules(selector, source = css) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...source.matchAll(new RegExp(`(?:^|[,}])\\s*${escaped}\\s*\\{([^}]*)\\}`, "gm"))];
  assert.ok(matches.length, `missing CSS rule for ${selector}`);
  return matches.map((m) => m[1]);
}
function rule(selector, source = css) {
  const all = rules(selector, source);
  return all[all.length - 1];
}
/** At least one rule for `selector` declares `pattern`. */
function declares(selector, pattern, source = css) {
  assert.ok(
    rules(selector, source).some((body) => pattern.test(body)),
    `no rule for ${selector} declares ${pattern}`
  );
}

/** Every `@media <condition>` block body, brace-matched. */
function mediaBlocks(condition) {
  const header = `@media ${condition}`;
  const blocks = [];
  let cursor = 0;
  while ((cursor = css.indexOf(header, cursor)) !== -1) {
    const open = css.indexOf("{", cursor + header.length);
    let depth = 0;
    let close = -1;
    for (let i = open; i < css.length; i += 1) {
      if (css[i] === "{") depth += 1;
      if (css[i] === "}") depth -= 1;
      if (depth === 0) { close = i; break; }
    }
    assert.notEqual(close, -1, `unbalanced braces in ${header}`);
    blocks.push(css.slice(open + 1, close));
    cursor = close + 1;
  }
  assert.ok(blocks.length, `missing media query ${header}`);
  return blocks;
}

// ---------------------------------------------------------------------------
// 1. The takeover
// ---------------------------------------------------------------------------
test("a live session collapses the page furniture that sat above it", () => {
  // The four blocks measured above the session on a phone. Each must be named
  // by a `body.session-live` selector somewhere in the stylesheet.
  for (const furniture of ["#dash-welcome", ".dash-tabs", "#quicklog", ".section-head"]) {
    const re = new RegExp(`body\\.session-live[^{]*${furniture.replace(/[.#]/g, "\\$&")}[^{]*\\{[^}]*display:\\s*none`);
    assert.match(css, re, `${furniture} is not collapsed while a session is live`);
  }
});

test("CRITICAL: the takeover is switched OFF as well as on", () => {
  // A session-live class that is never cleared leaves the Dashboard with no
  // header, no tabs and no Quick log for the rest of the profile's life.
  assert.match(workoutUi, /function setSessionChrome\(live\)\s*\{[\s\S]*classList\.toggle\("session-live", live\)/);
  assert.match(workoutUi, /function startSession[\s\S]*?setSessionChrome\(true\)/);
  assert.match(workoutUi, /function showIdle\(\)[\s\S]*?setSessionChrome\(false\)/);
});

test("every exit from a session routes through showIdle, so nothing can skip the reset", () => {
  // finishSession and discardSession are the only two ways out. If a third
  // appears and hides el.session directly, the takeover would stick.
  const hidesSession = [...workoutUi.matchAll(/el\.session\.hidden\s*=\s*true/g)];
  assert.equal(hidesSession.length, 1, "el.session is hidden in more than one place; only showIdle may do it");
  const showIdleBody = workoutUi.slice(workoutUi.indexOf("function showIdle()"));
  assert.ok(showIdleBody.includes("el.session.hidden = true"), "the single hide is not the one inside showIdle");
});

test("starting a session brings the Train panel forward", () => {
  // Started from Today or Split Lab while Stats or History was selected, the
  // panel the session renders into is hidden and the session is invisible.
  assert.match(workoutUi, /function startSession[\s\S]*?getElementById\("dash-tab-train"\)\?\.click\(\)/);
});

// ---------------------------------------------------------------------------
// 2. The fixed action bar
// ---------------------------------------------------------------------------
test("CRITICAL: Finish and the rest timer are outside the session card", () => {
  // Both used to live inside #workout-session: the rest timer between the
  // session head and the first exercise, Finish at the very bottom of a
  // 3.3-screen page. The app-shell close tag is the boundary — everything
  // before it is in the scrolling page, everything after is a fixed sibling.
  const shellEnd = at("<!-- /.app-shell -->");
  assert.ok(at('id="session-bar"') > shellEnd, "#session-bar is back inside .app-shell");
  assert.ok(at('id="session-finish"') > shellEnd, "Finish is back inside the scrolling session card");
  assert.ok(at('id="rest-timer"') > shellEnd, "the rest timer is back inside the scrolling session card");
  // ...and inside the bar itself.
  assert.ok(at('id="session-finish"') > at('id="session-bar"'));
  assert.ok(at('id="rest-timer"') > at('id="session-bar"'));
});

test("the bar is gated on the class alone, so it survives leaving the Dashboard", () => {
  // Being a sibling of .app-shell is what lets the timer follow you to
  // Nutrition mid-workout. That only works if nothing else hides it.
  assert.match(rule(".session-bar"), /display:\s*none/);
  declares("body.session-live .session-bar", /position:\s*fixed/);
});

test("the bar lines up with the content column at BOTH shell widths", () => {
  // The shell is a 96px icon rail above 961px and a full-width top bar below
  // it. Hard-coding one number left a 150px hole beside the bar at 1280px, so
  // the bar's offset is read off the SAME breakpoint and the SAME width as the
  // shell's own grid. If F1 ever changes the rail, this fails instead of
  // silently reopening the gap.
  const rail = mediaBlocks("(min-width: 961px)");
  const shell = rail.map((b) => b.match(/\.app-shell\s*\{[^}]*grid-template-columns:\s*(\d+)px/)).find(Boolean);
  assert.ok(shell, "the icon-rail width is no longer declared at (min-width: 961px)");
  const bar = rail.map((b) => b.match(/\.session-bar\s*\{[^}]*left:\s*(\d+)px/)).find(Boolean);
  assert.ok(bar, "the bar does not clear the icon rail at (min-width: 961px)");
  assert.equal(bar[1], shell[1], "the bar's left offset has drifted from the sidebar rail width");
  // Below the rail breakpoint the shell is display:block, so the bar starts at 0.
  declares("body.session-live .session-bar", /left:\s*0/);
});

test("the bar stacks above the bottom tab bar rather than under it", () => {
  const mobile = mediaBlocks("(max-width: 960px)");
  assert.ok(
    mobile.some((b) => /\.session-bar\s*\{[^}]*bottom:\s*calc\(64px/.test(b)),
    "the bar no longer clears the fixed bottom nav"
  );
});

test("CRITICAL: the coach FAB is lifted off Finish", () => {
  // Both wanted the same bottom-right corner. The FAB is drawn later and won,
  // so Finish was literally underneath it.
  const lifts = [...css.matchAll(/body\.session-live #chat-fab\s*\{[^}]*bottom:[^}]*var\(--session-bar-h\)/g)];
  assert.ok(lifts.length >= 2, "the FAB is not lifted at both the desktop and mobile offsets");
});

test("the bar's height is published from a measurement, with a correct CSS default", () => {
  // The row is allowed to wrap rather than overflow, and it does wrap at 320px
  // once Finish becomes "Save changes" next to +15s and Skip. A hard-coded
  // height would put the FAB straight back on top of Finish in exactly that
  // case, so JS publishes the real one.
  assert.match(rule("body.session-live"), /--session-bar-h:\s*\d+px/, "no CSS default, so the layout breaks with JS off");
  assert.match(workoutUi, /setProperty\("--session-bar-h", `\$\{h\}px`\)/);
  // Measured after the Finish label is set, or it measures the narrower bar.
  const start = workoutUi.slice(workoutUi.indexOf("function startSession"));
  assert.ok(
    start.indexOf('textContent = session.editingId ? "Save changes"') < start.indexOf("setSessionChrome(true)"),
    "the bar is measured before the Finish label widens it"
  );
  // ...and re-measured when the running controls swap in and out.
  assert.match(workoutUi, /function startRest[\s\S]*?syncBarGeometry\(\)/);
  assert.match(workoutUi, /function renderRestIdle[\s\S]*?syncBarGeometry\(\)/);
});

test("rest presets are gated on the popover, not on the timer being idle", () => {
  // The old rule was `.rest-timer.is-running .rest-presets { display: none }`.
  // Restoring it would break retargeting a running timer, which is supported.
  assert.match(css, /\.rest-timer:not\(\.is-picking\)\s*\.rest-presets[^{]*\{[^}]*display:\s*none/);
  assert.doesNotMatch(css, /\.rest-timer\.is-running\s+\.rest-presets/);
  assert.match(workoutUi, /function setRestPicking\(open\)/);
  // Choosing a preset closes the popover instead of leaving it over the bar.
  assert.match(workoutUi, /data-rest-set[\s\S]*?setRestPicking\(false\)/);
});

test("hiding the REST label on a narrow screen does not cost the button its name", () => {
  // The label is display:none at 360px and below so Finish stays on one row.
  // 375px keeps it: measured at 283px of 351px used with the running controls.
  assert.ok(
    mediaBlocks("(max-width: 360px)").some((b) => /\.rest-timer__label\s*\{[^}]*display:\s*none/.test(b)),
    "the REST label is no longer trimmed, so the bar wraps at 320px"
  );
  assert.match(html, /data-rest-open[^>]*aria-label="[^"]+"/, "the picker button has no accessible name once the label is hidden");
});

// ---------------------------------------------------------------------------
// 3. Touch targets
// ---------------------------------------------------------------------------
test("the done tick is a real 44px target on a touch screen", () => {
  const coarse = mediaBlocks("(pointer: coarse)");
  const done = coarse.map((b) => b.match(/\.set-done\s*\{([^}]*)\}/)).find(Boolean);
  assert.ok(done, ".set-done has no coarse-pointer sizing");
  assert.match(done[1], /width:\s*44px/);
  assert.match(done[1], /height:\s*44px/);
});

test("CRITICAL: the delete cross is NOT given a 44px zone next to the done tick", () => {
  // Deliberate, and the reason is worth keeping: two 44px zones a thumb-width
  // apart overlap, the later element wins the overlap, and the later element
  // here is the destructive one. A fat tick plus a fat cross means mis-tapping
  // deletes the set you just logged. The cross gets full height and a clear
  // gap instead. The old phantom ::after zones (which overlapped by a pixel)
  // are dropped in favour of real boxes.
  const coarse = mediaBlocks("(pointer: coarse)");
  const del = coarse.map((b) => b.match(/\.set-del\s*\{([^}]*)\}/)).find(Boolean);
  assert.ok(del, ".set-del has no coarse-pointer sizing");
  assert.match(del[1], /width:\s*30px/, "the delete cross has been widened into the done tick's zone");
  assert.match(del[1], /height:\s*44px/);
  assert.ok(
    coarse.some((b) => /\.set-done::after,\s*\.set-del::after\s*\{[^}]*content:\s*none/.test(b)),
    "the overlapping phantom tap zones are back"
  );
});

test("the session's own small controls clear 44px", () => {
  const coarse = mediaBlocks("(pointer: coarse)").join("\n");
  for (const [selector, prop] of [
    [".ex-block__del", /height:\s*44px/],
    [".add-set", /min-height:\s*44px/],
    [".session-diff__chip", /min-height:\s*44px/],
    [".rest-preset", /min-height:\s*44px/],
    [".rest-custom", /min-height:\s*44px/],
  ]) {
    assert.match(rule(selector, coarse), prop, `${selector} is still under the 44px minimum`);
  }
  // The rest picker is sized outside the media query because it is a bar
  // control at every pointer type.
  assert.match(rule(".rest-timer__pick"), /min-height:\s*44px/);
});

test("the set table still fits its inputs after the control column grew", () => {
  // .set-ctl went 4.2rem -> 5.4rem to hold a 44px tick. The inputs must not be
  // squeezed under their own minimum in exchange.
  const coarse = mediaBlocks("(pointer: coarse)").join("\n");
  assert.match(coarse, /\.set-ctl\s*\{[^}]*width:\s*5\.4rem/);
  // Under 520px .set-in drops to a 2.6rem floor, which is what has to survive:
  // at 375px the two inputs still measure 78px each, unchanged from before the
  // control column grew, because the table redistributes rather than crushing.
  declares(".set-in", /min-width:\s*2\.6rem/);
});
