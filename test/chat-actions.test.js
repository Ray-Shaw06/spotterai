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
