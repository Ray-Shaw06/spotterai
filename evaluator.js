/**
 * SpotterAI — Safety & Quality Evaluator
 * ============================================================================
 * This is the heart of the project: a PURE-CODE auditor (no LLM) that grades
 * an AI-generated training program. It exists to catch the kinds of unsafe or
 * low-quality advice an LLM can confidently produce.
 *
 * evaluatePlan(plan, userInputs) -> { score: 0-100, checks: [...] }
 *   where each check is { id, label, status: "pass"|"warn"|"fail", detail }.
 *
 * Design principles
 * -----------------
 * - Every threshold lives in a clearly named constant (THRESHOLDS / PENALTY)
 *   so the rubric is easy to read and tune.
 * - The evaluator FLAGS concerns; it never "certifies" a plan as safe. Wording
 *   is deliberately "potential concern", not "approved".
 * - Heuristics, not medical rules. Keyword matching on exercise names is
 *   intentionally simple and transparent.
 *
 * Runs in the browser as an ES module.
 */

import { lookupExercise, isContraindicated } from "./exercise-data.js";

// ============================================================================
// 1. TUNABLE CONSTANTS  (the rubric)
// ============================================================================

export const THRESHOLDS = {
  // --- Recovery / rest days -------------------------------------------------
  TRAINING_DAYS_WARN: 6, // 6 training days in the week → limited recovery (warn)
  TRAINING_DAYS_FAIL: 7, // 7 training days → no rest day at all (fail)

  // --- Weekly working sets per major muscle group ---------------------------
  HIGH_WEEKLY_SETS_WARN: 24, // above this is likely junk volume / overtraining
  VERY_HIGH_WEEKLY_SETS_FAIL: 32, // clearly excessive for almost anyone
  LOW_WEEKLY_SETS_FOR_GROWTH: 6, // a prime mover below this is under-stimulated

  // --- Push / pull balance (upper-body working-set ratio) -------------------
  BALANCE_RATIO_WARN: 2.0, // one side > 2× the other → imbalance (warn)
  BALANCE_RATIO_FAIL: 3.0, // one side > 3× the other → strong imbalance (fail)
  BALANCE_MIN_SETS_TO_JUDGE: 4, // need at least this much upper volume to assess

  // --- Beginner load sanity -------------------------------------------------
  BEGINNER_MAX_RPE: 8, // beginners should rarely exceed RPE 8
  BEGINNER_MAXOUT_RPE: 10, // prescribing RPE 10 to a beginner is a hard flag
  BEGINNER_MAX_WEEKLY_SETS_PER_MUSCLE: 22, // beginners need less volume to adapt

  // --- Goal fit (average rep ranges) ----------------------------------------
  STRENGTH_MAX_AVG_REPS: 10, // strength work should skew toward lower reps
  HYPERTROPHY_MIN_AVG_REPS: 5, // hypertrophy work shouldn't be pure low-rep singles
  HYPERTROPHY_MAX_AVG_REPS: 20, // …nor exclusively very high-rep endurance work

  // --- Injuries -------------------------------------------------------------
  INJURY_MATCHES_FOR_FAIL: 2, // this many contraindicated movements → fail (else warn)
};

/**
 * Points deducted from 100 for each check, by severity. Higher = more
 * safety-critical. Injuries are weighted heaviest; goal-fit is lightest.
 */
export const PENALTY = {
  rest_days: { warn: 8, fail: 16 },
  weekly_volume: { warn: 9, fail: 16 },
  muscle_balance: { warn: 10, fail: 18 },
  injury: { warn: 12, fail: 24 },
  beginner_load: { warn: 10, fail: 18 },
  goal_fit: { warn: 6, fail: 12 },
};

// ============================================================================
// 2. EXERCISE → MUSCLE MAPPING  (heuristic keyword matching)
// ============================================================================

/**
 * Maps a major muscle group to keywords that, when found in an exercise name,
 * count that exercise's working sets toward the group. Compound lifts match
 * several groups on purpose (e.g. a deadlift trains back AND hamstrings).
 *
 * Each entry is { include: [...], exclude: [...] }. A name matches the group if
 * it contains ANY include keyword and NO exclude keyword. Excludes prevent the
 * obvious cross-contaminations (e.g. "leg curl" is hamstrings, not biceps).
 */
