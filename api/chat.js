/**
 * SpotterAI — coach chatbot
 * ----------------------------------------------------------------------------
 * A serverless function that answers questions about the user's generated plan
 * and general fitness, via Google Gemini. The conversation history is sent up
 * by the browser each turn (no database); the current plan is attached as
 * context so the assistant can reference it.
 *
 * Safety: the system instruction makes the assistant educational and
 * safety-first — it defers to professionals for pain, injury, or medical
 * questions, and never diagnoses or prescribes.
 *
 * The Gemini key is read from env here and never exposed to the client.
 */

const { callGemini } = require("../lib/gemini.js");

// Keep requests bounded.
const MAX_MESSAGES = 16; // most recent turns kept for context
const MAX_MESSAGE_CHARS = 4000; // per message
const MAX_PLAN_CHARS = 6000; // truncated plan JSON
const MAX_TRACKER_CHARS = 6000; // truncated tracker summary JSON
const MAX_OUTPUT_TOKENS = 1024;

/** Build the system instruction, embedding the user's plan and tracker data. */
function buildSystemInstruction(plan, tracker) {
  let s = `You are SpotterAI's in-app fitness coach assistant. You are knowledgeable, encouraging, and SAFETY-FIRST.

Guidelines:
- Help with training, technique, programming, and general nutrition questions.
- Be concise and practical. Prefer short paragraphs and bullet points. Plain language.
- You are an EDUCATIONAL tool, not a doctor, physiotherapist, or licensed professional. For pain, injury, medical conditions, medication, or anything clinical, clearly tell the user to consult a qualified professional — do not diagnose or prescribe.
- Encourage good form, adequate recovery, and gradual progression. Never encourage unsafe maximal effort, crash dieting, or training through sharp pain.
- If the user asks about "my plan" or "this program", reference the specific plan provided.
- The user has a tracker (workouts, nutrition, streak, rank, bodyweight). When they ask to "summarize my week", review their progress, or how they're doing, use the TRACKER data: comment on sessions vs target, streak, weekly volume trend, protein vs target, and bodyweight trend. Be specific with their numbers, celebrate wins, and give one or two concrete next steps.
- If you don't know or it's outside fitness, say so briefly.`;

  if (plan && typeof plan === "object") {
    s += `\n\nThe user's CURRENT generated plan (JSON):\n${JSON.stringify(plan).slice(0, MAX_PLAN_CHARS)}`;
  } else {
    s += `\n\nThe user has not generated a plan yet. If they ask about "my plan", invite them to generate one first.`;
  }

  if (tracker && typeof tracker === "object") {
    s += `\n\nThe user's TRACKER summary (JSON) — their logged progress; reference these real numbers:\n${JSON.stringify(tracker).slice(0, MAX_TRACKER_CHARS)}`;
  } else {
    s += `\n\nThe user hasn't logged any workouts or nutrition yet. If they ask to summarize their week, encourage them to start logging on the dashboard.`;
  }
  return s;
}

/** Map our {role, content} messages to Gemini's contents format. */
function toGeminiContents(messages) {
  return messages
    .filter((m) => m && typeof m.content === "string" && m.content.trim())
    .slice(-MAX_MESSAGES)
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content.slice(0, MAX_MESSAGE_CHARS) }],
    }));
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Server is missing GEMINI_API_KEY." });
  }

  let payload = req.body;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      return res.status(400).json({ error: "Invalid request body." });
    }
  }
  payload = payload || {};

  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const contents = toGeminiContents(messages);
  if (!contents.length || contents[contents.length - 1].role !== "user") {
    return res.status(400).json({ error: "No user message to respond to." });
  }

  try {
    const reply = await callGemini({
      apiKey,
      contents,
      systemInstruction: buildSystemInstruction(payload.plan, payload.tracker),
      generationConfig: { temperature: 0.7, maxOutputTokens: MAX_OUTPUT_TOKENS },
      timeoutMs: 25000,
    });

    if (!reply.trim()) {
      return res.status(502).json({ error: "The coach didn't return a response. Please try again." });
    }
    return res.status(200).json({ reply });
  } catch (err) {
    if (err.status === 429) {
      return res.status(429).json({ error: "The coach is rate-limited right now. Try again shortly." });
    }
    // Transient overload (all retries + fallback model exhausted) — let the client retry.
    const overloaded = err.status === 503 || /\b503\b|overload|UNAVAILABLE/i.test(err.message || "");
    if (overloaded) {
      return res.status(503).json({ error: "The AI is briefly overloaded. Please try again in a few seconds." });
    }
    return res.status(502).json({ error: "The coach is unavailable right now. Please try again shortly." });
  }
};
