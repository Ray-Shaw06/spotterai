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

import { lookupExercise, isContraindicated, volumeContribution, equipmentCapabilities, canPerform, hasKnownEquipment } from "./exercise-data.js";
import { isCardioEntry, cardioMinutes } from "./lib/plan.js";

// ============================================================================
// 1. TUNABLE CONSTANTS  (the rubric)
// ============================================================================

/**
 * The rubric.
 *
 * Every constant below is sourced in `docs/rubric-sources.md`, which lists the
 * evidence behind it and grades how well that evidence actually supports the
 * number: Supported, Directional, Practical, or Contradicted. Three are graded
 * Practical (no literature sets them, they are recovery and realism judgments)
 * and that is stated there rather than implied away here.
 *
 * If you change a number, update its entry there in the same commit. A
 * threshold you cannot cite is a threshold you picked.
 */
export const THRESHOLDS = {
  // --- Recovery / rest days -------------------------------------------------
  TRAINING_DAYS_WARN: 6, // 6 training days in the week → limited recovery (warn)
  TRAINING_DAYS_FAIL: 7, // 7 training days → no rest day at all (fail)

  // --- Weekly working sets per major muscle group ---------------------------
  // Sources: rubric-sources.md#volume. The LOW line is Directional (Schoenfeld
  // dose-response); the HIGH/VERY_HIGH ceilings are Practical, and the
  // dose-response literature arguably points the other way.
  HIGH_WEEKLY_SETS_WARN: 24, // above this is likely junk volume / overtraining
  VERY_HIGH_WEEKLY_SETS_FAIL: 32, // clearly excessive for almost anyone
  LOW_WEEKLY_SETS_FOR_GROWTH: 6, // a prime mover below this is under-stimulated

  // --- Training frequency (hypertrophy) -------------------------------------
  // Sources: rubric-sources.md#frequency. Supported: train a muscle 2x/week.
  FREQUENCY_MIN_SETS_TO_JUDGE: 10, // only assess frequency once a muscle gets real weekly volume
  FREQUENCY_TARGET_DAYS: 2, // ~2x/week is the common frequency recommendation for growth

  // --- Push / pull balance (upper-body working-set ratio) -------------------
  BALANCE_RATIO_WARN: 2.0, // one side > 2× the other → imbalance (warn)
  BALANCE_RATIO_FAIL: 3.0, // one side > 3× the other → strong imbalance (fail)
  BALANCE_MIN_SETS_TO_JUDGE: 4, // need at least this much upper volume to assess

  // --- Goal fit (general / fat-loss bucket) ---------------------------------
  GENERAL_MIN_LIFTS_TO_JUDGE: 4, // need this many numeric-rep lifts before judging shape
  GENERAL_MAX_AVG_REPS: 15, // whole-week average above this is endurance-biased
  GENERAL_UNIFORM_MIN_REPS: 8, // below this, one uniform rep target is a strength template, not a defect

  // --- Progressive overload -------------------------------------------------
  PROGRESSION_MIN_SIGNALS: 2, // distinct progression words needed to count as a scheme

  // --- Beginner load sanity -------------------------------------------------
  // Sources: rubric-sources.md#intensity. RPE here is reps-in-reserve; novices
  // judge proximity to failure less accurately, which is the case for a cap.
  BEGINNER_MAX_RPE: 8, // beginners should rarely exceed RPE 8
  BEGINNER_MAXOUT_RPE: 10, // prescribing RPE 10 to a beginner is a hard flag
  BEGINNER_MAX_WEEKLY_SETS_PER_MUSCLE: 22, // beginners need less volume to adapt

  // --- Goal fit (average rep ranges) ----------------------------------------
  STRENGTH_MAX_AVG_REPS: 10, // strength work should skew toward lower reps
  HYPERTROPHY_MIN_AVG_REPS: 5, // hypertrophy work shouldn't be pure low-rep singles
  HYPERTROPHY_MAX_AVG_REPS: 20, // …nor exclusively very high-rep endurance work

  // --- Injuries -------------------------------------------------------------
  INJURY_MATCHES_FOR_FAIL: 2, // this many contraindicated movements → fail (else warn)

  // --- Quad / hamstring balance (programming balance, NOT injury prediction) -
  // A systematic review concludes the H:Q ratio "has limited value for the
  // prediction of ACL and hamstring injuries" (see docs/rubric-sources.md), so
  // this flags lopsided PROGRAMMING, which is defensible coaching, and
  // deliberately claims nothing about injury risk.
  LEG_BALANCE_RATIO_WARN: 3.0, // one side > 3× the other → imbalance (lenient)
  LEG_MIN_SETS_TO_JUDGE: 4,

  // --- Per-session set sanity ----------------------------------------------
  SESSION_SETS_WARN: 30, // a very long single session
  SESSION_SETS_FAIL: 40, // extreme, quality collapses late in the workout

  // --- Structured-data coverage (transparency about estimate quality) ------
  COVERAGE_MIN: 0.7, // below this, many lifts fell back to rougher keyword logic

  // --- Cardio ---------------------------------------------------------------
  // Sources: rubric-sources.md#conditioning. The leg-day conflict rule follows
  // Wilson et al. 2012: interference is running-specific and lower-body-specific.
  // Weekly conditioning minutes. The warn line sits well above the 150 min/week
  // health guideline on purpose: this check is about cardio competing with
  // lifting recovery, not about whether someone does enough of it.
  CARDIO_WEEKLY_MIN_WARN: 300,
  CARDIO_WEEKLY_MIN_FAIL: 500,
  // Leg volume on a day, above which hard cardio next to it is a real conflict.
  // Below this a day is not a leg day in any meaningful sense.
  CARDIO_CONFLICT_LEG_SETS: 6,
  CARDIO_CONFLICTS_FOR_FAIL: 2, // one collision is a warn, a pattern is a fail
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
  // Frequency is a pure coaching optimization, not a safety/quality deduction:
  // the underlying volume is already scored by weekly_volume. Zero-weight so it
  // surfaces as a suggestion without ever moving the score.
  muscle_frequency: { warn: 0, fail: 0 },
  // Equipment fit is a usability note, not a safety flag; zero-weight so it
  // surfaces without penalizing the score.
  equipment_fit: { warn: 0, fail: 0 },
  // Progressive overload is a programming-quality note. Zero-weight on
  // introduction (v1.3.0) so adding the check cannot regress any existing
  // case's score — same discipline used for muscle_frequency and equipment_fit.
  progressive_overload: { warn: 0, fail: 0 },
  // Cardio checks land zero-weight on introduction, the same discipline
  // muscle_frequency, equipment_fit and progressive_overload got: adding a
  // check must not be able to move any existing case's score. They are also
  // emitted CONDITIONALLY (see evaluatePlan), so a lifting-only plan gets no
  // cardio rows at all and every pre-existing benchmark case is untouched.
  cardio_load: { warn: 0, fail: 0 },
  cardio_conflict: { warn: 0, fail: 0 },
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

// The lower body, for the cardio conflict check. Calves are left out: they are
// not what running interferes with, and including them would let a day of calf
// raises read as a leg day.
export const LEG_GROUPS = ["quads", "hamstrings", "glutes"];

/**
 * Cardio that competes with heavy lifting for the same recovery. Matched on the
 * exercise name when the plan does not state an intensity.
 *
 * Deliberately NOT here: "jog", "walk", "incline walk", "cycling", "elliptical",
 * "swim". Easy aerobic work next to a leg day is a normal training week, and
 * flagging it would make the check noise.
 */
export const HARD_CARDIO_KEYWORDS = ["sprint", "hiit", "interval", "hill", "tempo run", "threshold", "assault bike", "battle rope", "sled", "stair climber"];

/**
 * Words that indicate a real progression instruction rather than encouragement.
 *
 * Matched at a WORD BOUNDARY, never as a bare substring. That distinction is
 * load-bearing: as plain substrings, "prepare" counts as "rep" and — worse —
 * "progress" contains "pr", so a note reading only "Progress over time." scored
 * two signals off one concept and passed as a concrete rule. "pr" is gone for
 * that reason; a personal record is a result, not an instruction.
 */
export const PROGRESSION_SIGNALS = [
  "add", "increase", "heavier", "more weight", "rep", "set", "rpe",
  "week", "progress", "load", "deload", "top of the range", "double progression",
  "amrap", "microload", "personal record",
];

/**
 * A load written as a number plus a unit: "2.5kg", "5 lbs", "10%". The leading
 * digit is required, so "elbow" cannot be read as "lb" — a plausible word in a
 * training note and otherwise a free second signal.
 */
const PROGRESSION_LOAD_RE = /\d\s*(?:kgs?|lbs?|pounds?|kilos?|%)/;

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

    // Prefer the structured DB: 1.0 set to each primary mover, 0.5 to each
    // secondary. Fall back to keyword matching (full set to each matched group)
    // only when the exercise isn't in the DB.
    const contrib = volumeContribution(ex.name);
    if (contrib) {
      for (const [group, weight] of Object.entries(contrib)) {
        if (group in volume) volume[group] += sets * weight;
      }
    } else {
      const name = norm(ex.name);
      for (const [group, { include, exclude }] of Object.entries(MUSCLE_KEYWORDS)) {
        const hit = include.some((kw) => name.includes(kw)) && !exclude.some((kw) => name.includes(kw));
        if (hit) volume[group] += sets;
      }
    }
  }

  // Round to a tidy half-set so displayed numbers stay clean.
  for (const g of Object.keys(volume)) volume[g] = Math.round(volume[g] * 2) / 2;
  return volume;
}

