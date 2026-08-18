import test from "node:test";
import assert from "node:assert/strict";
import { onceRouteActive } from "../route-gate.js";

test("fires immediately, exactly once, when the route is already active", () => {
  let calls = 0;
  onceRouteActive(
    () => true,
    () => {
      throw new Error("must not subscribe once already active");
    },
    () => {
      calls++;
    }
  );
  assert.equal(calls, 1);
});

test("does not fire while inactive, then fires on the first change that leaves it active", () => {
  let active = false;
  let calls = 0;
  let onChange;
  onceRouteActive(
    () => active,
    (fn) => {
      onChange = fn;
    },
    () => {
      calls++;
    }
  );
  assert.equal(calls, 0, "must not fire before the route is active");

  onChange(); // a change happened, but the route still isn't the target route
  assert.equal(calls, 0);

  active = true;
  onChange(); // now it is
  assert.equal(calls, 1);
});

test("fires at most once even when further changes keep reporting active", () => {
  let calls = 0;
  let onChange;
  onceRouteActive(
    () => true,
    (fn) => {
      onChange = fn;
    },
    () => {
      calls++;
    }
  );
  // Already active, so it fired synchronously and never subscribed.
  assert.equal(calls, 1);
  assert.equal(onChange, undefined);
});

test("never fires if the route never becomes active", () => {
  let calls = 0;
  let onChange;
  onceRouteActive(
    () => false,
    (fn) => {
      onChange = fn;
    },
    () => {
      calls++;
    }
  );
  onChange();
  onChange();
  assert.equal(calls, 0);
});
