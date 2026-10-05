import test from "node:test";
import assert from "node:assert/strict";

import { trendOf, prepareWeighIns } from "../nutrition-adjust.js";
import { addDays } from "../lib/calendar-days.js";

const TODAY = "2026-10-05";
const series = (kgs, today = TODAY) => kgs.map((kg, i) => ({ date: addDays(today, -(kgs.length - 1 - i)), kg }));
/** A weight that falls `pctPerWeek` of its starting value each week, one weigh-in a day for `days` days. */
const line = (start, pctPerWeek, days = 28) => series(Array.from({ length: days }, (_, d) => start * (1 + (pctPerWeek / 100) * (d / 7))));

test("a perfect loss line reads back as the same percent per week, with no uncertainty", () => {
  const pts = prepareWeighIns(line(80, -0.5), TODAY, 28);
  const t = trendOf(pts);
  assert.equal(t.n, 28);
  assert.ok(Math.abs(t.slopePctPerWeek - -0.505) < 0.02, `${t.slopePctPerWeek}`);
  assert.ok(Math.abs(t.upper - t.lower) < 1e-9, "a perfect line has a zero-width interval");
  assert.ok(t.upper >= t.lower);
});

test("flat weight reads as about zero and the interval brackets zero when the data is noisy", () => {
  const flat = trendOf(prepareWeighIns(line(80, 0), TODAY, 28));
  assert.ok(Math.abs(flat.slopePctPerWeek) < 1e-9);
  const noisy = series(Array.from({ length: 28 }, (_, d) => 80 + (d % 2 ? 0.8 : -0.8)));
  const t = trendOf(prepareWeighIns(noisy, TODAY, 28));
  assert.ok(t.lower < 0 && t.upper > 0);
});

test("two entries on one date are averaged, and the point count is days, not entries", () => {
  const s = [...line(80, 0, 10), { date: TODAY, kg: 82 }];
  const pts = prepareWeighIns(s, TODAY, 28);
  assert.equal(pts.length, 10);
  assert.equal(pts[pts.length - 1].kg, 81, "80 and 82 on the last date");
});

test("a typo, an impossible value and a future date are dropped", () => {
  const s = line(80, 0, 12);
  s[5] = { ...s[5], kg: 8.0 }; // typo for 80
  s[6] = { ...s[6], kg: 800 };
  s[7] = { ...s[7], kg: 95 }; // more than 15% from the window median
  s.push({ date: addDays(TODAY, 3), kg: 80 });
  const pts = prepareWeighIns(s, TODAY, 28);
  assert.equal(pts.length, 9);
  assert.ok(pts.every((p) => p.kg === 80));
});

test("only the window is used", () => {
  const s = [{ date: addDays(TODAY, -40), kg: 70 }, ...line(80, 0, 10)];
  assert.equal(prepareWeighIns(s, TODAY, 28).length, 10);
});

test("fewer than three distinct days gives no trend", () => {
  assert.equal(trendOf(prepareWeighIns(line(80, 0, 2), TODAY, 28)), null);
  assert.equal(trendOf([]), null);
});

test("the percent trend does not depend on the unit the weights were entered in", () => {
  const kg = line(80, -0.6);
  const lb = kg.map((p) => ({ ...p, kg: p.kg * 2.2046226218 }));
  const a = trendOf(prepareWeighIns(kg, TODAY, 28));
  const b = trendOf(prepareWeighIns(lb, TODAY, 28));
  assert.ok(Math.abs(a.slopePctPerWeek - b.slopePctPerWeek) < 1e-9);
});

test("weigh-ins all on one weekday still yield a trend; the weekday spread is a gate elsewhere", () => {
  const mondays = [0, 7, 14, 21].map((d, i) => ({ date: addDays("2026-09-14", d), kg: 80 - i * 0.4 }));
  assert.ok(trendOf(prepareWeighIns(mondays, TODAY, 28)).slopePctPerWeek < 0);
});
