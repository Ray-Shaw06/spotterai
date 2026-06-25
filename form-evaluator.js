/**
 * SpotterAI — Form Evaluator (pure code)
 * ============================================================================
 * The on-device counterpart to evaluator.js. Given body landmarks from
 * MediaPipe Pose, it computes joint angles and applies transparent, rule-based
 * heuristics to give live form cues and count reps.
 *
 * Accuracy notes (what makes this version more precise):
 *   • Segment angles (knee/elbow/hip flexion) are computed from MediaPipe's
 *     **3D world landmarks** (metric, hip-centered) → far less sensitive to
 *     camera viewpoint than 2D pixel angles.
 *   • Orientation-vs-gravity cues (torso lean, "overhead", hip line) use the
 *     **2D image landmarks**, whose Y axis aligns with gravity for an upright
 *     camera.
 *   • A **One-Euro filter** (applied in form-coach.js) removes landmark jitter
 *     before these rules run, so rep counting and cues don't flicker.
 *   • Rep counting uses hysteresis + a minimum range-of-motion + a debounce so
 *     small twitches and double-counts are rejected.
 *
 * Honest limits: this is a single 2D camera. It cannot see spinal position,
 * load, or true 3D depth. It offers heuristic cues, not a coach's eye. All
 * thresholds live in FORM_THRESHOLDS so they're easy to read and tune.
 */

// MediaPipe Pose landmark indices (33-point model).
const LM = {
  nose: 0,
  shoulderL: 11, shoulderR: 12,
  elbowL: 13, elbowR: 14,
  wristL: 15, wristR: 16,
  hipL: 23, hipR: 24,
  kneeL: 25, kneeR: 26,
  ankleL: 27, ankleR: 28,
};

// ============================================================================
// 1. TUNABLE THRESHOLDS (degrees, unless noted). Starting points — fine-tune
//    on a real device. Rep gates: DOWN/UP angles, MIN_RANGE, debounce.
// ============================================================================
export const SMOOTHING = { minCutoff: 1.7, beta: 0.02, dCutoff: 1.0 };

export const FORM_THRESHOLDS = {
  global: { MIN_VIS: 0.5, REP_DEBOUNCE_MS: 320 },

  squat: { DOWN: 110, UP: 160, MIN_RANGE: 30, GOOD_DEPTH: 100, SHALLOW_DEPTH: 120, MAX_TORSO_LEAN: 60 },
  pushup: { DOWN: 110, UP: 150, MIN_RANGE: 30, GOOD_DEPTH: 95, SHALLOW_DEPTH: 110, BODY_SAG: 0.045 },
  lunge: { DOWN: 120, UP: 160, MIN_RANGE: 35, GOOD_DEPTH: 100, SHALLOW_DEPTH: 120, MAX_TORSO_LEAN: 38 },
  ohp: { DOWN: 100, UP: 158, MIN_RANGE: 40, GOOD_DEPTH: 100, SHALLOW_DEPTH: 120 },
  curl: { DOWN: 70, UP: 150, MIN_RANGE: 45, GOOD_PEAK: 60, SHALLOW_PEAK: 85, ELBOW_DRIFT: 28 },
  rdl: { DOWN: 125, UP: 160, MIN_RANGE: 28, GOOD_DEPTH: 110, SHALLOW_DEPTH: 130, KNEE_SQUAT: 125 },
  hipthrust: { DOWN: 135, UP: 162, MIN_RANGE: 22, GOOD_LOCK: 165, LOW_LOCK: 150 },

  general: { MIN_RANGE: 25, DOWN_FRAC: 0.35, UP_FRAC: 0.35, REP_DEBOUNCE_MS: 350 },
};

// ============================================================================
// 2. GEOMETRY
// ============================================================================

