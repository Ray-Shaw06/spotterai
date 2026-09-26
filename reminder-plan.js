/**
 * SpotterAI — which reminders this device wants booked
 * ============================================================================
 * Pure: plain data in, a sorted list out. No DOM, storage, network or clock of
 * its own, so every rule runs under node --test. reminders-sync.js compares
 * this list with what is already booked and books or cancels the difference.
 *
 * The rules (docs/superpowers/specs/2026-09-25-reminders-design.md):
 *   workout  18:00, every `gap` days after the last workout, up to 7 days out
 *   meals    breakfast/lunch/dinner at the person's times, today + 2 days,
 *            skipping a slot already logged today
 *   water    every 3 hours from the last log (from 10:00 if none today), until
 *            21:00 or the day's target; 10/13/16/19:00 on the next 2 days
 *
 * All times are the device's local time; the server only ever sees instants.
 */

export const MEAL_SLOTS = Object.freeze(["breakfast", "lunch", "dinner"]);
export const DEFAULT_MEAL_TIMES = Object.freeze({ breakfast: "08:30", lunch: "12:30", dinner: "18:30" });

const WORKOUT_TIME = "18:00";
const WATER_FIRST = "10:00";
const WATER_LAST = "21:00";
const WATER_EVERY_MS = 3 * 3600 * 1000;
const WATER_FUTURE_TIMES = Object.freeze(["10:00", "13:00", "16:00", "19:00"]);
/** Meal and water reminders: today plus the next 2 days. */
const DAY_HORIZON = 3;
/** Workout nudges: QStash's 7-day limit, less an hour for clock drift. */
const WORKOUT_HORIZON_MS = 7 * 24 * 3600 * 1000 - 3600 * 1000;
/** Closer than this and the booking round trip could outrun the reminder. */
const MIN_LEAD_MS = 60 * 1000;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const pad = (n) => String(n).padStart(2, "0");

/** Local "YYYY-MM-DD" for a Date. */
export function ymd(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local Date for "YYYY-MM-DD" at "HH:MM". Invalid input gives an Invalid Date. */
function atLocal(dateStr, hhmm) {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  const [h, min] = String(hhmm).split(":").map(Number);
  return new Date(y, m - 1, d, h, min, 0, 0);
}

function addDays(dateStr, n) {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  return ymd(new Date(y, m - 1, d + n));
}

function keyOf(kind, detail, date) {
  return `${kind}:${detail}:${ymd(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Days without a workout before a nudge: from the plan's days per week, 3 without a plan. */
export function workoutGapDays(plan) {
  const perWeek = Number(plan?.days_per_week) || (Array.isArray(plan?.days) ? plan.days.length : 0);
  if (!perWeek) return 3;
  return Math.min(7, Math.max(2, Math.ceil(7 / perWeek)));
}

/**
 * @param {object} input
 * @param {number} input.now                 epoch ms
 * @param {{workout:boolean, meals:boolean, water:boolean}} input.enabled
 * @param {object} [input.mealTimes]         { breakfast: "HH:MM", lunch, dinner }
 * @param {object|null} [input.plan]         the generated plan, for days per week
 * @param {Array<{date:string}>} [input.workouts]
 * @param {Array<{date:string, meal:string}>} [input.nutrition]
 * @param {Object<string, number>} [input.water]   { "YYYY-MM-DD": ml }
 * @param {number} [input.waterTargetMl]
 * @param {number|null} [input.lastWaterAt]  epoch ms of the last water log this device saw
 * @param {number|null} [input.enabledAt]    epoch ms reminders were first turned on
 * @returns {Array<{key:string, kind:string, detail:string, at:number}>} sorted by time
 */
export function plannedReminders(input) {
  const now = Number(input.now);
  const today = ymd(new Date(now));
  const out = [];
  const add = (kind, detail, date) => {
    const at = date.getTime();
    if (!Number.isFinite(at) || at - now < MIN_LEAD_MS) return;
    out.push({ key: keyOf(kind, detail, date), kind, detail, at });
  };
  if (input.enabled?.workout) workoutNudges(input, now, add);
  if (input.enabled?.meals) mealReminders(input, today, add);
  if (input.enabled?.water) waterReminders(input, today, add);
  return out.sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
}

function workoutNudges({ plan, workouts, enabledAt }, now, add) {
  const gap = workoutGapDays(plan);
  const latest = (workouts || []).reduce((max, w) => (typeof w?.date === "string" && w.date > max ? w.date : max), "");
  const base = latest || ymd(new Date(Number(enabledAt) || now));
  // Bounded: a base years in the past walks forward at most a few hundred steps.
  for (let n = 1; n <= 1000; n++) {
    const when = atLocal(addDays(base, n * gap), WORKOUT_TIME);
    const t = when.getTime();
    if (!Number.isFinite(t) || t - now > WORKOUT_HORIZON_MS) break;
    add("workout", "", when);
  }
}

function mealReminders({ mealTimes, nutrition }, today, add) {
  const times = { ...DEFAULT_MEAL_TIMES };
  for (const slot of MEAL_SLOTS) {
    if (TIME.test(mealTimes?.[slot] || "")) times[slot] = mealTimes[slot];
  }
  const loggedToday = new Set((nutrition || []).filter((e) => e?.date === today).map((e) => e.meal));
  for (let d = 0; d < DAY_HORIZON; d++) {
    const date = addDays(today, d);
    for (const slot of MEAL_SLOTS) {
      if (d === 0 && loggedToday.has(slot)) continue;
      add("meal", slot, atLocal(date, times[slot]));
    }
  }
}

function waterReminders({ water, waterTargetMl, lastWaterAt }, today, add) {
  const target = Number(waterTargetMl) || 0;
  const reachedTarget = target > 0 && (Number(water?.[today]) || 0) >= target;
  if (!reachedTarget) {
    const last = Number(lastWaterAt);
    const loggedToday = Number.isFinite(last) && last > 0 && ymd(new Date(last)) === today;
    // Rounded up to the minute so the key, and the booking, sit on a clean time.
    const sinceLog = loggedToday ? Math.ceil((last + WATER_EVERY_MS) / 60_000) * 60_000 : 0;
    const end = atLocal(today, WATER_LAST).getTime();
    for (let t = Math.max(atLocal(today, WATER_FIRST).getTime(), sinceLog); t <= end; t += WATER_EVERY_MS) {
      add("water", "", new Date(t));
    }
  }
  for (let d = 1; d < DAY_HORIZON; d++) {
    const date = addDays(today, d);
    for (const hhmm of WATER_FUTURE_TIMES) add("water", "", atLocal(date, hhmm));
  }
}
