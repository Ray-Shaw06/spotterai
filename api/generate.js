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

// Current free "Flash" model on Google AI Studio. If Google renames the free
// model, update this single constant.
const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

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

// The exact JSON shape we want back, shown to the model in the prompt. We
// deliberately enforce JSON via `responseMimeType: "application/json"` (which is
// broadly supported) plus this explicit schema in the prompt, rather than the
// stricter `responseSchema` field — that keeps the request simple and portable,
// and our parse/validate/retry loop below handles any drift.
const SCHEMA_HINT = `{
  "program_name": string,
  "goal": string,
  "days_per_week": number,
  "days": [
    {
      "day": string,                // e.g. "Day 1"
      "focus": string,              // e.g. "Upper Body" or "Rest"
      "exercises": [
        {
          "name": string,
          "sets": number,
          "reps": string,           // e.g. "8-12", "5", or "30s"
          "rpe": number | null,     // 6-10, or null for warm-up/mobility
          "notes": string
        }
      ]
    }
  ],
  "progression": string,
  "general_notes": string
}`;

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

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Remove markdown code fences (```json ... ```) and grab the outermost JSON
 * object, then attempt to parse. Returns the parsed object or null.
 */
function extractJson(raw) {
  if (!raw || typeof raw !== "string") return null;

  // Strip ```json ... ``` or ``` ... ``` fences if the model added them.
  let text = raw.trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  // As a last resort, slice from the first "{" to the last "}".
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    text = text.slice(first, last + 1);
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Shallow structural validation of the plan. We only confirm the shape the UI
 * and evaluator depend on; we do NOT grade the training content here (that is
 * the evaluator's job, client-side).
 */
function isValidPlan(plan) {
  if (!plan || typeof plan !== "object") return false;
  if (typeof plan.program_name !== "string") return false;
  if (!Array.isArray(plan.days) || plan.days.length === 0) return false;

  return plan.days.every(
    (day) =>
      day &&
      typeof day.focus === "string" &&
      Array.isArray(day.exercises) &&
      day.exercises.every((ex) => ex && typeof ex.name === "string" && ex.sets !== undefined && ex.reps !== undefined)
  );
}

/** Normalize a validated plan so optional fields always exist for the client. */
function normalizePlan(plan, inputs) {
  return {
    program_name: plan.program_name || "Custom Training Program",
    goal: plan.goal || inputs.goal || "General fitness",
    days_per_week: Number(plan.days_per_week) || plan.days.length,
    days: plan.days.map((day) => ({
      day: String(day.day || ""),
      focus: String(day.focus || ""),
      exercises: (day.exercises || []).map((ex) => ({
        name: String(ex.name || "Exercise"),
        sets: Number(ex.sets) || 0,
        reps: String(ex.reps ?? ""),
        rpe: ex.rpe === null || ex.rpe === undefined ? null : Number(ex.rpe),
        notes: String(ex.notes || ""),
      })),
    })),
    progression: String(plan.progression || ""),
    general_notes: String(plan.general_notes || ""),
  };
}

/** One round-trip to Gemini. Returns the raw model text, or throws on HTTP error. */
async function callGemini(apiKey, prompt, timeoutMs) {
  // Abort a single call if it runs long, so one slow request can't consume the
  // whole function budget and trigger a platform 504.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: TEMPERATURE,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          // Force syntactically valid JSON. The exact shape is specified in the
          // prompt; we validate + retry below to catch any drift.
          responseMimeType: "application/json",
          // Disable "thinking" on Gemini 2.5 Flash. We don't need a chain of
          // thought to fill a JSON template, and leaving it on roughly triples
          // latency — which was overrunning the function time limit (HTTP 504).
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
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

  // Surface rate limiting distinctly so the client can fall back to a sample.
  if (response.status === 429) {
    const err = new Error("Gemini rate limit reached");
    err.status = 429;
    throw err;
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const err = new Error(`Gemini error ${response.status}: ${body.slice(0, 300)}`);
    err.status = 502;
    throw err;
  }

  const data = await response.json();
  // Gemini returns candidates[].content.parts[].text
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
  return text;
}

// ----------------------------------------------------------------------------
// Serverless handler (Vercel: default export of a (req, res) function)
// ----------------------------------------------------------------------------

module.exports = async (req, res) => {
  // Only POST is supported.
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // Misconfiguration — tell the client clearly so it can fall back.
    return res.status(500).json({
      error: "Server is missing GEMINI_API_KEY. Add it as an environment variable.",
    });
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
  inputs = inputs || {};

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
