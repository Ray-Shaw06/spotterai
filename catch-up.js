/**
 * SpotterAI — catch-up (pure)
 * ============================================================================
 * What is still unlogged, today and yesterday.
 *
 * SpotterAI cannot remind you. The 2026-07-22 decision retired Web Push for a
 * genuinely $0 operator bill and set a hard rule: no promise of any
 * notification after the app is closed. That rule is not reopened here. So
 * instead of nagging harder, this makes forgetting cost nothing: the app tells
 * you what is open the moment you next open it, and every item is one tap from
 * done, including yesterday's.
 *
 * Pure and DOM-free, the same shape as today.js. `openItems` takes a plain
 * snapshot of numbers and returns rows; today-ui.js does the reading and the
 * rendering.
 *
 * TONE IS A REQUIREMENT, not decoration. Every string here says what is open,
 * never that you failed. The rest of the product already refuses to shame a
 * missed day (see `coachNote` and `weekTwoSuggestion`); a catch-up card is
 * exactly where that would be easiest to break.
 */

/** Hours-of-day before which an item is not yet "open". Nothing is late at 9am. */
export const OPEN_AFTER = {
  workout: 17, // an evening lifter has not missed anything at lunchtime
  nutrition: 13, // after a normal lunch
  bodyweight: 9,
};

/** A weigh-in is stale after this many days, not missed after one. */
export const BODYWEIGHT_STALE_DAYS = 7;

/** At most this many rows, so the card stays a nudge and not a chore list. */
export const MAX_ITEMS = 3;

/**
 * @param {object} snapshot
 * @param {number} snapshot.hour                  local hour, 0-23
 * @param {boolean} snapshot.hasPlan
 * @param {boolean} snapshot.trainingDayDue       today is a training slot in the rotation
 * @param {number} snapshot.workoutsToday
 * @param {number} snapshot.nutritionToday        entry count, not calories
 * @param {number} snapshot.workoutsYesterday
 * @param {number} snapshot.nutritionYesterday
 * @param {number|null} snapshot.daysSinceBodyweight  null when never logged
 * @returns {Array<{id,label,hint,act,scope}>}
 */
export function openItems(snapshot = {}) {
  const {
    hour = 0,
    hasPlan = false,
    trainingDayDue = false,
    workoutsToday = 0,
    nutritionToday = 0,
    workoutsYesterday = 0,
    nutritionYesterday = 0,
    daysSinceBodyweight = null,
  } = snapshot;

  const items = [];

  if (hasPlan && trainingDayDue && workoutsToday === 0 && hour >= OPEN_AFTER.workout) {
    items.push({
      id: "workout",
      label: "Today's session isn't logged yet",
      hint: "Start it now, or log it after the fact if you already trained.",
      act: "start",
      scope: "today",
    });
  }

  if (nutritionToday === 0 && hour >= OPEN_AFTER.nutrition) {
    items.push({
      id: "nutrition",
      label: "No food logged today",
      hint: "Type or say what you ate, one line is enough.",
      act: "meal",
      scope: "today",
    });
  }

  const stale = daysSinceBodyweight === null || daysSinceBodyweight >= BODYWEIGHT_STALE_DAYS;
  if (stale && hour >= OPEN_AFTER.bodyweight) {
    items.push({
      id: "bodyweight",
      label: daysSinceBodyweight === null ? "No bodyweight on record" : `Last weigh-in was ${daysSinceBodyweight} days ago`,
      hint: "One number, and the nutrition targets stay honest.",
      act: "weight",
      scope: "today",
    });
  }

  // Yesterday only counts as empty when BOTH are empty. A rest day with meals
  // logged is a normal day, not a gap, and calling it one would be the shaming
  // this card exists to avoid.
  if (workoutsYesterday === 0 && nutritionYesterday === 0) {
    items.push({
      id: "yesterday",
      label: "Yesterday has nothing logged",
      hint: "You can still add it. Backdated entries count the same.",
      act: "backfill",
      scope: "yesterday",
    });
  }

  return items.slice(0, MAX_ITEMS);
}

/**
 * One line above the rows. Deliberately flat: it reports a count, it does not
 * grade you for it.
 */
export function catchUpSummary(items = []) {
  if (!items.length) return "";
  if (items.length === 1) return "One thing still open.";
  return `${items.length} things still open.`;
}
