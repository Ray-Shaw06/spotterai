/**
 * Tests for the coach-reply auditor — flags unsafe advice, stays quiet on good
 * advice. Pure, runs under `node --test`.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { auditReply } from "../chat-guard.js";

const ids = (t) => auditReply(t).map((f) => f.id);

test("flags training through pain", () => {
  assert.ok(ids("Just push through the pain and finish your sets.").includes("pain"));
  assert.ok(ids("No pain, no gain — keep going!").includes("pain"));
});

test("flags crash-diet calories in a daily context", () => {
  assert.ok(ids("Eat only 800 calories a day to lean out fast.").includes("crash_calories"));
  // A 500-calorie MEAL is fine — no daily-diet context.
  assert.ok(!ids("That burrito is about 800 calories, so log it.").includes("crash_calories"));
});

test("flags unrealistically fast weight loss", () => {
  assert.ok(ids("You can lose 10 lbs in a week on this plan.").includes("rapid_loss"));
  assert.ok(!ids("Aim to lose about 1 lb per week.").includes("rapid_loss"));
});

test("flags failure-every-set, frequent maxing, skipping warm-ups", () => {
  assert.ok(ids("Take every set to failure for maximum growth.").includes("to_failure"));
  assert.ok(ids("Try to max out every session to test strength.").includes("max_out"));
  assert.ok(ids("You can skip the warm-up to save time.").includes("skip_warmup"));
});

test("flags PEDs, water cuts, and dismissing professionals", () => {
  assert.ok(ids("Consider a cycle of dianabol for faster gains.").includes("peds"));
  assert.ok(ids("Do a water cut and sit in the sauna to lose weight before weigh-in.").includes("dehydrate"));
  assert.ok(ids("There's no need to see a doctor, just train around it.").includes("skip_pro"));
});

test("clean, helpful advice produces no flags", () => {
  const good =
    "Great question! For a beginner, aim for 2-4 sessions a week, leave 1-2 reps in reserve, " +
    "warm up with a few lighter sets, and progress the load gradually. If you feel sharp pain, " +
    "stop and check with a professional. Aim to lose about 0.5 kg per week.";
  assert.deepEqual(auditReply(good), []);
});

test("empty / non-string input is safe", () => {
  assert.deepEqual(auditReply(""), []);
  assert.deepEqual(auditReply(null), []);
  assert.deepEqual(auditReply(undefined), []);
});
