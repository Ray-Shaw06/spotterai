import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  REST_ALERTS_KEY,
  restAlertCapability,
  restAlertsEnabled,
  setRestAlertsEnabled,
  enableRestAlerts,
  disableRestAlerts,
  notifyRestComplete,
  purgeLegacyNotificationStorage,
  hapticsCapability,
  REST_PUSH_SUBSCRIPTION_KEY,
  REST_PUSH_ENDPOINT,
  applicationServerKey,
  restPushConfig,
  storedRestPushSubscription,
  subscribeRestPush,
  scheduleRestPush,
  cancelRestPush,
  restPushBooked,
  __resetRestPushForTests,
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

    // No fetch in this env, so the server cannot be asked and nothing is booked.
    assert.deepEqual(await enableRestAlerts(envWith({ permission: "default", requestResult: "granted" })), { state: "enabled", enabled: true, booked: false });
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

// ---------------------------------------------------------------------------
// Reachability: the alert shipped, defaulted off, and hid its only switch in
// Account. These pin the tiers that decide whether it can be offered at all.
// ---------------------------------------------------------------------------

function iosEnv({ installed = false, notification = false, permission = "default" } = {}) {
  const env = {
    navigator: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1", maxTouchPoints: 5 },
    matchMedia: () => ({ matches: installed }),
  };
  if (installed) env.navigator.standalone = true;
  if (notification) {
    env.Notification = function () {};
    env.Notification.permission = permission;
    env.navigator.serviceWorker = { ready: Promise.resolve({ showNotification: async () => {} }) };
  }
  return env;
}

test("an iPhone in Safari is told to install, not that its device cannot do it", () => {
  // This is the actual reason a real iPhone got no notification. The old code
  // returned "unsupported" and told the user their device can't show
  // notifications. It can, once it is on the home screen.
  assert.equal(restAlertCapability(iosEnv()), "needs-install");
});

test("the same iPhone installed to the home screen can be asked for permission", () => {
  assert.equal(restAlertCapability(iosEnv({ installed: true, notification: true })), "needs-permission");
  assert.equal(restAlertCapability(iosEnv({ installed: true, notification: true, permission: "granted" })), "ready");
  assert.equal(restAlertCapability(iosEnv({ installed: true, notification: true, permission: "denied" })), "denied");
});

test("a desktop browser with no Notification API is still a plain dead end", () => {
  const env = { navigator: { userAgent: "Mozilla/5.0 (X11; Linux x86_64)", maxTouchPoints: 0 } };
  assert.equal(restAlertCapability(env), "unsupported");
});

test("iPadOS reporting a desktop UA is still recognised as iOS", () => {
  // iPadOS 13+ claims to be a Macintosh; touch points are the only tell.
  const env = { navigator: { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 5 } };
  assert.equal(restAlertCapability(env), "needs-install");
  // A real Mac must NOT be told to add it to a home screen.
  const mac = { navigator: { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 0 } };
  assert.equal(restAlertCapability(mac), "unsupported");
});

test("haptics report honestly per platform", () => {
  const android = { navigator: { vibrate: () => true, userAgent: "Android" } };
  assert.equal(hapticsCapability(android), "vibration");

  // WebKit has never shipped the Vibration API, so on iPhone the notification
  // is the only route to a buzz. Promising "it vibrates" there is a lie.
  assert.equal(hapticsCapability(iosEnv({ installed: true, notification: true })), "notification-only");

  const nothing = { navigator: { userAgent: "Mozilla/5.0 (X11; Linux x86_64)", maxTouchPoints: 0 } };
  assert.equal(hapticsCapability(nothing), "none");
});

test("the notification asks the OS to buzz as well as show", async () => {
  let opts = null;
  const env = envWith({ permission: "granted", showNotification: async (_t, o) => { opts = o; } });
  setRestAlertsEnabled(true, fakeStore());
  // enable through the real store so notifyRestComplete's own gate passes
  globalThis.localStorage = fakeStore({ [REST_ALERTS_KEY]: "true" });
  assert.equal(await notifyRestComplete(env), "shown");
  assert.deepEqual(opts.vibrate, [200, 80, 200]);
  assert.equal(opts.silent, false);
});

