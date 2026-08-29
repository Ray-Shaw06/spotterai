/**
 * SpotterAI — plan editing primitives (pure)
 * ============================================================================
 * Small, deterministic operations on a plan object: swap, remove, add and
 * retune exercises, plus re-focus a whole day. Used by BOTH the plan-page editor
 * and the coach's action layer, so every edit funnels through the same code —
 * and the caller always re-audits afterwards (setPlan → evaluator), so safety
 * can't be edited away.
 *
 * All functions deep-clone and return { plan, changed }. `day` may be an index,
 * a day label ("Day 2"), or a focus ("Upper Body"); null/omitted = all days.
 */

import { resolveExercise, isTimeBasedExercise } from "./exercise-catalog.js";
import { isCardioEntry, cardioMinutes } from "./lib/plan.js";

const clone = (o) => JSON.parse(JSON.stringify(o));
const norm = (s) => String(s == null ? "" : s).trim().toLowerCase();
const appendNote = (existing, note) => (existing ? `${existing} · ${note}` : note);

/**
 * Are these two names the same exercise? Goes through the catalog resolver, so
 * "Face Pull" and "face pulls" match. Falls back to a normalized string compare
 * for custom exercises the catalog has never heard of.
 */
function isSameExercise(a, b) {
  if (!a || !b) return false;
  if (norm(a) === norm(b)) return true;
  const ra = resolveExercise(a);
  const rb = resolveExercise(b);
  return Boolean(ra && rb && ra.name === rb.name);
}

/** Mirrors repair.js's rest-day test. A focus label reading as rest is not
 *  cosmetic: repair.js and the evaluator count training days from this text. */
const READS_AS_REST = /\b(rest|recovery|off day|day off)\b/;

export function findDayIndex(plan, day) {
  const days = (plan && plan.days) || [];
  if (day == null || day === "") return -1;
  if (typeof day === "number") return day >= 0 && day < days.length ? day : -1;
  const d = norm(day);
  let i = days.findIndex((x) => norm(x.day) === d || norm(x.focus) === d);
  if (i < 0) i = days.findIndex((x) => norm(`${x.day} ${x.focus}`).includes(d) || norm(x.focus).includes(d));
  return i;
}

export function swapExercise(plan, { from, to, day = null } = {}) {
  const p = clone(plan);
  if (!to || !from) return { plan: p, changed: 0 };
  const di = findDayIndex(p, day);
  let changed = 0;
  (p.days || []).forEach((d, i) => {
    if (di >= 0 && i !== di) return;
    for (const ex of d.exercises || []) {
      if (norm(ex.name) === norm(from)) {
        ex.name = String(to);
        ex.notes = appendNote(ex.notes, "edited");
        changed++;
      }
    }
  });
  return { plan: p, changed };
}

export function removeExercise(plan, { name, day = null } = {}) {
  const p = clone(plan);
  if (!name) return { plan: p, changed: 0 };
  const di = findDayIndex(p, day);
  let changed = 0;
  (p.days || []).forEach((d, i) => {
    if (di >= 0 && i !== di) return;
    const before = (d.exercises || []).length;
    d.exercises = (d.exercises || []).filter((ex) => norm(ex.name) !== norm(name));
    changed += before - d.exercises.length;
  });
  return { plan: p, changed };
}

export function addExercise(plan, { name, day = null, sets, reps, rpe = 8 } = {}) {
  const p = clone(plan);
  if (!name) return { plan: p, changed: 0 };
  let di = findDayIndex(p, day);
  if (di < 0) di = 0; // default to the first day
  if (!p.days || !p.days[di]) return { plan: p, changed: 0 };
  p.days[di].exercises = p.days[di].exercises || [];

  // Refuse a lift the day already has. The coach asked to add Plank to a day
  // that already had one and nothing stopped it, so the plan ended up listing
  // the same movement twice. Matching goes through the catalog resolver, so
  // "Face Pull" and "face pulls" are recognised as the same exercise.
  const already = p.days[di].exercises.some((ex) => isSameExercise(ex?.name, name));
  if (already) return { plan: p, changed: 0, reason: `${String(name)} is already on ${p.days[di].label || "that day"}` };

  // Isometric holds and loaded carries are prescribed in SECONDS. Defaulting
  // everything to "8-12" produced prescriptions like "Plank 3 x 8-12 @ RPE 8".
  // The plan schema already allows "30s" and the evaluator already parses it.
  const timed = isTimeBasedExercise(name);
  const finalSets = sets ?? (timed ? 3 : 3);
  const finalReps = reps ?? (timed ? "30s" : "8-12");

  p.days[di].exercises.push({ name: String(name), sets: finalSets, reps: String(finalReps), rpe, notes: "added" });
  return { plan: p, changed: 1 };
}

