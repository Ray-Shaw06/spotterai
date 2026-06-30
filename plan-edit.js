/**
 * SpotterAI — plan editing primitives (pure)
 * ============================================================================
 * Small, deterministic operations on a plan object: swap, remove, add and
 * retune exercises. Used by BOTH the plan-page editor and the coach's action
 * layer, so every edit funnels through the same code — and the caller always
 * re-audits afterwards (setPlan → evaluator), so safety can't be edited away.
 *
 * All functions deep-clone and return { plan, changed }. `day` may be an index,
 * a day label ("Day 2"), or a focus ("Upper Body"); null/omitted = all days.
 */

const clone = (o) => JSON.parse(JSON.stringify(o));
const norm = (s) => String(s == null ? "" : s).trim().toLowerCase();
const appendNote = (existing, note) => (existing ? `${existing} · ${note}` : note);

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

export function addExercise(plan, { name, day = null, sets = 3, reps = "8-12", rpe = 8 } = {}) {
  const p = clone(plan);
  if (!name) return { plan: p, changed: 0 };
  let di = findDayIndex(p, day);
  if (di < 0) di = 0; // default to the first day
  if (!p.days || !p.days[di]) return { plan: p, changed: 0 };
  p.days[di].exercises = p.days[di].exercises || [];
  p.days[di].exercises.push({ name: String(name), sets, reps: String(reps), rpe, notes: "added" });
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

const HANDLERS = {
  swap_exercise: (p, a) => swapExercise(p, { from: a.from, to: a.to, day: a.day }),
  remove_exercise: (p, a) => removeExercise(p, { name: a.name, day: a.day }),
  add_exercise: (p, a) => addExercise(p, { name: a.name, day: a.day, sets: a.sets, reps: a.reps, rpe: a.rpe }),
  retune_exercise: (p, a) => retuneExercise(p, { name: a.name, day: a.day, sets: a.sets, reps: a.reps, rpe: a.rpe }),
};

/** Apply one structured plan action (from the coach). Returns { plan, changed }. */
export function applyPlanAction(plan, action) {
  const h = action && HANDLERS[action.type];
  return h ? h(plan, action) : { plan: clone(plan), changed: 0 };
}

export const PLAN_ACTION_TYPES = Object.keys(HANDLERS);
