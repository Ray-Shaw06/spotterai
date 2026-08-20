/**
 * SpotterAI — deterministic adapt engine (pure, no LLM, no DOM; the one
 * exception is a fire-and-forget audit-telemetry beacon, which never throws
 * and never affects the returned plan)
 * ============================================================================
 * Re-tunes an existing plan from what the user has ACTUALLY logged, using only
 * transparent rules and the same safety machinery the rest of the app trusts.
 * This replaces the old Gemini-backed /api/adapt: adaptation is now fully
 * offline, free, and unit-testable, and every change bullet cites a real number
 * — which matches the product thesis (don't blindly trust the AI).
 *
 *   adaptPlan(plan, context, inputs) -> { plan, changes, summary, adapted }
 *     changes : string[]  — short "what changed & why" bullets for the UI
 *     summary : string    — 1-2 sentence overview
 *     adapted : boolean   — whether anything actually changed
 *
 * Ordered transforms, recovery before progression:
 *   1. Injuries / pain      — merged into inputs; the safety close (step 6) swaps
 *                             contraindicated movements deterministically.
 *   2. Adherence pullback   — missed sessions → ease accessory volume.
 *   3. Deload               — rising-volume peak → back off ~40%.
 *   4. Progression          — lifts hit at/above target for 2+ sessions → add a
 *                             set and suggest the next load. Skipped when we just
 *                             deloaded or pulled that muscle back.
 *   5. Rebalance            — delegated to the safety close (push/pull + leg
 *                             balance are enforced there; see the note in step 5).
 *   6. Safety close         — repairPlan + evaluatePlan re-audit.
 *
 * HARD INVARIANT (safety-sacred): the returned plan never carries MORE critical
 * or warning flags than the plan we started from. If our edits can't clear that
 * bar even after repair, we discard them and return a pure safety-only pass.
 */

import { suggestNextWeight, deloadFromWeeklyVolume } from "./progression.js";
import { repairPlan } from "./repair.js";
import { evaluatePlan, computeWeeklyVolume, MUSCLE_KEYWORDS, THRESHOLDS } from "./evaluator.js";
import { sendAuditTelemetry } from "./audit-telemetry-client.js";

const clone = (o) => JSON.parse(JSON.stringify(o));
const norm = (t) => String(t || "").toLowerCase().replace(/\s+/g, " ").trim();

/** Highest rep number a plan target asks for. "8-12"->12, "5"->5, "30s"->null.
 *  Time-based holds and uncountable targets (AMRAP, failure) return null. */
function repsTargetMax(reps) {
  if (typeof reps === "number") return reps > 0 ? reps : null;
  const s = String(reps ?? "").trim().toLowerCase();
  if (!s || !/\d/.test(s)) return null; // empty, AMRAP, "to failure"
  if (/\d\s*(s|sec|secs|min)\b/.test(s)) return null; // time-based (30s, 2 min)
  const nums = s.match(/\d+/g);
  return nums ? Math.max(...nums.map(Number)) : null;
}

/** Muscle groups an exercise trains, via the evaluator's shared keyword maps. */
function groupsFor(name) {
  const n = norm(name);
  const out = [];
  for (const [group, map] of Object.entries(MUSCLE_KEYWORDS)) {
    if (map.include.some((k) => n.includes(k)) && !map.exclude.some((k) => n.includes(k))) out.push(group);
  }
  return out;
}
const primaryGroup = (name) => groupsFor(name)[0] || null;

function nextVersion(v) {
  const n = parseInt(String(v || "v1").replace(/\D/g, ""), 10) || 1;
  return `v${n + 1}`;
}

/** Enough logged training to adapt from? */
function hasSignal(context) {
  if (!context || typeof context !== "object") return false;
  if (Number(context.workoutsLogged) > 0) return true;
  return !!context.exercises && Object.keys(context.exercises).length > 0;
}

/** Structured per-exercise history the builder attached, matched by name. */
function historyFor(context, name) {
  const ex = context.exercises || {};
  return ex[norm(name)] || null;
}

