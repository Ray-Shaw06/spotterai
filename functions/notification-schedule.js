import { DateTime, IANAZone } from "luxon";

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const PAYLOADS = Object.freeze({
  workout: Object.freeze({
    title: "Your SpotterAI workout is ready",
    body: "Your planned session is waiting when you're ready.",
    url: "/#/today",
  }),
  follow_up: Object.freeze({
    title: "Still planning to train?",
    body: "You can start now, reschedule, or take the recovery day you need.",
    url: "/#/today",
  }),
  streak: Object.freeze({
    title: "Keep your training rhythm",
    body: "A planned session is still open today—train, reschedule, or recover without guilt.",
    url: "/#/today",
  }),
  recovery: Object.freeze({
    title: "Quick recovery check-in",
    body: "How are you feeling after your last session? Adjust today if anything hurts.",
    url: "/#/today",
  }),
});

function asMillis(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getTime();
  if (value && typeof value.toMillis === "function") {
    const result = value.toMillis();
    return Number.isFinite(result) ? result : null;
  }
  if (value && typeof value.toDate === "function") {
    const result = value.toDate();
    return result instanceof Date && !Number.isNaN(result.getTime()) ? result.getTime() : null;
  }
  return null;
}

function timeParts(value) {
  if (typeof value !== "string" || !TIME_PATTERN.test(value)) return null;
  const [hour, minute] = value.split(":").map(Number);
  return { hour, minute, total: hour * 60 + minute };
}

function localTime(date, time, zone) {
  const parts = timeParts(time);
  if (!parts) return DateTime.invalid("invalid time");
  return DateTime.fromObject({
    year: date.year,
    month: date.month,
    day: date.day,
    hour: parts.hour,
    minute: parts.minute,
    second: 0,
    millisecond: 0,
  }, { zone });
}

function afterQuietHours(candidate, quietHours, zone) {
  const start = timeParts(quietHours.start);
  const end = timeParts(quietHours.end);
  if (!start || !end || start.total === end.total) return candidate;

  const total = candidate.hour * 60 + candidate.minute;
  const crossesMidnight = start.total > end.total;
  const inside = crossesMidnight
    ? total >= start.total || total < end.total
    : total >= start.total && total < end.total;
  if (!inside) return candidate;

  const deliveryDate = crossesMidnight && total >= start.total
    ? candidate.plus({ days: 1 })
    : candidate;
  return localTime(deliveryDate, quietHours.end, zone);
}

