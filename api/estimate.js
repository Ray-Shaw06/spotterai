/**
 * SpotterAI — AI estimator (food macros + exercise classification)
 * ----------------------------------------------------------------------------
 * One serverless function that lets the user log ANYTHING, not just items in the
 * built-in lists:
 *   - kind "food":     "2 egg & cheese omelettes" -> { kcal, protein, carbs, fat }
 *   - kind "food" + image: a PHOTO of a plate -> identified meal + macros (Gemini
 *     vision, still free tier)
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
// Base64 length cap (~3 MB binary) — well under Vercel's request limit. The
// client downscales photos to a few hundred KB before sending; this is a guard.
const MAX_IMAGE_CHARS = 3_800_000;

// Response schemas (OpenAPI subset Gemini supports) — belt-and-braces with the
// prompt. We still validate/normalize below in case the model drifts.
const FOOD_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    serving: { type: "string" },
    kcal: { type: "number" }, // best TYPICAL estimate
    kcal_low: { type: "number" }, // lean / small-portion end of a realistic range
    kcal_high: { type: "number" }, // rich / large-portion end
    protein: { type: "number" },
    carbs: { type: "number" },
    fat: { type: "number" },
  },
  required: ["name", "serving", "kcal", "kcal_low", "kcal_high", "protein", "carbs", "fat"],
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

const FOOD_INSTRUCTION = `You are a careful, CONSERVATIVE nutrition estimator. People over-log food, so err toward realistic, slightly conservative numbers — never inflate portions or hidden fats.

Rules:
- Estimate the TOTAL for the WHOLE amount described (sum multiple/large quantities). If no amount is given, assume ONE normal serving — not a large one.
- Estimate grams per component and look up typical per-100g (USDA-style) values, then sum. Do not round portions up. Prefer the plainer, leaner interpretation when ambiguous (grilled not fried, light not creamy); only count oils/butter/sauces the description implies.
- Give a realistic range: "kcal_low" (lean / small portion) and "kcal_high" (rich / large portion). "kcal" is your single best TYPICAL estimate and MUST lie between them.
- "protein"/"carbs"/"fat" are grams for the TYPICAL estimate (up to one decimal).
- "serving" restates the amount (e.g. "2 omelettes", "1 bowl", "100 g"). "name": short clean label (Title Case, no quantity).
- If the input is clearly not a food or drink, return kcal 0 (and 0 for the range) and zero macros.
Return ONLY the JSON object.`;

const FOOD_VISION_INSTRUCTION = `You are a careful, CONSERVATIVE nutrition estimator analyzing a PHOTO of food or drink. People consistently over-log photo meals, so err toward realistic, slightly conservative numbers — NEVER inflate portion size or hidden fats.

How to estimate:
- Identify each item, then estimate grams for each using visible scale cues (dinner plate ~26 cm, fork ~19 cm, a hand, a standard cup/can). If scale is unclear, assume a NORMAL HOME portion, not a large restaurant one, and do not round portions up.
- Look up typical per-100g (USDA-style) values for each item and sum them.
- Only count oil, butter, dressing or sauce you can actually SEE. Do not assume heavy hidden oils. When ambiguous, choose the leaner, plainer interpretation (grilled not deep-fried, light not creamy) unless the photo clearly shows otherwise.
- Give a realistic range: "kcal_low" (lean interpretation / smaller portion) and "kcal_high" (rich interpretation / larger portion). "kcal" is your single best TYPICAL estimate and MUST lie between them.
- "protein"/"carbs"/"fat" are grams for the TYPICAL estimate. "name": short clean meal label (Title Case). "serving": the portion you assumed (e.g. "1 plate", "1 bowl").
- If there is no food or drink in the image, return name "No food detected" with kcal 0 (and 0 for the range) and zero macros.
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

/** Validate an optional inline image payload from the client. */
function validImage(img) {
  if (!img || typeof img !== "object") return null;
  const mimeType = String(img.mimeType || "").toLowerCase();
  const data = typeof img.data === "string" ? img.data : "";
  if (!/^image\/(jpeg|png|webp)$/.test(mimeType)) return null;
  if (!data || data.length > MAX_IMAGE_CHARS) return null;
  return { mimeType, data };
}

