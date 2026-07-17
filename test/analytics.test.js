import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FUNNEL_EVENTS, trackFunnel } from "../analytics.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "index.html"), "utf8");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

test("the static shell loads Vercel Web Analytics from its first-party endpoint", () => {
  assert.equal(pkg.dependencies?.["@vercel/analytics"], "^2.0.1");
  assert.match(html, /window\.va\s*=\s*window\.va\s*\|\|\s*function/);
  assert.match(html, /<script defer src="\/_vercel\/insights\/script\.js"><\/script>/);
});

test("funnel telemetry sends only allow-listed virtual pageviews", () => {
  const calls = [];
  globalThis.window = { va: (...args) => calls.push(args) };
  assert.equal(trackFunnel("plan_generation_failed", { failure_class: "timeout", weight: 90 }), true);
  assert.deepEqual(calls[0], ["pageview", {
    route: "/funnel/plan_generation_failed/[failure_class]",
    path: "/funnel/plan_generation_failed/timeout",
  }]);
  assert.doesNotMatch(JSON.stringify(calls), /weight|90/);
  delete globalThis.window;
});

test("unknown events and properties never leave the browser", () => {
  const calls = [];
  globalThis.window = { va: (...args) => calls.push(args) };
  assert.equal(trackFunnel("raw_prompt", { prompt: "private" }), false);
  assert.equal(calls.length, 0);
  delete globalThis.window;
});

test("the funnel schema is deeply immutable at runtime", () => {
  assert.ok(Object.isFrozen(FUNNEL_EVENTS));
  assert.ok(Object.isFrozen(FUNNEL_EVENTS.first_workout_started));
  assert.ok(Object.isFrozen(FUNNEL_EVENTS.first_workout_started.source));
  assert.throws(() => FUNNEL_EVENTS.first_workout_started.source.push("personally-identifying-value"), TypeError);
});

test("results expose one first-workout action and dispatch day one from the plan", () => {
  const results = html.match(/<div class="state state--results" id="state-results"[\s\S]*?<\/div>\s*<\/section>/)?.[0] || "";
  assert.equal((results.match(/id="start-first-workout"/g) || []).length, 1);
  const app = readFileSync(join(root, "app.js"), "utf8");
  assert.match(app, /new CustomEvent\("spotter:start-plan-day",\s*\{\s*detail:\s*\{\s*index:\s*0,\s*source:\s*"plan"\s*\}/);
});

test("editing a logged workout does not restart the first-workout funnel", () => {
  const workoutUi = readFileSync(join(root, "workout-ui.js"), "utf8");
  assert.match(workoutUi, /if \(!session\.editingId && !session\.funnelStarted\)/);
});

test("a null generation response is classified as an invalid response", () => {
  const app = readFileSync(join(root, "app.js"), "utf8");
  assert.match(app, /plan = data\?\.plan;/);
});
