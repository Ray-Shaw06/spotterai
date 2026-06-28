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

function repairInjury(plan, check, changes) {
  const key = check.id.replace("injury_", "");
  const rule = INJURY_RULES[key];
  if (!rule) return;
  const alts = rule.alternatives || [];
  let ai = 0;
  for (const day of plan.days || []) {
    for (const ex of day.exercises || []) {
      if (rule.riskyKeywords.some((k) => norm(ex.name).includes(k))) {
        const alt = alts[ai % alts.length] || `a ${rule.label.toLowerCase()}-friendly variation`;
        ai++;
        changes.push({ issue: `${rule.label}: “${ex.name}” may aggravate the injury`, fix: `Replaced with ${alt}` });
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
    changes.push({ issue: "No rest day in the week", fix: `Converted ${last.day || "the last training day"} to active recovery` });
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
    changes.push({ issue: `Excessive weekly volume for ${group} (${sets} sets)`, fix: `Trimmed redundant ${group} work down to about ${Math.max(current, target)} sets/week` });
  }
}

function repairBalance(plan, changes) {
  const vol = computeWeeklyVolume(plan);
  const push = sumGroups(vol, PUSH_GROUPS);
  const pull = sumGroups(vol, PULL_GROUPS);
  if (push + pull < THRESHOLDS.BALANCE_MIN_SETS_TO_JUDGE) return;
  const days = (plan.days || []).filter((d) => (d.exercises || []).length);
  if (!days.length) return;

  if (push >= pull) {
    // add pulling to the day with the most pressing
    const target = days.reduce(
      (best, d) => {
        const p = (d.exercises || []).filter((e) => PUSH_GROUPS.some((g) => matchesGroup(e.name, g))).length;
        return p > best.p ? { d, p } : best;
      },
      { d: days[0], p: -1 }
    ).d;
    target.exercises.push({ name: "Seated Cable Row", sets: 3, reps: "10-12", rpe: 8, notes: "Added to balance push/pull" });
    target.exercises.push({ name: "Face Pull", sets: 3, reps: "12-15", rpe: 8, notes: "Rear delts / upper back" });
    changes.push({ issue: "Pushing volume far outweighs pulling", fix: "Added Seated Cable Row + Face Pull to even the ratio" });
  } else {
    days[0].exercises.push({ name: "Dumbbell Bench Press", sets: 3, reps: "8-12", rpe: 8, notes: "Added to balance push/pull" });
    changes.push({ issue: "Pulling volume far outweighs pushing", fix: "Added Dumbbell Bench Press to even the ratio" });
  }
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
  if (capped) changes.push({ issue: "Intensity too high for a beginner", fix: `Capped RPE at ${THRESHOLDS.BEGINNER_MAX_RPE} on ${capped} exercise${capped > 1 ? "s" : ""} — leave reps in reserve` });
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
