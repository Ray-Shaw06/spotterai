import test from "node:test";
import assert from "node:assert/strict";

import {
  REST_ALERTS_KEY,
  restAlertCapability,
  restAlertsEnabled,
  setRestAlertsEnabled,
  enableRestAlerts,
  disableRestAlerts,
  notifyRestComplete,
  purgeLegacyNotificationStorage,
} from "../workout-alerts.js";

function fakeStore(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    has: (k) => map.has(k),
    keys: () => [...map.keys()],
  };
}

function envWith({ permission, hasNotification = true, hasSW = true, requestResult, showNotification } = {}) {
  const env = { navigator: {} };
  if (hasNotification) {
    env.Notification = function () {};
    env.Notification.permission = permission;
    env.Notification.requestPermission = async () => requestResult ?? permission;
  }
  if (hasSW) {
    env.navigator.serviceWorker = {
      ready: Promise.resolve({ showNotification: showNotification || (async () => {}) }),
    };
  }
  return env;
}

test("restAlertCapability classifies the environment", () => {
  assert.equal(restAlertCapability({ navigator: {} }), "unsupported");
  assert.equal(restAlertCapability(envWith({ permission: "granted" })), "ready");
  assert.equal(restAlertCapability(envWith({ permission: "denied" })), "denied");
  assert.equal(restAlertCapability(envWith({ permission: "default" })), "needs-permission");
  assert.equal(restAlertCapability(envWith({ permission: "granted", hasSW: false })), "unsupported");
});

test("the enabled flag round-trips and fails closed", () => {
  const store = fakeStore();
  assert.equal(restAlertsEnabled(store), false);
  setRestAlertsEnabled(true, store);
  assert.equal(store.getItem(REST_ALERTS_KEY), "true");
  assert.equal(restAlertsEnabled(store), true);
  setRestAlertsEnabled(false, store);
  assert.equal(restAlertsEnabled(store), false);
  // A garbage value is not "true", so it reads as disabled.
  assert.equal(restAlertsEnabled(fakeStore({ [REST_ALERTS_KEY]: "yes" })), false);
});

test("enableRestAlerts only enables after a granted permission", async () => {
  const store = fakeStore();
  globalThis.localStorage = store;
  try {
    assert.deepEqual(await enableRestAlerts(envWith({ permission: "denied" })), { state: "denied", enabled: false });
    assert.equal(store.has(REST_ALERTS_KEY), false);

    assert.deepEqual(await enableRestAlerts(envWith({ permission: "default", requestResult: "denied" })), { state: "denied", enabled: false });
    assert.equal(store.has(REST_ALERTS_KEY), false);

    assert.deepEqual(await enableRestAlerts(envWith({ permission: "default", requestResult: "granted" })), { state: "enabled", enabled: true });
    assert.equal(store.getItem(REST_ALERTS_KEY), "true");

    assert.deepEqual(await enableRestAlerts({ navigator: {} }), { state: "unsupported", enabled: false });
  } finally {
    delete globalThis.localStorage;
  }
});

test("disableRestAlerts clears the local flag", () => {
  const store = fakeStore({ [REST_ALERTS_KEY]: "true" });
  globalThis.localStorage = store;
  try {
    assert.deepEqual(disableRestAlerts(), { state: "disabled", enabled: false });
    assert.equal(store.has(REST_ALERTS_KEY), false);
  } finally {
    delete globalThis.localStorage;
  }
});

test("notifyRestComplete only fires when enabled AND permission is ready", async () => {
  globalThis.localStorage = fakeStore();
  try {
    // Disabled → skipped, no notification attempted.
    assert.equal(await notifyRestComplete(envWith({ permission: "granted" })), "skipped");

    globalThis.localStorage = fakeStore({ [REST_ALERTS_KEY]: "true" });
    // Enabled but permission not granted → skipped.
    assert.equal(await notifyRestComplete(envWith({ permission: "default" })), "skipped");

    // Enabled + ready → shown, with branded same-origin options.
    let shownArgs = null;
    const env = envWith({ permission: "granted", showNotification: async (...a) => { shownArgs = a; } });
    assert.equal(await notifyRestComplete(env), "shown");
    assert.equal(shownArgs[0], "Rest complete");
    assert.equal(shownArgs[1].icon, "/icons/spotterai-192.png");

    // A display failure is non-fatal.
    const boom = envWith({ permission: "granted", showNotification: async () => { throw new Error("no"); } });
    assert.equal(await notifyRestComplete(boom), "failed");
  } finally {
    delete globalThis.localStorage;
  }
});

test("purgeLegacyNotificationStorage removes only spotterai.notifications.* keys", () => {
  const store = fakeStore({
    "spotterai.notifications.token": "x",
    "spotterai.notifications.preferences": "y",
    "spotterai.rest.default": "120",
    "spotterai.plan": "keep me",
  });
  purgeLegacyNotificationStorage(store);
  assert.deepEqual(store.keys().sort(), ["spotterai.plan", "spotterai.rest.default"]);
});
