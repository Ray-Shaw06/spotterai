/**
 * Shared Gemini client for the serverless functions.
 * ----------------------------------------------------------------------------
 * Both /api/generate (plan generation) and /api/chat (the coach chatbot) call
 * Gemini through this one module, so the model names and request hardening live
 * in a SINGLE place. The API key is passed in by the caller (read from env in
 * the handler) and is never stored here.
 *
 * Resilience: free-tier Gemini sometimes returns transient 503 ("overloaded")
 * or 429 (rate-limit) errors. `callGemini` retries those with backoff, falls
 * back across Gemini models, and — for TEXT requests, when GROQ_API_KEY is set —
 * finally falls back to Groq (a separate free provider with much more generous
 * limits, OpenAI-compatible). Vision (image) requests stay Gemini-only, since
 * Groq's vision is weaker. Without GROQ_API_KEY, behavior is exactly as before.
 *
 * Runtime: Node 18+ (global fetch). ES module (matches the rest of the codebase).
 */

// Primary model, then fallback(s) tried when the primary is overloaded/rate-limited.
// A fallback must be a DIFFERENT model so it has separate quota. Model IDs get
// retired (gemini-2.5-flash-lite began returning 404 "no longer available to new
// users", which broke the fallback for every AI feature). If calls start 404-ing,
// list what your key actually supports and update this line:
//   curl "https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_API_KEY"
const GEMINI_MODEL = "gemini-2.5-flash";
const FALLBACK_MODELS = ["gemini-2.0-flash"];
const ALL_MODELS = [GEMINI_MODEL, ...FALLBACK_MODELS];

const endpointFor = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
// Kept for api/generate.js, which builds its own request against the primary model.
const GEMINI_ENDPOINT = endpointFor(GEMINI_MODEL);

// HTTP statuses worth retrying (transient): rate limit, server, overloaded.
const RETRYABLE = new Set([429, 500, 502, 503]);
const MAX_TRIES_PER_MODEL = 2; // attempts per model before moving on

// Groq — the cross-provider fallback (free, OpenAI-compatible, separate quota).
// Enabled by setting GROQ_API_KEY; the model is overridable via GROQ_MODEL. If
// calls 404, list what's available and update the default:
//   curl https://api.groq.com/openai/v1/models -H "Authorization: Bearer $GROQ_API_KEY"
const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
// Gemini statuses that mean "busy / down" — the cases a different provider fixes.
const GROQ_FALLBACK_STATUSES = new Set([429, 500, 502, 503, 504]);

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

/** True if any content part carries an image (Gemini `inline_data`) — those
 *  requests are vision and must NOT fall back to Groq. */
export function hasImagePart(contents) {
  return (contents || []).some((c) => (c.parts || []).some((p) => p.inline_data || p.inlineData));
}

/** Translate Gemini `contents` + systemInstruction into OpenAI/Groq `messages`. */
export function toGroqMessages(contents, systemInstruction) {
  const messages = [];
  if (systemInstruction) messages.push({ role: "system", content: systemInstruction });
  for (const c of contents || []) {
    const text = (c.parts || []).map((p) => p.text).filter(Boolean).join("\n");
    if (text) messages.push({ role: c.role === "model" ? "assistant" : "user", content: text });
  }
  return messages;
}

/** One request to Groq's chat-completions endpoint. Returns text, or throws. */
async function callGroq({ apiKey, contents, systemInstruction, generationConfig, timeoutMs }) {
  const cfg = generationConfig || {};
  const body = {
    model: GROQ_MODEL,
    messages: toGroqMessages(contents, systemInstruction),
    temperature: cfg.temperature ?? DEFAULT_GENERATION_CONFIG.temperature,
  };
  if (cfg.maxOutputTokens) body.max_tokens = cfg.maxOutputTokens;
  // Our JSON prompts all say "JSON", which Groq's json_object mode requires.
  if (cfg.responseMimeType === "application/json") body.response_format = { type: "json_object" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify(body),
    });
  } catch (err) {
    clearTimeout(timer);
    const e = new Error(err.name === "AbortError" ? "Groq request timed out" : err.message || "Network error contacting Groq");
    e.status = err.name === "AbortError" ? 504 : 503;
    throw e;
  }
  clearTimeout(timer);
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const e = new Error(`Groq error ${response.status}: ${detail.slice(0, 300)}`);
    e.status = response.status;
    throw e;
  }
  const data = await response.json();
  return data?.choices?.[0]?.message?.content ?? "";
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

  // Gemini exhausted. If it was a "busy / down" failure and this is a TEXT
  // request, try Groq (separate free capacity) before giving up.
  const groqApiKey = process.env.GROQ_API_KEY;
  if (groqApiKey && !hasImagePart(contents) && lastError && GROQ_FALLBACK_STATUSES.has(lastError.status)) {
    try {
      return await callGroq({ apiKey: groqApiKey, contents, systemInstruction, generationConfig: body.generationConfig, timeoutMs });
    } catch {
      // Keep surfacing the ORIGINAL Gemini error — callers map its .status to UX
      // (e.g. 429 → "show the saved example"). A Groq failure shouldn't mask that.
    }
  }
  throw lastError;
}

export { GEMINI_MODEL, GEMINI_ENDPOINT, callGemini };
