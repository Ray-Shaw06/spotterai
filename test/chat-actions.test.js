/**
 * Tests for the coach action protocol parser.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { parseCoachActions, describeAction } from "../chat-actions.js";

test("extracts a single action + strips the block from the visible text", () => {
  const reply = 'Sure, swapping it.\n```spotter-action\n{"type":"swap_exercise","from":"Bench Press","to":"Push-up"}\n```';
  const { actions, text } = parseCoachActions(reply);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].to, "Push-up");
  assert.equal(text, "Sure, swapping it.");
  assert.doesNotMatch(text, /spotter-action/);
});

test("supports an array of actions and drops unknown types", () => {
  const reply = 'Done.\n```spotter-action\n[{"type":"remove_exercise","name":"Curl"},{"type":"hack_account"}]\n```';
  const { actions } = parseCoachActions(reply);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "remove_exercise");
});

test("no block → no actions, text unchanged", () => {
  const { actions, text } = parseCoachActions("Just answering your question.");
  assert.equal(actions.length, 0);
  assert.equal(text, "Just answering your question.");
});

test("malformed JSON is ignored but still stripped", () => {
  const { actions, text } = parseCoachActions("ok\n```spotter-action\n{not json}\n```");
  assert.equal(actions.length, 0);
  assert.equal(text, "ok");
});

test("describeAction summarises each type", () => {
  assert.match(describeAction({ type: "swap_exercise", from: "A", to: "B" }), /Swapped A → B/);
  assert.match(describeAction({ type: "add_exercise", name: "Plank", day: "Day 2" }), /Added Plank · Day 2/);
});

test("describeAction names the day edit", () => {
  assert.match(describeAction({ type: "replace_day", day: "Day 1", focus: "Upper Body" }), /Upper Body/);
});

test("a day retitle survives the parser instead of being dropped", () => {
  const reply = 'Making Day 1 upper.\n```spotter-action\n[{"type":"replace_day","day":"Day 1","focus":"Upper Body"}]\n```';
  const { actions } = parseCoachActions(reply);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].focus, "Upper Body");
});

test("dropped actions are reported, not silently swallowed", () => {
  // The coach claiming a change the app quietly discarded is the worst failure
  // mode here: the reply reads as if the plan changed when it did not.
  const reply = 'Done.\n```spotter-action\n[{"type":"remove_exercise","name":"Curl"},{"type":"rename_program"}]\n```';
  const { actions, dropped } = parseCoachActions(reply);
  assert.equal(actions.length, 1);
  assert.equal(dropped, 1);
  assert.equal(parseCoachActions("no block here").dropped, 0);
});
