import test from "node:test";
import assert from "node:assert/strict";

import { streakRows, streakListHTML, consistencyCardHTML } from "../consistency-card.js";

const week = (s) => [...s].map((c) => c === "1");
const streak = (current, best, bits) => ({ current, best, last7: [...bits].filter((c) => c === "1").length, week: week(bits) });
const full = {
  protein: streak(4, 9, "0111011"),
  calories: streak(0, 6, "1110000"),
  logged: streak(0, 0, "0000000"),
};

test("rows keep a fixed order and skip a hidden streak", () => {
  assert.deepEqual(streakRows(full).map((r) => r.kind), ["protein", "calories", "logged"]);
  assert.deepEqual(streakRows({ ...full, calories: null }).map((r) => r.kind), ["protein", "logged"]);
  assert.deepEqual(streakRows(null), []);
});

test("a run reads as a run, a one-day run is singular", () => {
  assert.equal(streakRows(full)[0].run, "4 days in a row");
  assert.equal(streakRows({ logged: streak(1, 1, "0000001") })[0].run, "1 day in a row");
});

test("an ended run reads as an invitation, never as a loss", () => {
  const [, calories, logged] = streakRows(full);
  assert.equal(calories.run, "Pick it back up today");
  assert.equal(calories.meta, "Best 6 · 3 of last 7 days");
  assert.equal(logged.run, "Log a meal to start");
  assert.equal(logged.meta, "0 of last 7 days");
});

test("no string shames the user", () => {
  const banned = ["missed", "failed", "fail", "you didn't", "you did not", "slacking", "lazy", "behind", "streak lost", "lost", "broke", "broken", "reset", "cheat", "clean", "junk", "bad", "guilty"];
  const text = [streakListHTML(full), streakListHTML(full, { compact: true }), consistencyCardHTML(full)].join(" ").replace(/<[^>]+>/g, " ").toLowerCase();
  for (const word of banned) assert.ok(!new RegExp(`\\b${word}\\b`).test(text), `"${word}" in card copy`);
});

test("the week is described in words for screen readers, not only drawn", () => {
  const html = streakListHTML(full);
  assert.match(html, /role="img" aria-label="5 of the last 7 days"/);
  assert.equal((html.match(/streak__tick--on/g) || []).length, 5 + 3);
});

test("compact drops the best-run line and the full card keeps it", () => {
  assert.ok(!streakListHTML(full, { compact: true }).includes("streak__meta"));
  assert.ok(streakListHTML(full).includes("streak__meta"));
});

test("nothing to show renders nothing", () => {
  assert.equal(streakListHTML(null), "");
  assert.equal(consistencyCardHTML(null), "");
});

test("the card has a real heading and says where the numbers come from", () => {
  const html = consistencyCardHTML(full);
  assert.match(html, /<h2 class="card-title">Consistency<\/h2>/);
  assert.match(html, /targets you set/);
});
