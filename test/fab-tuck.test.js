/**
 * Tests for the coach launcher auto-tuck rule.
 *
 * The launcher covering card text on a 390px screen is the bug this fixes, but
 * the failure mode that matters more is the opposite one: a launcher that
 * tucks when it should not, stranding the only way into the coach. Most of
 * these assert that it stays put.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  nextTucked,
  attachFabTuck,
  TUCK_DELTA,
  TUCK_TOP_ZONE,
  TUCK_BOTTOM_SLACK,
} from "../fab-tuck.js";

/** A long page, scrolled to the middle, not near either end. */
const mid = (over = {}) => ({
  tucked: false,
  lastY: 1000,
  y: 1000,
  docH: 8000,
  viewH: 800,
  ...over,
});

// ---- the actual fix --------------------------------------------------------

test("scrolling down tucks the launcher away from the content under it", () => {
  assert.equal(nextTucked(mid({ y: 1000 + TUCK_DELTA + 1 })), true);
});

test("scrolling back up brings it straight back", () => {
  assert.equal(nextTucked(mid({ tucked: true, y: 1000 - TUCK_DELTA - 1 })), false);
});

test("movement below the noise floor holds the current state", () => {
  // A trackpad twitch or a rounding wobble must not flicker the control.
  for (const delta of [0, 1, TUCK_DELTA, -TUCK_DELTA, -1]) {
    assert.equal(nextTucked(mid({ tucked: true, y: 1000 + delta })), true, `delta ${delta}`);
    assert.equal(nextTucked(mid({ tucked: false, y: 1000 + delta })), false, `delta ${delta}`);
  }
});

// ---- never strand the control ----------------------------------------------

test("an open panel pins the launcher, because it is also the close button", () => {
  assert.equal(nextTucked(mid({ tucked: true, y: 5000, panelOpen: true })), false);
});

test("keyboard focus pins it, so focus never lands on something invisible", () => {
  assert.equal(nextTucked(mid({ tucked: true, y: 5000, focused: true })), false);
});

test("the top zone always shows it — there it is a call to action", () => {
  assert.equal(nextTucked(mid({ tucked: true, y: TUCK_TOP_ZONE, lastY: 0 })), false);
  // Still true when the gesture would otherwise tuck it.
  assert.equal(nextTucked(mid({ y: TUCK_TOP_ZONE - 1, lastY: 0 })), false);
});

test("the bottom of the page shows it — padding there already clears it", () => {
  const docH = 8000;
  const viewH = 800;
  const maxY = docH - viewH;
  assert.equal(
    nextTucked({ tucked: true, lastY: maxY - 400, y: maxY - TUCK_BOTTOM_SLACK, docH, viewH }),
    false,
  );
});

// ---- hostile inputs --------------------------------------------------------

test("iOS rubber-banding cannot read as a scroll gesture", () => {
  // Negative scrollY at the top, and overscroll past the end, both clamp.
  assert.equal(nextTucked(mid({ y: -120, lastY: 0 })), false);
  const docH = 8000;
  const viewH = 800;
  assert.equal(nextTucked({ tucked: false, lastY: 7000, y: docH + 200, docH, viewH }), false);
});

test("a page shorter than the viewport never tucks", () => {
  assert.equal(nextTucked({ tucked: false, lastY: 0, y: 500, docH: 600, viewH: 900 }), false);
});

// ---- wiring ----------------------------------------------------------------

/** Minimal window/document stand-in; rAF runs synchronously so asserts are flat. */
function fakeEnv({ scrollHeight = 8000, innerHeight = 800 } = {}) {
  const listeners = {};
  const fab = {
    classes: new Set(),
    attrs: {},
    classList: {
      toggle(name, on) {
        if (on) fab.classes.add(name);
        else fab.classes.delete(name);
      },
    },
    setAttribute(k, v) {
      fab.attrs[k] = v;
    },
  };
  const env = {
    scrollY: 0,
    innerHeight,
    document: { documentElement: { scrollHeight }, activeElement: null },
    requestAnimationFrame: (f) => f(),
    addEventListener: (type, fn) => {
      listeners[type] = fn;
    },
    removeEventListener: (type) => {
      delete listeners[type];
    },
    scrollTo(y) {
      env.scrollY = y;
      listeners.scroll?.();
    },
  };
  return { env, fab, listeners };
}

test("attaching drives the class and aria-hidden off real scrolling", () => {
  const { env, fab } = fakeEnv();
  const detach = attachFabTuck({ fab, isPanelOpen: () => false, env });

  env.scrollTo(2000); // down, well past the top zone
  assert.equal(fab.classes.has("is-tucked"), true);
  assert.equal(fab.attrs["aria-hidden"], "true");

  env.scrollTo(1500); // back up
  assert.equal(fab.classes.has("is-tucked"), false);
  assert.equal(fab.attrs["aria-hidden"], "false");

  detach();
  env.scrollTo(4000);
  assert.equal(fab.classes.has("is-tucked"), false, "detached listener must not fire");
});

test("a scroll burst coalesces into one update per frame", () => {
  const { env, fab } = fakeEnv();
  let frames = 0;
  env.requestAnimationFrame = (f) => {
    frames++;
    f();
  };
  attachFabTuck({ fab, isPanelOpen: () => false, env });
  for (let i = 1; i <= 20; i++) env.scrollTo(1000 + i * 50);
  assert.equal(frames, 20, "each settled frame schedules exactly one more");
});

test("no launcher, or an env that cannot listen, is a no-op rather than a crash", () => {
  assert.doesNotThrow(() => attachFabTuck({ fab: null, isPanelOpen: () => false, env: {} })());
  const { fab } = fakeEnv();
  assert.doesNotThrow(() => attachFabTuck({ fab, isPanelOpen: () => false, env: {} })());
});
