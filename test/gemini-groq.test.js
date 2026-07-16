/**
 * Tests for the Gemini→Groq request translation used by the cross-provider
 * fallback. The network call itself needs a key (manual), but the translation is
 * pure and must be exact — a wrong role or a dropped system prompt silently
 * degrades every fallback response.
 */

import test from "node:test";
import assert from "node:assert/strict";
import * as gemini from "../lib/gemini.js";

const { hasImagePart, toGroqMessages } = gemini;

test("Gemini fallback roster uses a live multimodal model", () => {
  assert.equal(gemini.GEMINI_MODELS[0], "gemini-2.5-flash");
  assert.ok(gemini.GEMINI_MODELS.includes("gemini-3.5-flash"));
  assert.ok(!gemini.GEMINI_MODELS.includes("gemini-2.0-flash"), "the June 2026 shutdown model must not return");
});

test("vision requests preserve the image and fall through after primary-model 429s", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) });
    if (String(url).includes("gemini-2.5-flash")) {
      return new Response('{"error":"rate limited"}', { status: 429 });
    }
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{"name":"Meal"}' }] } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const contents = [{
    role: "user",
    parts: [
      { text: "Estimate this meal." },
      { inline_data: { mime_type: "image/jpeg", data: "photo-base64" } },
    ],
  }];

  try {
    const result = await gemini.callGemini({
      apiKey: "test-key",
      contents,
      systemInstruction: "Return meal JSON.",
      generationConfig: { responseMimeType: "application/json", responseSchema: { type: "object" } },
      timeoutMs: 1000,
    });

    assert.equal(result, '{"name":"Meal"}');
    assert.equal(calls.length, 3, "two primary attempts, then one live fallback");
    assert.match(calls[2].url, /gemini-3\.5-flash:generateContent/);
    assert.deepEqual(calls[2].body.contents, contents);
    assert.equal(calls[2].body.generationConfig.responseMimeType, "application/json");
    assert.deepEqual(calls[2].body.generationConfig.responseSchema, { type: "object" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("hasImagePart detects Gemini inline_data (vision must stay Gemini-only)", () => {
  const vision = [{ role: "user", parts: [{ text: "what is this" }, { inline_data: { mime_type: "image/jpeg", data: "…" } }] }];
  const textOnly = [{ role: "user", parts: [{ text: "2 eggs" }] }];
  assert.equal(hasImagePart(vision), true);
  assert.equal(hasImagePart(textOnly), false);
  assert.equal(hasImagePart([]), false);
  assert.equal(hasImagePart(undefined), false);
});

test("toGroqMessages maps system + roles and concatenates text parts", () => {
  const messages = toGroqMessages(
    [
      { role: "user", parts: [{ text: "hello" }, { text: "world" }] },
      { role: "model", parts: [{ text: "hi there" }] },
    ],
    "You are a coach."
  );
  assert.deepEqual(messages, [
    { role: "system", content: "You are a coach." },
    { role: "user", content: "hello\nworld" }, // parts joined
    { role: "assistant", content: "hi there" }, // Gemini "model" → OpenAI "assistant"
  ]);
});

test("toGroqMessages omits the system message when there's no instruction", () => {
  const messages = toGroqMessages([{ role: "user", parts: [{ text: "Food: banana" }] }]);
  assert.deepEqual(messages, [{ role: "user", content: "Food: banana" }]);
});