/**
 * Per-muscle weekly training FREQUENCY: how many distinct training days hit each
 * group. A day counts for a group if any of its exercises contribute volume to
 * that group (same recognition as computeWeeklyVolume — structured DB first,
 * keyword fallback). Used by the frequency check and, later, the adapt engine.
 */
export function computeWeeklyFrequency(plan) {
  const freq = {};
  for (const group of Object.keys(MUSCLE_KEYWORDS)) freq[group] = 0;

  for (const day of plan.days || []) {
    const text = `${norm(day.day)} ${norm(day.focus)}`;
    const isRest = /\b(rest|recovery|off day|day off|active recovery)\b/.test(text) || text.includes("mobility only");
    if (isRest) continue;

    const hit = new Set();
    for (const ex of day.exercises || []) {
      if ((Number(ex.sets) || 0) <= 0) continue;
      const contrib = volumeContribution(ex.name);
      if (contrib) {
        for (const group of Object.keys(contrib)) if (group in freq) hit.add(group);
      } else {
        const name = norm(ex.name);
        for (const [group, { include, exclude }] of Object.entries(MUSCLE_KEYWORDS)) {
          if (include.some((kw) => name.includes(kw)) && !exclude.some((kw) => name.includes(kw))) hit.add(group);
        }
      }
    }
    for (const group of hit) freq[group] += 1;
  }
  return freq;
}

