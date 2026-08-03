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
  assert.match(app, /plan = assertPlanShape\(data\?\.plan\);/);
});

// ============================================================================
// Activation events must fire once per profile, ever.
//
// `first_workout_completed` used to fire on every addWorkout (workout-ui.js),
// and `first_workout_started` once per browser session forever. Because the
// owner trains and logs in the app, both stayed lit in every window and could
// never show whether a stranger got going. Both the 2026-07-22 and 2026-08-02
// traffic snapshots were misread as a result.
// ============================================================================

/** Stub window.va + a working localStorage, and hand back the recorded calls. */
function withBrowser(run) {
  const calls = [];
  const mem = new Map();
  globalThis.window = { va: (...args) => calls.push(args) };
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  };
  try {
    return run(calls, mem);
  } finally {
    delete globalThis.window;
    delete globalThis.localStorage;
  }
}

test("REGRESSION: an activation event fires once and never again", async () => {
  const { trackFunnelOnce } = await import("../analytics.js");
  withBrowser((calls) => {
    assert.equal(trackFunnelOnce("first_workout_completed", { source: "dashboard" }), true);
    assert.equal(trackFunnelOnce("first_workout_completed", { source: "dashboard" }), false);
    assert.equal(trackFunnelOnce("first_workout_completed", { source: "today" }), false);
    assert.equal(calls.length, 1, "the owner's 40th workout must not look like an activation");
    assert.equal(calls[0][1].path, "/funnel/first_workout_completed/dashboard");
  });
});

test("the one-shot marker survives a reload, not just a session", async () => {
  const { trackFunnelOnce } = await import("../analytics.js");
  withBrowser((calls, mem) => {
    trackFunnelOnce("first_workout_started", { source: "dashboard" });
    const persisted = [...mem.entries()].find(([k]) => k.startsWith("spotterai.funnel.v1"));
    assert.ok(persisted, "the marker must be written to storage, not held in memory");
    assert.match(persisted[1], /first_workout_started/);
    assert.equal(calls.length, 1);
  });
});

test("ongoing volume still gets an event, under an honest name", async () => {
  const { trackFunnel } = await import("../analytics.js");
  withBrowser((calls) => {
    for (let i = 0; i < 3; i++) trackFunnel("workout_completed", { source: "dashboard" });
    assert.equal(calls.length, 3, "workout_completed is not an activation event; it fires every time");
    assert.equal(calls[0][1].path, "/funnel/workout_completed/dashboard");
  });
});

test("trackFunnelOnce refuses unregistered names like trackFunnel does", async () => {
  const { trackFunnelOnce } = await import("../analytics.js");
  withBrowser((calls) => {
    assert.equal(trackFunnelOnce("not_a_real_event", {}), false);
    assert.equal(calls.length, 0);
  });
});

test("a storage failure over-reports rather than losing the activation", async () => {
  const { trackFunnelOnce } = await import("../analytics.js");
  const calls = [];
  globalThis.window = { va: (...args) => calls.push(args) };
  globalThis.localStorage = {
    getItem: () => { throw new Error("disabled"); },
    setItem: () => { throw new Error("disabled"); },
    removeItem: () => {},
  };
  try {
    assert.equal(trackFunnelOnce("first_workout_completed", { source: "plan" }), true);
    assert.equal(calls.length, 1, "a blocked storage must not silently swallow the event");
  } finally {
    delete globalThis.window;
    delete globalThis.localStorage;
  }
});
