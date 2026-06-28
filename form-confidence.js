/**
 * SpotterAI — form-check confidence (pure)
 * ============================================================================
 * The "can we even judge this rep?" logic, extracted from form-coach.js so it's
 * unit-testable without a webcam or DOM. Confidence is the mean visibility of
 * the key body landmarks; below LOW_CONFIDENCE the coach refuses strong advice.
 */

// MediaPipe Pose indices for shoulders, elbows, wrists, hips, knees, ankles.
export const CONF_LANDMARKS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
export const LOW_CONFIDENCE = 0.5;

/** Mean visibility of the key joints (0–1). 0 when nothing is visible. */
export function frameConfidence(landmarks, indices = CONF_LANDMARKS) {
  let sum = 0;
  let n = 0;
  for (const i of indices) {
    const v = landmarks?.[i]?.visibility;
    if (typeof v === "number" && Number.isFinite(v)) {
      sum += v;
      n += 1;
    }
  }
  return n ? sum / n : 0;
}

/** Bucket the confidence for the meter: high / med / low. */
export function confidenceLevel(conf) {
  return conf >= 0.75 ? "high" : conf >= LOW_CONFIDENCE ? "med" : "low";
}

/** Whether we should give real form feedback (vs. "unable to judge"). */
export function canJudge(conf) {
  return conf >= LOW_CONFIDENCE;
}