// ---------------------------------------------------------------------------
// Booked push (the route that survives a locked screen)
// ---------------------------------------------------------------------------

const PUBLIC_KEY = "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM";
// Deliberately NOT the VAPID key: the device's own p256dh is a different value,
// and a fixture that conflated them could not tell a persisted secret from a
// persisted public key.
const DEVICE_P256DH = "BAe1cDcKQ8mVcW1oKcaHfmHPPr0cNS3wYsw5EcyQmaFhOZiVVNoFFvOsfDEz1SDF7xlZNv0J0hxPU2rf0oPDqoI";
const SUB_JSON = { endpoint: "https://web.push.apple.com/abc", expirationTime: null, keys: { p256dh: DEVICE_P256DH, auth: "tBHItJI5svbpez7KI4CCXg" } };

/**
 * A device with permission granted, a push-capable service worker, and a
 * server double behind env.fetch. `server.enabled` flips the GET answer;
 * `server.schedule` is the status the POST answers with.
 */
function pushEnv({ permission = "granted", existing = null, server = {} } = {}) {
  const env = envWith({ permission });
  const state = { subscribed: existing, unsubscribed: 0, requests: [], subscribeOptions: null };
  const manager = {
    getSubscription: async () => state.subscribed,
    subscribe: async (options) => {
      state.subscribeOptions = options;
      state.subscribed = { toJSON: () => SUB_JSON, unsubscribe: async () => { state.unsubscribed += 1; state.subscribed = null; return true; } };
      return state.subscribed;
    },
  };
  env.navigator.serviceWorker = { ready: Promise.resolve({ showNotification: async () => {}, pushManager: manager }) };
  const cfg = { enabled: true, schedule: 200, cancel: 204, token: "msg_1.mac", scheduleBody: null, ...server };
  env.fetch = async (url, init = {}) => {
    state.requests.push({ url, init });
    const method = init.method || "GET";
    if (method === "GET") return new Response(JSON.stringify(cfg.enabled ? { enabled: true, publicKey: PUBLIC_KEY } : { enabled: false }), { status: 200 });
    if (method === "POST") {
      const body = cfg.schedule === 200 ? { token: cfg.token, endsAt: 1 } : (cfg.scheduleBody || {});
      return new Response(JSON.stringify(body), { status: cfg.schedule });
    }
    if (method === "DELETE") return new Response(null, { status: cfg.cancel });
    return new Response("", { status: 405 });
  };
  return { env, state };
}

test.beforeEach(() => __resetRestPushForTests());

test("applicationServerKey decodes base64url into the raw bytes subscribe() wants", () => {
  const bytes = applicationServerKey(PUBLIC_KEY);
  assert.ok(bytes instanceof Uint8Array);
  assert.equal(bytes.length, 65, "an uncompressed P-256 point");
  assert.equal(bytes[0], 0x04);
  assert.equal(applicationServerKey("").length, 0);
});

test("restPushConfig asks the server once per page and reads any failure as not enabled", async () => {
  const { env, state } = pushEnv();
  assert.deepEqual(await restPushConfig(env), { enabled: true, publicKey: PUBLIC_KEY });
  assert.deepEqual(await restPushConfig(env), { enabled: true, publicKey: PUBLIC_KEY });
  assert.equal(state.requests.length, 1, "cached after the first answer");

  __resetRestPushForTests();
  const off = pushEnv({ server: { enabled: false } });
  assert.deepEqual(await restPushConfig(off.env), { enabled: false });

  __resetRestPushForTests();
  const broken = envWith({ permission: "granted" });
  broken.fetch = async () => { throw new Error("offline"); };
  assert.deepEqual(await restPushConfig(broken), { enabled: false });

  __resetRestPushForTests();
  assert.deepEqual(await restPushConfig({ navigator: {} }), { enabled: false }, "no fetch at all");
});

