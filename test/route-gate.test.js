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

test("fires once through subscribe path and never again despite further active changes", () => {
  let active = false;
  let calls = 0;
  let subscribeCount = 0;
  let onChange;
  onceRouteActive(
    () => active,
    (fn) => {
      subscribeCount++;
      onChange = fn;
    },
    () => {
      calls++;
    }
  );
  assert.equal(calls, 0, "must not fire before the route is active");
  assert.equal(subscribeCount, 1, "must subscribe exactly once");

  active = true;
  onChange(); // first change reports active
  assert.equal(calls, 1, "must fire when active is first detected");

  active = false;
  onChange(); // change reports inactive, should not fire
  assert.equal(calls, 1, "must not fire when becoming inactive");

  active = true;
  onChange(); // change reports active again, but already fired so should not run
  assert.equal(calls, 1, "must not fire again even when active is reported later");
  assert.equal(subscribeCount, 1, "must have subscribed exactly once for lifetime");
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
