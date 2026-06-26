/**
 * SpotterAI — natural-language quick-log parser
 * ----------------------------------------------------------------------------
 * Turns a plain-English (or spoken) note into a structured log:
 *   "bench 3x5 at 60kg then 3x8 incline db press"  -> a workout
 *   "ate a chicken burrito and a banana"           -> nutrition (with macros)
 *
 * Returns { kind, workout, nutrition, note } so the client can show a preview
 * and let the user CONFIRM before anything is written to the tracker (the AI
 * proposes, the user approves — no silent mis-logging).
 *
 * Calls Gemini (free tier) through the shared client; key stays server-side.
 * Runtime: Node 18+ (global fetch). ES module (Vercel runs the default export).
 */

import { callGemini } from "../lib/gemini.js";

const MAX_TEXT_CHARS = 400;
const MAX_OUTPUT_TOKENS = 800;
const MEALS = ["breakfast", "lunch", "dinner", "snacks"];

const INSTRUCTION = `You convert a short natural-language note into a structured fitness log.

Decide whether the note describes a WORKOUT (exercises done, with sets/reps/weight) or NUTRITION (food/drink eaten). Then:
- WORKOUT: list each exercise with its sets. Expand shorthand like "3x5" into 3 sets of 5 reps. "weight" is a number in whatever unit the user implies (default kg); bodyweight movements use 0. Use a clean Title Case exercise name.
- NUTRITION: list each food/drink item and ESTIMATE its macros with typical real-world values (the TOTAL for the amount stated). Infer "meal" (breakfast/lunch/dinner/snacks) only if the note implies it, otherwise use "".
- If it's neither, or too vague to log, set "kind" to "unknown" and put a short, friendly clarification in "note".

Return ONLY this JSON object (no prose, no code fences):
{
  "kind": "workout" | "nutrition" | "unknown",
  "workout": { "name": string, "exercises": [ { "name": string, "sets": [ { "weight": number, "reps": number } ] } ] } | null,
  "nutrition": { "meal": "breakfast"|"lunch"|"dinner"|"snacks"|"", "items": [ { "name": string, "kcal": number, "protein": number, "carbs": number, "fat": number } ] } | null,
  "note": string
}`;

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

const numPos = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const round1 = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 10) / 10 : 0;
};

function normalizeWorkout(w) {
  if (!w || typeof w !== "object" || !Array.isArray(w.exercises)) return null;
  const exercises = w.exercises
    .map((e) => ({
      name: String(e?.name || "").trim().slice(0, 60),
      sets: Array.isArray(e?.sets)
        ? e.sets.map((s) => ({ weight: numPos(s?.weight), reps: numPos(s?.reps) })).filter((s) => s.weight > 0 || s.reps > 0)
        : [],
    }))
    .filter((e) => e.name && e.sets.length);
  if (!exercises.length) return null;
  return { name: String(w.name || "Quick-logged workout").trim().slice(0, 40) || "Quick-logged workout", exercises };
}

function normalizeNutrition(n) {
  if (!n || typeof n !== "object" || !Array.isArray(n.items)) return null;
  const items = n.items
    .map((it) => ({
      name: String(it?.name || "").trim().slice(0, 60),
      kcal: Math.round(numPos(it?.kcal)),
      protein: round1(it?.protein),
      carbs: round1(it?.carbs),
      fat: round1(it?.fat),
    }))
    .filter((it) => it.name);
  if (!items.length) return null;
  const meal = MEALS.includes(n.meal) ? n.meal : "";
  return { meal, items };
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
  const text = String((payload || {}).text || "").trim().slice(0, MAX_TEXT_CHARS);
  if (!text) return res.status(400).json({ error: "Nothing to log." });

  try {
    const raw = await callGemini({
      apiKey,
      contents: [{ role: "user", parts: [{ text: `Note: ${text}` }] }],
      systemInstruction: INSTRUCTION,
      generationConfig: { temperature: 0.2, maxOutputTokens: MAX_OUTPUT_TOKENS, responseMimeType: "application/json" },
      timeoutMs: 20000,
    });

    const parsed = extractJson(raw);
    if (!parsed || typeof parsed !== "object") {
      return res.status(502).json({ error: "Couldn't understand that. Try again." });
    }

    // Trust the model's kind first, then fall back to whichever section parses.
    const tryWorkout = () => normalizeWorkout(parsed.workout);
    const tryNutrition = () => normalizeNutrition(parsed.nutrition);

    if (parsed.kind === "workout") {
      const w = tryWorkout();
      if (w) return res.status(200).json({ kind: "workout", workout: w });
    }
    if (parsed.kind === "nutrition") {
      const n = tryNutrition();
      if (n) return res.status(200).json({ kind: "nutrition", nutrition: n });
    }
    const w = tryWorkout();
    if (w) return res.status(200).json({ kind: "workout", workout: w });
    const n = tryNutrition();
    if (n) return res.status(200).json({ kind: "nutrition", nutrition: n });

    return res.status(200).json({
      kind: "unknown",
      note: typeof parsed.note === "string" && parsed.note.trim() ? parsed.note.trim().slice(0, 200) : "I couldn't tell if that's a workout or a meal. Try “bench 3×5 at 60kg” or “ate oatmeal and a banana”.",
    });
  } catch (err) {
    if (err.status === 429) return res.status(429).json({ error: "Rate-limited right now (free tier). Try again shortly." });
    const overloaded = err.status === 503 || /\b503\b|overload|UNAVAILABLE/i.test(err.message || "");
    if (overloaded) return res.status(503).json({ error: "The AI is briefly overloaded. Try again in a few seconds." });
    return res.status(502).json({ error: "Couldn't reach the parser right now. Try again shortly." });
  }
}