test("subscribeRestPush creates a subscription with the server's key and remembers only what the UI needs", async () => {
  const store = fakeStore();
  const { env, state } = pushEnv();
  const json = await subscribeRestPush(env, store);
  assert.deepEqual(json, SUB_JSON);
  assert.equal(state.subscribeOptions.userVisibleOnly, true, "iOS refuses silent pushes");
  assert.deepEqual([...state.subscribeOptions.applicationServerKey], [...applicationServerKey(PUBLIC_KEY)]);
  assert.deepEqual(storedRestPushSubscription(store), { endpoint: SUB_JSON.endpoint, publicKey: PUBLIC_KEY });

  // The push encryption secrets never touch storage. /api/rest-push takes a
  // subscription from anyone, so a leaked copy of the full blob would let a
  // stranger push banners at this device.
  const raw = store.getItem(REST_PUSH_SUBSCRIPTION_KEY);
  assert.equal(raw.includes(SUB_JSON.keys.auth), false, "auth secret is not persisted");
  assert.equal(raw.includes(SUB_JSON.keys.p256dh), false, "p256dh is not persisted");
});

test("subscribeRestPush prefers the live subscription over the stored copy, so a rotated one is picked up", async () => {
  const rotated = { ...SUB_JSON, endpoint: "https://web.push.apple.com/rotated" };
  const store = fakeStore({ [REST_PUSH_SUBSCRIPTION_KEY]: JSON.stringify({ endpoint: SUB_JSON.endpoint, publicKey: PUBLIC_KEY }) });
  const { env, state } = pushEnv({ existing: { toJSON: () => rotated } });
  assert.deepEqual(await subscribeRestPush(env, store), rotated);
  assert.equal(state.subscribeOptions, null, "no new subscribe() when one exists");
  assert.deepEqual(storedRestPushSubscription(store), { endpoint: rotated.endpoint, publicKey: PUBLIC_KEY });
});

test("a VAPID key rotation re-mints the subscription instead of pushing at a dead one forever", async () => {
  // A subscription is bound to the key it was minted with. Without this, an
  // operator rotating keys breaks every already-subscribed device permanently:
  // the push service refuses every send and nothing on the phone notices.
  const store = fakeStore({ [REST_PUSH_SUBSCRIPTION_KEY]: JSON.stringify({ endpoint: SUB_JSON.endpoint, publicKey: "B-an-older-key" }) });
  const existing = { toJSON: () => SUB_JSON, unsubscribe: async () => { existing.dropped = true; return true; } };
  const { env, state } = pushEnv({ existing });
  await subscribeRestPush(env, store);
  assert.equal(existing.dropped, true, "the stale subscription is released");
  assert.ok(state.subscribeOptions, "a new one is minted");
  assert.deepEqual([...state.subscribeOptions.applicationServerKey], [...applicationServerKey(PUBLIC_KEY)]);
  assert.equal(storedRestPushSubscription(store).publicKey, PUBLIC_KEY);
});

test("subscribeRestPush is null without permission, without a server, or without push support", async () => {
  const store = fakeStore();
  assert.equal(await subscribeRestPush(pushEnv({ permission: "default" }).env, store), null);
  __resetRestPushForTests();
  assert.equal(await subscribeRestPush(pushEnv({ server: { enabled: false } }).env, store), null);
  __resetRestPushForTests();
  const noPush = pushEnv().env;
  noPush.navigator.serviceWorker = { ready: Promise.resolve({ showNotification: async () => {} }) };
  assert.equal(await subscribeRestPush(noPush, store), null);
  assert.equal(storedRestPushSubscription(store), null);
});

test("enableRestAlerts books when it can and reports it; disable forgets and unsubscribes", async () => {
  const store = fakeStore();
  const { env, state } = pushEnv({ permission: "default" });
  env.Notification.requestPermission = async () => { env.Notification.permission = "granted"; return "granted"; };
  assert.deepEqual(await enableRestAlerts(env, store), { state: "enabled", enabled: true, booked: true });
  assert.deepEqual(storedRestPushSubscription(store), { endpoint: SUB_JSON.endpoint, publicKey: PUBLIC_KEY });

  assert.deepEqual(disableRestAlerts(env, store), { state: "disabled", enabled: false });
  assert.equal(store.has(REST_ALERTS_KEY), false);
  assert.equal(storedRestPushSubscription(store), null);
  await new Promise((r) => { setTimeout(r, 0); });
  assert.equal(state.unsubscribed, 1);
});

