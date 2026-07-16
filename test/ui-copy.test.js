/**
 * UI copy / label guardrails — read index.html as text and assert the
 * user-facing positioning and navigation stay consistent. These are cheap
 * regression guards, not a DOM test.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "index.html"), "utf8");
const app = readFileSync(join(root, "app.js"), "utf8");
const router = readFileSync(join(root, "router.js"), "utf8");

test("nav uses 'Safety Lab', not the old 'Evals' label", () => {
  assert.ok(html.includes("<span>Safety Lab</span>"), "Safety Lab nav label present");
  assert.ok(!html.includes("<span>Evals</span>"), "old Evals nav label gone");
  assert.ok(router.includes("Safety Lab · SpotterAI"));
});

test("a 'Today' daily home base exists in the nav and routes", () => {
  assert.ok(html.includes("<span>Today</span>"), "Today nav label present");
  assert.ok(/data-view="today"/.test(html), "Today view present");
  assert.ok(router.includes('"today"'), "today route registered");
});

test("a Pain Mode modal exists", () => {
  assert.ok(/id="pain-modal"/.test(html));
});

test("an Exercise Library exists in the nav, routes, and has a detail modal", () => {
  assert.ok(html.includes("<span>Library</span>"), "Library nav label present");
  assert.ok(/data-view="library"/.test(html), "Library view present");
  assert.ok(router.includes('"library"'), "library route registered");
  assert.ok(/id="exercise-modal"/.test(html), "exercise detail modal present");
});

test("positioning is the AI fitness copilot promise, not the old coach line", () => {
  assert.ok(/AI fitness copilot/i.test(html), "copilot positioning present");
  // The old tagline must be gone from user-facing copy (title + footer).
  assert.ok(!/coach that audits its own safety/i.test(html), "old tagline removed");
});

test("footer carries the full copilot description", () => {
  assert.ok(/AI fitness copilot that helps you build plans/i.test(html));
});

test("homepage has the three user scenario cards", () => {
  assert.ok(/See how SpotterAI handles real training situations/i.test(html));
  for (const t of ["Healthy beginner", "Knee limitation", "Inconsistent training logs"]) {
    assert.ok(html.includes(t), `scenario card present: ${t}`);
  }
});

test("homepage has the 'What not to trust SpotterAI for' limitations section", () => {
  assert.ok(/What not to trust SpotterAI for/i.test(html));
  assert.ok(/Diagnosing pain or injuries/i.test(html));
  assert.ok(/still help you create a more conservative general plan/i.test(html));
});

test("guided onboarding is the only plan builder on the landing page", () => {
  assert.ok(!/id="plan-form"/.test(html), "duplicate inline plan form removed");
  assert.ok(!/Build your program/i.test(html), "duplicate builder heading removed");
  assert.match(
    html,
    /<section id="generator" class="section" hidden>/,
    "results section starts hidden"
  );

  const buildPlanLinks = [...html.matchAll(/<a\b([^>]*)>Build my plan<\/a>/g)];
  assert.ok(buildPlanLinks.length >= 2, "hero and final plan CTAs remain present");
  for (const [, attributes] of buildPlanLinks) {
    assert.match(attributes, /data-onboard/, "every Build my plan CTA opens onboarding");
  }
});

test("the plan controller reveals results and returns Start over to onboarding", () => {
  assert.ok(!/getElementById\("plan-form"\)/.test(app), "controller no longer depends on the removed form");
  assert.ok(!/getElementById\("generate-btn"\)/.test(app), "controller no longer depends on the removed form button");
  assert.match(app, /const inputs = inputsOverride \|\| lastInputs;/, "retry reuses the last onboarding inputs");
  assert.match(app, /generatorSection\.hidden = false;/, "generation reveals the results section");
  assert.match(app, /generatorSection\.hidden = true;/, "reset hides the results section");
  assert.match(app, /new CustomEvent\("spotter:onboarding"\)/, "Start over reopens guided onboarding");
});
