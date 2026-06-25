/**
 * SpotterAI — Form Evaluator (pure code, no ML inference here)
 * ============================================================================
 * The on-device counterpart to evaluator.js. Where evaluator.js audits the
 * *plan*, this audits your *execution*: given body landmarks from MediaPipe
 * Pose, it computes joint angles and applies transparent, rule-based heuristics
 * to give live form cues and count reps.
 *
 * This module is pure: it takes landmark arrays + the rep state and returns
 * numbers, cues, and rep updates. All camera/ML/drawing lives in form-coach.js.
 *
 * Like the rest of SpotterAI, it FLAGS likely issues from a single 2D camera —
 * it is not a coach or physiotherapist. Thresholds are named constants below.
 *
 * Landmark indices follow MediaPipe Pose (33 points), normalized to [0,1].
 */

// ----------------------------------------------------------------------------
// MediaPipe Pose landmark indices we use
// ----------------------------------------------------------------------------
const LM = {
  shoulderL: 11, shoulderR: 12,
  elbowL: 13, elbowR: 14,
  wristL: 15, wristR: 16,
  hipL: 23, hipR: 24,
  kneeL: 25, kneeR: 26,
  ankleL: 27, ankleR: 28,
};

// ----------------------------------------------------------------------------
// Geometry helpers
// ----------------------------------------------------------------------------

