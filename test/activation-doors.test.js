/**
 * The two doors the 2026-08-16 funnel pull asked for.
 *
 * The pull found one wall and one surprise, and this file guards the response
 * to each.
 *
 * THE WALL. 14 people completed onboarding, 14 got a plan, 3 started a workout.
 * Nothing above that step converts badly and nothing below it converts badly at
 * all. But the funnel could not say WHY, because it had no event between
 * "plan_generation_succeeded" and "first_workout_started" — so bouncing at the
 * plan screen and bouncing three days later looked identical, and they want
 * opposite fixes. Two events split them, and a fixed action bar removes the one
 * cause you can measure with a ruler rather than a sample: the button was about
 * seven mobile screens below the top of the results.
 *
 * THE SURPRISE. Photo food logging drew 8 visitors and 16 views over the same
 * window against 3 for plan import, from four clicks down a nav menu with no
 * landing-page presence at all. It is the only thing in the funnel people came
 * BACK to. The response is a front door and a `source` segment, so the next
 * pull can say whether the door or the feature is doing the work.
 *
 * There is no DOM harness in this project, so the UI half is source-structure
 * assertions in the style of mid-workout-layout.test.js. They cannot prove the
 * pixels; they prove the decisions that produce them.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { FUNNEL_EVENTS, trackFunnel } from "../analytics.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "index.html"), "utf8");
const css = readFileSync(join(root, "style.css"), "utf8");
const app = readFileSync(join(root, "app.js"), "utf8");
const nutritionUi = readFileSync(join(root, "nutrition-ui.js"), "utf8");
const storeJs = readFileSync(join(root, "store.js"), "utf8");

/** Body of every rule matching `selector` (the stylesheet overrides by cascade order). */
function rules(selector, source = css) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...source.matchAll(new RegExp(`(?:^|[,}])\\s*${escaped}\\s*\\{([^}]*)\\}`, "gm"))];
  assert.ok(matches.length, `missing CSS rule for ${selector}`);
  return matches.map((m) => m[1]);
}
function declares(selector, pattern) {
  assert.ok(rules(selector).some((body) => pattern.test(body)), `no rule for ${selector} declares ${pattern}`);
}

// ---------------------------------------------------------------------------
// 1. The plan action bar
// ---------------------------------------------------------------------------
test("CRITICAL: the fix does not reorder the audit under the plan", () => {
  // The cheap way to shorten the scroll would be to move the plan above the
  // audit. Flags-first is the product's whole claim: the audit must never be
  // something you find after the thing it is auditing. The bar exists precisely
  // so this ordering can stay.
  const audit = html.indexOf('class="card audit"');
  const repair = html.indexOf('id="repair-mount"');
  const plan = html.indexOf('id="plan-output"');
  assert.ok(audit > 0 && repair > audit, "the repair panel no longer follows the audit");
  assert.ok(plan > repair, "the plan is now rendered above the audit that judges it");
});