test("scheduleRestPush books the deadline with the server and leaves a cancel token pending", async () => {
  const store = fakeStore({ [REST_ALERTS_KEY]: "true" });
  const { env, state } = pushEnv();
  assert.equal(restPushBooked(), false);
  assert.equal(await scheduleRestPush(1_700_000_090_000.4, env, store), "booked");
  assert.equal(restPushBooked(), true);
  const post = state.requests.find((r) => r.init.method === "POST");
  assert.equal(post.url, REST_PUSH_ENDPOINT);
  assert.equal(post.init.keepalive, true, "must outlive a screen lock right after the tap");
  const sent = JSON.parse(post.init.body);
  assert.deepEqual(sent.subscription, SUB_JSON);
  assert.equal(sent.endsAt, 1_700_000_090_000);
  assert.equal(typeof sent.now, "number", "the client's own clock travels with the deadline, so the server can use the interval and its own origin");
});

test("scheduleRestPush is skipped when alerts are off, and no request is made", async () => {
  const { env, state } = pushEnv();
  assert.equal(await scheduleRestPush(Date.now() + 60_000, env, fakeStore()), "skipped");
  assert.equal(state.requests.length, 0);
  assert.equal(restPushBooked(), false);
});

test("re-arming cancels the previous booking before making the next", async () => {
  const store = fakeStore({ [REST_ALERTS_KEY]: "true" });
  const { env, state } = pushEnv();
  await scheduleRestPush(Date.now() + 60_000, env, store);
  await scheduleRestPush(Date.now() + 75_000, env, store);
  const methods = state.requests.map((r) => r.init.method || "GET");
  const firstDelete = methods.indexOf("DELETE");
  const secondPost = methods.lastIndexOf("POST");
  assert.ok(firstDelete > -1 && firstDelete < secondPost, methods.join(","));
  assert.match(state.requests[firstDelete].url, /token=msg_1\.mac/);
});

test("a 503 from the server stops further asking ONLY when the server says it is unconfigured", async () => {
  const store = fakeStore({ [REST_ALERTS_KEY]: "true" });
  const off = pushEnv({ server: { schedule: 503, scheduleBody: { configured: false } } });
  assert.equal(await scheduleRestPush(Date.now() + 60_000, off.env, store), "skipped");
  assert.deepEqual(await restPushConfig(off.env), { enabled: false });
  assert.equal(restPushBooked(), false);
  assert.equal(storedRestPushSubscription(store), null, "the Account copy must stop promising a booking");

  // A 503 WITHOUT that marker is the platform talking (a paused deployment, an
  // edge error, or a spent daily budget). It must not switch the feature off
  // for the life of the page.
  __resetRestPushForTests();
  const busy = pushEnv({ server: { schedule: 503, scheduleBody: { configured: true } } });
  assert.equal(await scheduleRestPush(Date.now() + 60_000, busy.env, fakeStore({ [REST_ALERTS_KEY]: "true" })), "skipped");
  assert.deepEqual(await restPushConfig(busy.env), { enabled: true, publicKey: PUBLIC_KEY });

  __resetRestPushForTests();
  const flaky = pushEnv({ server: { schedule: 502 } });
  assert.equal(await scheduleRestPush(Date.now() + 60_000, flaky.env, store), "failed");
  assert.deepEqual(await restPushConfig(flaky.env), { enabled: true, publicKey: PUBLIC_KEY });

  __resetRestPushForTests();
  const offline = pushEnv();
  const realFetch = offline.env.fetch;
  offline.env.fetch = async (url, init = {}) => { if (init.method === "POST") throw new Error("offline"); return realFetch(url, init); };
  assert.equal(await scheduleRestPush(Date.now() + 60_000, offline.env, store), "failed");
});

test("cancelRestPush sends the token once and is a no-op without one", async () => {
  const store = fakeStore({ [REST_ALERTS_KEY]: "true" });
  const { env, state } = pushEnv();
  assert.equal(await cancelRestPush(env), "none");
  await scheduleRestPush(Date.now() + 60_000, env, store);
  const [first, second] = await Promise.all([cancelRestPush(env), cancelRestPush(env)]);
  assert.deepEqual([first, second].sort(), ["cancelled", "none"], "a concurrent second call must not double-cancel");
  assert.equal(state.requests.filter((r) => r.init.method === "DELETE").length, 1);
  assert.equal(restPushBooked(), false);

  __resetRestPushForTests();
  const failing = pushEnv({ server: { cancel: 500 } });
  await scheduleRestPush(Date.now() + 60_000, failing.env, store);
  assert.equal(await cancelRestPush(failing.env), "failed");
  assert.equal(restPushBooked(), false, "the token is dropped either way");
});