/**
 * Adherence read from recent weekly sessions vs the target. "Behind" means the
 * last few completed weeks averaged well under target — a signal to ease off,
 * not pile on. Ignores the current (partial) week.
 */
function adherence(context) {
  const target = Number(context?.thisWeek?.target) || 0;
  const weeks = Array.isArray(context?.weeklySessions) ? context.weeklySessions : [];
  if (target <= 0 || weeks.length < 2) return { behind: false, avg: null, target };
  const completed = weeks.slice(0, -1); // drop the current partial week
  const recent = completed.slice(-3);
  if (!recent.length) return { behind: false, avg: null, target };
  const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
  return { behind: avg < target * 0.6, avg: Math.round(avg * 10) / 10, target };
}

// ----------------------------------------------------------------------------
// Transforms
// ----------------------------------------------------------------------------

/** Ease accessory volume when adherence is low. Records the groups it touched so
 *  progression doesn't turn around and re-load them the same block. */
function pullBack(work, changes, pulledBack) {
  const MAX_TRIMS = 3;
  let trims = 0;
  for (const day of work.days || []) {
    const exs = day.exercises || [];
    // Accessories = everything after the day's first (primary) lift.
    for (let i = exs.length - 1; i >= 1 && trims < MAX_TRIMS; i--) {
      const ex = exs[i];
      if (Number(ex.sets) > 2) {
        ex.sets = Number(ex.sets) - 1;
        trims += 1;
        const g = primaryGroup(ex.name);
        if (g) pulledBack.add(g);
      }
    }
  }
  return trims;
}

/** Back off ~40% of working sets across the board (floor of 2 per exercise). */
function deloadVolume(work) {
  let cut = 0;
  for (const day of work.days || []) {
    for (const ex of day.exercises || []) {
      const sets = Number(ex.sets) || 0;
      if (sets <= 2) continue;
      const reduced = Math.max(2, Math.round(sets * 0.6));
      if (reduced < sets) {
        cut += sets - reduced;
        ex.sets = reduced;
      }
    }
  }
  return cut;
}

// ----------------------------------------------------------------------------
// Entry point
// ----------------------------------------------------------------------------

