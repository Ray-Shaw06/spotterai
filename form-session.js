/**
 * SpotterAI — Form Session (pure code)
 * ============================================================================
 * Records a form-check session's pose timeline so it can be reviewed after the
 * set — the live cues in form-coach.js vanish when the camera stops, which is
 * useless for exercises you physically can't watch mid-set (pull-ups).
 *
 * What it records (and what it doesn't):
 *   • Per-rep records: completion time, depth verdict, the warn/good cues that
 *     fired during that rep's window, and whether the rep was judged at all
 *     (the confidence gate can refuse).
 *   • Session aggregates: cue frequency as honest "N of M reps" counts,
 *     best/worst rep, average confidence.
 *   • No video, no landmarks, no personal data — the report is generated from
 *     this timeline by the same pure rules that produced the live feedback.
 *
 * Cue counting is per rep window, not per frame: a warning that stayed on
 * screen for 40 frames of one rep still counts as 1 rep affected. That keeps
 * "Hips sagging — 4 of 10 reps" arithmetically true.
 */

/** Deterministic tip lines, keyed by the exact cue/verdict text that earned them. */
export const TIPS = {
  // Squat
  "Chest up — too much forward lean": "Brace before you descend and keep your eyes forward — if the lean persists, try lightening the load or elevating your heels.",
  "Go deeper — aim for parallel": "Slow the descent and pause at your comfortable bottom — depth improves faster with control than with bouncing.",
  // Push-up
  "Hips sagging — brace your core": "Squeeze glutes and think \"ribs down\" before each rep — a straight line from shoulders to ankles is the rep standard.",
  "Hips too high — flatten your back": "Walk your hands a touch forward and tuck your hips until your body forms one line.",
  "Lower a little more": "Aim your chest toward the floor until your elbows pass 90° — shorten the set if depth fades with fatigue.",
  // Lunge
  "Stay tall — keep the torso upright": "Shorten the step slightly and keep your ribs stacked over your hips.",
  "Drop a little deeper": "Lower until the back knee hovers just off the floor — hold something stable if balance is the limiter.",
  // Overhead press
  "Press fully overhead": "Finish each rep with biceps by your ears — if lockout won't come, the weight is doing the deciding.",
  // Curl
  "Keep your elbow pinned — no swinging": "Pin your elbow to your side and curl only with the forearm — swinging means the weight is too heavy for strict reps.",
  // RDL
  "It's a hinge, not a squat — sit the hips back": "Push your hips back toward the wall behind you and keep shins near-vertical — the stretch belongs in the hamstrings.",
  // Hip thrust
  "Drive hips higher to lock out": "Finish each rep with a deliberate glute squeeze at the top rather than rushing the next rep.",
  // Depth verdicts
  "Just shy of full depth": "You're close — a brief pause at the bottom usually buys the last few degrees.",
  "Too shallow — bigger range": "Cut the weight or slow the tempo until the full range is yours — partial reps build partial strength.",
  "Curl a bit higher": "Curl until your forearm meets your biceps — squeeze for a beat at the top.",
  "Partial rep": "Reset and use a lighter weight for full-range reps — range first, load second.",
  "Almost — lock out harder": "Drive through your heels and finish each rep with the hips fully extended.",
  "Short lockout": "Think \"hips to the ceiling\" and hold the top position for a full second.",
};

const UNJUDGED_TEXT = "Unable to judge this rep";

/**
 * Collects one session's rep-by-rep timeline. Feed it from the camera loop:
 * start(t) once, recordCues/recordConfidence every frame, recordRep on each
 * completion, then summary() after stop.
 */
export class SessionRecorder {
  constructor(exerciseId) {
    this.exerciseId = exerciseId;
    this.startT = null;
    this.repRecords = [];
    this.windowCues = new Map(); // text -> level, deduped within the current rep window
    this.confSum = 0;
    this.confCount = 0;
    this.lastT = null;
  }

  /** Mark the session origin (performance.now() when the camera goes live). */
  start(tMs) {
    if (this.startT == null) this.startT = tMs;
  }