// ---------------------------------------------------------------------------
// The edges of the booked route: a server that answers badly, a browser that
// takes the subscription away, and storage that lies. Every one of these has
// to end as "no booking", never as a throw out of an arm() that is running
// inside the tap that started the rest.
// ---------------------------------------------------------------------------

test("restPushConfig reads a broken GET and a keyless 'enabled' answer as not enabled", async () => {
  // A 500 from our own deploy must not look like "enabled" — the client would
  // then subscribe and POST into a route that cannot book anything.
  const broken = envWith({ permission: "granted" });
  broken.fetch = async () => new Response("upstream", { status: 500 });
  assert.deepEqual(await restPushConfig(broken), { enabled: false });

  // enabled:true with no key is a half-configured server. subscribe() needs an
  // applicationServerKey, so booking without one would fail on the device.
  __resetRestPushForTests();
  const keyless = envWith({ permission: "granted" });
  keyless.fetch = async () => new Response(JSON.stringify({ enabled: true }), { status: 200 });
  assert.deepEqual(await restPushConfig(keyless), { enabled: false });

  __resetRestPushForTests();
  const blank = envWith({ permission: "granted" });
  blank.fetch = async () => new Response(JSON.stringify({ enabled: true, publicKey: "" }), { status: 200 });
  assert.deepEqual(await restPushConfig(blank), { enabled: false });

  // Not JSON at all (an HTML error page from a proxy) is the same answer.
  __resetRestPushForTests();
  const html = envWith({ permission: "granted" });
  html.fetch = async () => new Response("<!doctype html>", { status: 200 });
  assert.deepEqual(await restPushConfig(html), { enabled: false });
});

test("subscribeRestPush is null when the browser refuses, which is what a revoked permission looks like", async () => {
  // Permission can be pulled between the grant and the next set; the browser
  // then throws from subscribe() rather than returning null.
  const store = fakeStore();
  const refused = pushEnv();
  refused.env.navigator.serviceWorker = {
    ready: Promise.resolve({
      showNotification: async () => {},
      pushManager: { getSubscription: async () => null, subscribe: async () => { throw new Error("permission denied"); } },
    }),
  };
  assert.equal(await subscribeRestPush(refused.env, store), null);
  assert.equal(storedRestPushSubscription(store), null, "nothing is remembered from a failed subscribe");

  // A pushManager that throws on read is the same dead end, not a crash.
  __resetRestPushForTests();
  const throwing = pushEnv();
  throwing.env.navigator.serviceWorker = {
    ready: Promise.resolve({
      showNotification: async () => {},
      pushManager: { getSubscription: async () => { throw new Error("gone"); }, subscribe: async () => null },
    }),
  };
  assert.equal(await subscribeRestPush(throwing.env, store), null);

  // A subscription whose toJSON() has no endpoint is unusable: the server
  // would reject it, so it must not be remembered or sent.
  __resetRestPushForTests();
  const shapeless = pushEnv({ existing: { toJSON: () => ({ keys: {} }) } });
  assert.equal(await subscribeRestPush(shapeless.env, store), null);
  assert.equal(storedRestPushSubscription(store), null);
});

