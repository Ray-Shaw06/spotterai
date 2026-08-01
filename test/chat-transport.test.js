/**
 * Coach transport guardrails.
 *
 * chat.js reads DOM nodes at module scope, so it cannot be imported under
 * node:test. These are source-text regression guards in the same style as
 * ui-copy.test.js and service-worker-behavior.test.js: they pin the contract
 * that the coach must classify its failures the same way the plan surface
 * does, and must not issue an unbounded fetch.
 *
 * Why they exist: a real session showed the coach reporting "This feature
 * needs the live API" for every rejection, including a plain offline blip,
 * which hid the actual cause from the user.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { aiFailureMessage } from "../ai-errors.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const chat = readFileSync(join(root, "chat.js"), "utf8");
const vercelConfig = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));

test("the coach classifies a failed request instead of guessing", () => {
  assert.match(chat, /classifyAiFailure\(/, "coach classifies the error");
  assert.match(chat, /navigator\.onLine/, "coach distinguishes offline from unreachable");
  assert.match(chat, /aiFailureMessage\(/, "coach renders shared failure copy");
  assert.doesNotMatch(
    chat,
    /This feature needs the live API/,
    "the static-preview guess must not be the catch-all message"
  );
});

test("the coach request is bounded by a timeout", () => {
  assert.match(chat, /fetchWithTimeout\(\s*"api\/chat"/, "coach uses fetchWithTimeout");
  assert.doesNotMatch(chat, /\bfetch\(\s*"api\/chat"/, "no bare unbounded fetch remains");
});

test("an offline coach failure says offline, not static preview", () => {
  assert.match(aiFailureMessage("chat", "offline"), /offline/i);
});

test("every api function gets an explicit maxDuration", () => {
  // api/chat.js budgets up to 25s per model call and walks a 2-model ladder, so
  // it cannot run on the platform default. Any api/* route added later needs a
  // budget too, or the platform can kill the invocation mid-flight and the
  // browser sees a dropped connection rather than a clean JSON error.
  const configured = Object.keys(vercelConfig.functions || {}).sort();
  assert.deepEqual(configured, ["api/chat.js", "api/estimate.js", "api/generate.js", "api/parse.js"]);
  for (const [route, settings] of Object.entries(vercelConfig.functions)) {
    assert.equal(typeof settings.maxDuration, "number", `${route} has a maxDuration`);
    assert.ok(settings.maxDuration >= 30, `${route} allows the model ladder to finish`);
  }
});

test("AI failure copy has no leftover dash-sweep artefacts", () => {
  const aiErrors = readFileSync(join(root, "ai-errors.js"), "utf8");
  assert.doesNotMatch(aiErrors, /still here-try/, "'here-try' hyphen artefact is gone");
  for (const failureClass of ["offline", "timeout", "rate_limited", "unavailable", "invalid_response", "unknown"]) {
    assert.doesNotMatch(aiFailureMessage("plan", failureClass), /\b\w+-\w+ (?:once|again)\b/);
  }
});
