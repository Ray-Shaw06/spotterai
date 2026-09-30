/**
 * The "Snap a meal" door.
 *
 * It is the landing page's quickest way in, and iOS opens the camera only
 * inside the tap that asked for it. So when the nutrition page moved to
 * loading on first visit, the door could not move with it: this module owns
 * the camera input and clicks it synchronously, then loads the rest. The
 * failure that matters is a click that waits for anything first.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { initSnapDoor, photoInput } from "../snap-door.js";

function fakeDoc() {
  const listeners = {};
  const body = { children: [], appendChild(node) { this.children.push(node); } };
  return {
    body,
    listeners,
    createElement(tag) {
      return { tag, attrs: {}, hidden: false, clicks: 0, setAttribute(k, v) { this.attrs[k] = v; }, click() { this.clicks += 1; } };
    },
    addEventListener(type, fn) { listeners[type] = fn; },
    removeEventListener(type) { delete listeners[type]; },
  };
}

/** A click whose target sits inside a door with this data-snap-meal, or none. */
const tap = (doc, snapMeal) => doc.listeners.click({
  target: { closest: (sel) => (sel === "[data-snap-meal]" && snapMeal !== null ? { dataset: { snapMeal } } : null) },
});
const never = () => new Promise(() => {});
const tick = () => new Promise((resolve) => { setImmediate(resolve); });

test("a tap on a door opens the camera inside the tap, before the nutrition page has loaded", () => {
  const doc = fakeDoc();
  const tracked = [];
  initSnapDoor({ doc, load: never, track: (...args) => tracked.push(args) });
  tap(doc, "landing");
  assert.equal(photoInput(doc).clicks, 1, "the click must happen synchronously, not after the load");
  assert.deepEqual(tracked, [["meal_photo_started", { source: "landing" }]]);
});

test("once the nutrition page loads, it takes over with the food picker", async () => {
  const doc = fakeDoc();
  let continued = 0;
  initSnapDoor({ doc, load: async () => ({ continueSnap: () => { continued += 1; } }), track: () => {} });
  tap(doc, "nutrition");
  await tick();
  assert.equal(continued, 1);
});

test("a door with an unknown source counts as the nutrition page", () => {
  const doc = fakeDoc();
  const tracked = [];
  initSnapDoor({ doc, load: never, track: (...args) => tracked.push(args) });
  tap(doc, "somewhere-else");
  assert.deepEqual(tracked, [["meal_photo_started", { source: "nutrition" }]]);
});

test("a click anywhere else opens nothing and loads nothing", () => {
  const doc = fakeDoc();
  let loads = 0;
  initSnapDoor({ doc, load: () => { loads += 1; return never(); }, track: () => {} });
  tap(doc, null);
  assert.equal(photoInput(doc).clicks, 0);
  assert.equal(loads, 0);
});

test("the camera input is made once, as a hidden rear-camera image picker", () => {
  const doc = fakeDoc();
  const input = photoInput(doc);
  assert.equal(photoInput(doc), input, "one input, shared with the nutrition page");
  assert.equal(input.type, "file");
  assert.equal(input.accept, "image/*");
  assert.equal(input.attrs.capture, "environment");
  assert.equal(input.hidden, true);
  assert.deepEqual(doc.body.children, [input]);
});

test("a failed load is reported, and the camera it already opened stays open", async () => {
  const doc = fakeDoc();
  const errors = [];
  initSnapDoor({ doc, load: () => Promise.reject(new Error("offline")), track: () => {}, onError: (e) => errors.push(e.message) });
  tap(doc, "landing");
  await tick();
  assert.equal(photoInput(doc).clicks, 1);
  assert.deepEqual(errors, ["offline"]);
});

test("teardown stops listening", () => {
  const doc = fakeDoc();
  const detach = initSnapDoor({ doc, load: never, track: () => {} });
  detach();
  assert.equal(doc.listeners.click, undefined);
});
