/**
 * SpotterAI — AI estimator (food macros + exercise classification)
 * ----------------------------------------------------------------------------
 * One serverless function that lets the user log ANYTHING by name, not just
 * items in the built-in lists:
 *   - kind "food":     "2 egg & cheese omelettes" -> { kcal, protein, carbs, fat }
 *   - kind "exercise": "hammer strength iso row"  -> { muscle, equipment, cardio }
 *
 * It calls Google Gemini (free tier) through the shared client, forcing a strict
 * JSON response, then validates + normalizes server-side so the browser always
 * gets a clean, bounded object (or a clean error to fall back from).
 *
 * The Gemini key is read from env here and never exposed to the client.
 * Runtime: Node 18+ (global fetch). ES module (Vercel runs the default export).
 */

import { callGemini } from "../lib/gemini.js";

// Must mirror MUSCLES in exercises.js so the classified group is one the UI knows.
const MUSCLES = ["Chest", "Back", "Shoulders", "Biceps", "Triceps", "Quads", "Hamstrings", "Glutes", "Calves", "Core", "Cardio", "Full body"];

const MAX_QUERY_CHARS = 120;
const MAX_OUTPUT_TOKENS = 320;

// Response schemas (OpenAPI subset Gemini supports) — belt-and-braces with the
// prompt. We still validate/normalize below in case the model drifts.
const FOOD_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    serving: { type: "string" },
    kcal: { type: "number" },
    protein: { type: "number" },
    carbs: { type: "number" },
    fat: { type: "number" },
  },
  required: ["name", "serving", "kcal", "protein", "carbs", "fat"],
};
const EXERCISE_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    muscle: { type: "string" },
    equipment: { type: "string" },
    cardio: { type: "boolean" },
  },
  required: ["name", "muscle", "equipment", "cardio"],
};

const FOOD_INSTRUCTION = `You are a precise nutrition-estimation engine. Given a food or drink described in plain language, estimate its nutrition using typical real-world values.

Rules:
- Estimate the TOTAL for the WHOLE amount described. If a quantity is stated ("2 omelettes", "3 eggs", "a large latte"), give the combined total for all of it, not per-unit.
- If no amount is given, assume one normal serving.
- "serving" restates the amount you estimated (e.g. "2 omelettes", "1 bowl", "100 g").
- "kcal" is calories (a number). "protein", "carbs", "fat" are grams (numbers, up to one decimal).
- Keep "name" a short, clean label of the food (Title Case, no quantity).
- If the input is clearly not a food or drink, return kcal 0 and zero macros.
Return ONLY the JSON object.`;

const EXERCISE_INSTRUCTION = `You classify a single strength, gym, or fitness exercise by name.

Return:
- "name": a cleaned-up canonical exercise name in Title Case (no equipment brand names).
- "muscle": the PRIMARY muscle group, EXACTLY one of: ${MUSCLES.join(", ")}.
- "equipment": the main equipment, one short word/phrase (e.g. Barbell, Dumbbell, Machine, Cable, Bodyweight, Kettlebell, Smith Machine).
- "cardio": true ONLY if it is primarily a cardio / conditioning movement (running, cycling, rowing, jump rope, etc.); otherwise false.
Return ONLY the JSON object.`;

/** Strip code fences / surrounding prose and parse the first JSON object. */
function extractJson(raw) {
  if (!raw || typeof raw !== "string") return null;
  let text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) text = text.slice(first, last + 1);
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const round = (v, dp) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

function normalizeFood(o, query) {
  if (!o || typeof o !== "object") return null;
  const name = (String(o.name || query).trim() || query).slice(0, 60);
  return {
    name,
    serving: (String(o.serving || "1 serving").trim() || "1 serving").slice(0, 40),
    kcal: round(o.kcal, 0),
    protein: round(o.protein, 1),
    carbs: round(o.carbs, 1),
    fat: round(o.fat, 1),
    source: "ai",
  };
}

function normalizeExercise(o, query) {
  if (!o || typeof o !== "object") return null;
  const name = (String(o.name || query).trim() || query).slice(0, 50);
  const raw = String(o.muscle || "").trim().toLowerCase();
  const muscle = MUSCLES.find((m) => m.toLowerCase() === raw) || "Full body";
  return {
    name,
    muscle,
    equipment: String(o.equipment || "").trim().slice(0, 30),
    cardio: o.cardio === true || muscle === "Cardio",
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Server is missing GEMINI_API_KEY." });

  let payload = req.body;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      return res.status(400).json({ error: "Invalid request body." });
    }
  }
  payload = payload || {};

  const kind = payload.kind === "exercise" ? "exercise" : payload.kind === "food" ? "food" : null;
  const query = String(payload.query || "").trim().slice(0, MAX_QUERY_CHARS);
  if (!kind) return res.status(400).json({ error: "Missing or invalid 'kind' (food | exercise)." });
  if (!query) return res.status(400).json({ error: "Missing 'query'." });

  const food = kind === "food";
  try {
    const text = await callGemini({
      apiKey,
      contents: [{ role: "user", parts: [{ text: `${food ? "Food" : "Exercise"}: ${query}` }] }],
      systemInstruction: food ? FOOD_INSTRUCTION : EXERCISE_INSTRUCTION,
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        responseMimeType: "application/json",
        responseSchema: food ? FOOD_SCHEMA : EXERCISE_SCHEMA,
      },
      timeoutMs: 20000,
    });

    const parsed = extractJson(text);
    const result = food ? normalizeFood(parsed, query) : normalizeExercise(parsed, query);
    if (!result) return res.status(502).json({ error: "The estimator returned an unexpected response. Try again." });
    return res.status(200).json(food ? { food: result } : { exercise: result });
  } catch (err) {
    if (err.status === 429) return res.status(429).json({ error: "Rate-limited right now (free tier). Try again shortly." });
    const overloaded = err.status === 503 || /\b503\b|overload|UNAVAILABLE/i.test(err.message || "");
    if (overloaded) return res.status(503).json({ error: "The AI is briefly overloaded. Try again in a few seconds." });
    return res.status(502).json({ error: "The estimator is unavailable right now. Try again shortly." });
  }
};
