/**
 * SpotterAI — deterministic plan repair engine
 * ============================================================================
 * Turns each evaluator flag into a concrete, rule-based edit, then re-audits the
 * revised plan. No LLM — it shares the evaluator's keyword maps and thresholds
 * so a "fix" actually moves the audit it was derived from.
 *
 *   repairPlan(plan, inputs) -> { before, after, plan: repaired, changes }
 *     changes: [{ issue, fix }]
 *
 * The engine is intentionally conservative: it preserves the user's goal and
 * available days, and only edits what a flag points at.
 */

import {
  evaluatePlan,
  INJURY_RULES,
  computeWeeklyVolume,
  MUSCLE_KEYWORDS,
  PUSH_GROUPS,
  PULL_GROUPS,
  THRESHOLDS,
} from "./evaluator.js";
import { lookupExercise, isContraindicated } from "./exercise-data.js";

const clone = (o) => JSON.parse(JSON.stringify(o));
const norm = (t) => String(t || "").toLowerCase().replace(/\s+/g, " ").trim();
const isRestDay = (d) => /\b(rest|recovery|off day|day off|active recovery)\b/.test(`${norm(d.day)} ${norm(d.focus)}`);

function matchesGroup(name, group) {
  const map = MUSCLE_KEYWORDS[group];
  if (!map) return false;
  const n = norm(name);
  return map.include.some((k) => n.includes(k)) && !map.exclude.some((k) => n.includes(k));
}
function sumGroups(vol, groups) {
  return groups.reduce((s, g) => s + (vol[g] || 0), 0);
}
function nextVersion(v) {
  const n = parseInt(String(v || "v1").replace(/\D/g, ""), 10) || 1;
  return `v${n + 1}`;
}

// ----------------------------------------------------------------------------
// Per-flag repairs
// ----------------------------------------------------------------------------

/** Is this exercise risky for the injury? Mirror the evaluator: structured DB
 *  contraindications for known lifts, keyword fallback for unknown ones. */
function riskyForInjury(name, key, rule) {
  const known = lookupExercise(name);
  return known ? isContraindicated(name, key) : rule.riskyKeywords.some((k) => norm(name).includes(k));
}

/** Pick a safe alternative that best preserves the original's primary muscle, so
 *  the swap removes the risk without quietly dropping training stimulus. */
function bestAlternative(originalName, alts, injuryKey) {
  const pool = alts.filter((a) => !isContraindicated(a, injuryKey));
  const list = pool.length ? pool : alts;
  const orig = lookupExercise(originalName);
  const primary = orig?.primaryMuscles?.[0];
  if (primary) {
    const exact = list.find((a) => lookupExercise(a)?.primaryMuscles.includes(primary));
    if (exact) return exact;
  }
  const overlap = list.find((a) => {
    const e = lookupExercise(a);
    return e && orig && e.primaryMuscles.some((m) => orig.primaryMuscles.includes(m));
  });
  return overlap || list[0] || `a ${injuryKey}-friendly variation`;
}

function repairInjury(plan, check, changes) {
  const key = check.id.replace("injury_", "");
  const rule = INJURY_RULES[key];
  if (!rule) return;
  const alts = rule.alternatives || [];
  for (const day of plan.days || []) {
    for (const ex of day.exercises || []) {
      if (riskyForInjury(ex.name, key, rule)) {
        const alt = bestAlternative(ex.name, alts, key);
        changes.push({ issue: `${rule.label}: “${ex.name}” may aggravate the injury`, fix: `Replaced with ${alt}`, why: `Keeps training the same muscle while removing the movement most likely to aggravate a ${rule.label.toLowerCase()} issue.`, tradeoff: "A slightly different stimulus than the original lift." });
        ex.name = alt;
        ex.notes = ex.notes ? `${ex.notes} · ${rule.label}-friendly swap` : `${rule.label}-friendly swap`;
      }
    }
  }
}

function repairRest(plan, changes) {
  const trainingDays = (plan.days || []).filter((d) => !isRestDay(d));
  if (trainingDays.length < THRESHOLDS.TRAINING_DAYS_FAIL) return; // only the no-rest-day case
  const last = [...(plan.days || [])].reverse().find((d) => !isRestDay(d));
  if (last) {
    changes.push({ issue: "No rest day in the week", fix: `Converted ${last.day || "the last training day"} to active recovery`, why: "Recovery is when you actually adapt — at least one rest day lowers injury and burnout risk.", tradeoff: "One fewer training day this week." });
    last.focus = "Rest / active recovery";
    last.exercises = [];
  }
}

function repairVolume(plan, changes) {
  const vol = computeWeeklyVolume(plan);
  const over = Object.entries(vol)
    .filter(([, s]) => s >= THRESHOLDS.HIGH_WEEKLY_SETS_WARN)
    .sort((a, b) => b[1] - a[1]);

  for (const [group, sets] of over) {
    const target = THRESHOLDS.HIGH_WEEKLY_SETS_WARN - 1;
    let current = sets;
    const matches = [];
    for (const day of plan.days || []) for (const ex of day.exercises || []) if (matchesGroup(ex.name, group)) matches.push({ day, ex });

    // 1) trim a set at a time (down to a 2-set floor), round-robin.
    let guard = 0;
    while (current > target && matches.some((m) => Number(m.ex.sets) > 2) && guard < 300) {
      const m = matches[guard % matches.length];
      if (Number(m.ex.sets) > 2) { m.ex.sets = Number(m.ex.sets) - 1; current -= 1; }
      guard++;
    }
    // 2) if still over, drop the most redundant accessory (last match).
    while (current > target && matches.length > 1) {
      const victim = matches.pop();
      const arr = victim.day.exercises;
      const idx = arr.indexOf(victim.ex);
      if (idx >= 0) { current -= Number(victim.ex.sets) || 0; arr.splice(idx, 1); }
    }
    changes.push({ issue: `Excessive weekly volume for ${group} (${sets} sets)`, fix: `Trimmed redundant ${group} work down to about ${Math.max(current, target)} sets/week`, why: "Brings junk volume back into a productive range, so the sets that remain actually drive progress.", tradeoff: `Less direct ${group} volume this week.` });
  }
}

