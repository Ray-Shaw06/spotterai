/**
 * SpotterAI — serverless plan generator
 * ------------------------------------------------------------------
 * A single serverless function (Vercel format) that:
 *   1. Receives the user's training inputs from the browser.
 *   2. Builds a constrained prompt and calls Google Gemini (free tier).
 *   3. Forces a STRICT JSON response, validates it, and retries on
 *      malformed output up to MAX_RETRIES times.
 *   4. Returns a clean { plan } object — or a clean error.
 *
 * The Gemini API key lives ONLY here, read from process.env. It is never
 * sent to or referenced by any client-side code.
 *
 * Runtime: Node.js 18+ (global `fetch` is built in — no dependencies).
 */

// ----------------------------------------------------------------------------
// Configuration — change the model in ONE place.
// ----------------------------------------------------------------------------

// Model name + endpoint live in one shared place (lib/gemini.js) so both
// serverless functions stay in sync. Change the model there.
import { callGemini as callLLM } from "../lib/gemini.js";
// The plan schema + parse/validate/normalize helpers are shared with the client-side adapt engine.
import { SCHEMA_HINT, clampNumber, extractJson, isValidPlan, normalizePlan } from "../lib/plan.js";

// How many extra times we re-ask Gemini if it returns unparseable JSON.
const MAX_RETRIES = 2;

// Sampling temperature. Low-ish for structured, reliable output.
const TEMPERATURE = 0.6;

// Cap the response so generation stays fast and bounded. A full weekly plan is
// well under this; capping avoids runaway latency.
const MAX_OUTPUT_TOKENS = 4096;

// Time budgets (ms). The serverless platform has a hard timeout (see
// vercel.json `maxDuration`). We abort our own calls comfortably before it so
// the browser always gets a clean JSON error and can fall back to a saved
// example — never a raw 504 gateway page.
const PER_CALL_TIMEOUT_MS = 20000; // abort a single Gemini call after this
const OVERALL_BUDGET_MS = 50000; // stop retrying once this much time is used

// ----------------------------------------------------------------------------
// Prompt construction
// ----------------------------------------------------------------------------

/**
 * Turn the raw form inputs into a readable, bounded instruction for Gemini.
 * We give the model a human-readable client profile plus the exact JSON shape
 * (SCHEMA_HINT) it must return, and request JSON output mode in the request.
 */
function buildPrompt(inputs) {
  const goal = inputs.goal || "General fitness";
  const experience = inputs.experience || "Beginner";
  const days = clampNumber(inputs.daysPerWeek, 2, 6, 3);
  const equipment =
    Array.isArray(inputs.equipment) && inputs.equipment.length
      ? inputs.equipment.join(", ")
      : "bodyweight only";
  const sessionLength = clampNumber(inputs.sessionLength, 20, 120, 60);

  const injuryList = Array.isArray(inputs.injuries) ? inputs.injuries.filter((i) => i && i !== "none") : [];
  const injuryNote = inputs.injuryNotes ? String(inputs.injuryNotes).slice(0, 400) : "";
  const injuriesSummary =
    injuryList.length || injuryNote
      ? `${injuryList.join(", ")}${injuryList.length && injuryNote ? ". " : ""}${injuryNote}`
      : "None reported";

  return `You are an experienced, conservative strength & conditioning coach building a SAFE, evidence-based weekly training program.

CLIENT PROFILE
- Primary goal: ${goal}
- Experience level: ${experience}
- Training days per week: ${days}
- Available equipment: ${equipment}
- Time per session: ${sessionLength} minutes
- Injuries / limitations: ${injuriesSummary}

REQUIREMENTS
- Design exactly ${days} training days. Use clear focus labels (e.g. "Upper Body", "Push", "Lower Body", "Full Body").
- Only prescribe exercises possible with the available equipment.
- Respect the client's experience level: beginners get foundational compound lifts, simple progressions, and conservative RPE (target RPE 6-8); never prescribe maximal or RPE 10 work to a beginner.
- If injuries are reported, AVOID contraindicated movements and choose safe regressions instead. Add a short safety cue in the exercise "notes".
- Balance pushing and pulling volume; include adequate recovery for the chosen frequency.
- Keep total work realistic for the session length.
- "reps" is a string (e.g. "8-12", "5", "30s"). "rpe" is a number 6-10 or null for warm-up/mobility. "sets" is an integer.
- Fill "progression" with how to add load/reps over the coming weeks, and "general_notes" with warm-up and recovery guidance.

OUTPUT FORMAT
Return ONLY a single JSON object matching exactly this shape (no prose, no markdown, no code fences):
${SCHEMA_HINT}`;
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/**
 * One round-trip to the LLM, via the shared client. Returns the raw model text,
 * or throws with `.status` set. The client forces JSON, disables Gemini
 * "thinking" (via its defaults), falls back across Gemini models, and — when
 * GROQ_API_KEY is set — finally to Groq, so plan generation degrades far less
 * under Gemini overload/rate-limit than a single direct call did. The outer loop
 * below still validates + retries on malformed JSON and maps `.status === 429`
 * to the saved-example fallback.
 */
async function callGemini(apiKey, prompt, timeoutMs) {
  return callLLM({
    apiKey,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: TEMPERATURE,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      responseMimeType: "application/json",
    },
    timeoutMs,
  });
}

