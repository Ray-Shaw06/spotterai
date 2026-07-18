const DEFAULT_TIME = "18:00";
const DEFAULT_QUIET_HOURS = Object.freeze({ start: "22:00", end: "08:00" });
const DEFAULT_CATEGORIES = Object.freeze({
  workout: true,
  followUp: true,
  streak: true,
  recovery: true,
});
const CATEGORY_KEYS = Object.freeze(Object.keys(DEFAULT_CATEGORIES));
const WEEKDAY_PRESETS = Object.freeze({
  1: Object.freeze([1]),
  2: Object.freeze([1, 4]),
  3: Object.freeze([1, 3, 5]),
  4: Object.freeze([1, 2, 4, 5]),
  5: Object.freeze([1, 2, 3, 4, 5]),
  6: Object.freeze([1, 2, 3, 4, 5, 6]),
  7: Object.freeze([1, 2, 3, 4, 5, 6, 7]),
});
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isTime(value) {
  return typeof value === "string" && TIME_PATTERN.test(value);
}

function isTimeZone(value) {
  if (typeof value !== "string" || !value || /^[+-]/.test(value)) return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function defaultTimeZone() {
  return "UTC";
}

function normalizeSchedule(value) {
  if (!Array.isArray(value)) return [];

  const selected = new Map();
  for (const row of value) {
    if (!isRecord(row) || !hasOwn(row, "weekday") || !hasOwn(row, "time") || !Number.isInteger(row.weekday) || row.weekday < 1 || row.weekday > 7 || !isTime(row.time)) {
      continue;
    }
    if (!selected.has(row.weekday)) selected.set(row.weekday, { weekday: row.weekday, time: row.time });
  }

  return [...selected.values()].sort((left, right) => left.weekday - right.weekday).slice(0, 7);
}

function normalizeCategories(value) {
  const categories = {};
  for (const key of CATEGORY_KEYS) {
    categories[key] = isRecord(value) && hasOwn(value, key) && typeof value[key] === "boolean" ? value[key] : DEFAULT_CATEGORIES[key];
  }
  return categories;
}

function isValidSchedule(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 7) return false;
  const weekdays = new Set();
  return value.every((row) => {
    const valid = isRecord(row)
      && hasOwn(row, "weekday")
      && hasOwn(row, "time")
      && Number.isInteger(row.weekday)
      && row.weekday >= 1
      && row.weekday <= 7
      && isTime(row.time)
      && !weekdays.has(row.weekday);
    if (valid) weekdays.add(row.weekday);
    return valid;
  });
}

/**
 * Builds editable notification preferences from a plan's weekly frequency.
 */
export function prefillNotificationPreferences(daysPerWeek, timezone) {
  const weekdays = WEEKDAY_PRESETS[daysPerWeek] || WEEKDAY_PRESETS[3];
  return {
    timezone: isTimeZone(timezone) ? timezone : defaultTimeZone(),
    schedule: weekdays.map((weekday) => ({ weekday, time: DEFAULT_TIME })),
    quietHours: { ...DEFAULT_QUIET_HOURS },
    categories: { ...DEFAULT_CATEGORIES },
    paused: false,
  };
}

/**
 * Returns a fresh, allow-listed preference payload without personal or free-text data.
 */
export function normalizeNotificationPreferences(value) {
  const input = isRecord(value) ? value : {};
  const quietHours = hasOwn(input, "quietHours") && isRecord(input.quietHours) ? input.quietHours : {};

  return {
    timezone: hasOwn(input, "timezone") && isTimeZone(input.timezone) ? input.timezone : defaultTimeZone(),
    schedule: normalizeSchedule(hasOwn(input, "schedule") ? input.schedule : undefined),
    quietHours: {
      start: hasOwn(quietHours, "start") && isTime(quietHours.start) ? quietHours.start : DEFAULT_QUIET_HOURS.start,
      end: hasOwn(quietHours, "end") && isTime(quietHours.end) ? quietHours.end : DEFAULT_QUIET_HOURS.end,
    },
    categories: normalizeCategories(hasOwn(input, "categories") ? input.categories : undefined),
    paused: hasOwn(input, "paused") && typeof input.paused === "boolean" ? input.paused : false,
  };
}

/**
 * Validates a raw preference payload while returning its privacy-safe normalized form.
 */
export function validateNotificationPreferences(value) {
  const input = isRecord(value) ? value : {};
  const errors = {};

  if (!hasOwn(input, "timezone") || !isTimeZone(input.timezone)) errors.timezone = "Use a valid IANA time zone.";
  if (!hasOwn(input, "schedule") || !isValidSchedule(input.schedule)) errors.schedule = "Use one to seven unique weekdays with HH:mm times.";

  const quietHours = hasOwn(input, "quietHours") ? input.quietHours : undefined;
  if (!isRecord(quietHours) || !hasOwn(quietHours, "start") || !hasOwn(quietHours, "end") || !isTime(quietHours.start) || !isTime(quietHours.end)) {
    errors.quietHours = "Use HH:mm start and end quiet-hour times.";
  }

  const categories = hasOwn(input, "categories") ? input.categories : undefined;
  if (!isRecord(categories) || CATEGORY_KEYS.some((key) => !hasOwn(categories, key) || typeof categories[key] !== "boolean")) {
    errors.categories = "Set each notification category to true or false.";
  }

  if (!hasOwn(input, "paused") || typeof input.paused !== "boolean") errors.paused = "Set paused to true or false.";

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    value: normalizeNotificationPreferences(input),
  };
}

/** Returns a privacy-safe zone-only update, or null when no migration is needed. */
export function notificationTimezoneMigration(preferences, currentTimezone) {
  const current = validateNotificationPreferences(preferences);
  if (!current.valid || !isTimeZone(currentTimezone) || current.value.timezone === currentTimezone) return null;
  const next = { ...current.value, timezone: currentTimezone };
  return validateNotificationPreferences(next).valid ? next : null;
}
