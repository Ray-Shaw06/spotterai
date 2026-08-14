/**
 * Consistency calendar — the month grid and the streak that backs it.
 *
 * The trap this file exists for: `computeStreak` counts consecutive CALENDAR
 * days containing a workout, so a rest day breaks it. Shipping a calendar with
 * that as the headline would render a correct 4-day split as failure and punish
 * the user for following their own plan. `computeWeeklyStreak` counts weeks that
 * met the session target instead.
 */
import test from "node:test";
import assert from "node:assert/strict";

class MemoryStorage {
  #map = new Map();
  getItem(k) {
    return this.#map.has(k) ? this.#map.get(k) : null;
  }
  setItem(k, v) {
    this.#map.set(k, String(v));
  }
  removeItem(k) {
    this.#map.delete(k);
  }
  clear() {
    this.#map.clear();
  }
}
globalThis.localStorage = new MemoryStorage();
globalThis.window = { addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true };
globalThis.CustomEvent = class {
  constructor(type, init) {
    this.type = type;
    this.detail = init?.detail;
  }
};

const {
  importData,
  dayStatus,
  calendarMonth,
  computeWeeklyStreak,
  nutritionGoalsMet,
  deriveStats,
} = await import("../tracker-store.js");

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};
const workout = (date, id = `w-${date}-${Math.random().toString(36).slice(2, 6)}`) => ({
  id,
  date,
  name: "Session",
  exercises: [],
  volume: 1000,
});

function seed(patch) {
  importData({ workouts: [], nutrition: [], bodyweight: [], water: {}, ...patch });
}

/** Monday of the week containing `d`. Mirrors the store's own week start. */
function mondayOf(d) {
  const x = new Date(d);
  const dow = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - dow);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** N sessions inside the week that is `weeksBack` weeks before this one. */
function sessionsInWeek(weeksBack, count) {
  const monday = mondayOf(new Date());
  monday.setDate(monday.getDate() - weeksBack * 7);
  const out = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    out.push(workout(ymd(d), `w-${weeksBack}-${i}`));
  }
  return out;
}

// ---------------------------------------------------------------------------
// TIMEZONE: a stored 'YYYY-MM-DD' must be read as a LOCAL day.
//
// `new Date("2026-08-10")` is UTC midnight, which at any negative UTC offset is
// the previous day locally. That put every MONDAY workout in the previous week,
// silently undercounting `thisWeek.sessions` and misplacing weekly volume. It
// was invisible at UTC and at positive offsets, so it only ever hit users in the
// Americas.
// ---------------------------------------------------------------------------
test("CRITICAL: a Monday workout belongs to the week it was logged in", () => {
  const monday = mondayOf(new Date());
  const key = ymd(monday);
  seed({ workouts: [workout(key, "monday-session")] });
  assert.equal(deriveStats().thisWeek.sessions, 1, "a Monday session must count toward this week");
});

test("every day of the current week lands in the current week", () => {
  const monday = mondayOf(new Date());
  const week = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    week.push(workout(ymd(d), `d-${i}`));
  }
  seed({ workouts: week });
  assert.equal(deriveStats().thisWeek.sessions, 7, "no day of the week may be attributed elsewhere");
});

// ---------------------------------------------------------------------------
// THE REST-DAY TRAP
// ---------------------------------------------------------------------------
test("CRITICAL: a correct 4-day split does not read as a broken streak", () => {
  // Mon, Tue, Thu, Fri — textbook upper/lower split, two rest days in it.
  const monday = mondayOf(new Date());
  const on = [0, 1, 3, 4].map((i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    return workout(ymd(d));
  });
  seed({ workouts: [...on, ...sessionsInWeek(1, 4), ...sessionsInWeek(2, 4)] });

  const stats = deriveStats();
  assert.ok(stats.weeklyStreak >= 3, `expected a healthy weekly streak, got ${stats.weeklyStreak}`);
  // And the reason the old number was the wrong headline:
  assert.ok(stats.streakDays < 4, "the day streak breaks on rest days, which is why it is not the headline");
});

test("an in-progress week short of target does not break the streak", () => {
  // Nothing yet this week, but the previous three weeks all hit target.
  seed({ workouts: [...sessionsInWeek(1, 4), ...sessionsInWeek(2, 4), ...sessionsInWeek(3, 4)] });
  assert.equal(computeWeeklyStreak(
    [...sessionsInWeek(1, 4), ...sessionsInWeek(2, 4), ...sessionsInWeek(3, 4)],
    4
  ), 3, "a fresh Monday must not zero the streak");
});

test("the current week counts once it hits target", () => {
  const all = [...sessionsInWeek(0, 4), ...sessionsInWeek(1, 4)];
  assert.equal(computeWeeklyStreak(all, 4), 2);
});