/** Interior angle (degrees) at vertex b for a-b-c. Uses x,y,z when present. */
export function angleAt(a, b, c) {
  if (!a || !b || !c) return null;
  const abx = a.x - b.x, aby = a.y - b.y, abz = (a.z ?? 0) - (b.z ?? 0);
  const cbx = c.x - b.x, cby = c.y - b.y, cbz = (c.z ?? 0) - (b.z ?? 0);
  const dot = abx * cbx + aby * cby + abz * cbz;
  const m1 = Math.hypot(abx, aby, abz);
  const m2 = Math.hypot(cbx, cby, cbz);
  if (m1 === 0 || m2 === 0) return null;
  let cos = dot / (m1 * m2);
  cos = Math.max(-1, Math.min(1, cos));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** Angle (deg) of vector from→to relative to straight up. 2D image coords (y down). */
function angleFromVertical(from, to) {
  const vx = to.x - from.x;
  const vy = to.y - from.y;
  const mag = Math.hypot(vx, vy);
  if (mag === 0) return null;
  let cos = (vy * -1) / mag; // up = (0,-1)
  cos = Math.max(-1, Math.min(1, cos));
  return (Math.acos(cos) * 180) / Math.PI;
}

function vis(landmarks, i) {
  return landmarks[i]?.visibility ?? landmarks[i]?.presence ?? 1;
}

/**
 * Pick the more visible side and return its joints from BOTH the 2D image
 * landmarks (for gravity-relative cues) and the 3D world landmarks (for angles).
 */
function side(image, world) {
  const left = (vis(image, LM.shoulderL) + vis(image, LM.hipL) + vis(image, LM.kneeL)) / 3;
  const right = (vis(image, LM.shoulderR) + vis(image, LM.hipR) + vis(image, LM.kneeR)) / 3;
  const s = right >= left ? "R" : "L";
  const pick = (name) => ({ img: image[LM[name + s]], w: world[LM[name + s]] });
  return {
    s,
    confidence: Math.max(left, right),
    shoulder: pick("shoulder"),
    elbow: pick("elbow"),
    wrist: pick("wrist"),
    hip: pick("hip"),
    knee: pick("knee"),
    ankle: pick("ankle"),
  };
}

/** Straightness of hip relative to the shoulder→ankle line (2D). + = sag, - = pike. */
function hipDeviation(shoulderImg, hipImg, ankleImg) {
  const denom = ankleImg.x - shoulderImg.x;
  if (Math.abs(denom) < 1e-4) return 0;
  const t = (hipImg.x - shoulderImg.x) / denom;
  const lineY = shoulderImg.y + t * (ankleImg.y - shoulderImg.y);
  return hipImg.y - lineY; // image y grows downward
}

// Depth helpers -------------------------------------------------------------
function depthFlex(val, good, shallow, okText = "Good depth") {
  if (val == null) return { level: "warn", text: "Couldn't read depth" };
  if (val <= good) return { level: "good", text: okText };
  if (val <= shallow) return { level: "warn", text: "Just shy of full depth" };
  return { level: "warn", text: "Too shallow — bigger range" };
}

// ============================================================================
// 3. EXERCISES — each: rep gate, metrics(), cues(), depthFeedback()
//    rep.metric: which extreme drives depth feedback ("min" flexion / "max" lockout)
// ============================================================================
const T = FORM_THRESHOLDS;

export const EXERCISES = {
  squat: {
    id: "squat", label: "Squat",
    setup: "Stand side-on, full body in frame.",
    rep: { key: "knee", down: T.squat.DOWN, up: T.squat.UP, minRange: T.squat.MIN_RANGE, metric: "min" },
    metrics(image, world) {
      const d = side(image, world);
      return {
        knee: angleAt(d.hip.w, d.knee.w, d.ankle.w),
        torsoLean: angleFromVertical(d.hip.img, d.shoulder.img),
        confidence: d.confidence,
        reliable: d.confidence >= T.global.MIN_VIS,
        focusJoints: [LM["hip" + d.s], LM["knee" + d.s], LM["ankle" + d.s], LM["shoulder" + d.s]],
      };
    },
    cues(m) {
      const c = [];
      if (!m.reliable) return c;
      if (m.torsoLean != null && m.knee != null && m.knee < 150 && m.torsoLean > T.squat.MAX_TORSO_LEAN)
        c.push({ level: "warn", text: "Chest up — too much forward lean", joints: [LM.shoulderL, LM.hipL, LM.shoulderR, LM.hipR] });
      if (m.knee != null && m.knee < 135) {
        if (m.knee <= T.squat.GOOD_DEPTH) c.push({ level: "good", text: "Good depth — at/below parallel" });
        else if (m.knee > T.squat.SHALLOW_DEPTH) c.push({ level: "warn", text: "Go deeper — aim for parallel" });
      }
      return c;
    },
    depthFeedback: (min) => depthFlex(min, T.squat.GOOD_DEPTH, T.squat.SHALLOW_DEPTH, "Hit depth"),
  },

  pushup: {
    id: "pushup", label: "Push-up",
    setup: "Lie side-on so your whole body is visible.",
    rep: { key: "elbow", down: T.pushup.DOWN, up: T.pushup.UP, minRange: T.pushup.MIN_RANGE, metric: "min" },
    metrics(image, world) {
      const d = side(image, world);
      return {
        elbow: angleAt(d.shoulder.w, d.elbow.w, d.wrist.w),
        hipDev: hipDeviation(d.shoulder.img, d.hip.img, d.ankle.img),
        confidence: d.confidence,
        reliable: d.confidence >= T.global.MIN_VIS,
        focusJoints: [LM["shoulder" + d.s], LM["elbow" + d.s], LM["wrist" + d.s], LM["hip" + d.s]],
      };
    },
    cues(m) {
      const c = [];
      if (!m.reliable) return c;
      if (m.hipDev > T.pushup.BODY_SAG) c.push({ level: "warn", text: "Hips sagging — brace your core", joints: [LM.hipL, LM.hipR] });
      else if (m.hipDev < -T.pushup.BODY_SAG) c.push({ level: "warn", text: "Hips too high — flatten your back", joints: [LM.hipL, LM.hipR] });
      if (m.elbow != null && m.elbow < 130) {
        if (m.elbow <= T.pushup.GOOD_DEPTH) c.push({ level: "good", text: "Good depth" });
        else if (m.elbow > T.pushup.SHALLOW_DEPTH) c.push({ level: "warn", text: "Lower a little more" });
      }
      return c;
    },
    depthFeedback: (min) => depthFlex(min, T.pushup.GOOD_DEPTH, T.pushup.SHALLOW_DEPTH, "Full range"),
  },

  lunge: {
    id: "lunge", label: "Lunge",
    setup: "Side-on. Step into each lunge with control.",
    rep: { key: "frontKnee", down: T.lunge.DOWN, up: T.lunge.UP, minRange: T.lunge.MIN_RANGE, metric: "min" },
    metrics(image, world) {
      const kneeL = angleAt(world[LM.hipL], world[LM.kneeL], world[LM.ankleL]);
      const kneeR = angleAt(world[LM.hipR], world[LM.kneeR], world[LM.ankleR]);
      const front = [kneeL, kneeR].filter((x) => x != null).sort((a, b) => a - b)[0] ?? null; // most-flexed leg
      const d = side(image, world);
      return {
        frontKnee: front,
        torsoLean: angleFromVertical(d.hip.img, d.shoulder.img),
        confidence: d.confidence,
        reliable: d.confidence >= T.global.MIN_VIS,
        focusJoints: [LM.kneeL, LM.kneeR, LM.hipL, LM.hipR],
      };
    },
    cues(m) {
      const c = [];
      if (!m.reliable) return c;
      if (m.torsoLean != null && m.frontKnee != null && m.frontKnee < 150 && m.torsoLean > T.lunge.MAX_TORSO_LEAN)
        c.push({ level: "warn", text: "Stay tall — keep the torso upright", joints: [LM.shoulderL, LM.hipL] });
      if (m.frontKnee != null && m.frontKnee < 130) {
        if (m.frontKnee <= T.lunge.GOOD_DEPTH) c.push({ level: "good", text: "Good lunge depth" });
        else if (m.frontKnee > T.lunge.SHALLOW_DEPTH) c.push({ level: "warn", text: "Drop a little deeper" });
      }
      return c;
    },
    depthFeedback: (min) => depthFlex(min, T.lunge.GOOD_DEPTH, T.lunge.SHALLOW_DEPTH, "Good depth"),
  },

  ohp: {
    id: "ohp", label: "Overhead press",
    setup: "Face the camera or side-on; press fully overhead.",
    rep: { key: "elbow", down: T.ohp.DOWN, up: T.ohp.UP, minRange: T.ohp.MIN_RANGE, metric: "min" },
    metrics(image, world) {
      const d = side(image, world);
      return {
        elbow: angleAt(d.shoulder.w, d.elbow.w, d.wrist.w),
        wristAboveShoulder: d.wrist.img.y < d.shoulder.img.y,
        confidence: d.confidence,
        reliable: d.confidence >= T.global.MIN_VIS,
        focusJoints: [LM["shoulder" + d.s], LM["elbow" + d.s], LM["wrist" + d.s]],
      };
    },
    cues(m) {
      const c = [];
      if (!m.reliable) return c;
      // At lockout, the wrist should finish above the shoulder/head.
      if (m.elbow != null && m.elbow > 150 && !m.wristAboveShoulder)
        c.push({ level: "warn", text: "Press fully overhead", joints: [LM.wristL, LM.wristR] });
      if (m.elbow != null && m.elbow > 158 && m.wristAboveShoulder) c.push({ level: "good", text: "Full lockout" });
      return c;
    },
    depthFeedback: (min) => depthFlex(min, T.ohp.GOOD_DEPTH, T.ohp.SHALLOW_DEPTH, "Full range"),
  },

  curl: {
    id: "curl", label: "Biceps curl",
    setup: "Side-on. Keep your upper arm still.",
    rep: { key: "elbow", down: T.curl.DOWN, up: T.curl.UP, minRange: T.curl.MIN_RANGE, metric: "min" },
    metrics(image, world) {
      const d = side(image, world);
      return {
        elbow: angleAt(d.shoulder.w, d.elbow.w, d.wrist.w),
        // How far the upper arm swings forward from vertical (proxy for "cheating").
        upperArmSwing: angleFromVertical(d.shoulder.img, d.elbow.img),
        confidence: d.confidence,
        reliable: d.confidence >= T.global.MIN_VIS,
        focusJoints: [LM["shoulder" + d.s], LM["elbow" + d.s], LM["wrist" + d.s]],
      };
    },
    cues(m) {
      const c = [];
      if (!m.reliable) return c;
      if (m.upperArmSwing != null && m.upperArmSwing > T.curl.ELBOW_DRIFT)
        c.push({ level: "warn", text: "Keep your elbow pinned — no swinging", joints: [LM.elbowL, LM.elbowR] });
      if (m.elbow != null && m.elbow <= T.curl.GOOD_PEAK) c.push({ level: "good", text: "Full contraction" });
      return c;
    },
    depthFeedback: (min) => {
      if (min == null) return { level: "warn", text: "Couldn't read range" };
      if (min <= T.curl.GOOD_PEAK) return { level: "good", text: "Full curl" };
      if (min <= T.curl.SHALLOW_PEAK) return { level: "warn", text: "Curl a bit higher" };
      return { level: "warn", text: "Partial rep" };
    },
  },

  rdl: {
    id: "rdl", label: "Romanian deadlift / hinge",
    setup: "Side-on. Hinge at the hips, shins near-vertical.",
    rep: { key: "hip", down: T.rdl.DOWN, up: T.rdl.UP, minRange: T.rdl.MIN_RANGE, metric: "min" },
    metrics(image, world) {
      const d = side(image, world);
      return {
        hip: angleAt(d.shoulder.w, d.hip.w, d.knee.w),
        knee: angleAt(d.hip.w, d.knee.w, d.ankle.w),
        confidence: d.confidence,
        reliable: d.confidence >= T.global.MIN_VIS,
        focusJoints: [LM["shoulder" + d.s], LM["hip" + d.s], LM["knee" + d.s]],
      };
    },
    cues(m) {
      const c = [];
      if (!m.reliable) return c;
      // Bending the knees a lot turns a hinge into a squat.
      if (m.hip != null && m.hip < 150 && m.knee != null && m.knee < T.rdl.KNEE_SQUAT)
        c.push({ level: "warn", text: "It's a hinge, not a squat — sit the hips back", joints: [LM.kneeL, LM.kneeR] });
      if (m.hip != null && m.hip <= T.rdl.GOOD_DEPTH) c.push({ level: "good", text: "Good hip hinge" });
      return c;
    },
    depthFeedback: (min) => depthFlex(min, T.rdl.GOOD_DEPTH, T.rdl.SHALLOW_DEPTH, "Good hinge depth"),
  },

  hipthrust: {
    id: "hipthrust", label: "Glute bridge / hip thrust",
    setup: "Side-on, lying down. Drive hips to full lockout.",
    rep: { key: "hip", down: T.hipthrust.DOWN, up: T.hipthrust.UP, minRange: T.hipthrust.MIN_RANGE, metric: "max" },
    metrics(image, world) {
      const d = side(image, world);
      return {
        hip: angleAt(d.shoulder.w, d.hip.w, d.knee.w),
        confidence: d.confidence,
        reliable: d.confidence >= T.global.MIN_VIS,
        focusJoints: [LM["shoulder" + d.s], LM["hip" + d.s], LM["knee" + d.s]],
      };
    },
    cues(m) {
      const c = [];
      if (!m.reliable) return c;
      if (m.hip != null && m.hip >= T.hipthrust.GOOD_LOCK) c.push({ level: "good", text: "Full lockout — squeeze glutes" });
      else if (m.hip != null && m.hip > 140 && m.hip < T.hipthrust.LOW_LOCK) c.push({ level: "warn", text: "Drive hips higher to lock out" });
      return c;
    },
    depthFeedback: (max) => {
      if (max == null) return { level: "warn", text: "Couldn't read lockout" };
      if (max >= T.hipthrust.GOOD_LOCK) return { level: "good", text: "Full lockout" };
      if (max >= T.hipthrust.LOW_LOCK) return { level: "warn", text: "Almost — lock out harder" };
      return { level: "warn", text: "Short lockout" };
    },
  },

  // Universal counter for any movement — auto-detects the working joint, no
  // form cues (we won't pretend to coach a lift we don't have rules for).
  general: {
    id: "general", label: "Other — auto rep counter",
    setup: "Works for any rep-based movement. Do a few reps to calibrate.",
    adaptive: true,
    metrics(image, world) {
      const d = side(image, world);
      return {
        knee: angleAt(d.hip.w, d.knee.w, d.ankle.w),
        elbow: angleAt(d.shoulder.w, d.elbow.w, d.wrist.w),
        hip: angleAt(d.shoulder.w, d.hip.w, d.knee.w),
        shoulderAbd: angleAt(d.hip.w, d.shoulder.w, d.elbow.w),
        confidence: d.confidence,
        reliable: d.confidence >= T.global.MIN_VIS,
        focusJoints: [LM["shoulder" + d.s], LM["elbow" + d.s], LM["hip" + d.s], LM["knee" + d.s]],
      };
    },
  },
};

// ============================================================================
// 4. REP COUNTERS
// ============================================================================

/** Rep counter for a defined exercise: hysteresis + min ROM + debounce. */
export class RepCounter {
  constructor(exercise) {
    this.ex = exercise;
    this.reset();
  }
  reset() {
    this.reps = 0;
    this.phase = "up";
    this.minA = Infinity;
    this.maxA = -Infinity;
    this.lastRepT = 0;
    this.lastRep = null;
  }
  update(metrics, tMs) {
    let justCompleted = false;
    const r = this.ex.rep;
    const v = metrics ? metrics[r.key] : null;
    if (v == null || !metrics.reliable) return { reps: this.reps, phase: this.phase, justCompleted };

    if (this.phase === "up" && v < r.down) {
      this.phase = "down";
      this.minA = v;
      this.maxA = v;
    } else if (this.phase === "down") {
      this.minA = Math.min(this.minA, v);
      this.maxA = Math.max(this.maxA, v);
      if (v > r.up) {
        const rom = this.maxA - this.minA;
        const debounced = tMs - this.lastRepT > FORM_THRESHOLDS.global.REP_DEBOUNCE_MS;
        if (rom >= r.minRange && debounced) {
          this.reps += 1;
          this.lastRepT = tMs;
          const extreme = r.metric === "max" ? this.maxA : this.minA;
          this.lastRep = { rep: this.reps, depth: this.ex.depthFeedback(extreme) };
          justCompleted = true;
        }
        this.phase = "up";
        this.minA = Infinity;
        this.maxA = -Infinity;
      }
    }
    return { reps: this.reps, phase: this.phase, justCompleted };
  }
}

/**
 * Universal rep counter: tracks several candidate joint angles, auto-selects the
 * one with the largest range of motion, and counts reps against adaptive
 * thresholds. No form cues — just a reliable count for any movement.
 */
export class AdaptiveRepCounter {
  constructor() {
    this.keys = ["knee", "elbow", "hip", "shoulderAbd"];
    this.reset();
  }
  reset() {
    this.range = {};
    for (const k of this.keys) this.range[k] = { min: Infinity, max: -Infinity };
    this.reps = 0;
    this.phase = "up";
    this.dominant = null;
    this.lastRepT = 0;
    this.calibrating = true;
    this.lastRep = null;
  }
  update(metrics, tMs) {
    let justCompleted = false;
    if (!metrics || !metrics.reliable) return { reps: this.reps, calibrating: this.calibrating, dominant: this.dominant, justCompleted };

    // Update each candidate's running range, letting the window slowly contract.
    for (const k of this.keys) {
      const v = metrics[k];
      if (v == null) continue;
      const c = this.range[k];
      c.min = c.min === Infinity ? v : Math.min(v, c.min + (v - c.min) * 0.003);
      c.max = c.max === -Infinity ? v : Math.max(v, c.max + (v - c.max) * 0.003);
    }

    // Dominant joint = largest range of motion.
    let best = null, bestRange = 0;
    for (const k of this.keys) {
      const r = this.range[k].max - this.range[k].min;
      if (r > bestRange) { bestRange = r; best = k; }
    }
    this.dominant = best;

    const G = FORM_THRESHOLDS.general;
    if (!best || bestRange < G.MIN_RANGE) {
      this.calibrating = true;
      return { reps: this.reps, calibrating: true, dominant: best, justCompleted };
    }
    this.calibrating = false;

    const c = this.range[best];
    const v = metrics[best];
    if (v == null) return { reps: this.reps, calibrating: false, dominant: best, justCompleted };
    const down = c.min + bestRange * G.DOWN_FRAC;
    const up = c.max - bestRange * G.UP_FRAC;

    if (this.phase === "up" && v < down) {
      this.phase = "down";
    } else if (this.phase === "down" && v > up) {
      if (tMs - this.lastRepT > G.REP_DEBOUNCE_MS) {
        this.reps += 1;
        this.lastRepT = tMs;
        justCompleted = true;
      }
      this.phase = "up";
    }
    return { reps: this.reps, calibrating: false, dominant: best, justCompleted };
  }
}

// One-Euro filter (jitter removal) — used by form-coach.js to smooth angles. ---
class LowPass {
  constructor() { this.s = null; }
  filter(x, alpha) { this.s = this.s == null ? x : alpha * x + (1 - alpha) * this.s; return this.s; }
  last() { return this.s; }
}
export class OneEuroFilter {
  constructor(minCutoff = SMOOTHING.minCutoff, beta = SMOOTHING.beta, dCutoff = SMOOTHING.dCutoff) {
    this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff;
    this.x = new LowPass(); this.dx = new LowPass(); this.lastT = null;
  }
  _alpha(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  filter(x, tMs) {
    if (this.lastT == null) { this.lastT = tMs; return this.x.filter(x, 1); }
    let dt = (tMs - this.lastT) / 1000;
    if (dt <= 0) dt = 1 / 30;
    this.lastT = tMs;
    const prev = this.x.last() ?? x;
    const dxv = (x - prev) / dt;
    const edx = this.dx.filter(dxv, this._alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.x.filter(x, this._alpha(cutoff, dt));
  }
}
