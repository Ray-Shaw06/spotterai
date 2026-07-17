import test from "node:test";
import assert from "node:assert/strict";
import { aiFailureMessage, classifyAiFailure, fetchWithTimeout } from "../ai-errors.js";
import { estimateFood } from "../ai.js";

test("AI failures are classified without exposing provider messages", () => {
  assert.equal(classifyAiFailure({ status: 429 }, { online: true }), "rate_limited");
  assert.equal(classifyAiFailure({ name: "TimeoutError" }, { online: true }), "timeout");
  assert.equal(classifyAiFailure({}, { online: false }), "offline");
  assert.equal(classifyAiFailure({ status: 503 }, { online: true }), "unavailable");
  assert.equal(classifyAiFailure(new SyntaxError("bad JSON"), { online: true }), "invalid_response");
  assert.doesNotMatch(aiFailureMessage("photo", "unavailable", { fallback: false }), /Gemini|Groq|503/i);
});

test("fetchWithTimeout turns its own timer abort into TimeoutError", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_url, { signal }) =>
    new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });

  try {
    await assert.rejects(fetchWithTimeout("/slow", {}, 5), (error) => error?.name === "TimeoutError");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchWithTimeout preserves a caller-requested abort", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_url, { signal }) =>
    new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  const controller = new AbortController();

  try {
    const request = fetchWithTimeout("/cancelled", { signal: controller.signal }, 100);
    controller.abort(new DOMException("Cancelled", "AbortError"));
    await assert.rejects(request, (error) => error?.name === "AbortError");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a malformed food response is marked invalid_response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ food: "not a food object" }) });

  try {
    await assert.rejects(estimateFood("banana"), (error) => error?.failureClass === "invalid_response");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