test("storedRestPushSubscription survives a corrupt, shapeless, or unreadable store", async () => {
  // Anything can end up in localStorage (another tab, a bad migration, a user
  // with devtools open). The Account UI reads this synchronously on render.
  assert.equal(storedRestPushSubscription(fakeStore({ [REST_PUSH_SUBSCRIPTION_KEY]: "{not json" })), null);
  assert.equal(storedRestPushSubscription(fakeStore({ [REST_PUSH_SUBSCRIPTION_KEY]: "null" })), null);
  assert.equal(storedRestPushSubscription(fakeStore({ [REST_PUSH_SUBSCRIPTION_KEY]: '{"keys":{}}' })), null, "no endpoint");
  assert.equal(storedRestPushSubscription(fakeStore({ [REST_PUSH_SUBSCRIPTION_KEY]: '"a string"' })), null);
  assert.equal(storedRestPushSubscription(null), null);
  const hostile = { getItem: () => { throw new Error("storage disabled"); } };
  assert.equal(storedRestPushSubscription(hostile), null);

  // And a store that refuses writes still lets the booking go ahead: the live
  // registration holds the real subscription, the copy is only for the UI.
  const readOnly = { getItem: () => null, setItem: () => { throw new Error("quota"); }, removeItem: () => {} };
  const { env } = pushEnv();
  assert.ok(await subscribeRestPush(env, readOnly));
});

test("a 200 that carries no cancel token is a failure, not a silent booking", async () => {
  // Without a token there is nothing to cancel with, so treating this as
  // "booked" would leave a push that skip and +15s could never call off.
  const store = fakeStore({ [REST_ALERTS_KEY]: "true" });
  const { env } = pushEnv({ server: { token: undefined } });
  assert.equal(await scheduleRestPush(Date.now() + 60_000, env, store), "failed");
  assert.equal(restPushBooked(), false);

  __resetRestPushForTests();
  const notJson = pushEnv();
  const realFetch = notJson.env.fetch;
  notJson.env.fetch = async (url, init = {}) => (init.method === "POST" ? new Response("<html>", { status: 200 }) : realFetch(url, init));
  assert.equal(await scheduleRestPush(Date.now() + 60_000, notJson.env, store), "failed");
  assert.equal(restPushBooked(), false);
});

// ---------------------------------------------------------------------------
// The workout-ui wiring
//
// workout-ui.js is module-scope DOM code with no seam to import headlessly, so
// this is a source contract rather than a behaviour test. It exists because
// every one of these four calls is invisible when it goes missing: the rest
// still counts down and still beeps, and only a locked phone notices that the
// booking was never made or never called off.
// ---------------------------------------------------------------------------

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const workoutUiSource = readFileSync(join(repoRoot, "workout-ui.js"), "utf8");
const swSource = readFileSync(join(repoRoot, "service-worker.js"), "utf8");
const alertsSource = readFileSync(join(repoRoot, "workout-alerts.js"), "utf8");

/** A top-level function body, sliced to the closing brace in column one. */
function fnBody(name, source = workoutUiSource) {
  const start = source.indexOf(`\nfunction ${name}(`);
  assert.notEqual(start, -1, `workout-ui.js no longer defines ${name}()`);
  const end = source.indexOf("\n}", start + 1);
  assert.notEqual(end, -1, `${name}() has no top-level close`);
  return source.slice(start, end);
}