/**
 * Read the plan's conditioning work: total weekly minutes, and a per-day view
 * the conflict check walks.
 *
 * `hard` is decided by the plan's stated intensity first and the exercise name
 * second, so an easy 40-minute jog and 40 minutes of hill sprints are not
 * treated as the same demand on the same legs.
 */
export function computeWeeklyCardio(plan) {
  const days = [];
  let minutes = 0;
  let sessions = 0;
  let hardSessions = 0;

  (plan?.days || []).forEach((day, index) => {
    let dayMinutes = 0;
    let dayHard = false;
    const names = [];

    for (const ex of day.exercises || []) {
      if (!isCardioEntry(ex)) continue;
      const mins = cardioMinutes(ex);
      dayMinutes += mins;
      names.push(ex.name);
      const stated = String(ex.intensity || "").toLowerCase();
      const hard = stated === "hard" || (!stated && matchesAny(ex.name, HARD_CARDIO_KEYWORDS));
      if (hard) dayHard = true;
    }

    if (!names.length) return;
    minutes += dayMinutes;
    sessions += 1;
    if (dayHard) hardSessions += 1;
    days.push({ index, focus: day.focus || day.day || `Day ${index + 1}`, minutes: dayMinutes, hard: dayHard, names });
  });

  return { minutes, sessions, hardSessions, days };
}

/** Working sets a single day puts into the lower body. Exported so the repair
 *  engine reads leg volume the same way the check that flagged it did. */
