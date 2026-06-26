/**
 * SpotterAI — adaptive coach (re-tune a plan from real logged training)
 * ----------------------------------------------------------------------------
 * The headline loop: given the user's CURRENT plan + a compact summary of what
 * they've ACTUALLY logged (sessions, volume trend, PRs, adherence, nutrition),
 * Gemini revises the program so the next block fits their real progress — then
 * the SAME pure-code evaluator re-audits it on the client. Generate → train →
 * re-audit, closed.
 *
 * Returns { plan, changes, summary }: the revised plan (same schema as
 * /api/generate, so the renderer + evaluator are reused as-is) plus a short
 * human-readable list of what changed and why.
 *
 * The Gemini key is read from env here and never exposed to the client.
 * Runtime: Node 18+ (global fetch). CommonJS — no build step.
 */

const { callGemini } = require("../lib/gemini.js");
const { SCHEMA_HINT, extractJson, isValidPlan, normalizePlan } = require("../lib/plan.js");

const MAX_JSON_RETRIES = 1; // re-ask once if the model returns malformed JSON
const MAX_OUTPUT_TOKENS = 4096;
const MAX_PLAN_CHARS = 6000;
const MAX_TRACKER_CHARS = 6000;
const MAX_CHANGES = 8;

// The revised plan plus a summary + change log, in one object.
const ADAPT_SCHEMA_HINT = `{
  ...all fields of the plan below...,
  "summary": string,            // 1-2 sentences on how the plan was adapted
  "changes": [ string ]         // 3-6 short bullets: each adjustment AND why, citing their data
}

where the plan fields are:
${SCHEMA_HINT}`;

/** Human-readable line for the original profile, when we have it. */
function profileLine(inputs) {
  if (!inputs || typeof inputs !== "object") return "Not provided — infer from the current plan.";
  const eq = Array.isArray(inputs.equipment) && inputs.equipment.length ? inputs.equipment.join(", ") : "bodyweight only";
  const injuries = Array.isArray(inputs.injuries) ? inputs.injuries.filter((i) => i && i !== "none") : [];
  const injuryNote = inputs.injuryNotes ? ` ${String(inputs.injuryNotes).slice(0, 300)}` : "";
  return [
    `Goal: ${inputs.goal || "general fitness"}`,
    `Experience: ${inputs.experience || "unknown"}`,
    `Days/week: ${inputs.daysPerWeek || "as in plan"}`,
    `Equipment: ${eq}`,
    `Injuries: ${injuries.length || injuryNote ? injuries.join(", ") + injuryNote : "none reported"}`,
  ].join(" · ");
}

function buildPrompt(plan, tracker, inputs) {
  return `You are an experienced, conservative strength & conditioning coach REVISING an existing weekly training program based on what the client has ACTUALLY been doing. Make the next training block fit their real progress and adherence — it should feel like the natural next step, not a brand-new program.

CURRENT PLAN (JSON):
${JSON.stringify(plan).slice(0, MAX_PLAN_CHARS)}

THE CLIENT'S LOGGED TRAINING (JSON summary — these are real numbers from their tracker):
${JSON.stringify(tracker).slice(0, MAX_TRACKER_CHARS)}

ORIGINAL CLIENT PROFILE:
${profileLine(inputs)}

HOW TO ADAPT
- Progress where they're succeeding: if logged sets show they're hitting or beating targets / set personal records on a lift, add a little load, a rep, or a set there.
- Pull back where needed: if adherence is low (few sessions vs target, broken streak) simplify or reduce volume; if a muscle's volume already looks high or they seem to be plateauing, deload or hold rather than pile on.
- Rebalance: shift volume toward muscle groups they've been neglecting relative to the plan, and keep push/pull balanced.
- Respect the client's experience level and ANY injuries — avoid contraindicated movements and keep RPE conservative for beginners (target RPE 6-8).
- Keep it realistic for their available days and equipment, and KEEP THE SAME JSON SCHEMA and day-structure conventions.
- Prefer adjusting the existing program over rewriting it wholesale.

OUTPUT FORMAT
Return ONLY a single JSON object (no prose, no markdown, no code fences) in EXACTLY this shape — the full revised plan plus "summary" and "changes":
${ADAPT_SCHEMA_HINT}

Each "changes" entry must name the specific adjustment AND the reason from their data, e.g. "Bumped Bench Press to 4×5 — you hit 3×5 at 60kg three sessions in a row" or "Cut leg volume slightly — only 1 of 3 planned leg days logged this week".`;
}

/** Tracker has enough logged activity to adapt from? */
function hasSignal(tracker) {
  if (!tracker || typeof tracker !== "object") return false;
  return Number(tracker.workoutsLogged) > 0 || (Array.isArray(tracker.recentWorkouts) && tracker.recentWorkouts.length > 0);
}

function cleanChanges(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((c) => typeof c === "string" && c.trim())
    .map((c) => c.trim().slice(0, 240))
    .slice(0, MAX_CHANGES);
}

module.exports = async (req, res) => {
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

  const plan = payload.plan;
  const tracker = payload.tracker;
  const inputs = payload.inputs;

  if (!isValidPlan(plan)) {
    return res.status(400).json({ error: "No valid current plan to adapt. Generate a plan first." });
  }
  if (!hasSignal(tracker)) {
    return res.status(400).json({ error: "No logged training yet — log a workout or two, then I can tailor your plan." });
  }

  const prompt = buildPrompt(plan, tracker, inputs);

  let lastError = "Unknown error";
  for (let attempt = 0; attempt <= MAX_JSON_RETRIES; attempt++) {
    try {
      const raw = await callGemini({
        apiKey,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.5,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          responseMimeType: "application/json",
        },
        timeoutMs: 25000,
      });

      const parsed = extractJson(raw);
      if (parsed && isValidPlan(parsed)) {
        return res.status(200).json({
          plan: normalizePlan(parsed, inputs || {}),
          changes: cleanChanges(parsed.changes),
          summary: typeof parsed.summary === "string" ? parsed.summary.slice(0, 400) : "",
        });
      }
      lastError = "Model returned malformed or incomplete JSON.";
    } catch (err) {
      if (err.status === 429) return res.status(429).json({ error: "Rate-limited right now (free tier). Try again shortly." });
      const overloaded = err.status === 503 || /\b503\b|overload|UNAVAILABLE/i.test(err.message || "");
      if (overloaded) return res.status(503).json({ error: "The AI is briefly overloaded. Try again in a few seconds." });
      lastError = err.message || "Gemini request failed.";
    }
  }

  return res.status(502).json({ error: `Could not adapt the plan. ${lastError}` });
};