test("arming a rest books the push for the alarm's own deadline, and +15s re-books it", () => {
  // The deadline must come from restAlarm.endsAt(), not a locally computed
  // one: the alarm clamps the seconds, so any second copy of the arithmetic
  // can book a push for a moment the tone does not fire at.
  assert.match(fnBody("startRest"), /restAlarm\.arm\(restTotal\);[\s\S]*scheduleRestPush\(restAlarm\.endsAt\(\)\)/);
  assert.match(fnBody("addRest"), /restAlarm\.arm\(next\);[\s\S]*scheduleRestPush\(restAlarm\.endsAt\(\)\)/);
  // Never unhandled: this runs inside the tap that started the rest.
  for (const name of ["startRest", "addRest"]) {
    assert.match(fnBody(name), /scheduleRestPush\(restAlarm\.endsAt\(\)\)\.catch\(/, `${name} must swallow its own rejection`);
  }
});

test("stopping a rest calls the booking off, so a skipped set never buzzes later", () => {
  const stop = fnBody("stopRest");
  assert.match(stop, /restAlarm\.disarm\(\)/);
  assert.match(stop, /cancelRestPush\(\)\.catch\(/);
  // skipRest and startRest both route through stopRest rather than repeating
  // the pair, which is what keeps a re-arm from leaving two bookings.
  assert.match(fnBody("skipRest"), /stopRest\(\)/);
  assert.match(fnBody("startRest"), /stopRest\(\)/);
});

test("restDone ALWAYS fires the local notification, whatever the booking did", () => {
  // This used to be conditional: a booked push suppressed the local banner
  // when restDone ran late. But "booked" only ever meant QStash accepted the
  // message. A phone offline past the push TTL, an expired subscription or a
  // rotated key all left the user with NO notification at all, which is worse
  // than before the feature existed. The two banners share a tag and neither
  // sets renotify, so a duplicate is silent; a miss is not recoverable.
  const done = fnBody("restDone");
  assert.match(done, /notifyRestComplete\(\)\.catch\(/);
  assert.doesNotMatch(done, /restPushBooked\(\)/, "no suppression path may come back");
  assert.doesNotMatch(workoutUiSource, /REST_LATE_MS/, "and neither may its threshold");
  assert.match(done, /cancelRestPush\(\)\.catch\(/, "the token has to be released or the next rest starts booked");
});

test("neither banner sets renotify, so the pair collapses silently instead of alerting twice", () => {
  // Same tag + renotify:true is an explicit instruction to alert again. With
  // the app open both banners land a few seconds apart, so that would buzz
  // twice on every single set.
  for (const [name, src] of [["service-worker.js", swSource], ["workout-alerts.js", alertsSource]]) {
    assert.match(src, /renotify: false/, name);
    assert.doesNotMatch(src, /renotify: true/, name);
    assert.match(src, /tag: "spotterai-rest"/, name);
  }
});

test("the page banner and the push banner are the same notification, so the tag can collapse them", () => {
  // Two independent literals in two files, tied together only by this test.
  for (const field of ["tag", "body", "icon", "badge"]) {
    const pattern = new RegExp(`${field}: "([^"]+)"`);
    assert.equal(swSource.match(pattern)[1], alertsSource.match(pattern)[1], field);
  }
  assert.match(swSource, /"Rest complete"/);
  assert.match(alertsSource, /showNotification\("Rest complete"/);
});

test("a skip landing mid-booking cancels the booking instead of leaving it to fire", async () => {
  // The race this guards: a booking takes two round trips to create and one
  // synchronous line to cancel. Without the generation counter the skip found
  // nothing to cancel, the POST then stored its token, and a "Rest complete"
  // push arrived minutes later for a rest the user had already skipped.
  const store = fakeStore({ [REST_ALERTS_KEY]: "true" });
  const { env, state } = pushEnv();
  let releasePost;
  const realFetch = env.fetch;
  env.fetch = async (url, init = {}) => {
    if ((init.method || "GET") === "POST") {
      await new Promise((r) => { releasePost = r; });
    }
    return realFetch(url, init);
  };

  const booking = scheduleRestPush(Date.now() + 60_000, env, store);
  await new Promise((r) => { setTimeout(r, 0); }); // let it reach the POST
  assert.equal(await cancelRestPush(env), "none", "nothing is stored yet, so there is nothing to cancel");
  releasePost();

  assert.equal(await booking, "superseded");
  assert.equal(restPushBooked(), false, "the superseded token must never be stored");
  const deletes = state.requests.filter((r) => r.init.method === "DELETE");
  assert.equal(deletes.length, 1, "the booking cancels itself on the way in");
  assert.match(deletes[0].url, /token=msg_1\.mac/);
});

test("a re-arm landing mid-booking supersedes the first booking, and the second one stands", async () => {
  const store = fakeStore({ [REST_ALERTS_KEY]: "true" });
  const { env, state } = pushEnv();
  let releaseFirst;
  let posts = 0;
  const realFetch = env.fetch;
  env.fetch = async (url, init = {}) => {
    if ((init.method || "GET") === "POST" && ++posts === 1) {
      await new Promise((r) => { releaseFirst = r; });
    }
    return realFetch(url, init);
  };

  const first = scheduleRestPush(Date.now() + 60_000, env, store);
  await new Promise((r) => { setTimeout(r, 0); });
  const second = await scheduleRestPush(Date.now() + 75_000, env, store); // +15s
  releaseFirst();

  assert.equal(await first, "superseded");
  assert.equal(second, "booked");
  assert.equal(restPushBooked(), true, "the live rest keeps its booking");
  assert.equal(state.requests.filter((r) => r.init.method === "POST").length, 2);
});