export function legSetsForDay(day) {
  let sets = 0;
  for (const ex of day.exercises || []) {
    if (isCardioEntry(ex)) continue; // a run is not leg volume; that is the point
    const count = Number(ex.sets) || 0;
    if (count <= 0) continue;
    const contrib = volumeContribution(ex.name);
    if (contrib) {
      for (const group of LEG_GROUPS) if (contrib[group]) sets += count * contrib[group];
    } else {
      const name = norm(ex.name);
      for (const group of LEG_GROUPS) {
        const map = MUSCLE_KEYWORDS[group];
        if (map.include.some((k) => name.includes(k)) && !map.exclude.some((k) => name.includes(k))) sets += count;
      }
    }
  }
  return Math.round(sets * 2) / 2;
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

/** How much cardio the user asked for, normalized. Null when never asked. */
function cardioRequest(userInputs) {
  const raw = norm(userInputs?.cardio);
  if (!raw) return null;
  if (raw.includes("none") || raw === "no") return "none";
  if (raw.includes("lot") || raw.includes("high")) return "lots";
  if (raw.includes("little") || raw.includes("some") || raw.includes("moderate")) return "some";
  return null;
}

/**
 * Cardio volume, and whether the plan honoured what was asked for.
 *
 * The high thresholds are about conditioning competing with lifting recovery,
 * not about hitting a health guideline. SpotterAI programs lifting; it says so
 * rather than quietly grading someone's running.
 */
function checkCardioLoad(plan, cardio, userInputs) {
  const id = "cardio_load";
  const label = "Cardio load";
  const request = cardioRequest(userInputs);
  const mins = cardio.minutes;

  if (request && request !== "none" && cardio.sessions === 0) {
    return finalize(id, label, "warn", `You asked for ${request === "lots" ? "a lot of" : "some"} cardio and this plan prescribes none. Conditioning is missing rather than deliberately left out.`);
  }
  if (request === "none" && cardio.sessions > 0) {
    return finalize(id, label, "warn", `You asked for no cardio, but the plan includes ${cardio.sessions} conditioning session${cardio.sessions > 1 ? "s" : ""} (${mins} min). Drop them, or update your preference so the plan and the profile agree.`);
  }
  if (mins >= THRESHOLDS.CARDIO_WEEKLY_MIN_FAIL) {
    return finalize(id, label, "fail", `${mins} minutes of cardio a week alongside the lifting in this plan is a lot to recover from. At this volume conditioning starts eating into strength and muscle gains, and the injury risk climbs. Cut it back or drop a lifting day.`);
  }
  if (mins >= THRESHOLDS.CARDIO_WEEKLY_MIN_WARN) {
    return finalize(id, label, "warn", `${mins} minutes of cardio a week is high next to this much lifting. It is workable if you are running for its own sake; expect slower strength progress and watch your recovery.`);
  }
  return finalize(id, label, "pass", cardio.sessions ? `${cardio.sessions} cardio session${cardio.sessions > 1 ? "s" : ""} (${mins} min a week) sits comfortably alongside the lifting here.` : "No cardio prescribed, and none was requested.");
}

/**
 * Hard conditioning stacked on, or immediately before, a heavy leg day.
 *
 * This is the failure that motivated cardio support at all: run hard on
 * Tuesday and Wednesday's squats are not the same squats. Adjacency is read in
 * PLAN ORDER, which is the order the app rotates days in, so "the day before"
 * means what a user would mean by it.
 */
function checkCardioConflict(plan, cardio) {
  const id = "cardio_conflict";
  const label = "Cardio and leg-day conflict";
  const days = plan.days || [];
  const legSets = days.map(legSetsForDay);
  const hardDays = new Map(cardio.days.filter((d) => d.hard).map((d) => [d.index, d]));
  const conflicts = [];

  for (const [index, day] of hardDays) {
    const own = legSets[index] || 0;
    if (own >= THRESHOLDS.CARDIO_CONFLICT_LEG_SETS) {
      conflicts.push(`${day.focus} pairs ${day.names.join(", ")} with ${own} sets of leg work on the same day`);
      continue; // one day, one conflict; the same-day collision is the worse one
    }
    // The week WRAPS. todaysWorkout rotates with `sessions % days.length`, so
    // the last day is followed by the first one, and a sprint session at the end
    // of the plan lands the day before a leg day at the top of it. Reading only
    // index + 1 made that collision invisible in exactly the plans where the
    // conditioning was scheduled last.
    const nextIndex = days.length > 1 ? (index + 1) % days.length : -1;
    const next = nextIndex >= 0 ? days[nextIndex] : null;
    if (next && (legSets[nextIndex] || 0) >= THRESHOLDS.CARDIO_CONFLICT_LEG_SETS) {
      conflicts.push(`${day.focus} (${day.names.join(", ")}) lands the day before ${next.focus || next.day || "a leg day"}, which has ${legSets[nextIndex]} sets of leg work`);
    }
  }

  if (!conflicts.length) {
    return finalize(id, label, "pass", cardio.hardSessions ? "Hard cardio is kept clear of the heavy leg work." : "No hard conditioning scheduled next to leg training.");
  }
  const status = conflicts.length >= THRESHOLDS.CARDIO_CONFLICTS_FOR_FAIL ? "fail" : "warn";
  return finalize(id, label, status, `${conflicts.join("; ")}. Hard conditioning and heavy lower-body lifting draw on the same recovery, so the second one of the pair is the one that suffers.`);
}

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
    if (high.length) parts.push(`High weekly volume for ${high.join(", ")} sets, past ~${THRESHOLDS.HIGH_WEEKLY_SETS_WARN} sets/week, returns diminish for most people.`);
    if (low.length) parts.push(`Light volume for a ${goal} goal on ${low.join(", ")} sets, consider adding work to drive progress.`);
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
  if (pull === 0) return finalize(id, label, "fail", `All pushing, no pulling (push ${push} vs pull ${pull} sets). This commonly drives rounded-shoulder posture and shoulder issues, add rows and pull-ups.`);
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
    const label = `Injury safety, ${rule.label}`;

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
  const experience = norm(userInputs.experience);
  const isBeginner = experience.includes("beginner");

  // Unknown experience is NOT a pass. Before v1.3.0 this returned a reassuring
  // "advanced intensity is appropriate" for anyone whose experience we had never
  // asked for — inventing a safety judgement from no information, in a product
  // whose whole claim is that it does not do that.
  if (!experience) {
    return finalize(
      id,
      label,
      "not_assessed",
      "We do not know your training experience, so beginner-intensity limits were not checked. Tell us your experience level and this check will run."
    );
  }

  if (!isBeginner) {
    return finalize(id, label, "pass", "Not a beginner, advanced intensity is appropriate when well managed.");
  }

  const exercises = allExercises(plan);
  const maxedOut = exercises.filter((ex) => ex.rpe != null && Number(ex.rpe) >= THRESHOLDS.BEGINNER_MAXOUT_RPE);
  const highRpe = exercises.filter((ex) => ex.rpe != null && Number(ex.rpe) > THRESHOLDS.BEGINNER_MAX_RPE && Number(ex.rpe) < THRESHOLDS.BEGINNER_MAXOUT_RPE);
  const overVolume = Object.entries(volume).filter(([, s]) => s > THRESHOLDS.BEGINNER_MAX_WEEKLY_SETS_PER_MUSCLE).map(([g, s]) => `${g} (${s})`);

  if (maxedOut.length) {
    return finalize(id, label, "fail", `Prescribes max-effort RPE ${THRESHOLDS.BEGINNER_MAXOUT_RPE} work to a beginner (${maxedOut.length} exercise${maxedOut.length > 1 ? "s" : ""}). Beginners build skill and connective-tissue resilience faster with 1-3 reps in reserve, keep intensity around RPE 6-8.`);
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

  // Fat loss / general: there is no single "correct" rep range, so this used to
  // pass unconditionally. That made the check vacuous for exactly the plans that
  // need it most: `lib/plan.js` defaults a goal-less plan (a pasted or imported
  // one) into this bucket. Judge the SHAPE instead of the number — a week where
  // every exercise sits at the identical rep target is a list, not a program.
  //
  // Gated on the rep target itself: a whole week at 5s is a novice linear
  // progression (5x5, Starting Strength) where uniformity IS the design and the
  // load is what moves. Telling that user to "vary the main lifts from the
  // accessories" would break a program that works. A whole week at 12s is the
  // chatbot signature. Only the second one is a finding.
  const distinctTargets = new Set(reps.map((r) => r.avg));
  if (
    reps.length >= THRESHOLDS.GENERAL_MIN_LIFTS_TO_JUDGE &&
    distinctTargets.size === 1 &&
    avgReps >= THRESHOLDS.GENERAL_UNIFORM_MIN_REPS
  ) {
    return finalize(
      id,
      label,
      "warn",
      `Every exercise is prescribed at the same rep target (~${round(avgReps)}). A week with no variation in rep range trains one quality only, and it gives you nothing to progress toward. Vary the main lifts from the accessories.`
    );
  }
  if (avgReps != null && avgReps > THRESHOLDS.GENERAL_MAX_AVG_REPS) {
    return finalize(
      id,
      label,
      "warn",
      `Average rep target is ~${round(avgReps)} across the whole week, which is high for general training. Very high reps build endurance more than strength or size, so pull the main lifts down toward 6-12.`
    );
  }
  return finalize(id, label, "pass", `Program structure is reasonable for a ${goal.replace("_", " ")} goal.`);
}

/**
 * Progressive overload — is a progression scheme actually stated?
 *
 * The plan model is a single WEEK, so this cannot verify that load goes up over
 * time; there is no week 2 to compare against. What it can do is check that the
 * plan says how to progress at all, and that the answer is concrete rather than
 * encouragement. That distinction is the single most common failure in a plan
 * pasted out of a chatbot: it prescribes a week and never tells you what to do
 * with it next week.
 *
 * The detail string states this limitation explicitly rather than implying a
 * stronger guarantee than the check can make.
 *
 * Suggestion-tier, zero-weight on introduction (see PENALTY).
 */
function checkProgressiveOverload(plan) {
  const id = "progressive_overload";
  const label = "Progressive overload";
  const text = norm(plan && plan.progression);

  if (!text) {
    return finalize(
      id,
      label,
      "warn",
      "This plan does not say how to progress. Without a rule for adding weight or reps, you repeat the same week indefinitely and stop adapting after a few weeks."
    );
  }

  // Count DISTINCT progression signals. One stray word ("work hard every week")
  // is not a scheme; two or more is a real instruction. Word-boundary matching,
  // so "prepare" is not a rep scheme and "progress" is one signal, not two.
  const matched = PROGRESSION_SIGNALS.filter((sig) => new RegExp(`\\b${sig}`).test(text));
  if (PROGRESSION_LOAD_RE.test(text)) matched.push("numeric load");
  if (matched.length < THRESHOLDS.PROGRESSION_MIN_SIGNALS) {
    return finalize(
      id,
      label,
      "warn",
      `The progression note ("${String(plan.progression).slice(0, 80)}") does not describe a concrete rule. Say what goes up and when, for example add 2.5kg to the main lift when you hit the top of the rep range on every set.`
    );
  }

  return finalize(
    id,
    label,
    "pass",
    "The plan states a concrete progression rule. Note this checks that a scheme exists and is specific, not that the rate of progression suits you."
  );
}

/** Quad / hamstring balance. A programming-balance check, not an injury
 *  predictor: see docs/rubric-sources.md for why that claim was removed. */
function checkLegBalance(volume) {
  const id = "leg_balance";
  const label = "Quad / hamstring balance";
  const quad = volume.quads || 0;
  const ham = volume.hamstrings || 0;

  if (quad + ham < THRESHOLDS.LEG_MIN_SETS_TO_JUDGE) {
    return finalize(id, label, "pass", "Not enough lower-body volume this week to assess quad/hamstring balance.");
  }
  if (ham === 0) {
    return finalize(id, label, "warn", `Quad work with no direct hamstring work (quads ${round(quad)} vs hamstrings 0 sets). Add a hinge or leg curl, balanced posterior-chain volume supports the knees.`);
  }
  const ratio = Math.max(quad, ham) / Math.min(quad, ham);
  const heavier = quad > ham ? "quads" : "hamstrings";
  if (ratio >= THRESHOLDS.LEG_BALANCE_RATIO_WARN) {
    return finalize(id, label, "warn", `Lower body skews toward ${heavier} (quads ${round(quad)} vs hamstrings ${round(ham)} sets, ${round(ratio)}×). A more even split trains the lower body more completely.`);
  }
  return finalize(id, label, "pass", `Quad and hamstring volume are reasonably balanced (quads ${round(quad)} vs hamstrings ${round(ham)} sets).`);
}

/**
 * Training frequency — a hypertrophy optimization note. When a muscle gets
 * substantial weekly volume but all of it lands in one session, spreading it
 * across ~2 days tends to grow the muscle better (more quality reps per set,
 * better recovery). Suggestion-tier and zero-weight: the volume is already
 * scored by weekly_volume, so this never moves the number.
 */
function checkMuscleFrequency(plan, volume, frequency, goal) {
  const id = "muscle_frequency";
  const label = "Training frequency";

  // The 2x-beats-1x evidence is clearest for hypertrophy; stay quiet otherwise.
  if (goal !== "hypertrophy") {
    return finalize(id, label, "pass", "Training frequency isn't a primary concern for this goal.");
  }

  const under = Object.keys(MUSCLE_KEYWORDS).filter(
    (g) => (volume[g] || 0) >= THRESHOLDS.FREQUENCY_MIN_SETS_TO_JUDGE && (frequency[g] || 0) <= 1
  );

  if (under.length) {
    const list = under.map((g) => `${g} (${round(volume[g])} sets in one day)`).join(", ");
    const which = under.length === 1 ? "One muscle group gets" : "Some muscle groups get";
    return finalize(
      id,
      label,
      "warn",
      `${which} substantial volume in a single weekly session: ${list}. Spreading it across about ${THRESHOLDS.FREQUENCY_TARGET_DAYS} days a week tends to grow a muscle better than the same sets in one session, through more quality reps and better recovery. This is an optimization, not a safety issue, the total volume is unchanged.`
    );
  }
  return finalize(id, label, "pass", "Muscle groups with meaningful volume are trained at least a couple of times a week.");
}

/**
 * Equipment fit — flags prescribed exercises the user can't do with the
 * equipment they selected. A usability check, not a safety one: suggestion-tier
 * and zero-weight. Passes when no equipment was provided (nothing to assess) or
 * when everything is performable. Only judges recognized exercises so unknown
 * names are never over-flagged.
 */
function checkEquipmentFit(plan, userInputs) {
  const id = "equipment_fit";
  const label = "Equipment fit";
  const caps = equipmentCapabilities(userInputs.equipment);

  if (!caps) {
    return finalize(id, label, "not_assessed", "No equipment was specified, so exercise availability wasn't assessed. Tell us what you have access to and this check will run.");
  }

  // Two separate populations, and conflating them is what made this check lie:
  // lifts we can judge, and lifts we cannot recognize at all. The old code
  // gated on `lookupExercise`, the CURATED slice, so 168 of 362 catalog entries
  // whose equipment the catalog knew perfectly well were treated as unknown and
  // skipped — and then the pass said "Every prescribed exercise fits".
  const missing = [];
  const unrecognized = [];
  for (const ex of allExercises(plan)) {
    if (!hasKnownEquipment(ex.name)) unrecognized.push(ex.name);
    else if (!canPerform(ex.name, caps)) missing.push(ex.name);
  }
  const unique = [...new Set(missing)];
  const unknown = [...new Set(unrecognized)];
  const total = allExercises(plan).length;

  // What we could not read is stated in every branch, never implied away.
  const caveat = unknown.length
    ? ` ${unknown.length} exercise${unknown.length === 1 ? "" : "s"} (${unknown.slice(0, 3).join(", ")}${unknown.length > 3 ? ", …" : ""}) ${unknown.length === 1 ? "wasn't" : "weren't"} recognized, so ${unknown.length === 1 ? "it was" : "they were"} not checked. Use standard exercise names for a sharper audit.`
    : "";

  if (unique.length) {
    const shown = unique.slice(0, 4).join(", ");
    const more = unique.length > 4 ? `, and ${unique.length - 4} more` : "";
    const one = unique.length === 1;
    return finalize(
      id,
      label,
      "warn",
      `${unique.length} exercise${one ? "" : "s"} need${one ? "s" : ""} equipment you didn't list (${shown}${more}). Swap ${one ? "it" : "them"} for a movement your available equipment supports, or add the equipment to your profile.${caveat}`
    );
  }
  // A pass that could only read part of the plan says so rather than claiming
  // the whole plan is clear.
  if (unknown.length) {
    return finalize(id, label, "pass", `The ${total - unknown.length} of ${total} exercises we recognized all fit your available equipment.${caveat}`);
  }
  return finalize(id, label, "pass", "Every prescribed exercise fits the equipment you have available.");
}

/** Per-session set sanity — flags an extremely long single workout. */
function checkSessionLoad(plan) {
  const id = "session_load";
  const label = "Session length sanity";
  let worst = 0;
  let worstDay = "";
  for (const day of plan.days || []) {
    const text = `${norm(day.day)} ${norm(day.focus)}`;
    if (/\b(rest|recovery|off day|day off|active recovery)\b/.test(text)) continue;
    const sets = (day.exercises || []).reduce((s, e) => s + (Number(e.sets) || 0), 0);
    if (sets > worst) { worst = sets; worstDay = day.focus || day.day || "a session"; }
  }
  if (worst >= THRESHOLDS.SESSION_SETS_FAIL) {
    return finalize(id, label, "fail", `One session prescribes ${worst} working sets (${worstDay}). That's an extreme, very long workout, quality and form decay late on, raising injury risk. Split it across days.`);
  }
  if (worst >= THRESHOLDS.SESSION_SETS_WARN) {
    return finalize(id, label, "warn", `A session prescribes ${worst} working sets (${worstDay}), a long workout. Consider trimming or splitting it for better quality per set.`);
  }
  return finalize(id, label, "pass", "No single session is overloaded with working sets.");
}

/** Transparency: how much of the plan the structured DB recognized. */
function checkCoverage(plan) {
  const id = "coverage";
  const label = "Exercise recognition";
  const all = allExercises(plan);
  if (!all.length) return finalize(id, label, "pass", "No exercises to assess.");
  const known = all.filter((e) => lookupExercise(e.name)).length;
  const pct = known / all.length;
  if (pct >= THRESHOLDS.COVERAGE_MIN) {
    return finalize(id, label, "pass", `${known}/${all.length} exercises matched the structured database, so the volume and injury checks ran on recognized movements.`);
  }
  return finalize(id, label, "warn", `Only ${known}/${all.length} exercises were recognized; the rest were assessed by name keywords, so the volume estimates for those are rougher. Use standard exercise names for a sharper audit.`);
}

// ============================================================================
// 7. SEVERITY TIERS + REMEDIES
//    The UI leads with flags (not the score), so each check is sorted into a
//    severity tier and — when flagged — carries a suggested fix and safer
//    alternatives. This same structured data feeds the plan-repair engine.
// ============================================================================

/** A stable version string surfaced in the Trust Report. Bump on rubric change. */
// v1.4.0 adds the two cardio checks. They are zero-weight and conditionally
// emitted, so no pre-existing case moved, but the rubric now covers something it
// did not before and the Trust Report should say which rubric it ran.
export const EVALUATOR_VERSION = "v1.4.0";

/** Suggested fixes for the non-injury checks, keyed by check id. */
const REMEDIES = {
  rest_days: { fix: "Schedule at least one full rest day, or convert a training day to active recovery." },
  weekly_volume: {
    fix: "Trim sets on the most overrepresented muscle group and remove redundant accessory work; add a little volume to anything under-stimulated.",
  },
  muscle_balance: {
    fix: "Even out the push:pull ratio, add pulling volume, or trim excess pressing.",
    alternatives: ["Barbell / dumbbell row", "Lat pulldown", "Face pull", "Rear-delt fly", "Chest-supported row"],
  },
  beginner_load: {
    fix: "Lower intensity (leave 1–3 reps in reserve), drop max-effort sets, and build volume gradually.",
  },
  goal_fit: { fix: "Shift rep ranges toward your goal, lower reps (≈3–6) for strength, ≈6–15 for hypertrophy." },
  muscle_frequency: { fix: "Split that muscle's weekly sets across two sessions (for example, half on one day and half on another) rather than one big session." },
  equipment_fit: { fix: "Swap exercises that need unavailable equipment for ones your gear supports, or update the equipment in your profile." },
  // Added v1.3.0. These three checks could flag with no advice attached, because
  // remedyFor returned {} for any id missing from this table.
  leg_balance: {
    fix: "Add direct hamstring work, or trim quad volume, until the two are closer to even.",
    alternatives: ["Romanian deadlift", "Lying leg curl", "Seated leg curl", "Good morning", "Nordic curl"],
  },
  session_load: {
    fix: "Move some of that session's work to another day. Quality per set drops late in a very long workout.",
  },
  coverage: {
    fix: "Rename the unrecognized lifts to their standard names (for example \"DB bench\" to \"Dumbbell Bench Press\") so the volume and injury checks run on them properly.",
  },
  progressive_overload: {
    fix: "State one concrete rule, for example: add 2.5kg to the main lift when you hit the top of the rep range on every set, then drop back to the bottom.",
  },
  cardio_load: {
    fix: "Bring the weekly cardio minutes in line with what you asked for: trim the longest session, or add one if the plan left conditioning out entirely.",
    alternatives: ["Incline Walk", "Stationary Bike", "Rowing Machine", "Jog", "Swimming"],
  },
  cardio_conflict: {
    fix: "Move the hard conditioning to a day that is neither a leg day nor the day before one, or run it easy instead. Upper-body days and rest days both absorb it without a cost.",
    alternatives: ["Incline Walk", "Stationary Bike", "Elliptical", "Swimming"],
  },
};

/**
 * Sort a check into a severity tier:
 *   critical  — safety-relevant failures (no rest, junk volume, injury conflicts…)
 *   warning   — concerns worth reviewing before training
 *   suggestion— quality/optimization notes (goal fit), not safety
 *   pass      — no concern
 */
function tierFor(check) {
  // "Not assessed" is its own tier, checked FIRST. Without this it falls all the
  // way through to the default `return "warning"` below and renders as a warning
  // about the user's plan, when it is really a statement about our own inputs.
  if (check.status === "not_assessed") return "not_assessed";
  if (check.status === "pass") return "pass";
  if (check.id === "invalid_plan") return "critical";
  // Quality / optimization / transparency notes, not safety flags.
  // `progressive_overload` belongs here with the other zero-weight quality
  // notes: at "warning" it reads as a safety concern, and trust.js drops the
  // Trust Report from High to Medium on a plan with nothing unsafe about it.
  if (check.id === "goal_fit" || check.id === "leg_balance" || check.id === "coverage" || check.id === "muscle_frequency" || check.id === "equipment_fit" || check.id === "progressive_overload" || check.id === "cardio_load") return "suggestion";
  // cardio_conflict is a recovery concern, so it reads as a warning rather than
  // a suggestion, but it never reaches "critical": it is a programming order
  // problem, not an unsafe prescription, and it carries no score penalty.
  if (check.id === "cardio_conflict") return "warning";
  if (check.id.startsWith("injury_")) return check.status === "fail" ? "critical" : "warning";
  const CRITICAL_ON_FAIL = new Set(["rest_days", "weekly_volume", "beginner_load", "session_load"]);
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
  const s = { critical: 0, warning: 0, suggestion: 0, pass: 0, not_assessed: 0, total: checks.length };
  for (const c of checks) s[c.tier] = (s[c.tier] || 0) + 1;
  s.passed = s.pass;
  // Unassessed checks are deliberately excluded from BOTH passed and flags: they
  // are neither a clean bill of health nor a problem with the plan.
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
  const frequency = computeWeeklyFrequency(plan);
  const cardio = computeWeeklyCardio(plan);

  // Cardio rows are emitted ONLY when there is cardio to judge, or the user
  // asked for some. A plan with no conditioning and no request gets no rows at
  // all, which is what keeps every pre-existing audit byte-identical: an
  // unconditional check would add a row to summary.total for every plan ever
  // audited, and would break the two suites that assert a full-input audit has
  // zero unassessed checks. Same shape as checkInjuries, which has always
  // contributed a variable number of rows.
  const cardioRelevant = cardio.sessions > 0 || cardioRequest(userInputs) !== null;
  const cardioChecks = cardioRelevant ? [checkCardioLoad(plan, cardio, userInputs), checkCardioConflict(plan, cardio)] : [];

  // Run every check. Injuries can contribute multiple rows.
  const checks = [
    checkRestDays(plan),
    checkWeeklyVolume(plan, volume, goal),
    checkMuscleBalance(volume),
    checkLegBalance(volume),
    checkMuscleFrequency(plan, volume, frequency, goal),
    checkEquipmentFit(plan, userInputs),
    checkSessionLoad(plan),
    checkProgressiveOverload(plan),
    ...cardioChecks,
    ...checkInjuries(plan, userInputs),
    checkBeginnerLoad(plan, volume, userInputs),
    checkGoalFit(plan, userInputs, goal),
    checkCoverage(plan),
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