// Back-friendly pulling additions (no lower-back or shoulder/push contribution).
const PULL_ADDS = [
  { name: "Lat Pulldown", sets: 3, reps: "10-12", rpe: 8 },
  { name: "Seated Cable Row", sets: 3, reps: "10-12", rpe: 8 },
  { name: "Chest-Supported Row", sets: 3, reps: "10-12", rpe: 8 },
];

function repairBalance(plan, changes) {
  const vol = computeWeeklyVolume(plan);
  const push = sumGroups(vol, PUSH_GROUPS);
  const pull = sumGroups(vol, PULL_GROUPS);
  if (push + pull < THRESHOLDS.BALANCE_MIN_SETS_TO_JUDGE) return;
  const days = (plan.days || []).filter((d) => (d.exercises || []).length);
  if (!days.length) return;

  if (push < pull) {
    days[0].exercises.push({ name: "Dumbbell Bench Press", sets: 3, reps: "8-12", rpe: 8, notes: "Added to balance push/pull" });
    changes.push({ issue: "Pulling volume far outweighs pushing", fix: "Added Dumbbell Bench Press to even the ratio", why: "Balances pressing against the heavier pulling volume.", tradeoff: "A little more total weekly volume." });
    return;
  }

  // Pushing dominates: trim a little of the heaviest pressing AND add pure
  // pulling, scaled to the gap, on the most press-heavy day.
  const pressers = [];
  for (const d of days) for (const e of d.exercises || []) {
    if (PUSH_GROUPS.some((g) => matchesGroup(e.name, g)) && !PULL_GROUPS.some((g) => matchesGroup(e.name, g))) pressers.push(e);
  }
  pressers.sort((a, b) => Number(b.sets) - Number(a.sets));
  let trimmed = 0;
  for (const e of pressers.slice(0, 2)) if (Number(e.sets) > 3) { e.sets = Number(e.sets) - 1; trimmed += 1; }

  const target = days.reduce(
    (best, d) => {
      const p = (d.exercises || []).filter((e) => PUSH_GROUPS.some((g) => matchesGroup(e.name, g))).length;
      return p > best.p ? { d, p } : best;
    },
    { d: days[0], p: -1 }
  ).d;
  const needed = Math.max(1, Math.min(3, Math.ceil((push / 2 - pull) / 3)));
  for (let i = 0; i < needed; i++) target.exercises.push({ ...PULL_ADDS[i % PULL_ADDS.length], notes: "Added to balance push/pull" });

  changes.push({
    issue: "Pushing volume far outweighs pulling",
    fix: `Added ${needed} pulling exercise${needed > 1 ? "s" : ""}${trimmed ? ` and trimmed ${trimmed} pressing set${trimmed > 1 ? "s" : ""}` : ""} to even the ratio`,
    why: "A more even push:pull ratio supports shoulder health and posture.",
    tradeoff: trimmed ? "A little less pressing volume this week." : "A little more total weekly volume.",
  });
}

function repairBeginner(plan, changes) {
  let capped = 0;
  for (const day of plan.days || []) {
    for (const ex of day.exercises || []) {
      if (ex.rpe != null && ex.rpe !== "" && Number(ex.rpe) > THRESHOLDS.BEGINNER_MAX_RPE) {
        ex.rpe = THRESHOLDS.BEGINNER_MAX_RPE;
        capped++;
      }
    }
  }
  if (capped) changes.push({ issue: "Intensity too high for a beginner", fix: `Capped RPE at ${THRESHOLDS.BEGINNER_MAX_RPE} on ${capped} exercise${capped > 1 ? "s" : ""}`, why: "Leaving 1–3 reps in reserve lets a new lifter build technique and recover between sessions.", tradeoff: "Lighter top-end intensity than originally prescribed." });
}

// ----------------------------------------------------------------------------
// Entry point
// ----------------------------------------------------------------------------

export function repairPlan(originalPlan, inputs = {}) {
  const before = evaluatePlan(originalPlan, inputs);
  const plan = clone(originalPlan);
  const changes = [];

  // Only repair the things that matter for trust: criticals and warnings.
  const flagged = before.checks.filter((c) => c.tier === "critical" || c.tier === "warning");

  // Injuries first (they swap movements), then recovery, volume, balance, load.
  for (const c of flagged) if (c.id.startsWith("injury_")) repairInjury(plan, c, changes);
  for (const c of flagged) {
    if (c.id === "rest_days") repairRest(plan, changes);
    else if (c.id === "weekly_volume") repairVolume(plan, changes);
    else if (c.id === "muscle_balance") repairBalance(plan, changes);
    else if (c.id === "beginner_load") repairBeginner(plan, changes);
  }

  if (changes.length) plan.version = nextVersion(originalPlan.version);
  const after = evaluatePlan(plan, inputs);
  return { before, after, plan, changes };
}