export function adaptPlan(plan, context, inputs = {}) {
  if (!plan || !Array.isArray(plan.days)) return { plan, changes: [], summary: "", adapted: false };
  if (!hasSignal(context)) return { plan, changes: [], summary: "", adapted: false };

  const unit = context.unit || "kg";

  // 1. Injuries / pain — fold active limitations into the inputs so the safety
  //    close swaps contraindicated movements using the shared injury rules.
  const injuries = Array.from(
    new Set([
      ...(Array.isArray(inputs.injuries) ? inputs.injuries : []),
      ...(Array.isArray(context.activeLimitations) ? context.activeLimitations : []),
    ].filter((k) => k && k !== "none"))
  );
  const effInputs = { ...inputs, injuries };

  // Baseline flag counts we must not exceed.
  const baselineAudit = evaluatePlan(plan, effInputs);
  sendAuditTelemetry(baselineAudit, plan, effInputs, "adapt");
  const baseline = baselineAudit.summary;

  const work = clone(plan);
  const changes = [];
  const pulledBack = new Set();

  // 2. Adherence pullback.
  const adh = adherence(context);
  if (adh.behind) {
    const trimmed = pullBack(work, changes, pulledBack);
    if (trimmed) {
      changes.push(
        `Eased back ${trimmed} accessory set${trimmed > 1 ? "s" : ""}, you've averaged about ${adh.avg} of ${adh.target} planned sessions the last few weeks, so this keeps the plan realistic instead of piling on.`
      );
    }
  }

  // 3. Deload.
  const deload = deloadFromWeeklyVolume(context.weeklyVolume);
  const deloaded = !!(deload && deload.recommend);
  if (deloaded) {
    const cut = deloadVolume(work);
    if (cut) changes.push(`Deload week: trimmed ${cut} working sets (~40%). ${deload.reason}`);
  }

  // 4. Progression — only when we haven't just deloaded.
  if (!deloaded) {
    const vol = computeWeeklyVolume(work);
    for (const day of work.days || []) {
      for (const ex of day.exercises || []) {
        const hist = historyFor(context, ex.name);
        if (!hist || Number(hist.sessions) < 2) continue;

        const tmax = repsTargetMax(ex.reps);
        if (tmax == null) continue; // time-based / uncountable target → skip

        const recent = Array.isArray(hist.recentTopReps) ? hist.recentTopReps.slice(0, 3) : [];
        const hits = recent.filter((r) => Number(r) >= tmax).length;
        if (hits < 2) continue; // need 2+ recent sessions at/above target

        const g = primaryGroup(ex.name);
        if (g && pulledBack.has(g)) continue; // don't re-load what we just eased

        // Add a set if there's headroom and the group isn't already near junk volume.
        let added = false;
        const groupSets = g ? vol[g] || 0 : 0;
        if (Number(ex.sets) < 4 && groupSets < THRESHOLDS.HIGH_WEEKLY_SETS_WARN - 2) {
          ex.sets = Number(ex.sets) + 1;
          added = true;
          if (g) vol[g] = groupSets + 1;
        }

        // Suggest a concrete next load (plans carry no weight field, so this
        // lives in the exercise notes).
        const sug = suggestNextWeight(hist.latest);
        const loaded = sug && sug.weight > 0 && sug.increment > 0;
        if (loaded) {
          const tip = `Progress toward ${sug.weight}${unit}`;
          ex.notes = ex.notes ? `${ex.notes} · ${tip}` : tip;
        }

        if (added || loaded) {
          const topW = hist.latest && hist.latest.weight > 0 ? ` @ ${hist.latest.weight}${unit}` : "";
          const earned = `you hit ${tmax}+ reps${topW} for ${hits} sessions`;
          if (added && loaded) {
            changes.push(`${ex.name}: added a ${ex.sets}th set and suggested ${sug.weight}${unit} next, ${earned}.`);
          } else if (added) {
            changes.push(`${ex.name}: added a ${ex.sets}th set, ${earned}.`);
          } else {
            changes.push(`${ex.name}: suggested ${sug.weight}${unit} next, ${earned}.`);
          }
        }
      }
    }
  }

  // 5. Rebalance neglected muscles — delegated to the safety close below.
  //    The evaluator's balance repair (push/pull, leg antagonist) is the honest,
  //    deterministic lever we have today; per-muscle logged-frequency rebalance
  //    is a future enhancement, not faked here.

  // 6. Safety close: repair injuries + anything our edits disturbed, then re-audit.
  const safety = repairPlan(work, effInputs);
  for (const c of safety.changes) changes.push(`${c.fix}, ${c.why}`);
  const after = safety.after.summary;

  // HARD INVARIANT: never emit more critical/warning flags than we started with.
  if (after.critical > baseline.critical || after.warning > baseline.warning) {
    const safe = repairPlan(plan, effInputs);
    const fb = safe.changes.map((c) => `${c.fix}, ${c.why}`);
    return {
      plan: safe.plan,
      changes: fb,
      summary: fb.length
        ? "Re-checked your plan against your recent training and tightened a few things for safety."
        : "Your plan already fits your training, nothing to change yet.",
      adapted: fb.length > 0,
    };
  }

  let finalPlan = safety.plan;
  if (changes.length && finalPlan.version === plan.version) {
    finalPlan = { ...finalPlan, version: nextVersion(plan.version) };
  }

  return {
    plan: finalPlan,
    changes,
    summary: buildSummary(changes, deloaded, adh),
    adapted: changes.length > 0,
  };
}

/** Deterministic 1-2 sentence overview from what actually changed. */
function buildSummary(changes, deloaded, adh) {
  if (!changes.length) return "Your plan already fits your training, nothing to change yet.";
  const parts = [];
  if (deloaded) parts.push("scheduled a lighter deload week to let you recover");
  else if (adh.behind) parts.push("eased the volume to match how much you've actually been training");
  parts.push("kept every change inside the same safety checks");
  return `Adapted from your logged training: ${parts.join(", ")}.`;
}
