/**
 * Shared Gemini client for the serverless functions.
 * ----------------------------------------------------------------------------
 * Both /api/generate (plan generation) and /api/chat (the coach chatbot) call
 * Gemini through this one module, so the model names and request hardening live
 * in a SINGLE place. The API key is passed in by the caller (read from env in
 * the handler) and is never stored here.
 *
 * Resilience: free-tier Gemini sometimes returns transient 503 ("overloaded")
 * or 429 errors. `callGemini` retries those with backoff and, if the primary
 * model stays overloaded, transparently falls back to a lighter model (which has
 * separate capacity) before giving up.
 *
 * Runtime: Node 18+ (global fetch). CommonJS so it works without a build step.
 */

// Primary model, then fallback(s) tried when the primary is overloaded/rate-limited.
// Free "Flash" family — change here only.
const GEMINI_MODEL = "gemini-2.5-flash";
const FALLBACK_MODELS = ["gemini-2.5-flash-lite"];
const ALL_MODELS = [GEMINI_MODEL, ...FALLBACK_MODELS];

const endpointFor = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
// Kept for api/generate.js, which builds its own request against the primary model.
const GEMINI_ENDPOINT = endpointFor(GEMINI_MODEL);

// HTTP statuses worth retrying (transient): rate limit, server, overloaded.
const RETRYABLE = new Set([429, 500, 502, 503]);
const MAX_TRIES_PER_MODEL = 2; // attempts per model before moving on

// Defaults applied to every call. Thinking is disabled because none of our tasks
// need chain-of-thought, and leaving it on roughly triples latency (which
// previously overran the serverless time limit and produced HTTP 504s).
const DEFAULT_GENERATION_CONFIG = {
  temperature: 0.6,
  thinkingConfig: { thinkingBudget: 0 },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One request to a specific model endpoint. Returns text, or throws Error.status. */
async function singleCall(endpoint, apiKey, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(`${endpoint}?key=${apiKey}`, {
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
    const e = new Error(err.message || "Network error contacting Gemini");
    e.status = 503; // treat network blips as retryable
    throw e;
  }
  clearTimeout(timer);

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const e = new Error(`Gemini error ${response.status}: ${detail.slice(0, 300)}`);
    e.status = response.status;
    throw e;
  }

  const data = await response.json();
  // Concatenate all text parts from the first candidate.
  return data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
}

/**
 * Call Gemini with retry + model fallback.
 *
 * @param {object}   opts
 * @param {string}   opts.apiKey             - Gemini API key (server-side only).
 * @param {Array}    opts.contents           - Gemini `contents` array (the turns).
 * @param {string}   [opts.systemInstruction]- Optional system prompt text.
 * @param {object}   [opts.generationConfig] - Merged over the defaults.
 * @param {number}   [opts.timeoutMs=20000]  - Abort a single call after this long.
 * @returns {Promise<string>} The model's text output.
 * @throws  {Error} with `.status` (429 | 503 | 504 | 4xx) when all attempts fail.
 */
async function callGemini({ apiKey, contents, systemInstruction, generationConfig, timeoutMs = 20000 }) {
  const body = {
    contents,
    generationConfig: { ...DEFAULT_GENERATION_CONFIG, ...generationConfig },
  };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  let lastError;
  for (const model of ALL_MODELS) {
    for (let attempt = 0; attempt < MAX_TRIES_PER_MODEL; attempt++) {
      try {
        return await singleCall(endpointFor(model), apiKey, body, timeoutMs);
      } catch (err) {
        lastError = err;
        // Permanent errors (bad key/request, etc.) — don't retry or fall back.
        // (404 = model unavailable → fall through to the next model.)
        if (err.status && !RETRYABLE.has(err.status) && err.status !== 404) {
          throw err;
        }
        // Transient — brief backoff, then retry (or move to the next model).
        await sleep(300 * (attempt + 1));
      }
    }
  }
  throw lastError;
}

module.exports = { GEMINI_MODEL, GEMINI_ENDPOINT, callGemini };
