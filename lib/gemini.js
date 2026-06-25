/**
 * Shared Gemini client for the serverless functions.
 * ----------------------------------------------------------------------------
 * Both /api/generate (plan generation) and /api/chat (the coach chatbot) call
 * Gemini through this one module, so the model name and request hardening live
 * in a SINGLE place. The API key is passed in by the caller (read from env in
 * the handler) and is never stored here.
 *
 * Runtime: Node 18+ (global fetch). CommonJS so it works without a build step.
 */

// The current free "Flash" model on Google AI Studio. Change it here only.
const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Defaults applied to every call. Thinking is disabled because none of our
// tasks need chain-of-thought, and leaving it on roughly triples latency (which
// previously overran the serverless time limit and produced HTTP 504s).
const DEFAULT_GENERATION_CONFIG = {
  temperature: 0.6,
  thinkingConfig: { thinkingBudget: 0 },
};

/**
 * Low-level single call to Gemini's generateContent.
 *
 * @param {object}   opts
 * @param {string}   opts.apiKey             - Gemini API key (server-side only).
 * @param {Array}    opts.contents           - Gemini `contents` array (the turns).
 * @param {string}   [opts.systemInstruction]- Optional system prompt text.
 * @param {object}   [opts.generationConfig] - Merged over the defaults.
 * @param {number}   [opts.timeoutMs=20000]  - Abort the call after this long.
 * @returns {Promise<string>} The model's text output.
 * @throws  {Error} with `.status` (429 | 502 | 504) on failure.
 */
async function callGemini({ apiKey, contents, systemInstruction, generationConfig, timeoutMs = 20000 }) {
  // Abort a slow call so it can't consume the whole function budget.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const body = {
    contents,
    generationConfig: { ...DEFAULT_GENERATION_CONFIG, ...generationConfig },
  };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  let response;
  try {
    response = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify(body),
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") {
      const e = new Error("Gemini request timed out");
      e.status = 504;
      throw e;
    }
    throw err;
  }
  clearTimeout(timer);

  // Distinguish rate limiting so callers can fall back gracefully.
  if (response.status === 429) {
    const e = new Error("Gemini rate limit reached");
    e.status = 429;
    throw e;
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const e = new Error(`Gemini error ${response.status}: ${detail.slice(0, 300)}`);
    e.status = 502;
    throw e;
  }

  const data = await response.json();
  // Concatenate all text parts from the first candidate.
  return data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
}

module.exports = { GEMINI_MODEL, GEMINI_ENDPOINT, callGemini };
