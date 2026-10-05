/**
 * Nutrition consistency streaks. Every run is a target the user set compared
 * with what they logged; nothing here judges a food.
 */
import test from "node:test";
import assert from "node:assert/strict";

class MemoryStorage {
  #map = new Map();
  getItem(k) { return this.#map.has(k) ? this.#map.get(k) : null; }
  setItem(k, v) { this.#map.set(k, String(v)); }
  removeItem(k) { this.#map.delete(k); }
  clear() { this.#map.clear(); }
}
globalThis.localStorage = new MemoryStorage();
globalThis.window = { addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true };
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };

const { computeStreaks, dayMet, KCAL_BAND } = await import("../nutrition-streaks.js");
const { nutritionGoalsMet, nutritionDaySummaries, importData, addNutrition } = await import("../tracker-store.js");

const TODAY = "2026-10-05";
const targets = { kcal: 2000, protein: 150 };
const ago = (n) => {
  const d = new Date(`${TODAY}T12:00:00`);
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const good = { kcal: 2000, protein: 160 };
const lowProtein = { kcal: 2000, protein: 90 };
const days = (spec) => Object.fromEntries(Object.entries(spec).map(([n, v]) => [ago(Number(n)), v]));
const run = (spec, extra = {}) => computeStreaks({ days: days(spec), targets, today: TODAY, ...extra });

test("nothing ever logged means no card at all", () => {
  assert.equal(computeStreaks({ days: {}, targets, today: TODAY }), null);
  assert.equal(computeStreaks({ days: days({ 1: good }), targets }), null, "no date, no answer");
});

test("a run counts back from yesterday while today is still open", () => {
  const s = run({ 1: good, 2: good, 3: good });
  assert.equal(s.protein.current, 3, "today not logged yet does not read as 0");
  assert.equal(s.logged.current, 3);
});

test("today joins the run once it is met", () => {
  const s = run({ 0: good, 1: good, 2: good });
  assert.equal(s.protein.current, 3);
  assert.deepEqual(s.protein.week.slice(-3), [true, true, true]);
});

test("an unmet today neither adds to the run nor ends it", () => {
  const s = run({ 0: lowProtein, 1: good, 2: good });
  assert.equal(s.protein.current, 2);
  assert.equal(s.logged.current, 3, "it WAS logged, so the logged run still counts today");
});

test("a day with nothing logged ends the run", () => {
  const s = run({ 1: good, 3: good, 4: good });
  assert.equal(s.protein.current, 1);
  assert.equal(s.logged.current, 1);
});

test("best run survives after the current one ends, and last7 never reads as zero after one gap", () => {
  const s = run({ 1: good, 2: good, 3: good, 4: good, 5: good, 6: good, 8: good, 9: good, 20: good, 21: good, 22: good });
  assert.equal(s.protein.current, 6);
  assert.equal(s.protein.best, 6);
  const gap = run({ 2: good, 3: good, 4: good, 5: good, 6: good });
  assert.equal(gap.protein.current, 0, "yesterday missed, so the run is over");
  assert.equal(gap.protein.best, 5, "the best run is still on the screen");
  assert.equal(gap.protein.last7, 5, "and one gap does not zero the week");
});

test("best run finds the longest run anywhere in the record", () => {
  const s = run({ 1: good, 2: good, 10: good, 11: good, 12: good, 13: good, 14: good, 30: good });
  assert.equal(s.protein.best, 5);
  assert.equal(s.protein.current, 2);
});

test("protein counts at or above target and nothing below it", () => {
  assert.equal(dayMet("protein", { kcal: 0, protein: 150 }, targets), true);
  assert.equal(dayMet("protein", { kcal: 0, protein: 149 }, targets), false);
  assert.equal(dayMet("protein", { kcal: 0, protein: 500 }, targets), true, "more protein is not a miss");
});

test("calories count within the band either side and not outside it", () => {
  assert.equal(KCAL_BAND, 0.1);
  for (const [kcal, ok] of [[1800, true], [2200, true], [1799, false], [2201, false], [2000, true]]) {
    assert.equal(dayMet("calories", { kcal, protein: 0 }, targets), ok, `${kcal}`);
  }
});

test("the in-range definition agrees with the calendar's goals-met rule", () => {
  // The calendar and these streaks must never disagree about the same day:
  // goals-met IS protein-met AND calories-met. Sweep the input space through both.
  let checked = 0;
  for (let kcal = 0; kcal <= 3000; kcal += 50) {
    for (let protein = 0; protein <= 220; protein += 10) {
      const day = { kcal, protein };
      const expected = nutritionGoalsMet(day, targets);
      const actual = dayMet("protein", day, targets) && dayMet("calories", day, targets);
      assert.equal(actual, expected, `kcal ${kcal} protein ${protein}`);
      checked++;
    }
  }
  assert.ok(checked > 1000, "the sweep is not vacuous");
});

test("a critical nutrition flag hides the calorie run and nothing else", () => {
  const s = run({ 1: good, 2: good }, { hideCalories: true });
  assert.equal(s.calories, null);
  assert.equal(s.protein.current, 2);
  assert.equal(s.logged.current, 2);
});

test("a missing target hides that streak rather than inventing one", () => {
  const noKcal = computeStreaks({ days: days({ 1: good }), targets: { protein: 150 }, today: TODAY });
  assert.equal(noKcal.calories, null);
  const none = computeStreaks({ days: days({ 1: good }), targets: {}, today: TODAY });
  assert.equal(none.protein, null);
  assert.equal(none.calories, null);
  assert.equal(none.logged.current, 1, "logging needs no target");
});

test("the week is seven days, oldest first, ending at the last counted day", () => {
  const s = run({ 1: good, 2: lowProtein, 3: good });
  assert.equal(s.protein.week.length, 7);
  assert.deepEqual(s.protein.week.slice(-3), [true, false, true]);
  assert.equal(s.protein.last7, 2);
});

test("the day maths survives a month boundary and a DST change", () => {
  const spec = {};
  for (let n = 1; n <= 12; n++) spec[n] = good; // reaches back across Sept 23
  const s = run(spec);
  assert.equal(s.logged.current, 12);
  const dst = computeStreaks({
    days: { "2026-03-07": good, "2026-03-08": good, "2026-03-09": good },
    targets,
    today: "2026-03-10",
  });
  assert.equal(dst.logged.current, 3, "US spring-forward on 2026-03-08 must not split the run");
});

test("the store reads each day's totals and a backfilled entry lands on its own date", () => {
  importData({ version: 1, workouts: [], nutrition: [], bodyweight: [], water: {}, targets });
  addNutrition({ name: "Eggs", meal: "breakfast", kcal: 300, protein: 25, carbs: 2, fat: 20, date: "2026-10-01" });
  addNutrition({ name: "Rice", meal: "lunch", kcal: 400, protein: 8, carbs: 80, fat: 1, date: "2026-10-01" });
  addNutrition({ name: "Oats", meal: "breakfast", kcal: 350, protein: 12, carbs: 60, fat: 6, date: "2026-10-03" });
  const sums = nutritionDaySummaries();
  assert.deepEqual(Object.keys(sums).sort(), ["2026-10-01", "2026-10-03"]);
  assert.equal(sums["2026-10-01"].kcal, 700);
  assert.equal(sums["2026-10-01"].protein, 33);
  // Filling in the missing day repairs the run.
  assert.equal(computeStreaks({ days: sums, targets, today: "2026-10-04" }).logged.current, 1);
  addNutrition({ name: "Toast", meal: "breakfast", kcal: 200, protein: 6, carbs: 30, fat: 4, date: "2026-10-02" });
  assert.equal(computeStreaks({ days: nutritionDaySummaries(), targets, today: "2026-10-04" }).logged.current, 3);
});
