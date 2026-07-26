import test from "node:test";
import assert from "node:assert/strict";

import {
  buildWorkoutCalendar,
  escapeICSText,
  foldICSLine,
  formatFloatingLocal,
  formatUTCStamp,
  reminderBucket,
  CalendarInputError,
} from "../calendar-export.js";

const NOW = new Date("2026-07-22T10:00:00Z");

function samplePlan() {
  return {
    days: [
      { day: "Day 1", focus: "Upper Body", exercises: [{ name: "Barbell Bench Press", sets: 4, reps: "6-8" }] },
      { day: "Rest", focus: "Recovery walk" }, // filtered by trainingDays()
      { day: "Day 2", focus: "Lower Body", exercises: [{ name: "Back Squat", sets: 5, reps: 5 }] },
    ],
  };
}

test("escapeICSText escapes backslash, comma, semicolon, and newline", () => {
  assert.equal(escapeICSText("a,b;c\\d\ne"), "a\\,b\\;c\\\\d\\ne");
});

test("foldICSLine folds long lines to <=75 octets with CRLF + space continuation", () => {
  const long = "SUMMARY:" + "x".repeat(200);
  const folded = foldICSLine(long);
  for (const segment of folded.split("\r\n")) {
    assert.ok(segment.length <= 75, `segment too long: ${segment.length}`);
  }
  assert.ok(folded.includes("\r\n "), "continuation lines must start with a space");
});

test("floating local time has no zone marker; the DTSTAMP is UTC", () => {
  assert.match(formatFloatingLocal(new Date(2026, 6, 22, 18, 30, 0)), /^20260722T183000$/);
  assert.match(formatUTCStamp(NOW), /^20260722T100000Z$/);
});

test("one weekly-recurring event per training day; rest days are excluded", () => {
  const ics = buildWorkoutCalendar({ plan: samplePlan(), startDate: "2026-07-22", time: "18:00", reminderMinutes: 0, now: NOW });
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.equal((ics.match(/RRULE:FREQ=WEEKLY/g) || []).length, 2);
  assert.match(ics, /SUMMARY:SpotterAI: Upper Body/);
  assert.match(ics, /SUMMARY:SpotterAI: Lower Body/);
  assert.doesNotMatch(ics, /Recovery walk/); // rest day never exported
  // CRLF line endings and a proper envelope.
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n"));
  assert.ok(ics.trimEnd().endsWith("END:VCALENDAR"));
});

test("consecutive training days start on consecutive dates from the start date", () => {
  const ics = buildWorkoutCalendar({ plan: samplePlan(), startDate: "2026-07-22", time: "18:00", now: NOW });
  assert.match(ics, /DTSTART:20260722T180000/); // Day 1
  assert.match(ics, /DTSTART:20260723T180000/); // Day 2 (next day)
});

test("exercise details are escaped and included; no other plan data leaks", () => {
  const plan = { days: [{ day: "Day 1", focus: "Push, Pull", exercises: [{ name: "Curl, Barbell", sets: 3, reps: 10 }] }] };
  const ics = buildWorkoutCalendar({ plan, startDate: "2026-07-22", time: "07:15", now: NOW });
  assert.match(ics, /SUMMARY:SpotterAI: Push\\, Pull/);
  assert.match(ics, /DESCRIPTION:Curl\\, Barbell - 3×10/);
});

test("a reminder adds a VALARM with the right offset; none omits it", () => {
  const withAlarm = buildWorkoutCalendar({ plan: samplePlan(), startDate: "2026-07-22", time: "18:00", reminderMinutes: 30, now: NOW });
  assert.match(withAlarm, /BEGIN:VALARM/);
  assert.match(withAlarm, /TRIGGER:-PT30M/);
  const noAlarm = buildWorkoutCalendar({ plan: samplePlan(), startDate: "2026-07-22", time: "18:00", reminderMinutes: 0, now: NOW });
  assert.doesNotMatch(noAlarm, /VALARM/);
});

test("UIDs are stable and local-only for the same start date", () => {
  const opts = { plan: samplePlan(), startDate: "2026-07-22", time: "18:00", now: NOW };
  const a = buildWorkoutCalendar(opts);
  const b = buildWorkoutCalendar(opts);
  assert.equal(a, b);
  assert.match(a, /UID:spotterai-20260722-0@local/);
  assert.match(a, /UID:spotterai-20260722-1@local/);
});

test("invalid input throws a typed CalendarInputError naming the field", () => {
  const plan = samplePlan();
  assert.throws(() => buildWorkoutCalendar({ plan, startDate: "2026-07-22", time: "6pm" }), (e) => e instanceof CalendarInputError && e.field === "time");
  assert.throws(() => buildWorkoutCalendar({ plan, startDate: "nope", time: "18:00" }), (e) => e.field === "startDate");
  assert.throws(() => buildWorkoutCalendar({ plan, startDate: "2026-07-22", time: "18:00", reminderMinutes: 45 }), (e) => e.field === "reminderMinutes");
  assert.throws(() => buildWorkoutCalendar({ plan: { days: [{ day: "Rest", focus: "off day" }] }, startDate: "2026-07-22", time: "18:00" }), (e) => e.field === "plan");
});

test("reminderBucket only reports allow-listed values", () => {
  assert.equal(reminderBucket(30), "30");
  assert.equal(reminderBucket(45), "invalid");
});