export const MUSCLE_KEYWORDS = {
  chest: {
    include: ["bench", "chest press", "chest fly", "push-up", "push up", "pushup", "fly", "flye", "pec", "incline press", "incline dumbbell press", "incline barbell press", "decline press", "decline dumbbell press", "dip"],
    exclude: ["leg press"],
  },
  back: {
    include: ["row", "pull-up", "pull up", "pullup", "chin-up", "chin up", "chinup", "pulldown", "pull-down", "pull down", "lat ", "lat pull", "deadlift", "shrug", "pullover", "face pull", "rack pull"],
    exclude: [],
  },
  shoulders: {
    include: ["overhead press", "shoulder press", "ohp", "military press", "lateral raise", "side raise", "rear delt", "front raise", "arnold press", "upright row", "push press", "delt raise"],
    exclude: [],
  },
  biceps: {
    include: ["curl", "bicep", "chin-up", "chin up"],
    exclude: ["leg curl", "wrist curl"], // these "curls" are not biceps work
  },
  triceps: {
    include: ["tricep", "pushdown", "press-down", "pressdown", "skull crusher", "skullcrusher", "overhead extension", "kickback", "close grip", "close-grip", "dip"],
    exclude: [],
  },
  quads: {
    include: ["squat", "leg press", "lunge", "leg extension", "split squat", "step-up", "step up", "hack squat", "sissy squat", "wall sit"],
    exclude: [],
  },
  hamstrings: {
    include: ["deadlift", "romanian", "rdl", "leg curl", "good morning", "hamstring", "nordic", "glute ham"],
    exclude: [],
  },
  glutes: {
    include: ["hip thrust", "glute bridge", "glute", "bridge", "lunge", "step-up", "step up", "hip abduction", "romanian", "rdl"],
    exclude: [],
  },
  calves: {
    include: ["calf", "calves", "toe raise"],
    exclude: [],
  },
  core: {
    include: ["plank", "crunch", "abs", "ab wheel", "sit-up", "sit up", "situp", "leg raise", "rollout", "russian twist", "hollow", "dead bug", "pallof", "hanging knee", "mountain climber", "woodchop"],
    exclude: [],
  },
};

// Which groups count as "push" vs "pull" for the upper-body balance check.
export const PUSH_GROUPS = ["chest", "shoulders", "triceps"];
export const PULL_GROUPS = ["back", "biceps"];

// Prime movers we expect to see trained for muscle-building goals.
const PRIME_MOVERS = ["chest", "back", "quads", "hamstrings", "shoulders"];

// ============================================================================
// 3. INJURY → CONTRAINDICATION RULES
// ============================================================================

/**
 * Each rule maps a stated injury to: keywords that hint at the injury in free
 * text, the movement keywords considered risky, and a plain-language regression
 * suggestion. These are conservative heuristics, not medical guidance.
 */
export const INJURY_RULES = {
  lower_back: {
    label: "Lower back",
    aliases: ["lower back", "low back", "back pain", "lumbar", "herniat", "disc", "sciatic"],
    riskyKeywords: ["deadlift", "conventional deadlift", "back squat", "barbell squat", "good morning", "bent over row", "bent-over row", "barbell row", "clean", "snatch"],
    regression:
      "Swap heavy axial loading for back-friendly variations and keep loads moderate while bracing hard.",
    alternatives: ["Trap-bar deadlift", "Goblet or box squat", "Chest-supported row", "Hip thrust", "Romanian deadlift from blocks"],
  },
  knee: {
    label: "Knee",
    aliases: ["knee", "patell", "acl", "mcl", "meniscus"],
    riskyKeywords: ["lunge", "walking lunge", "deep squat", "jump squat", "sissy squat", "leg extension", "step-up", "step up", "pistol squat", "box jump", "plyometric", "jump"],
    regression:
      "Limit deep knee flexion and impact: train through a comfortable range and drop plyometrics until pain-free.",
    alternatives: ["Hip thrust", "Hamstring curl", "Glute bridge", "Controlled step-up", "Leg press (partial range)"],
  },
  shoulder: {
    label: "Shoulder",
    aliases: ["shoulder", "rotator cuff", "rotator", "ac joint", "labrum", "impingement"],
    riskyKeywords: ["overhead press", "shoulder press", "military press", "behind the neck", "behind-the-neck", "wide grip bench", "wide-grip bench", "upright row", "dip", "snatch", "push press"],
    regression:
      "Keep presses below any pain threshold and favor neutral-grip, shoulder-friendly variations.",
    alternatives: ["Neutral-grip dumbbell press", "Landmine press", "Cable lateral raise", "Floor press", "Face pull"],
  },
  wrist: {
    label: "Wrist",
    aliases: ["wrist", "carpal", "forearm"],
    riskyKeywords: ["barbell bench", "straight bar curl", "straight-bar curl", "barbell curl", "front squat", "clean", "overhead press", "push-up", "push up", "handstand"],
    regression:
      "Keep the wrist neutral and supported (consider wraps) rather than loading a flat-palm or straight-bar position.",
    alternatives: ["Dumbbell press / curl", "EZ-bar curl", "Neutral-grip handles", "Push-up handles", "Cable work"],
  },
};