  /** Record the cues visible this frame; each unique text counts once per rep window. */
  recordCues(cues) {
    if (!Array.isArray(cues)) return;
    for (const c of cues) {
      if (c && typeof c.text === "string" && !this.windowCues.has(c.text)) {
        this.windowCues.set(c.text, c.level === "good" ? "good" : "warn");
      }
    }
  }

  /** Running confidence average across judged frames. */
  recordConfidence(conf) {
    if (typeof conf === "number" && Number.isFinite(conf)) {
      this.confSum += conf;
      this.confCount += 1;
    }
  }

  /**
   * Close the current rep window. verdict is the depth feedback {level, text}
   * shown live; judged=false when the confidence gate refused to grade it.
   */
  recordRep({ tMs, rep, verdict, judged = true }) {
    this.lastT = tMs;
    const v = judged && verdict ? verdict : { level: "warn", text: UNJUDGED_TEXT };
    this.repRecords.push({
      rep,
      atMs: this.startT != null ? Math.max(0, tMs - this.startT) : 0,
      verdict: { level: v.level === "good" ? "good" : "warn", text: v.text },
      cues: [...this.windowCues].map(([text, level]) => ({ text, level })),
      judged: Boolean(judged),
    });
    this.windowCues = new Map();
  }

  /** Pure aggregate of everything recorded. Same input, same output. */
  summary() {
    const reps = this.repRecords.length;
    const judgedReps = this.repRecords.filter((r) => r.judged).length;

    // Frequency: for each cue/verdict text, in how many reps it appeared.
    const freq = new Map();
    const bump = (text, level) => {
      const e = freq.get(text) || { text, level, reps: 0 };
      e.reps += 1;
      freq.set(text, e);
    };
    for (const r of this.repRecords) {
      const seen = new Set();
      for (const c of r.cues) {
        if (!seen.has(c.text)) {
          seen.add(c.text);
          bump(c.text, c.level);
        }
      }
      if (r.judged && !seen.has(r.verdict.text)) bump(r.verdict.text, r.verdict.level);
    }
    const cueFrequency = [...freq.values()].sort(
      (a, b) => b.reps - a.reps || a.text.localeCompare(b.text)
    );

    // Score per rep: 0 is clean. Warn verdict and each warn cue add 1.
    const score = (r) =>
      (r.verdict.level === "warn" ? 1 : 0) + r.cues.filter((c) => c.level === "warn").length;
    let bestRep = null;
    let worstRep = null;
    let bestScore = Infinity;
    let worstScore = -1;
    for (const r of this.repRecords) {
      if (!r.judged) continue;
      const s = score(r);
      if (s < bestScore) { bestScore = s; bestRep = r.rep; }
      if (s > worstScore) { worstScore = s; worstRep = r.rep; }
    }
    // A worst rep only means something if it's actually worse than the best.
    if (worstScore <= bestScore) worstRep = null;

    const flaggedReps = this.repRecords.filter((r) => r.judged && score(r) > 0).map((r) => r.rep);

    return {
      exerciseId: this.exerciseId,
      reps,
      judgedReps,
      repRecords: this.repRecords.map((r) => ({ ...r, cues: r.cues.map((c) => ({ ...c })) })),
      cueFrequency,
      bestRep,
      worstRep,
      flaggedReps,
      avgConfidence: this.confCount ? this.confSum / this.confCount : null,
      durationMs:
        this.startT != null && this.lastT != null ? Math.max(0, this.lastT - this.startT) : 0,
    };
  }
}

/**
 * Deterministic tips: the most frequent warn findings, each with its mapped
 * coaching line. Never generated — same session data, same tips.
 */
export function tipsFor(summary, maxTips = 3) {
  if (!summary || !summary.reps) return [];
  const threshold = Math.min(2, summary.reps); // 1-rep sets still get their tip
  return summary.cueFrequency
    .filter((e) => e.level === "warn" && e.text !== UNJUDGED_TEXT && e.reps >= threshold && TIPS[e.text])
    .slice(0, maxTips)
    .map((e) => ({ finding: e.text, reps: e.reps, tip: TIPS[e.text] }));
}
