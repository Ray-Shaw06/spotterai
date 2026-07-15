/**
 * Tests for the Gemini→Groq request translation used by the cross-provider
 * fallback. The network call itself needs a key (manual), but the translation is
 * pure and must be exact — a wrong role or a dropped system prompt silently
 * degrades every fallback response.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { hasImagePart, toGroqMessages } from "../lib/gemini.js";

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
