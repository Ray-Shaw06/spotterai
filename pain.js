/**
 * SpotterAI — Pain Mode (pure, deterministic)
 * ============================================================================
 * Turns a pain report (location + severity) into a CONSERVATIVE response. It
 * never diagnoses, never prescribes rehab, and never asks the user to train
 * through pain. Severe pain blocks aggressive training of that area and points
 * to a professional. Locations that map to an evaluator injury key become an
 * active limitation so the plan can be re-audited.
 */

export const PAIN_LOCATIONS = ["knee", "shoulder", "lower_back", "wrist", "hip", "ankle", "neck", "other"];
export const PAIN_SEVERITIES = ["mild", "moderate", "severe"];
export const PAIN_TIMINGS = ["warmup", "during_set", "after", "ongoing"];

export const PAIN_LOCATION_LABEL = { knee: "Knee", shoulder: "Shoulder", lower_back: "Lower back", wrist: "Wrist", hip: "Hip", ankle: "Ankle", neck: "Neck", other: "Other" };
export const PAIN_SEVERITY_LABEL = { mild: "Mild discomfort", moderate: "Moderate pain", severe: "Sharp / severe pain" };

// Only these map to the evaluator's injury rules (so the plan can be re-audited).
const INJURY_KEY = { knee: "knee", shoulder: "shoulder", lower_back: "lower_back", wrist: "wrist" };

export const PAIN_DISCLAIMER =
  "SpotterAI cannot diagnose pain. Pain that is sharp, severe, persistent, worsening, or associated with injury should be handled by a qualified professional.";

/** Conservative response for a pain report. Pure — safe to unit-test. */
export function assessPain({ location, severity } = {}) {
  const label = PAIN_LOCATION_LABEL[location] || "the affected area";
  const lower = label.toLowerCase();
  const injuryKey = INJURY_KEY[location] || null; // null => not evaluator-mapped

  if (severity === "severe") {
    return {
      severity: "severe",
      label,
      injuryKey,
      tone: "critical",
      headline: `Stop training ${lower} movements today.`,
      advice: [
        "Stop the painful movement now — don't push through sharp or severe pain.",
        "SpotterAI won't give you a diagnosis or rehab instructions.",
        "Please see a qualified professional (a doctor or physiotherapist), especially if this is persistent or worsening.",
      ],
      blockAggressive: true,
      addLimitation: !!injuryKey,
      seekProfessional: true,
      disclaimer: PAIN_DISCLAIMER,
    };
  }
  if (severity === "moderate") {
    return {
      severity: "moderate",
      label,
      injuryKey,
      tone: "warning",
      headline: `Stop ${lower} work for today and switch to conservative alternatives.`,
      advice: [
        "Stop the movement that hurt for today.",
        "SpotterAI will reduce related volume and swap in lower-risk alternatives.",
        "If this is persistent or worsening, see a qualified professional.",
      ],
      blockAggressive: true,
      addLimitation: !!injuryKey,
      seekProfessional: false,
      disclaimer: PAIN_DISCLAIMER,
    };
  }
  // mild (default)
  return {
    severity: "mild",
    label,
    injuryKey,
    tone: "warning",
    headline: `Modify or skip the ${lower} movement today.`,
    advice: [
      "Stop or modify the specific movement that caused discomfort today.",
      `SpotterAI offers lower-risk substitutions and marks ${lower} as a limitation.`,
      "Check in again — if it keeps happening, treat it as more serious.",
    ],
    blockAggressive: false,
    addLimitation: !!injuryKey,
    seekProfessional: false,
    disclaimer: PAIN_DISCLAIMER,
  };
}
