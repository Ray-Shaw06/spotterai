/**
 * SpotterAI — safety boundaries (pure, deterministic)
 * ============================================================================
 * A small, transparent screen for requests SpotterAI should NOT answer with a
 * plan or confident coaching: pain, injury diagnosis, medical rehab, extreme
 * weight-loss / disordered-eating, training through pain, or asking it to ignore
 * its own warnings.
 *
 * Used by the coach (refuses client-side, before any API call) and the plan
 * generator (surfaces a prominent boundary instead of burying it).
 *
 *   screenRequest(text) -> { level: "block" | "caution" | "ok", id }
 */

export const BOUNDARY_PATTERNS = [
  { id: "severe_pain", level: "block", re: /\b(severe|sharp|stabbing|shooting|chronic|extreme)\s+pain\b|\bcan'?t\s+(walk|move|stand|breathe)\b|\b(gave out|popped|gave way)\b/i },
  { id: "diagnosis", level: "block", re: /\b(diagnos\w*|is it (torn|broken|fractured)|do i have (a|an)|mri|x-?ray|symptoms? of)\b/i },
  { id: "rehab", level: "block", re: /\b(rehab\w*|physical therapy plan|physio plan|post[-\s]?surgery|after surgery|recovery protocol|torn (acl|meniscus|rotator))\b/i },
  { id: "extreme_loss", level: "block", re: /\blose\s+\d{2,}\s?(lbs?|pounds|kgs?)\s+in\s+(a|one|1|two|2|three|3)\s?(week|month)\b|\bcrash diet|\bstarv\w*|\b(500|600|700|800|900|1000)\s?cal|\bextreme (deficit|cut)\b/i },
  { id: "eating_disorder", level: "block", re: /\b(anorexi\w*|bulimi\w*|purg\w*|laxative|make myself (throw up|sick)|stop eating|barely eat\w*|skip(ping)? meals to lose)\b/i },
  { id: "through_pain", level: "block", re: /\b(train|push|work|lift)\s+through\s+(the\s+)?pain\b|\bignore\s+the\s+pain\b|\bno pain no gain\b/i },
  { id: "ignore_warnings", level: "block", re: /\bignore\s+(the\s+)?(warning|warnings|safety|flags?|audit)\b|\bbypass\s+(the\s+)?(safety|audit|check)/i },
  { id: "overtraining", level: "caution", re: /\b(twice a day|2x (a|per) day|two-a-days?|every single day|no rest days?|7 days a week)\b/i },
  { id: "beginner_max", level: "caution", re: /\b(max(imal)?[-\s]?(effort|out)|1rm test|one rep max|to failure every)\b/i },
];

export function screenRequest(text) {
  const t = String(text || "");
  if (!t.trim()) return { level: "ok", id: null };
  for (const p of BOUNDARY_PATTERNS) if (p.re.test(t)) return { level: p.level, id: p.id };
  return { level: "ok", id: null };
}

/** The conservative redirect SpotterAI gives instead of an unsafe answer. */
export const SAFE_REDIRECT =
  "I can't responsibly build or coach that exact request. I can help with a lower-risk, general fitness approach — but pain, injury, medical, or disordered-eating concerns should be handled by a qualified professional such as a doctor, physiotherapist, or registered dietitian. If you're in pain right now, please stop training and seek help.";

/** Shorter note for the generator, shown prominently above a general plan. */
export const GENERATOR_BOUNDARY =
  "Your notes mention something that needs real-world care (pain, injury, or a medical/extreme-goal concern). SpotterAI generated a general, conservative plan and did not try to program around that — please consult a qualified professional before training, and don't push through pain.";
