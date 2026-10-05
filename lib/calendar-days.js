/**
 * Calendar arithmetic on 'YYYY-MM-DD' strings, independent of timezone and DST.
 *
 * The Y-M-D parts go through Date.UTC and come back out through the UTC getters,
 * so no offset and no clock change can move a date. Parsing "YYYY-MM-DD" with
 * `new Date()` (UTC) or rounding a local-noon timestamp each put some day in the
 * wrong place at some offset: the 2026-08-14 lesson, and the streak module's own
 * first draft, which passed only west of UTC and failed CI.
 */

const DAY_MS = 86400000;

/** Whole days since 1970-01-01 for a 'YYYY-MM-DD' date. */
export function dayNumber(ymd) {
  const [y, m, d] = String(ymd).split("-").map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

/** The 'YYYY-MM-DD' date for a day number. */
export function ymdFromNumber(n) {
  const d = new Date(n * DAY_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** `ymd` shifted by `n` days (negative goes back). */
export function addDays(ymd, n) {
  return ymdFromNumber(dayNumber(ymd) + n);
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekdayOf(ymd) {
  return new Date(dayNumber(ymd) * DAY_MS).getUTCDay();
}