/** Interior angle (degrees) at vertex `b` formed by points a-b-c. 2D (x,y). */
export function angleDeg(a, b, c) {
  const abx = a.x - b.x, aby = a.y - b.y;
  const cbx = c.x - b.x, cby = c.y - b.y;
  const dot = abx * cbx + aby * cby;
  const magAb = Math.hypot(abx, aby);
  const magCb = Math.hypot(cbx, cby);
  if (magAb === 0 || magCb === 0) return null;
  let cos = dot / (magAb * magCb);
  cos = Math.max(-1, Math.min(1, cos));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** Average visibility of a set of landmark indices (0..1). */
function visibilityOf(landmarks, indices) {
  let sum = 0;
  for (const i of indices) sum += landmarks[i]?.visibility ?? 0;
  return sum / indices.length;
}

/**
 * Many lifts are filmed side-on, so one side of the body is clearer than the
 * other. Pick whichever side (left/right) is more visible and return its joints.
 */
function dominantSide(landmarks) {
  const left = visibilityOf(landmarks, [LM.shoulderL, LM.hipL, LM.kneeL, LM.ankleL]);
  const right = visibilityOf(landmarks, [LM.shoulderR, LM.hipR, LM.kneeR, LM.ankleR]);
  const s = right >= left ? "R" : "L";
  return {
    side: s,
    shoulder: landmarks[LM["shoulder" + s]],
    elbow: landmarks[LM["elbow" + s]],
    wrist: landmarks[LM["wrist" + s]],
    hip: landmarks[LM["hip" + s]],
    knee: landmarks[LM["knee" + s]],
    ankle: landmarks[LM["ankle" + s]],
    confidence: Math.max(left, right),
  };
}

// ----------------------------------------------------------------------------
// Exercise definitions
//   Each defines:
//   - repAngle thresholds for the rep state machine
//   - metrics(landmarks): the joint angles we care about (+ which joints to flag)
//   - liveCues(metrics): real-time {level, text} cues from instantaneous angles
//   - depthFeedback(minRepAngle): per-rep quality once a rep completes
// ----------------------------------------------------------------------------

// Tunable thresholds — grouped per exercise for easy reading/adjustment.
export const FORM_THRESHOLDS = {
  squat: {
    DOWN_KNEE: 110, // below this knee angle = descending into the rep
    UP_KNEE: 160, // above this = standing (rep complete)
    GOOD_DEPTH: 100, // min knee angle at/under this = at least parallel
    SHALLOW_DEPTH: 120, // min knee angle above this = noticeably shallow
    MAX_TORSO_LEAN: 60, // torso-from-vertical above this = excessive forward lean
    MIN_CONFIDENCE: 0.5, // skip judging if the pose is too uncertain
  },
  pushup: {
    DOWN_ELBOW: 110, // below this elbow angle = lowering
    UP_ELBOW: 150, // above this = locked out (rep complete)
    GOOD_DEPTH: 95, // min elbow angle at/under this = good range
    SHALLOW_DEPTH: 110, // min elbow angle above this = too shallow
    BODY_LINE_SAG: 0.04, // hip below shoulder-ankle line by more than this = sag
    MIN_CONFIDENCE: 0.5,
  },
};

/** Angle (deg) of vector v from straight-up (0,-1). 0 = vertical, 90 = horizontal. */
function angleFromVertical(from, to) {
  const vx = to.x - from.x;
  const vy = to.y - from.y;
  const mag = Math.hypot(vx, vy);
  if (mag === 0) return null;
  // up vector is (0,-1) in image coords (y grows downward)
  let cos = (vx * 0 + vy * -1) / mag;
  cos = Math.max(-1, Math.min(1, cos));
  return (Math.acos(cos) * 180) / Math.PI;
}

export const EXERCISES = {
  squat: {
    id: "squat",
    label: "Bodyweight Squat",
    setup: "Stand side-on to the camera, full body in frame.",
    repAngleKey: "knee",
    downThreshold: FORM_THRESHOLDS.squat.DOWN_KNEE,
    upThreshold: FORM_THRESHOLDS.squat.UP_KNEE,

    metrics(landmarks) {
      const d = dominantSide(landmarks);
      const T = FORM_THRESHOLDS.squat;
      if (!d.shoulder || !d.hip || !d.knee || !d.ankle) return null;

      const knee = angleDeg(d.hip, d.knee, d.ankle);
      const torsoLean = angleFromVertical(d.hip, d.shoulder); // 0 upright, larger = leaning
      return {
        knee,
        torsoLean,
        confidence: d.confidence,
        reliable: d.confidence >= T.MIN_CONFIDENCE,
        // joints to highlight on the skeleton for this exercise (dominant side)
        focusJoints: [LM["hip" + d.side], LM["knee" + d.side], LM["ankle" + d.side], LM["shoulder" + d.side]],
      };
    },

    liveCues(m) {
      const T = FORM_THRESHOLDS.squat;
      const cues = [];
      if (!m || !m.reliable) return cues;
      // Only coach forward lean once the person is meaningfully bent (in a rep).
      if (m.torsoLean != null && m.knee != null && m.knee < 150 && m.torsoLean > T.MAX_TORSO_LEAN) {
        cues.push({ level: "warn", text: "Keep your chest up — too much forward lean", joints: [LM.shoulderL, LM.hipL] });
      }
      // Near the bottom of the rep, nudge for depth.
      if (m.knee != null && m.knee < 135) {
        if (m.knee <= T.GOOD_DEPTH) cues.push({ level: "good", text: "Good depth — at or below parallel" });
        else if (m.knee > T.SHALLOW_DEPTH) cues.push({ level: "warn", text: "Go deeper — aim for thighs parallel" });
      }
      return cues;
    },

    depthFeedback(minKnee) {
      const T = FORM_THRESHOLDS.squat;
      if (minKnee == null) return { level: "warn", text: "Couldn't read depth" };
      if (minKnee <= T.GOOD_DEPTH) return { level: "good", text: "Hit depth" };
      if (minKnee <= T.SHALLOW_DEPTH) return { level: "warn", text: "Just above parallel" };
      return { level: "warn", text: "Shallow — go deeper" };
    },
  },

  pushup: {
    id: "pushup",
    label: "Push-up",
    setup: "Lie side-on to the camera so your whole body is visible.",
    repAngleKey: "elbow",
    downThreshold: FORM_THRESHOLDS.pushup.DOWN_ELBOW,
    upThreshold: FORM_THRESHOLDS.pushup.UP_ELBOW,

    metrics(landmarks) {
      const d = dominantSide(landmarks);
      const T = FORM_THRESHOLDS.pushup;
      if (!d.shoulder || !d.elbow || !d.wrist || !d.hip || !d.ankle) return null;

      const elbow = angleDeg(d.shoulder, d.elbow, d.wrist);
      const bodyLine = angleDeg(d.shoulder, d.hip, d.ankle); // ~180 = straight

      // Sag vs pike: compare hip.y to the straight shoulder→ankle line at hip.x.
      let hipDeviation = 0; // + = hips sag below line, - = hips pike above
      const denom = d.ankle.x - d.shoulder.x;
      if (Math.abs(denom) > 1e-4) {
        const t = (d.hip.x - d.shoulder.x) / denom;
        const lineY = d.shoulder.y + t * (d.ankle.y - d.shoulder.y);
        hipDeviation = d.hip.y - lineY; // image y grows downward → positive = lower = sag
      }
      return {
        elbow,
        bodyLine,
        hipDeviation,
        confidence: d.confidence,
        reliable: d.confidence >= T.MIN_CONFIDENCE,
        focusJoints: [LM["shoulder" + d.side], LM["elbow" + d.side], LM["wrist" + d.side], LM["hip" + d.side]],
      };
    },

    liveCues(m) {
      const T = FORM_THRESHOLDS.pushup;
      const cues = [];
      if (!m || !m.reliable) return cues;
      if (m.hipDeviation > T.BODY_LINE_SAG) {
        cues.push({ level: "warn", text: "Hips sagging — squeeze glutes and brace", joints: [LM.hipL, LM.hipR] });
      } else if (m.hipDeviation < -T.BODY_LINE_SAG) {
        cues.push({ level: "warn", text: "Hips too high — flatten your back", joints: [LM.hipL, LM.hipR] });
      }
      if (m.elbow != null && m.elbow < 130) {
        if (m.elbow <= T.GOOD_DEPTH) cues.push({ level: "good", text: "Good depth" });
        else if (m.elbow > T.SHALLOW_DEPTH) cues.push({ level: "warn", text: "Lower a little more" });
      }
      return cues;
    },

    depthFeedback(minElbow) {
      const T = FORM_THRESHOLDS.pushup;
      if (minElbow == null) return { level: "warn", text: "Couldn't read depth" };
      if (minElbow <= T.GOOD_DEPTH) return { level: "good", text: "Full range" };
      if (minElbow <= T.SHALLOW_DEPTH) return { level: "warn", text: "A bit shallow" };
      return { level: "warn", text: "Too shallow" };
    },
  },
};

// ----------------------------------------------------------------------------
// Rep counter — a small state machine driven by the rep-defining angle
// ----------------------------------------------------------------------------

/**
 * Tracks reps for one exercise. Feed it the current metrics each frame; it
 * returns the running rep count and, on each completed rep, that rep's quality.
 */
export class RepCounter {
  constructor(exercise) {
    this.ex = exercise;
    this.reps = 0;
    this.phase = "up"; // "up" (top) | "down" (descended)
    this.minAngle = Infinity; // smallest rep-angle seen this rep
    this.lastRep = null; // { rep, depth: {level,text} }
  }

  /** @returns {{reps, phase, justCompleted}} */
  update(metrics) {
    let justCompleted = false;
    const v = metrics ? metrics[this.ex.repAngleKey] : null;
    if (v == null || !metrics.reliable) {
      return { reps: this.reps, phase: this.phase, justCompleted };
    }

    if (this.phase === "up" && v < this.ex.downThreshold) {
      this.phase = "down";
      this.minAngle = v;
    } else if (this.phase === "down") {
      this.minAngle = Math.min(this.minAngle, v);
      if (v > this.ex.upThreshold) {
        this.phase = "up";
        this.reps += 1;
        this.lastRep = { rep: this.reps, depth: this.ex.depthFeedback(this.minAngle) };
        this.minAngle = Infinity;
        justCompleted = true;
      }
    }
    return { reps: this.reps, phase: this.phase, justCompleted };
  }

  reset() {
    this.reps = 0;
    this.phase = "up";
    this.minAngle = Infinity;
    this.lastRep = null;
  }
}
