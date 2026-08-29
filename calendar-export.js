/**
 * SpotterAI — calendar export (zero-cost, fully on-device)
 * ============================================================================
 * Turns a generated plan's training days into a standards-compliant iCalendar
 * (.ics) file the user downloads and imports into their own calendar app. From
 * then on, the user's calendar owns the reminders and edits — SpotterAI sends
 * nothing, stores nothing, and never learns whether an event was imported.
 *
 * The generation functions below are pure: no DOM, storage, network, Firebase,
 * or analytics. `initCalendarExport()` wires the download dialog to the plan
 * results view.
 *
 * Privacy: event text is limited to the plan's own training-day focus and its
 * exercise names/sets/reps — content already visible on the plan page. It never
 * includes injuries, measurements, health notes, account identifiers, or any AI
 * prompt/response text.
 */
import { trainingDays } from "./today.js";
import { isCardioEntry, cardioMinutes } from "./lib/plan.js";

export class CalendarInputError extends Error {
  constructor(field, message) {
    super(message);
    this.name = "CalendarInputError";
    this.field = field;
  }
}

export const REMINDER_CHOICES = Object.freeze([0, 10, 30, 60]);
const EVENT_DURATION_MIN = 60;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/** RFC 5545 text escaping: backslash, semicolon, comma, and newlines. */
export function escapeICSText(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Fold a content line to <=75 octets with CRLF + single-space continuation. */
export function foldICSLine(line) {
  if (line.length <= 75) return line;
  const out = [];
  let current = "";
  for (const ch of line) {
    // A continuation line is prefixed by one space, so keep segments <=74 here.
    if ((current + ch).length > 74) {
      out.push(current);
      current = " " + ch; // leading space marks the fold
    } else {
      current += ch;
    }
  }
  if (current) out.push(current);
  return out.join("\r\n");
}

function pad(n) {
  return String(n).padStart(2, "0");
}

/** Floating local date-time: YYYYMMDDTHHMMSS (no TZID, no trailing Z). */
export function formatFloatingLocal(date) {
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `T${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/** UTC stamp: YYYYMMDDTHHMMSSZ. */
export function formatUTCStamp(date) {
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

function parseStartDate(startDate) {
  // Accept a Date or a YYYY-MM-DD string; anchor to local midnight.
  if (startDate instanceof Date && !Number.isNaN(startDate.getTime())) {
    return new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  }
  if (typeof startDate === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate.trim());
    if (m) {
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  throw new CalendarInputError("startDate", "Pick a valid start date.");
}

function exerciseLines(day) {
  const list = Array.isArray(day?.exercises) ? day.exercises : [];
  return list
    .map((ex) => {
      const name = String(ex?.name || "").trim();
      if (!name) return null;
      // Cardio is one continuous effort, so the sets×reps readout is wrong for
      // it: a 35 minute run exported as "1×" or "1×35 min" is the same mistake
      // the Today manifest used to make.
      if (isCardioEntry(ex)) {
        const minutes = cardioMinutes(ex);
        const effort = minutes ? `${minutes} min` : String(ex?.reps || "").trim();
        const intensity = ex?.intensity ? ` ${ex.intensity}` : "";
        return effort ? `${name} - ${effort}${intensity}` : name;
      }
      const sets = ex?.sets;
      const reps = ex?.reps;
      if (sets != null && reps != null) return `${name} - ${sets}×${reps}`;
      return name;
    })
    .filter(Boolean);
}

/**
 * Build the .ics text for a plan. Each training day becomes one weekly-recurring
 * floating-time event starting on consecutive days from `startDate`.
 *
 * @param {object}  opts
 * @param {object}  opts.plan            generated plan ({ days: [...] })
 * @param {string|Date} opts.startDate   local start date (YYYY-MM-DD or Date)
 * @param {string}  opts.time            local start time "HH:MM"
 * @param {number}  opts.reminderMinutes 0 | 10 | 30 | 60 (0 = no calendar alarm)
 * @param {Date}    [opts.now]           generation timestamp (for DTSTAMP/UIDs)
 * @returns {string} iCalendar document
 */
export function buildWorkoutCalendar({ plan, startDate, time, reminderMinutes = 0, now = new Date() }) {
  const days = trainingDays(plan);
  if (!days.length) throw new CalendarInputError("plan", "This plan has no training days to export.");
  if (!TIME_PATTERN.test(String(time || ""))) throw new CalendarInputError("time", "Enter a start time as HH:MM.");
  if (!REMINDER_CHOICES.includes(Number(reminderMinutes))) {
    throw new CalendarInputError("reminderMinutes", "Choose a reminder of none, 10, 30, or 60 minutes.");
  }

  const base = parseStartDate(startDate);
  const [hh, mm] = time.split(":").map(Number);
  const stamp = formatUTCStamp(now);
  const baseYmd = `${base.getFullYear()}${pad(base.getMonth() + 1)}${pad(base.getDate())}`;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SpotterAI//Workout Plan//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];

  days.forEach((day, i) => {
    const start = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i, hh, mm, 0);
    const end = new Date(start.getTime() + EVENT_DURATION_MIN * 60 * 1000);
    const focus = String(day?.focus || day?.day || "Training day").trim();
    const summary = escapeICSText(`SpotterAI: ${focus}`);
    const description = escapeICSText(exerciseLines(day).join("\n"));

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:spotterai-${baseYmd}-${i}@local`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART:${formatFloatingLocal(start)}`);
    lines.push(`DTEND:${formatFloatingLocal(end)}`);
    lines.push("RRULE:FREQ=WEEKLY");
    lines.push(foldICSLine(`SUMMARY:${summary}`));
    if (description) lines.push(foldICSLine(`DESCRIPTION:${description}`));
    if (Number(reminderMinutes) > 0) {
      lines.push("BEGIN:VALARM");
      lines.push("ACTION:DISPLAY");
      lines.push(foldICSLine(`DESCRIPTION:${summary}`));
      lines.push(`TRIGGER:-PT${Number(reminderMinutes)}M`);
      lines.push("END:VALARM");
    }
    lines.push("END:VEVENT");
  });

  lines.push("END:VCALENDAR");
  // RFC 5545 requires CRLF line breaks.
  return lines.join("\r\n") + "\r\n";
}

/** Reminder bucket label for privacy-safe analytics (never dates/plan text). */
export function reminderBucket(reminderMinutes) {
  const n = Number(reminderMinutes);
  return REMINDER_CHOICES.includes(n) ? String(n) : "invalid";
}

// ---------------------------------------------------------------------------
// Export dialog UI
// ---------------------------------------------------------------------------

function todayLocalYmd(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function triggerDownload(icsText, doc) {
  const blob = new Blob([icsText], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = doc.createElement("a");
  a.href = url;
  a.download = "spotterai-plan.ics";
  doc.body.appendChild(a);
  a.click();
  doc.body.removeChild(a);
  // Revoke on the next tick so the download has grabbed the URL.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function initCalendarExport({ doc = globalThis.document, getPlan, track } = {}) {
  if (!doc) return;
  const openBtn = doc.getElementById("calendar-export-open");
  const dialog = doc.getElementById("calendar-export-dialog");
  if (!openBtn || !dialog) return;

  const dateInput = doc.getElementById("calendar-export-date");
  const timeInput = doc.getElementById("calendar-export-time");
  const reminderInput = doc.getElementById("calendar-export-reminder");
  const error = doc.getElementById("calendar-export-error");
  const downloadBtn = doc.getElementById("calendar-export-download");
  const closeBtn = doc.getElementById("calendar-export-close");

  const setError = (msg) => {
    if (!error) return;
    error.textContent = msg || "";
    error.hidden = !msg;
  };

  const currentPlan = () => (typeof getPlan === "function" ? getPlan() : null);

  function open() {
    if (dateInput && !dateInput.value) dateInput.value = todayLocalYmd();
    if (timeInput && !timeInput.value) timeInput.value = "18:00";
    setError("");
    dialog.hidden = false;
    track?.("calendar_export_opened");
    dateInput?.focus();
  }
  function close() {
    dialog.hidden = true;
  }

  openBtn.addEventListener("click", open);
  closeBtn?.addEventListener("click", close);

  downloadBtn?.addEventListener("click", () => {
    setError("");
    try {
      const reminderMinutes = Number(reminderInput?.value || 0);
      const ics = buildWorkoutCalendar({
        plan: currentPlan(),
        startDate: dateInput?.value,
        time: timeInput?.value,
        reminderMinutes,
      });
      triggerDownload(ics, doc);
      track?.("calendar_export_downloaded", { reminder: reminderBucket(reminderMinutes) });
      close();
    } catch (err) {
      if (err instanceof CalendarInputError) setError(err.message);
      else setError("Couldn't build the calendar file. Check your entries and try again.");
    }
  });
}
