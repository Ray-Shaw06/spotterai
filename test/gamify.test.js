/**
 * Tests that the achievement set rewards healthy behaviour (consistency,
 * recovery, honest logging) and never uses shame / "never miss" pressure.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { ACHIEVEMENTS } from "../gamify.js";

const all = ACHIEVEMENTS.map((a) => `${a.name} ${a.desc}`).join(" · ").toLowerCase();

test("there is an honest-logging / body-awareness achievement", () => {
  assert.ok(ACHIEVEMENTS.some((a) => a.id === "bodyaware"));
  assert.match(all, /reported pain instead of pushing/);
});

test("there is a consistency achievement that rewards a realistic 2–4 workouts", () => {
  const c = ACHIEVEMENTS.find((a) => a.id === "consistency");
  assert.ok(c);
  assert.ok(c.test({ thisWeek: { sessions: 3 } }), "unlocks at 3 workouts in a week");
  assert.ok(!c.test({ thisWeek: { sessions: 2 } }));
});

test("no achievement uses shame or 'never miss' pressure", () => {
  assert.doesNotMatch(all, /never miss|no excuses|don'?t quit|lazy|every (single )?day|perfect (week|streak)|shame/);
});

test("reporting pain is rewarded, not punished", () => {
  const a = ACHIEVEMENTS.find((x) => x.id === "bodyaware");
  assert.ok(a.test({ painReportsCount: 1 }));
  assert.ok(a.xp > 0, "reporting pain earns XP (it's healthy)");
});