test("the bar is gated purely on a body class, like the session bar", () => {
  // It is a sibling of .app-shell, so nothing else can hide it. A .plan-bar
  // that defaults to visible would float over every page of the app.
  declares(".plan-bar", /display:\s*none/);
  declares("body.plan-ready .plan-bar", /position:\s*fixed/);
  assert.match(app, /classList\.toggle\("plan-ready"/);
});

test("CRITICAL: all four conditions gate the bar, not just the results state", () => {
  // Each of these was a way to show the wrong thing:
  //   resultsShowing  — the bar over a loading spinner or an error
  //   isHomeRoute     — the bar following you to Nutrition, since it is a
  //                     sibling of .app-shell and no view can hide it
  //   !ctaOnScreen    — two copies of the same button stacked at the plan's end
  //   !hasTrained     — "Start my first workout" shown to someone on session 30
  const body = app.match(/function syncPlanChrome\(\)\s*\{([\s\S]*?)\n\}/)?.[1] || "";
  assert.ok(body, "syncPlanChrome is gone");
  for (const cond of ["resultsShowing", "isHomeRoute()", "!ctaOnScreen", "!hasTrained()"]) {
    assert.ok(body.includes(cond), `syncPlanChrome no longer checks ${cond}`);
  }
});

test("hasTrained reads logged workouts, not the plan", () => {
  // Reading store.plan here would mean the bar hides itself the moment a plan
  // exists, which is every case it was built for.
  assert.match(app, /const hasTrained = \(\) => \(getTrackerState\(\)\.workouts \|\| \[\]\)\.length > 0/);
});

test("CRITICAL: the intersection observer fails toward showing the bar", () => {
  // IntersectionObserver does not fire in every environment (the preview pane
  // being one). `ctaOnScreen` must start false, so a browser that never reports
  // gets a visible button rather than a hidden one.
  assert.match(app, /let ctaOnScreen = false;/);
  assert.match(app, /typeof IntersectionObserver === "function"/, "the observer is not feature-detected");
});

test("both start buttons dispatch the same event, so they cannot diverge", () => {
  // Two copies of a primary action is two chances for one of them to rot.
  assert.match(app, /function startFirstWorkout\(\)\s*\{[\s\S]*?spotter:start-plan-day/);
  assert.match(app, /startFirstWorkoutBtn\?\.addEventListener\("click", startFirstWorkout\)/);
  assert.match(app, /planBarStart\?\.addEventListener\("click", startFirstWorkout\)/);
  // And exactly one place still builds the event.
  assert.equal((app.match(/spotter:start-plan-day/g) || []).length, 1);
});

test("CRITICAL: the plan bar never stacks on the mid-workout bar", () => {
  // Both are fixed to the bottom of the screen. Navigating Home mid-session is
  // the case: the session is live, the home view still holds a rendered plan.
  declares("body.session-live .plan-bar", /display:\s*none/);
  const z = /z-index:\s*(\d+)/.exec(rules("body.plan-ready .plan-bar")[0] || "")?.[1];
  const sessionZ = /z-index:\s*(\d+)/.exec(rules("body.session-live .session-bar")[0] || "")?.[1];
  assert.ok(Number(z) < Number(sessionZ), `plan bar z-index ${z} is not below the session bar's ${sessionZ}`);
});

test("the bar clears the same chrome the session bar does, by the same numbers", () => {
  // A hardcoded 244px sidebar offset on the session bar left a 150px hole at
  // 1280px once already. Both bars now have to name the same rail width at the
  // same breakpoint, and the same 64px tab-bar height, or this fails.
  const rail = /@media \(min-width: 961px\) \{[^}]*body\.plan-ready \.plan-bar \{[^}]*left:\s*96px/;
  assert.match(css, rail, "the plan bar does not clear the 96px desktop rail at 961px");
  declares("body.plan-ready .plan-bar", /bottom:\s*calc\(64px \+ env\(safe-area-inset-bottom/);
  declares("body.session-live .session-bar", /bottom:\s*calc\(64px \+ env\(safe-area-inset-bottom/);
});

test("the chat FAB is lifted over the plan bar too", () => {
  // The FAB and a bottom-right primary button want the same thumb. This exact
  // collision already shipped once with the session bar.
  assert.match(css, /body\.plan-ready #chat-fab \{[^}]*var\(--plan-bar-h\)/);
  assert.match(css, /body\.plan-ready \{[\s\S]*?--plan-bar-h:/);
});

// ---------------------------------------------------------------------------
// 2. The fork the funnel could not see
// ---------------------------------------------------------------------------
test("CRITICAL: the two new events split bouncing AT the plan from bouncing after it", () => {
  assert.ok(FUNNEL_EVENTS.plan_scrolled_to_end, "plan_scrolled_to_end is gone");
  assert.deepEqual(FUNNEL_EVENTS.returned_with_plan, { trained: ["true", "false"] });
  // `trained` is the load-bearing segment: returned_with_plan/false is a person
  // who came back holding a plan and still had not trained. Without it the
  // event cannot tell the 11 from the 3.
  const calls = [];
  globalThis.window = { va: (...a) => calls.push(a) };
  trackFunnel("returned_with_plan", { trained: "false" });
  assert.deepEqual(calls[0], ["pageview", {
    route: "/funnel/returned_with_plan/[trained]",
    path: "/funnel/returned_with_plan/false",
  }]);
  delete globalThis.window;
});

test("CRITICAL: both are activation events and fire once per profile", () => {
  // first_workout_completed fired on EVERY logged workout once, which kept it
  // lit with the owner's own training and made two traffic snapshots unreadable.
  // A `returned_with_plan` that fired on every page load would repeat that.
  assert.match(app, /trackFunnelOnce\("plan_scrolled_to_end"\)/);
  assert.match(app, /trackFunnelOnce\("returned_with_plan", \{ trained: String\(hasTrained\(\)\) \}\)/);
  assert.doesNotMatch(app, /trackFunnel\("plan_scrolled_to_end"/);
  assert.doesNotMatch(app, /trackFunnel\("returned_with_plan"/);
});

test("CRITICAL: plan_scrolled_to_end watches the inline CTA, never the bar", () => {
  // The bar is visible the whole time the results are. Firing this off the bar
  // would give a number that is ~100% by construction and means nothing.
  assert.match(app, /const firstWorkoutCta = document\.querySelector\("\.first-workout-cta"\)/);
  const observer = app.match(/if \(firstWorkoutCta && typeof IntersectionObserver[\s\S]*?\.observe\(([^)]*)\)/)?.[1];
  assert.equal(observer, "firstWorkoutCta");
});

test("CRITICAL: returned_with_plan requires a LATER day, not merely a reload", () => {
  // Firing on any load with a plan would count the person who generated one
  // five minutes ago as a returning user, which is the exact population it is
  // supposed to exclude.
  assert.match(storeJs, /export function planUpdatedAt\(\)/);
  const boot = app.slice(app.indexOf("const planWrittenAt = planUpdatedAt()"));
  assert.ok(boot, "the boot-time read of planUpdatedAt is gone");
  assert.match(boot, /midnight\.setHours\(0, 0, 0, 0\)/);
  assert.match(boot, /planWrittenAt < midnight\.getTime\(\)/);
  // Read before renderResults, because adapt rewrites updatedAt on this load.
  assert.ok(
    app.indexOf("const planWrittenAt = planUpdatedAt()") < app.indexOf("if (store.plan) renderResults"),
    "planUpdatedAt is read after the plan is re-rendered, so it can see this visit's own write"
  );
});

// ---------------------------------------------------------------------------
// 3. The nutrition front door
// ---------------------------------------------------------------------------
test("CRITICAL: the landing page has a photo door at all", () => {
  // It had two CTAs, both plan-shaped, and the best-converting feature in the
  // product was not one of them.
  const hero = html.match(/<div class="hero__actions">[\s\S]*?<\/div>/)?.[0] || "";
  assert.match(hero, /data-snap-meal="landing"/, "the hero has no photo-logging entry point");
});

test("the nutrition page surfaces the camera outside the picker", () => {
  // It used to be one option inside the food picker's search results, which you
  // reach by opening a specific meal first.
  const nutPage = html.slice(html.indexOf('data-view="nutrition"'), html.indexOf('data-view="progress"'));
  assert.match(nutPage, /data-snap-meal="nutrition"/);
  assert.ok(nutPage.indexOf("nut-snap") < nutPage.indexOf('id="nut-summary"'), "the door is below the fold of its own page");
});

test("CRITICAL: every door reports which door it was", () => {
  assert.deepEqual(FUNNEL_EVENTS.meal_photo_started, { source: ["landing", "nutrition", "picker"] });
  // All three sources are actually wired, and each is in the allow-list. A
  // source that is not on the list is silently dropped by trackFunnel, so a
  // typo here is an event that disappears rather than one that errors.
  const wired = new Set([...html.matchAll(/data-snap-meal="([a-z]+)"/g)].map((m) => m[1]));
  wired.add("picker");
  assert.deepEqual([...wired].sort(), ["landing", "nutrition", "picker"]);
  for (const s of wired) assert.ok(FUNNEL_EVENTS.meal_photo_started.source.includes(s), `${s} is not an allowed source`);
  assert.match(nutritionUi, /trackFunnel\("meal_photo_started", \{ source: "picker" \}\)/);
});

test("started is tracked separately from succeeded, so abandonment is visible", () => {
  // Before this, a photo opened and abandoned looked exactly like a photo never
  // opened. The 8 visitors were a floor with no ceiling attached.
  for (const e of ["meal_photo_started", "meal_photo_succeeded", "meal_photo_failed"]) {
    assert.ok(FUNNEL_EVENTS[e], `${e} is gone`);
  }
  assert.match(nutritionUi, /trackFunnel\("meal_photo_succeeded"\)/);
});

test("CRITICAL: the camera opens inside the click, not after an await", () => {
  // Browsers drop a programmatic .click() on a file input once the user gesture
  // has been handed back. An await, a setTimeout, or waiting on the route change
  // before clicking would make every door silently do nothing.
  const body = nutritionUi.match(/function openSnap\(source\)\s*\{([\s\S]*?)\n\}/)?.[1] || "";
  assert.ok(body, "openSnap is gone");
  assert.ok(!/await|setTimeout|then\(/.test(body), "openSnap defers before clicking the file input");
  assert.ok(
    body.indexOf("el.photoInput.click()") < body.indexOf("location.hash"),
    "the route change happens before the camera opens"
  );
});

test("a door pressed before the picker exists does nothing rather than throwing", () => {
  // The landing button lives outside the nutrition view, and init() only runs
  // when #nut-page is present.
  const body = nutritionUi.match(/function openSnap\(source\)\s*\{([\s\S]*?)\n\}/)?.[1] || "";
  assert.match(body, /if \(!el\.picker \|\| !el\.photoInput\) return;/);
});

test("an unknown source falls back to a legal one", () => {
  // data-snap-meal is authored in HTML, where a typo is invisible until the
  // event silently stops being recorded.
  assert.match(nutritionUi, /source === "landing" \|\| source === "nutrition" \? source : "nutrition"/);
});

// ---------------------------------------------------------------------------
// 4. Copy
// ---------------------------------------------------------------------------
test("the new user-facing copy carries no em dashes", () => {
  for (const [label, source] of [["index.html", html]]) {
    for (const needle of ["Snap a meal, get the macros", "Your plan is ready"]) {
      const i = source.indexOf(needle);
      assert.notEqual(i, -1, `${needle} is gone from ${label}`);
    }
  }
  const snapNote = html.match(/<p class="nut-snap__note">([^<]*)</)?.[1] || "";
  assert.ok(snapNote.length, "the nut-snap note is gone");
  assert.ok(!snapNote.includes("\u2014"), "em dash in the nutrition door copy");
});