function validDate(value, zone) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return null;
  const parsed = DateTime.fromISO(value, { zone });
  return parsed.isValid && parsed.toISODate() === value ? parsed.startOf("day") : null;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected) {
  return isRecord(value)
    && Object.keys(value).length === expected.length
    && expected.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function payload(category) {
  return {
    ...PAYLOADS[category],
    category,
    tag: `spotterai-${category}`,
    icon: "/icons/spotterai-192.png",
  };
}

export function isValidNotificationRecord(record) {
  if (!isRecord(record)) return false;
  if (typeof record.enabled !== "boolean" || typeof record.paused !== "boolean") return false;
  if (typeof record.timezone !== "string" || !IANAZone.isValidZone(record.timezone)) return false;
  if (!Array.isArray(record.schedule) || record.schedule.length < 1 || record.schedule.length > 7) return false;
  if (!record.schedule.every((row) => row
    && exactKeys(row, ["weekday", "time"])
    && Number.isInteger(row.weekday)
    && row.weekday >= 1
    && row.weekday <= 7
    && timeParts(row.time))) return false;
  if (new Set(record.schedule.map((row) => row.weekday)).size !== record.schedule.length) return false;
  if (!exactKeys(record.quietHours, ["start", "end"])
    || !timeParts(record.quietHours.start)
    || !timeParts(record.quietHours.end)) return false;
  const categoryKeys = ["workout", "followUp", "streak", "recovery"];
  if (!exactKeys(record.categories, categoryKeys)
    || !categoryKeys.every((category) => typeof record.categories[category] === "boolean")) return false;
  if (record.lastWorkoutCompletionDate !== null
    && !validDate(record.lastWorkoutCompletionDate, record.timezone)) return false;
  if (!Number.isSafeInteger(record.dailyDeliveryCount)
    || record.dailyDeliveryCount < 0
    || record.dailyDeliveryCount > 2) return false;
  if (record.dailyDeliveryDate === null) {
    if (record.dailyDeliveryCount !== 0) return false;
  } else if (!validDate(record.dailyDeliveryDate, record.timezone) || record.dailyDeliveryCount < 1) {
    return false;
  }
  if (!isRecord(record.lastSentByCategory)) return false;
  const sentEntries = Object.entries(record.lastSentByCategory);
  return sentEntries.every(([category, localDate]) => categoryKeys
    .map((key) => key === "followUp" ? "follow_up" : key)
    .includes(category) && Boolean(validDate(localDate, record.timezone)));
}

export function nextNotification(record, now) {
  const nowMillis = asMillis(now);
  if (nowMillis === null
    || !isValidNotificationRecord(record)
    || record.enabled !== true
    || record.paused !== false) return null;

  const localNow = DateTime.fromMillis(nowMillis, { zone: record.timezone });
  if (!localNow.isValid) return null;
  const today = localNow.toISODate();
  if (record.dailyDeliveryDate === today
    && Number.isFinite(record.dailyDeliveryCount)
    && record.dailyDeliveryCount >= 2) return null;

  const candidates = [];
  const completionDate = validDate(record.lastWorkoutCompletionDate, record.timezone);
  for (const row of record.schedule) {
    const daysUntil = (row.weekday - localNow.weekday + 7) % 7;
    for (const offset of [daysUntil - 7, daysUntil, daysUntil + 7]) {
      const eventDate = localNow.startOf("day").plus({ days: offset });
      const localDate = eventDate.toISODate();
      if (completionDate?.toISODate() === localDate) continue;

      const workout = localTime(eventDate, row.time, record.timezone);
      if (!workout.isValid) continue;
      const shiftedWorkout = afterQuietHours(workout, record.quietHours, record.timezone);
      if (record.categories.workout && (offset >= 0 || shiftedWorkout.toISODate() === today)) {
        candidates.push({ category: "workout", at: shiftedWorkout, localDate });
      }

      const previousDate = eventDate.minus({ days: 1 }).toISODate();
      const followCategory = completionDate?.toISODate() === previousDate ? "streak" : "follow_up";
      const followEnabled = followCategory === "streak" ? record.categories.streak : record.categories.followUp;
      const shiftedFollow = afterQuietHours(workout.plus({ hours: 2 }), record.quietHours, record.timezone);
      if (followEnabled && (offset >= 0 || shiftedFollow.toISODate() === today)) {
        candidates.push({
          category: followCategory,
          at: shiftedFollow,
          localDate,
        });
      }
    }
  }

  if (record.categories.recovery && completionDate) {
    const recoveryDate = completionDate.plus({ days: 1 });
    if (recoveryDate >= localNow.startOf("day")) {
      const recovery = localTime(recoveryDate, "08:30", record.timezone);
      if (recovery.isValid) {
        candidates.push({
          category: "recovery",
          at: afterQuietHours(recovery, record.quietHours, record.timezone),
          localDate: recoveryDate.toISODate(),
        });
      }
    }
  }

  candidates.sort((left, right) => left.at.toMillis() - right.at.toMillis());
  const selected = candidates.find((candidate) => candidate.at.isValid
    && record.lastSentByCategory?.[candidate.category] !== candidate.localDate);
  if (!selected) return null;

  return {
    category: selected.category,
    dueAt: selected.at.toMillis(),
    localDate: selected.localDate,
    payload: payload(selected.category),
  };
}

export { PAYLOADS };