test("a genuinely missed week ends the streak", () => {
  // Weeks 1 and 3 hit target, week 2 missed. Streak stops at week 1.
  const all = [...sessionsInWeek(1, 4), ...sessionsInWeek(2, 1), ...sessionsInWeek(3, 4)];
  assert.equal(computeWeeklyStreak(all, 4), 1);
});

test("no training at all is a zero streak, not a crash", () => {
  assert.equal(computeWeeklyStreak([], 4), 0);
  assert.equal(computeWeeklyStreak([], 0), 0, "a nonsense target must not divide by zero");
});

// ---------------------------------------------------------------------------
// The nutrition predicate
// ---------------------------------------------------------------------------
const targets = { kcal: 2000, protein: 150, waterMl: 2500 };

test("nutrition goals need protein AND calories, not protein alone", () => {
  assert.equal(nutritionGoalsMet({ kcal: 2000, protein: 150 }, targets), true);
  assert.equal(nutritionGoalsMet({ kcal: 900, protein: 150 }, targets), false, "protein hit but badly under-eaten");
  assert.equal(nutritionGoalsMet({ kcal: 2000, protein: 40 }, targets), false, "calories hit but protein missed");
});

test("calories are a band, not an exact number", () => {
  assert.equal(nutritionGoalsMet({ kcal: 1850, protein: 150 }, targets), true, "within 10% under");
  assert.equal(nutritionGoalsMet({ kcal: 2150, protein: 150 }, targets), true, "within 10% over");
  assert.equal(nutritionGoalsMet({ kcal: 2400, protein: 150 }, targets), false, "20% over is a miss");
});

test("water is reported but never gates the day", () => {
  // Most days have no water logged; requiring it would make the mark unreachable.
  assert.equal(nutritionGoalsMet({ kcal: 2000, protein: 150 }, targets), true);
});

test("missing targets never produce a false 'goals met'", () => {
  assert.equal(nutritionGoalsMet({ kcal: 2000, protein: 150 }, { kcal: 0, protein: 0 }), false);
  assert.equal(nutritionGoalsMet(null, targets), false);
  assert.equal(nutritionGoalsMet({ kcal: 2000, protein: 150 }, null), false);
});

// ---------------------------------------------------------------------------
// Day status
// ---------------------------------------------------------------------------
test("a day reports training and nutrition independently", () => {
  const d = ymd(daysAgo(1));
  seed({
    workouts: [workout(d)],
    nutrition: [{ id: "n1", date: d, name: "food", kcal: 2000, protein: 150 }],
  });
  const status = dayStatus(d);
  assert.equal(status.trained, true);
  assert.equal(status.nutritionMet, true);
  assert.equal(status.sessions, 1);
});

test("a rest day with good eating still earns its nutrition mark", () => {
  const d = ymd(daysAgo(1));
  seed({ nutrition: [{ id: "n1", date: d, name: "food", kcal: 2000, protein: 150 }] });
  const status = dayStatus(d);
  assert.equal(status.trained, false);
  assert.equal(status.nutritionMet, true, "eating well on a rest day must count");
});

test("a day with no data at all is empty, not 'goals met'", () => {
  seed({});
  const status = dayStatus(ymd(daysAgo(3)));
  assert.equal(status.trained, false);
  assert.equal(status.nutritionMet, false);
  assert.equal(status.loggedNutrition, false);
});

test("two sessions in one day are counted, not collapsed", () => {
  const d = ymd(daysAgo(1));
  seed({ workouts: [workout(d, "a"), workout(d, "b")] });
  assert.equal(dayStatus(d).sessions, 2);
});

// ---------------------------------------------------------------------------
// The grid
// ---------------------------------------------------------------------------
test("a month is whole weeks of seven days, Monday first", () => {
  seed({});
  const { weeks } = calendarMonth(2026, 7); // August 2026
  assert.ok(weeks.length >= 4 && weeks.length <= 6);
  for (const week of weeks) assert.equal(week.length, 7, "every row must have seven cells");
});

test("padding days are marked so the UI can dim them", () => {
  seed({});
  const cells = calendarMonth(2026, 7).weeks.flat();
  assert.ok(cells.some((c) => !c.inMonth), "a month rarely starts on a Monday");
  assert.ok(cells.filter((c) => c.inMonth).length === 31, "August has 31 days");
});

test("future days are flagged rather than rendered as misses", () => {
  seed({});
  const now = new Date();
  const cells = calendarMonth(now.getFullYear(), now.getMonth()).weeks.flat();
  const future = cells.filter((c) => c.isFuture);
  for (const c of future) assert.equal(c.trained, false);
  assert.ok(cells.some((c) => c.isToday), "the current month must mark today");
});

test("the grid reflects logged training", () => {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const key = ymd(first);
  seed({ workouts: [workout(key)] });
  const cell = calendarMonth(now.getFullYear(), now.getMonth()).weeks.flat().find((c) => c.date === key);
  assert.equal(cell.trained, true);
});