// ============================================================================
// 4. SMALL HELPERS
// ============================================================================

/** Lowercase + collapse whitespace for forgiving keyword matching. */
function norm(text) {
  return String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Does `haystack` contain ANY of the keyword phrases? */
function matchesAny(haystack, keywords) {
  const h = norm(haystack);
  return keywords.some((kw) => h.includes(kw));
}

/** Flatten every exercise in the plan into a single array (with its day). */
function allExercises(plan) {
  const out = [];
  for (const day of plan.days || []) {
    for (const ex of day.exercises || []) {
      out.push(ex);
    }
  }
  return out;
}

/**
 * Parse a reps string into numbers. Handles "8-12", "5", "12 each side",
 * time holds ("30s"), and open sets ("AMRAP", "to failure").
 */
function parseReps(reps) {
  if (typeof reps === "number") return { min: reps, max: reps, avg: reps, isTime: false };
  const s = norm(reps);
  if (!s) return { min: null, max: null, avg: null, isTime: false };
  // Time-based holds (planks, carries) — not a rep range.
  if (/\b\d+\s*(s|sec|secs|seconds|min|minute)\b/.test(s) || s.includes("hold")) {
    return { min: null, max: null, avg: null, isTime: true };
  }
  const nums = s.match(/\d+/g);
  if (!nums) return { min: null, max: null, avg: null, isTime: false }; // AMRAP / failure
  const arr = nums.map(Number);
  const min = Math.min(...arr);
  const max = Math.max(...arr);
  return { min, max, avg: (min + max) / 2, isTime: false };
}

/** Classify the user's goal into a normalized bucket. */
function goalBucket(goal) {
  const g = norm(goal);
  if (g.includes("strength")) return "strength";
  if (g.includes("hypertrophy") || g.includes("muscle") || g.includes("build")) return "hypertrophy";
  if (g.includes("fat") || g.includes("loss") || g.includes("lean") || g.includes("cut")) return "fat_loss";
  return "general";
}

/** Round to a tidy number for display. */
function round(n) {
  return Math.round(n * 10) / 10;
}

// ============================================================================
// 5. CORE COMPUTATIONS
// ============================================================================

/**
 * Estimate weekly working sets per muscle group by summing the `sets` of every
 * exercise whose name matches that group's keywords. A compound counts its full
 * sets toward each muscle it matches — a deliberate, transparent estimate.
 */
export function computeWeeklyVolume(plan) {
  const volume = {};
  for (const group of Object.keys(MUSCLE_KEYWORDS)) volume[group] = 0;

  for (const ex of allExercises(plan)) {
    const sets = Number(ex.sets) || 0;
    if (sets <= 0) continue;
    const name = norm(ex.name);
    for (const [group, { include, exclude }] of Object.entries(MUSCLE_KEYWORDS)) {
      const hit = include.some((kw) => name.includes(kw)) && !exclude.some((kw) => name.includes(kw));
      if (hit) volume[group] += sets;
    }
  }
  return volume;
}

/** Sum the sets across a list of groups. */
function sumGroups(volume, groups) {
  return groups.reduce((total, g) => total + (volume[g] || 0), 0);
}

/**
 * Count "training" days in the actual plan. Days whose focus/name reads as rest,
 * recovery, or mobility-only are not counted as training days.
 */
function countTrainingDays(plan) {
  let training = 0;
  for (const day of plan.days || []) {
    const text = `${norm(day.day)} ${norm(day.focus)}`;
    const isRest = /\b(rest|recovery|off day|day off|active recovery)\b/.test(text) || text.includes("mobility only");
    if (!isRest) training += 1;
  }
  return training;
}

/** Which injury rules are active, from both checkboxes and free text. */
export function activeInjuries(userInputs) {
  const active = new Set();

  // Checkbox values are normalized keys: "lower_back", "knee", "shoulder", "wrist".
  for (const raw of userInputs.injuries || []) {
    const key = norm(raw).replace(/\s+/g, "_");
    if (INJURY_RULES[key]) active.add(key);
    // tolerate "lower back" with a space, etc.
    if (key === "lower_back" || norm(raw) === "lower back") active.add("lower_back");
  }

  // Free-text: match against each rule's aliases.
  const notes = norm(userInputs.injuryNotes);
  if (notes) {
    for (const [key, rule] of Object.entries(INJURY_RULES)) {
      if (rule.aliases.some((a) => notes.includes(a))) active.add(key);
    }
  }
  return [...active];
}

// ============================================================================
// 6. INDIVIDUAL CHECKS
//    Each returns { id, label, status, detail } and (internally) a penalty.
// ============================================================================

/** Recovery: is there at least one rest day in the week? */
function checkRestDays(plan) {
  const training = countTrainingDays(plan);
  const id = "rest_days";
  const label = "Recovery & rest days";

  if (training >= THRESHOLDS.TRAINING_DAYS_FAIL) {
    return finalize(id, label, "fail", `Every day of the week is a training day (${training}/7). Programs with zero rest days risk under-recovery, injury, and burnout. Schedule at least one full rest day.`);
  }
  if (training >= THRESHOLDS.TRAINING_DAYS_WARN) {
    return finalize(id, label, "warn", `${training} training days leaves only one rest day. That can work for advanced lifters, but make sure sleep, nutrition, and intensity are well managed.`);
  }
  return finalize(id, label, "pass", `${training} training days leaves room for recovery across the week.`);
}

/** Weekly volume sanity: too much (overtraining) or too little for the goal. */
function checkWeeklyVolume(plan, volume, goal) {
  const id = "weekly_volume";
  const label = "Weekly volume sanity";

  const veryHigh = [];
  const high = [];
  for (const [group, sets] of Object.entries(volume)) {
    if (sets >= THRESHOLDS.VERY_HIGH_WEEKLY_SETS_FAIL) veryHigh.push(`${group} (${sets})`);
    else if (sets >= THRESHOLDS.HIGH_WEEKLY_SETS_WARN) high.push(`${group} (${sets})`);
  }

  // Under-stimulated prime movers only matter for muscle-building goals.
  const wantsVolume = goal === "hypertrophy" || goal === "strength";
  const low = wantsVolume
    ? PRIME_MOVERS.filter((g) => volume[g] > 0 && volume[g] < THRESHOLDS.LOW_WEEKLY_SETS_FOR_GROWTH).map((g) => `${g} (${volume[g]})`)
    : [];

  if (veryHigh.length) {
    return finalize(id, label, "fail", `Excessive weekly volume for ${veryHigh.join(", ")} sets. Beyond ~${THRESHOLDS.VERY_HIGH_WEEKLY_SETS_FAIL} hard sets per muscle/week is usually junk volume that raises injury risk without extra benefit.`);
  }
  if (high.length || low.length) {
    const parts = [];
    if (high.length) parts.push(`High weekly volume for ${high.join(", ")} sets — past ~${THRESHOLDS.HIGH_WEEKLY_SETS_WARN} sets/week, returns diminish for most people.`);
    if (low.length) parts.push(`Light volume for a ${goal} goal on ${low.join(", ")} sets — consider adding work to drive progress.`);
    return finalize(id, label, "warn", parts.join(" "));
  }
  return finalize(id, label, "pass", "Estimated weekly sets per muscle group land in a reasonable, productive range.");
}

/** Muscle balance: is upper-body push volume roughly balanced with pull? */
function checkMuscleBalance(volume) {
  const id = "muscle_balance";
  const label = "Push / pull balance";

  const push = sumGroups(volume, PUSH_GROUPS);
  const pull = sumGroups(volume, PULL_GROUPS);

  // Not enough upper-body work to judge (e.g. a legs-only or core day in isolation).
  if (push + pull < THRESHOLDS.BALANCE_MIN_SETS_TO_JUDGE) {
    return finalize(id, label, "pass", "Not enough upper-body volume this week to assess push/pull balance.");
  }

  // One side entirely missing while the other is substantial → strong imbalance.
  if (pull === 0) return finalize(id, label, "fail", `All pushing, no pulling (push ${push} vs pull ${pull} sets). This commonly drives rounded-shoulder posture and shoulder issues — add rows and pull-ups.`);
  if (push === 0) return finalize(id, label, "fail", `All pulling, no pushing (push ${push} vs pull ${pull} sets). Add pressing work to balance the program.`);

  const ratio = Math.max(push, pull) / Math.min(push, pull);
  const heavier = push > pull ? "pushing" : "pulling";
  if (ratio >= THRESHOLDS.BALANCE_RATIO_FAIL) {
    return finalize(id, label, "fail", `Strong imbalance toward ${heavier} (push ${push} vs pull ${pull} sets, ${round(ratio)}×). Aim closer to a 1:1 push:pull ratio to protect the shoulders.`);
  }
  if (ratio >= THRESHOLDS.BALANCE_RATIO_WARN) {
    return finalize(id, label, "warn", `Skewed toward ${heavier} (push ${push} vs pull ${pull} sets, ${round(ratio)}×). A more even push:pull split is usually healthier for the shoulders.`);
  }
  return finalize(id, label, "pass", `Push and pull volume are reasonably balanced (push ${push} vs pull ${pull} sets).`);
}

/**
 * Injury contraindications: one check PER active injury, scanning the plan for
 * risky movements and suggesting regressions.
 */
function checkInjuries(plan, userInputs) {
  const injuries = activeInjuries(userInputs);
  const checks = [];

  for (const key of injuries) {
    const rule = INJURY_RULES[key];
    const id = `injury_${key}`;
    const label = `Injury safety — ${rule.label}`;

    // Find which prescribed exercises are risky for this injury. Prefer the
    // structured exercise DB (curated contraindications); fall back to keyword
    // matching when the exercise isn't in the DB.
    const matched = [];
    for (const ex of allExercises(plan)) {
      const known = lookupExercise(ex.name);
      const risky = known ? isContraindicated(ex.name, key) : matchesAny(ex.name, rule.riskyKeywords);
      if (risky) matched.push(ex.name);
    }
    const unique = [...new Set(matched)];

    if (unique.length === 0) {
      checks.push(finalize(id, label, "pass", `No movements typically contraindicated for a ${rule.label.toLowerCase()} issue were prescribed. Still progress load conservatively.`, "injury"));
      continue;
    }

    const status = unique.length >= THRESHOLDS.INJURY_MATCHES_FOR_FAIL ? "fail" : "warn";
    const detail = `Given your reported ${rule.label.toLowerCase()} issue, these may aggravate it: ${unique.join(", ")}.`;
    checks.push(finalize(id, label, status, detail, "injury"));
  }

  return checks;
}

/** Beginner load sanity: is intensity/volume too advanced for a beginner? */
function checkBeginnerLoad(plan, volume, userInputs) {
  const id = "beginner_load";
  const label = "Beginner load sanity";
  const isBeginner = norm(userInputs.experience).includes("beginner");

  if (!isBeginner) {
    return finalize(id, label, "pass", "Not a beginner — advanced intensity is appropriate when well managed.");
  }

  const exercises = allExercises(plan);
  const maxedOut = exercises.filter((ex) => ex.rpe != null && Number(ex.rpe) >= THRESHOLDS.BEGINNER_MAXOUT_RPE);
  const highRpe = exercises.filter((ex) => ex.rpe != null && Number(ex.rpe) > THRESHOLDS.BEGINNER_MAX_RPE && Number(ex.rpe) < THRESHOLDS.BEGINNER_MAXOUT_RPE);
  const overVolume = Object.entries(volume).filter(([, s]) => s > THRESHOLDS.BEGINNER_MAX_WEEKLY_SETS_PER_MUSCLE).map(([g, s]) => `${g} (${s})`);

  if (maxedOut.length) {
    return finalize(id, label, "fail", `Prescribes max-effort RPE ${THRESHOLDS.BEGINNER_MAXOUT_RPE} work to a beginner (${maxedOut.length} exercise${maxedOut.length > 1 ? "s" : ""}). Beginners build skill and connective-tissue resilience faster with 1-3 reps in reserve — keep intensity around RPE 6-8.`);
  }
  if (highRpe.length >= 2 || overVolume.length) {
    const parts = [];
    if (highRpe.length >= 2) parts.push(`${highRpe.length} exercises exceed RPE ${THRESHOLDS.BEGINNER_MAX_RPE}, which is aggressive for a beginner.`);
    if (overVolume.length) parts.push(`Weekly volume is high for a beginner on ${overVolume.join(", ")} sets.`);
    return finalize(id, label, "warn", `${parts.join(" ")} Early on, leave a couple reps in reserve and add volume gradually.`);
  }
  return finalize(id, label, "pass", "Intensity and volume look appropriate for a beginner.");
}

/** Frequency / goal fit: does the structure match the stated goal? */
function checkGoalFit(plan, userInputs, goal) {
  const id = "goal_fit";
  const label = "Goal fit";

  // Average rep target across exercises that have a numeric rep range.
  const reps = allExercises(plan)
    .map((ex) => parseReps(ex.reps))
    .filter((r) => r.avg != null && !r.isTime);
  const avgReps = reps.length ? reps.reduce((sum, r) => sum + r.avg, 0) / reps.length : null;

  if (goal === "strength") {
    if (avgReps != null && avgReps > THRESHOLDS.STRENGTH_MAX_AVG_REPS) {
      return finalize(id, label, "warn", `Average rep target is ~${round(avgReps)}, which is high for a strength goal. Strength responds best to heavier loads in lower rep ranges (roughly 3-6) on the main lifts.`);
    }
    return finalize(id, label, "pass", "Rep ranges are consistent with a strength focus on the main lifts.");
  }

  if (goal === "hypertrophy") {
    if (avgReps != null && (avgReps < THRESHOLDS.HYPERTROPHY_MIN_AVG_REPS || avgReps > THRESHOLDS.HYPERTROPHY_MAX_AVG_REPS)) {
      return finalize(id, label, "warn", `Average rep target is ~${round(avgReps)}, outside the typical hypertrophy range (~6-15). Most muscle growth comes from moderate reps taken close to failure.`);
    }
    return finalize(id, label, "pass", "Rep ranges sit in a sensible hypertrophy zone.");
  }

  // Fat loss / general: structure is flexible, so this stays light.
  return finalize(id, label, "pass", `Program structure is reasonable for a ${goal.replace("_", " ")} goal.`);
}

// ============================================================================
// 7. SEVERITY TIERS + REMEDIES
//    The UI leads with flags (not the score), so each check is sorted into a
//    severity tier and — when flagged — carries a suggested fix and safer
//    alternatives. This same structured data feeds the plan-repair engine.
// ============================================================================

/** A stable version string surfaced in the Trust Report. Bump on rubric change. */
export const EVALUATOR_VERSION = "v1.0.0";

/** Suggested fixes for the non-injury checks, keyed by check id. */
const REMEDIES = {
  rest_days: { fix: "Schedule at least one full rest day — or convert a training day to active recovery." },
  weekly_volume: {
    fix: "Trim sets on the most overrepresented muscle group and remove redundant accessory work; add a little volume to anything under-stimulated.",
  },
  muscle_balance: {
    fix: "Even out the push:pull ratio — add pulling volume, or trim excess pressing.",
    alternatives: ["Barbell / dumbbell row", "Lat pulldown", "Face pull", "Rear-delt fly", "Chest-supported row"],
  },
  beginner_load: {
    fix: "Lower intensity (leave 1–3 reps in reserve), drop max-effort sets, and build volume gradually.",
  },
  goal_fit: { fix: "Shift rep ranges toward your goal — lower reps (≈3–6) for strength, ≈6–15 for hypertrophy." },
};

/**
 * Sort a check into a severity tier:
 *   critical  — safety-relevant failures (no rest, junk volume, injury conflicts…)
 *   warning   — concerns worth reviewing before training
 *   suggestion— quality/optimization notes (goal fit), not safety
 *   pass      — no concern
 */
function tierFor(check) {
  if (check.status === "pass") return "pass";
  if (check.id === "invalid_plan") return "critical";
  if (check.id === "goal_fit") return "suggestion";
  if (check.id.startsWith("injury_")) return check.status === "fail" ? "critical" : "warning";
  const CRITICAL_ON_FAIL = new Set(["rest_days", "weekly_volume", "beginner_load"]);
  if (check.status === "fail" && CRITICAL_ON_FAIL.has(check.id)) return "critical";
  return "warning";
}

/** Structured remedy (fix + safer alternatives) for a flagged check. */
function remedyFor(check) {
  if (check.status === "pass") return {};
  if (check.id.startsWith("injury_")) {
    const rule = INJURY_RULES[check.id.replace("injury_", "")];
    return rule ? { fix: rule.regression, alternatives: rule.alternatives || [] } : {};
  }
  const r = REMEDIES[check.id];
  return r ? { fix: r.fix, alternatives: r.alternatives || [] } : {};
}

/** Roll the checks up into the counts the flags-first UI leads with. */
function summarize(checks) {
  const s = { critical: 0, warning: 0, suggestion: 0, pass: 0, total: checks.length };
  for (const c of checks) s[c.tier] = (s[c.tier] || 0) + 1;
  s.passed = s.pass;
  s.flags = s.critical + s.warning + s.suggestion;
  return s;
}

// ============================================================================
// 8. ASSEMBLY + SCORING
// ============================================================================

/**
 * Attach the right penalty to a check based on its id/group and status, and
 * return the public-facing shape. `penaltyKey` lets injury checks (ids like
 * "injury_knee") share the "injury" penalty bucket.
 */
function finalize(id, label, status, detail, penaltyKey) {
  const key = penaltyKey || id;
  const weights = PENALTY[key] || { warn: 6, fail: 12 };
  const penalty = status === "fail" ? weights.fail : status === "warn" ? weights.warn : 0;
  return { id, label, status, detail, penalty };
}

/**
 * Main entry point.
 * @param {object} plan        The generated program (validated shape).
 * @param {object} userInputs  The original form inputs.
 * @returns {{ score:number, checks:Array }}
 */
export function evaluatePlan(plan, userInputs = {}) {
  // Defensive: never throw on a malformed plan — return a transparent failure.
  if (!plan || !Array.isArray(plan.days)) {
    const bad = [{ id: "invalid_plan", label: "Plan structure", status: "fail", tier: "critical", detail: "The plan could not be read, so no safety checks could run." }];
    return { score: 0, summary: summarize(bad), checks: bad };
  }

  const goal = goalBucket(userInputs.goal || plan.goal);
  const volume = computeWeeklyVolume(plan);

  // Run every check. Injuries can contribute multiple rows.
  const checks = [
    checkRestDays(plan),
    checkWeeklyVolume(plan, volume, goal),
    checkMuscleBalance(volume),
    ...checkInjuries(plan, userInputs),
    checkBeginnerLoad(plan, volume, userInputs),
    checkGoalFit(plan, userInputs, goal),
  ];

  // Score: start at 100 and deduct each check's penalty. Clamp to [0, 100].
  const totalPenalty = checks.reduce((sum, c) => sum + (c.penalty || 0), 0);
  const score = Math.max(0, Math.min(100, Math.round(100 - totalPenalty)));

  // Public output: strip the internal `penalty`, add the severity tier and
  // (for flagged checks) a structured fix + safer alternatives.
  const publicChecks = checks.map(({ penalty, ...rest }) => {
    const tier = tierFor(rest);
    return { ...rest, tier, ...remedyFor(rest) };
  });

  return { score, summary: summarize(publicChecks), checks: publicChecks };
}