// How far up the model's low→high range to report. AI food estimates skew high,
// so we sit in the lower-middle (0 = low end, 1 = high end).
const RANGE_LEAN = 0.35;
const MIN_SCALE = 0.6; // never cut a typical estimate by more than 40%

/**
 * Report a CONSERVATIVE calorie point from the model's own uncertainty range and
 * the factor to scale the (typical-estimate) macros by, so kcal + macros stay
 * consistent. Only ever reduces (scale ≤ 1) — this exists to curb overshoot.
 * @returns {{ kcal: number, scale: number }}
 */
export function conservativeEstimate(typical, low, high) {
  const t = Number(typical) || 0;
  const lo = Number(low) || 0;
  const hi = Number(high) || 0;
  if (t <= 0 || hi <= 0 || hi < lo || lo <= 0) return { kcal: Math.max(0, Math.round(t)), scale: 1 };
  const point = lo + RANGE_LEAN * (hi - lo);
  const scale = Math.min(1, Math.max(MIN_SCALE, point / t));
  return { kcal: Math.round(t * scale), scale };
}

function normalizeFood(o, query) {
  if (!o || typeof o !== "object") return null;
  const name = (String(o.name || query).trim() || query).slice(0, 60);
  const lowRaw = round(o.kcal_low, 0);
  const highRaw = round(o.kcal_high, 0);
  const { kcal, scale } = conservativeEstimate(round(o.kcal, 0), lowRaw, highRaw);
  const macro = (v) => round((Number(v) || 0) * scale, 1);
  return {
    name,
    serving: (String(o.serving || "1 serving").trim() || "1 serving").slice(0, 40),
    kcal,
    protein: macro(o.protein),
    carbs: macro(o.carbs),
    fat: macro(o.fat),
    // The model's plausibility range (calories), for an honest "varies a lot" hint.
    ...(highRaw > 0 && highRaw >= lowRaw ? { kcalLow: lowRaw, kcalHigh: highRaw } : {}),
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
  if (!kind) return res.status(400).json({ error: "Missing or invalid 'kind' (food | exercise)." });

  const food = kind === "food";
  const image = food ? validImage(payload.image) : null; // photo estimate (food only)
  const query = String(payload.query || "").trim().slice(0, MAX_QUERY_CHARS);
  if (!query && !image) return res.status(400).json({ error: "Missing 'query' (or a food image)." });

  // Build the request: a vision (photo) estimate for food, else a text estimate.
  let contents, systemInstruction, timeoutMs;
  if (image) {
    contents = [{ role: "user", parts: [{ text: "Estimate the nutrition of the food in this photo." }, { inline_data: { mime_type: image.mimeType, data: image.data } }] }];
    systemInstruction = FOOD_VISION_INSTRUCTION;
    timeoutMs = 25000;
  } else {
    contents = [{ role: "user", parts: [{ text: `${food ? "Food" : "Exercise"}: ${query}` }] }];
    systemInstruction = food ? FOOD_INSTRUCTION : EXERCISE_INSTRUCTION;
    timeoutMs = 20000;
  }

  try {
    const text = await callGemini({
      apiKey,
      contents,
      systemInstruction,
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        responseMimeType: "application/json",
        responseSchema: food ? FOOD_SCHEMA : EXERCISE_SCHEMA,
      },
      timeoutMs,
    });

    const parsed = extractJson(text);
    const result = food ? normalizeFood(parsed, query || "Meal") : normalizeExercise(parsed, query);
    if (!result) return res.status(502).json({ error: "The estimator returned an unexpected response. Try again." });
    return res.status(200).json(food ? { food: result } : { exercise: result });
  } catch (err) {
    if (err.status === 429) return res.status(429).json({ error: "Rate-limited right now (free tier). Try again shortly." });
    const overloaded = err.status === 503 || /\b503\b|overload|UNAVAILABLE/i.test(err.message || "");
    if (overloaded) return res.status(503).json({ error: "The AI is briefly overloaded. Try again in a few seconds." });
    return res.status(502).json({ error: "The estimator is unavailable right now. Try again shortly." });
  }
};
