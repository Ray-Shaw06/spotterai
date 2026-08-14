/**
 * SpotterAI — consistency calendar
 * ============================================================================
 * A month grid of what you actually did: days you trained, days you hit your
 * nutrition targets, and days you did both. Built entirely from data the
 * tracker already holds, so it needs no new storage and works offline.
 *
 * WHY IT LEADS WITH A WEEKLY STREAK
 * ---------------------------------
 * The obvious headline for a calendar is a day streak, and it is the wrong one.
 * `streakDays` counts consecutive calendar days containing a workout, so a rest
 * day breaks it. A correct 4-day split has rest days by design, which means the
 * grid would render good training as failure and quietly punish the user for
 * following their own plan. It leads with `weeklyStreak` (consecutive weeks
 * that met the weekly session target) instead, which is the unit lifting
 * actually happens in, and it treats the in-progress week as not-yet-counted
 * rather than as a miss.
 *
 *   ┌─────────────────────────────────────────────┐
 *   │  Mo  Tu  We  Th  Fr  Sa  Su                 │
 *   │  ●   ●   ·   ●   ●   ·   ·    ● trained     │
 *   │  ▲   ▲   ▲   ▲   ·   ·   ·    ▲ nutrition   │
 *   └─────────────────────────────────────────────┘
 *
 * A day can carry both marks; the two are independent on purpose, because
 * "trained but ate badly" and "rest day, ate well" are both real and both worth
 * seeing.
 */

import { calendarMonth, deriveStats, getState } from "./tracker-store.js";

const grid = document.getElementById("cal-grid");
const label = document.getElementById("cal-label");
const summary = document.getElementById("cal-summary");
const prevBtn = document.getElementById("cal-prev");
const nextBtn = document.getElementById("cal-next");

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Which month is on screen. Null means "the current one", so the calendar
// follows the clock until the user navigates away from it.
let offset = 0;

function viewedMonth() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return { year: d.getFullYear(), month: d.getMonth() };
}

/** One cell. Marks are additive: a day can be both trained and on-target. */
function cellHtml(cell) {
  const classes = ["cal-day"];
  if (!cell.inMonth) classes.push("cal-day--muted");
  if (cell.isToday) classes.push("cal-day--today");
  if (cell.isFuture) classes.push("cal-day--future");
  if (cell.trained) classes.push("cal-day--trained");
  if (cell.nutritionMet) classes.push("cal-day--fuelled");

  // Screen readers get the meaning, not the colour.
  const marks = [];
  if (cell.trained) marks.push(cell.sessions > 1 ? `${cell.sessions} sessions` : "trained");
  if (cell.nutritionMet) marks.push("nutrition on target");
  const described = marks.length ? marks.join(", ") : cell.isFuture ? "upcoming" : "nothing logged";

  return `<div class="${classes.join(" ")}" role="gridcell" aria-label="${esc(cell.date)}: ${esc(described)}">
      <span class="cal-day__num">${cell.day}</span>
      <span class="cal-day__marks" aria-hidden="true">
        ${cell.trained ? '<span class="cal-mark cal-mark--train"></span>' : ""}
        ${cell.nutritionMet ? '<span class="cal-mark cal-mark--fuel"></span>' : ""}
      </span>
    </div>`;
}

function render() {
  if (!grid) return;
  const { year, month } = viewedMonth();
  const { weeks } = calendarMonth(year, month);

  if (label) label.textContent = `${MONTHS[month]} ${year}`;

  grid.innerHTML =
    `<div class="cal-dow" aria-hidden="true">${DOW.map((d) => `<span>${d}</span>`).join("")}</div>` +
    weeks.map((week) => `<div class="cal-week" role="row">${week.map(cellHtml).join("")}</div>`).join("");

  // Month totals, counted from the cells actually shown for this month.
  const days = weeks.flat().filter((c) => c.inMonth && !c.isFuture);
  const trained = days.filter((c) => c.trained).length;
  const fuelled = days.filter((c) => c.nutritionMet).length;
  const both = days.filter((c) => c.trained && c.nutritionMet).length;

  if (summary) {
    const stats = deriveStats();
    const target = getState().targets.weeklyWorkouts;
    const streak = stats.weeklyStreak;

    // Honest framing. Zero weeks is "not yet", not "you failed".
    const streakLine = streak > 0
      ? `<strong>${plural(streak, "week")} in a row</strong> hitting ${plural(target, "session")}.`
      : `Hit ${plural(target, "session")} this week to start a streak.`;

    summary.innerHTML = `
      <p class="cal-streak">${streakLine}</p>
      <ul class="cal-legend">
        <li><span class="cal-mark cal-mark--train"></span> Trained <strong>${trained}</strong></li>
        <li><span class="cal-mark cal-mark--fuel"></span> Nutrition on target <strong>${fuelled}</strong></li>
        <li><span class="cal-mark cal-mark--both"></span> Both <strong>${both}</strong></li>
      </ul>`;
  }

  // Never navigate into an empty future month.
  if (nextBtn) nextBtn.disabled = offset >= 0;
}

function move(by) {
  offset = Math.min(0, offset + by);
  render();
}

prevBtn?.addEventListener("click", () => move(-1));
nextBtn?.addEventListener("click", () => move(1));

// Re-render whenever the data behind it changes, including a remote sync.
window.addEventListener("spotter:tracker", render);
window.addEventListener("spotter:profile", () => {
  offset = 0;
  render();
});

render();

export { render as renderCalendar };