// ----------------------------------------------------------------------------
// Serverless handler (Vercel: default export of a (req, res) function)
// ----------------------------------------------------------------------------

export default async function handler(req, res) {
  // Only POST is supported.
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  // Vercel parses JSON bodies automatically, but guard for raw strings too.
  let inputs = req.body;
  if (typeof inputs === "string") {
    try {
      inputs = JSON.parse(inputs);
    } catch {
      return res.status(400).json({ error: "Invalid request body." });
    }
  }

  // A request carrying no profile is not a plan request. Without this gate
  // `curl -X POST .../api/generate -d '{}'` returned 200 and a full plan:
  // buildPrompt defaults every field, so an empty body still reached Gemini.
  // This is the most expensive of the four functions (60s budget, 4096 output
  // tokens, up to MAX_RETRIES+1 model calls per request), and the free-tier key
  // is shared with /api/chat, /api/estimate and /api/parse — so exhausting it
  // here takes plan generation down for real users. The other three functions
  // already refuse an empty payload; this one did not.
  //
  // Ordered before the key lookup on purpose, so junk traffic gets a plain 400
  // instead of a 500 naming the environment variable we are missing.
  const PROFILE_FIELDS = ["goal", "experience", "daysPerWeek", "sessionLength", "equipment", "injuries", "injuryNotes"];
  const hasProfile =
    !!inputs &&
    typeof inputs === "object" &&
    !Array.isArray(inputs) &&
    PROFILE_FIELDS.some((f) => {
      const v = inputs[f];
      return Array.isArray(v) ? v.length > 0 : v != null && v !== "";
    });
  if (!hasProfile) {
    return res.status(400).json({ error: "Missing training profile. Send at least a goal." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // Misconfiguration — tell the client clearly so it can fall back.
    return res.status(500).json({
      error: "Server is missing GEMINI_API_KEY. Add it as an environment variable.",
    });
  }

  const prompt = buildPrompt(inputs);

  let lastError = "Unknown error";
  const deadline = Date.now() + OVERALL_BUDGET_MS;

  // Try once, then retry up to MAX_RETRIES more times on malformed JSON —
  // but never start an attempt we don't have time to finish.
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining < 3000) break; // not enough time for another round-trip
    try {
      const raw = await callGemini(apiKey, prompt, Math.min(PER_CALL_TIMEOUT_MS, remaining));
      const parsed = extractJson(raw);

      if (parsed && isValidPlan(parsed)) {
        const plan = normalizePlan(parsed, inputs);
        return res.status(200).json({ plan, attempts: attempt + 1 });
      }

      lastError = "Model returned malformed or incomplete JSON.";
      // loop continues -> retry
    } catch (err) {
      // Pass rate-limit through immediately so the client shows the saved example.
      if (err.status === 429) {
        return res.status(429).json({ error: "Rate limited by Gemini free tier. Try again shortly." });
      }
      lastError = err.message || "Gemini request failed.";
      // For transient server errors, allow the retry loop to try again.
    }
  }

  // All attempts exhausted.
  return res.status(502).json({ error: `Could not generate a valid plan. ${lastError}` });
};
