/**
 * Tests for the first-week guided experience: a gentle 7-day journey + a
 * conservative, non-shaming Week-2 suggestion.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { FIRST_WEEK_DAYS, dayContent, weekTwoSuggestion, weekOneReview } from "../first-week.js";

test("there are 7 days, each with a title, checklist, and CTA", () => {
  assert.equal(FIRST_WEEK_DAYS.length, 7);
  for (const d of FIRST_WEEK_DAYS) {
    assert.equal(typeof d.title, "string");
    assert.ok(Array.isArray(d.items) && d.items.length);
    assert.ok(d.cta && d.cta.label && d.cta.act);
  }
});

test("dayContent clamps out-of-range indices (no crash)", () => {
  assert.equal(dayContent(-3), FIRST_WEEK_DAYS[0]);
  assert.equal(dayContent(99), FIRST_WEEK_DAYS[6]);
});

test("Week-2 suggestion is conservative and never shames a missed week", () => {
  const missed = weekTwoSuggestion({ sessions: 1, target: 4 });
  assert.match(missed, /lighter|fewer|shorter|rebuild/i);
  assert.doesNotMatch(missed, /lazy|no excuses|failed|never miss|disappoint/i);

  assert.match(weekTwoSuggestion({ sessions: 4, target: 4 }), /small|gradual progression/i);
  assert.match(weekTwoSuggestion({ sessions: 1, target: 4, painReports: 1 }), /discomfort|conservative|eases off/i);
});

test("Week 1 review summarises the week's real numbers", () => {
  const r = weekOneReview({ sessions: 3, target: 4, nutritionDays: 5, proteinTargetDays: 4, painReports: 0, streakDays: 6 });
  assert.equal(r.workouts, 3);
  assert.equal(r.mealsLogged, 5);
  assert.equal(r.proteinDays, 4);
  assert.equal(r.bestStreak, 6);
  assert.equal(typeof r.suggestion, "string");
});