/** Retune sets/reps/rpe of a named exercise (used by inline edits + the coach). */
export function retuneExercise(plan, { name, day = null, sets, reps, rpe } = {}) {
  const p = clone(plan);
  if (!name) return { plan: p, changed: 0 };
  const di = findDayIndex(p, day);
  let changed = 0;
  (p.days || []).forEach((d, i) => {
    if (di >= 0 && i !== di) return;
    for (const ex of d.exercises || []) {
      if (norm(ex.name) !== norm(name)) continue;
      if (sets != null && sets !== "") ex.sets = Number(sets) || ex.sets;
      if (reps != null && reps !== "") ex.reps = String(reps);
      if (rpe != null && rpe !== "") ex.rpe = Number(rpe);
      changed++;
    }
  });
  return { plan: p, changed };
}

/**
 * Re-focus a whole day: change its label, its exercise list, or both in one
 * atomic edit. This is the "I don't want a full body day, give me upper"
 * primitive — the exercise-level ops above can rewrite every movement in a day
 * but can't touch `focus`, which is the heading the plan, workout picker and
 * Today card all render, so the day kept reading "Full Body" after the swap.
 *
 * Unlike the other primitives this always targets exactly one day (a plan-wide
 * relabel is never what the user means), and it refuses to relabel a day that
 * still has work in it as rest — see READS_AS_REST.
 */
export function replaceDay(plan, { day = null, focus, exercises } = {}) {
  const p = clone(plan);
  const di = findDayIndex(p, day);
  if (di < 0 || !p.days || !p.days[di]) return { plan: p, changed: 0 };
  const target = p.days[di];

  const nextFocus = focus == null ? "" : String(focus).trim();
  const list = Array.isArray(exercises)
    ? exercises.filter((e) => e && String(e.name || "").trim())
    : null;
  const wantsExercises = Array.isArray(exercises) && list.length > 0;
  if (!nextFocus && !wantsExercises) return { plan: p, changed: 0 };

  // Guardrail: a day that still holds working sets must not be labelled rest.
  const keptWork = wantsExercises ? list.length : (target.exercises || []).length;
  if (nextFocus && READS_AS_REST.test(norm(nextFocus)) && keptWork > 0) {
    return { plan: p, changed: 0 };
  }

  if (nextFocus) target.focus = nextFocus;
  if (wantsExercises) {
    // Cardio has to survive the rebuild. This used to hard-code the lifting
    // field set, so re-focusing a day turned a 35 minute easy run into
    // "3 sets of 8-12" with its duration and intensity gone, and the
    // cardio/leg-day conflict check lost the intensity it reads.
    target.exercises = list.map((e) => {
      const cardio = isCardioEntry(e);
      const base = {
        name: String(e.name).trim(),
        sets: Number(e.sets) > 0 ? Number(e.sets) : cardio ? 1 : 3,
        reps: e.reps == null || e.reps === "" ? (cardio ? "" : "8-12") : String(e.reps),
        rpe: cardio ? null : Number(e.rpe) > 0 ? Number(e.rpe) : 8,
        notes: e.notes ? String(e.notes) : "edited",
      };
      if (!cardio) return base;
      const minutes = cardioMinutes(e);
      return {
        ...base,
        reps: base.reps || (minutes ? `${minutes} min` : ""),
        type: "cardio",
        durationMin: minutes || null,
        intensity: e.intensity || null,
      };
    });
  }
  return { plan: p, changed: 1 };
}

const HANDLERS = {
  swap_exercise: (p, a) => swapExercise(p, { from: a.from, to: a.to, day: a.day }),
  remove_exercise: (p, a) => removeExercise(p, { name: a.name, day: a.day }),
  add_exercise: (p, a) => addExercise(p, { name: a.name, day: a.day, sets: a.sets, reps: a.reps, rpe: a.rpe }),
  retune_exercise: (p, a) => retuneExercise(p, { name: a.name, day: a.day, sets: a.sets, reps: a.reps, rpe: a.rpe }),
  replace_day: (p, a) => replaceDay(p, { day: a.day, focus: a.focus, exercises: a.exercises }),
};

/** Apply one structured plan action (from the coach). Returns { plan, changed }. */
export function applyPlanAction(plan, action) {
  const h = action && HANDLERS[action.type];
  return h ? h(plan, action) : { plan: clone(plan), changed: 0 };
}

export const PLAN_ACTION_TYPES = Object.keys(HANDLERS);
