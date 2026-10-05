/**
 * SpotterAI — welcome back (pure)
 * ============================================================================
 * What to do when you open the app after a long gap between workouts.
 *
 * Illness, travel and life drop whole weeks. Coming back at the old loads is
 * the usual way to get hurt, and treating the gap as a failure is the usual
 * way to quit. So the plan offers to ease you back in: trim working sets and
 * hold off adding weight until a few sessions have rebuilt the base. This
 * module decides WHEN that is on offer and what the card says. The easing
 * itself is a transform in adapt-engine.js, so it runs through the same safety
 * close and the same no-new-flags invariant as every other adaptation.
 *
 * The thresholds are defaults chosen for this app, not figures from research.
 * They are named constants so the rule reads in one place and a test pins it.
 *
 * Same shape as catch-up.js: the app PROPOSES, you approve. Nothing here edits
 * a plan, and TONE IS A REQUIREMENT: every string says what is on offer, never
 * that you let something slip.
 */

/** A gap this long is more than a normal week off. */
export const RAMP_MIN_DAYS = 10;

/** From here the gap gets the deeper easing. */
export const DEEP_RAMP_DAYS = 21;

/** Fewer logged workouts than this and there is no base to ease back toward. */
export const MIN_WORKOUTS = 3;

/** Share of working sets trimmed per level. */
export const RAMP_CUT = Object.freeze({ light: 0.25, deep: 0.4 });

export const HANDLED_KEY = "spotterai.welcomeBack.handled";

/** "light", "deep", or null when this gap does not call for easing. */
export function rampLevel(gapDays, workoutsLogged) {
  const gap = Number(gapDays);
  if (!Number.isFinite(gap) || gap < RAMP_MIN_DAYS) return null;
  if (!(Number(workoutsLogged) >= MIN_WORKOUTS)) return null;
  return gap >= DEEP_RAMP_DAYS ? "deep" : "light";
}

/**
 * The Today card, or null when there is nothing to offer.
 * @param {object} snapshot
 * @param {number|null} snapshot.gapDays          whole days since the last logged workout
 * @param {number} snapshot.workoutsLogged
 * @param {boolean} [snapshot.handled]            already applied or dismissed for this gap
 */
export function welcomeBack({ gapDays, workoutsLogged, handled = false } = {}) {
  if (handled) return null;
  const level = rampLevel(gapDays, workoutsLogged);
  if (!level) return null;
  const days = Math.round(Number(gapDays));
  return {
    level,
    gapDays: days,
    title: `Back after ${days} days`,
    body:
      level === "deep"
        ? "That was a long stretch away. Want to ease back in? This trims about 40% of your working sets and holds off adding weight, so your first sessions rebuild the base instead of resuming where you left off."
        : "Want to ease back in? This trims about a quarter of your working sets and holds off adding weight, so your first sessions rebuild instead of resuming where you left off.",
    cta: "Ease me back in",
    dismiss: "Not now",
  };
}

/** The last-workout date this device already handled (applied or dismissed), or null. */
export function handledGap(env = globalThis) {
  try {
    return env.localStorage?.getItem(HANDLED_KEY) || null;
  } catch {
    return null; // storage can throw outright in locked-down contexts
  }
}

/** Remember that the gap ending at `lastWorkoutDate` has been dealt with. A new
 *  workout moves the date, so the next long gap is a fresh offer. */
export function markGapHandled(lastWorkoutDate, env = globalThis) {
  try {
    if (lastWorkoutDate) env.localStorage?.setItem(HANDLED_KEY, String(lastWorkoutDate));
  } catch {
    /* storage disabled; the offer simply shows again next visit */
  }
}
