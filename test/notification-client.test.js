import test from "node:test";
import assert from "node:assert/strict";
import * as notificationClient from "../notification-client.js";
import {
  deleteNotificationSubscription,
  getNotificationConfiguration,
  notificationCapability,
  subscribeToNotifications,
  syncWorkoutCompletion,
  updateNotificationPreferences,
  validateApplicationServerKey,
  vapidKeyToUint8Array,
} from "../notification-client.js";
import { prefillNotificationPreferences } from "../notifications.js";

const TOKEN_KEY = "spotterai.notifications.token";
const PREFERENCES_KEY = "spotterai.notifications.preferences";
const OFFERED_PLAN_KEY = "spotterai.notifications.offeredPlanAt";
const PENDING_KEY = "spotterai.notifications.pending";
const CONFIGURATION_KEY = "spotterai.notifications.configurationId";
const CONFIGURATION_ID = "C".repeat(43);
const VALID_VAPID_PUBLIC_KEY = "BGsX0fLhLEJH-Lzm5WOkQPJ3A32BLeszoPShOUXYmMKWT-NC4v4af5uO5-tKfA-eFivOM1drMV7Oy7ZAaDe_UfU";
const OFF_CURVE_VAPID_PUBLIC_KEY = `B${"A".repeat(86)}`;

function lifecycleToken(expiresAt) {
  const payload = Buffer.from(JSON.stringify({ exp: expiresAt }), "utf8").toString("base64url");
  return `${payload}.opaque-signature`;
}

function existingSubscription() {
  return {
    toJSON: () => ({
      endpoint: "https://push.example/existing",
      expirationTime: null,
      keys: { p256dh: "existing-key", auth: "existing-auth" },
    }),
    unsubscribe: async () => true,
  };
}

function capabilityEnv({
  secure = true,
  userAgent = "Mozilla/5.0 (iPhone)",
  standalone = true,
  displayStandalone = false,
  permission = "default",
  push = true,
} = {}) {
  return {
    isSecureContext: secure,
    navigator: {
      userAgent,
      standalone,
      serviceWorker: {},
    },
    Notification: { permission },
    PushManager: push ? function PushManager() {} : undefined,
    matchMedia: () => ({ matches: displayStandalone }),
  };
}

function memoryStorage(initial = {}) {
  const seeded = { ...initial };
  if (seeded[TOKEN_KEY] && !seeded[CONFIGURATION_KEY]) seeded[CONFIGURATION_KEY] = CONFIGURATION_ID;
  const values = new Map(Object.entries(seeded));
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    snapshot: () => Object.fromEntries(values),
  };
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

function installRuntime({ permission = "default", subscription = null, fetchImpl, storage = memoryStorage() } = {}) {
  let currentSubscription = subscription;
  let permissionRequests = 0;
  let subscribeCalls = 0;
  const pushManager = {
    getSubscription: async () => currentSubscription,
    subscribe: async (options) => {
      subscribeCalls += 1;
      assert.equal(options.userVisibleOnly, true);
      assert.ok(options.applicationServerKey instanceof Uint8Array);
      currentSubscription ||= {
        toJSON: () => ({ endpoint: "https://push.example/device", expirationTime: null, keys: { p256dh: "key", auth: "auth" } }),
        unsubscribe: async () => true,
      };
      return currentSubscription;
    },
  };
  const registration = { pushManager };
  const navigatorValue = {
    userAgent: "Mozilla/5.0 (iPhone)",
    standalone: true,
    serviceWorker: { ready: Promise.resolve(registration) },
  };
  const notificationValue = {
    permission,
    requestPermission: async () => {
      permissionRequests += 1;
      notificationValue.permission = "granted";
      return "granted";
    },
  };
  const originals = new Map();
  for (const [key, value] of Object.entries({
    navigator: navigatorValue,
    Notification: notificationValue,
    PushManager: function PushManager() {},
    isSecureContext: true,
    matchMedia: () => ({ matches: false }),
    localStorage: storage,
    fetch: fetchImpl,
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  return {
    storage,
    pushManager,
    registration,
    notificationValue,
    permissionRequests: () => permissionRequests,
    subscribeCalls: () => subscribeCalls,
    prepared(existing = currentSubscription) {
      return {
        applicationServerKey: vapidKeyToUint8Array(VALID_VAPID_PUBLIC_KEY),
        configurationId: CONFIGURATION_ID,
        existingSubscription: existing,
        preparedAt: Date.now(),
        registration,
      };
    },
    restore() {
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}

test("capability supports only secure installed iPhone and Android PWAs with PushManager", () => {
  assert.deepEqual(notificationCapability(capabilityEnv()), { supported: true, platformGroup: "ios_pwa", reason: "ready" });
  assert.deepEqual(notificationCapability(capabilityEnv({
    userAgent: "Mozilla/5.0 (Linux; Android 15)", standalone: false, displayStandalone: true,
  })), { supported: true, platformGroup: "android_pwa", reason: "ready" });
  assert.deepEqual(notificationCapability(capabilityEnv({ secure: false })), { supported: false, platformGroup: "unsupported", reason: "insecure_context" });
  assert.deepEqual(notificationCapability(capabilityEnv({ standalone: false })), { supported: false, platformGroup: "unsupported", reason: "install_required_ios" });
  assert.deepEqual(notificationCapability(capabilityEnv({ userAgent: "Desktop", standalone: false })), { supported: false, platformGroup: "unsupported", reason: "unsupported_platform" });
  assert.deepEqual(notificationCapability(capabilityEnv({ push: false })), { supported: false, platformGroup: "ios_pwa", reason: "push_unavailable" });
  assert.deepEqual(notificationCapability(capabilityEnv({ permission: "denied" })), { supported: false, platformGroup: "ios_pwa", reason: "permission_denied" });
});

test("VAPID base64url conversion requires a canonical uncompressed P-256 key", () => {
  const bytes = vapidKeyToUint8Array(VALID_VAPID_PUBLIC_KEY);
  assert.equal(bytes.length, 65);
  assert.equal(bytes[0], 4);
  assert.throws(() => vapidKeyToUint8Array("AQIDBA"), (error) => error?.code === "invalid_public_key");
  assert.throws(() => vapidKeyToUint8Array(`${VALID_VAPID_PUBLIC_KEY}=`), (error) => error?.code === "invalid_public_key");
  assert.throws(() => vapidKeyToUint8Array("not base64!"), (error) => error?.code === "invalid_public_key");
});

test("exported non-prompting VAPID preflight rejects off-curve keys and missing WebCrypto", async () => {
  assert.equal(typeof validateApplicationServerKey, "function");
  await assert.doesNotReject(validateApplicationServerKey(VALID_VAPID_PUBLIC_KEY));
  await assert.rejects(validateApplicationServerKey(OFF_CURVE_VAPID_PUBLIC_KEY), (error) => error?.code === "invalid_public_key");

  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { configurable: true, writable: true, value: undefined });
  try {
    await assert.rejects(validateApplicationServerKey(VALID_VAPID_PUBLIC_KEY), (error) => error?.code === "invalid_public_key");
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "crypto", descriptor);
    else delete globalThis.crypto;
  }
});

test("subscription preflight prepares the ready service worker and existing subscription without prompting", async () => {
  assert.equal(typeof notificationClient.prepareNotificationSubscription, "function");
  const existing = existingSubscription();
  const runtime = installRuntime({
    permission: "granted",
    subscription: existing,
    fetchImpl: async () => {
      throw new Error("preflight must not call the API");
    },
  });
  try {
    const prepared = await notificationClient.prepareNotificationSubscription(VALID_VAPID_PUBLIC_KEY, CONFIGURATION_ID);
    assert.ok(prepared.applicationServerKey instanceof Uint8Array);
    assert.equal(prepared.applicationServerKey.length, 65);
    assert.equal(prepared.configurationId, CONFIGURATION_ID);
    assert.ok(Number.isSafeInteger(prepared.preparedAt));
    assert.strictEqual(prepared.existingSubscription, existing);
    assert.strictEqual(prepared.registration.pushManager, runtime.pushManager);
    assert.equal(runtime.permissionRequests(), 0);
    assert.equal(runtime.subscribeCalls(), 0);
  } finally {
    runtime.restore();
  }
});

test("configuration is fetched from the same-origin relative API and reports default-off honestly", async () => {
  const calls = [];
  const runtime = installRuntime({
    fetchImpl: async (...args) => {
      calls.push(args);
      return jsonResponse({ enabled: false, publicKey: null });
    },
  });
  try {
    assert.deepEqual(await getNotificationConfiguration(), {
      enabled: false,
      publicKey: null,
      configurationId: null,
    });
    assert.equal(calls[0][0], "/api/notifications");
    assert.equal(calls[0][1].method, "GET");
    assert.equal(calls[0][1].credentials, "same-origin");
  } finally {
    runtime.restore();
  }
});

test("subscribe refuses to start without completed non-prompting preflight state", async () => {
  let fetchCalls = 0;
  const runtime = installRuntime({
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse({ enabled: true, publicKey: VALID_VAPID_PUBLIC_KEY });
    },
  });
  try {
    await assert.rejects(
      subscribeToNotifications(prefillNotificationPreferences(3, "UTC")),
      (error) => error?.code === "registration_unavailable",
    );
    assert.equal(fetchCalls, 0);
    assert.equal(runtime.permissionRequests(), 0);
    assert.equal(runtime.subscribeCalls(), 0);
  } finally {
    runtime.restore();
  }
});

test("subscribe rejects expired prepared state before permission or PushManager work", async () => {
  const runtime = installRuntime({
    fetchImpl: async () => { throw new Error("stale preparation must not reach the API"); },
  });
  try {
    await assert.rejects(subscribeToNotifications(prefillNotificationPreferences(3, "UTC"), {
      prepared: {
        ...runtime.prepared(null),
        preparedAt: Date.now() - (6 * 60 * 1000),
      },
    }), (error) => error?.code === "configuration_stale");
    assert.equal(runtime.permissionRequests(), 0);
    assert.equal(runtime.subscribeCalls(), 0);
  } finally {
    runtime.restore();
  }
});

test("subscribe rejects an empty schedule before prepared state, permission, or push work", async () => {
  let fetchCalls = 0;
  const runtime = installRuntime({
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse({ enabled: true, publicKey: VALID_VAPID_PUBLIC_KEY });
    },
  });
  const preferences = { ...prefillNotificationPreferences(3, "UTC"), schedule: [] };
  try {
    await assert.rejects(subscribeToNotifications(preferences), (error) => error?.code === "invalid_preferences");
    assert.equal(fetchCalls, 0);
    assert.equal(runtime.permissionRequests(), 0);
    assert.equal(runtime.subscribeCalls(), 0);
  } finally {
    runtime.restore();
  }
});

test("subscription preflight rejects a malformed public key without requesting permission", async () => {
  const runtime = installRuntime({
    fetchImpl: async () => { throw new Error("preflight must not call the API"); },
  });
  try {
    await assert.rejects(notificationClient.prepareNotificationSubscription("not base64!", CONFIGURATION_ID), (error) => error?.code === "invalid_public_key");
    assert.equal(runtime.permissionRequests(), 0);
    assert.equal(runtime.subscribeCalls(), 0);
  } finally {
    runtime.restore();
  }
});

test("short, off-curve, noncanonical, and unverifiable public keys fail during non-prompting preflight", async (t) => {
  const cases = [
    ["short", "AQIDBA"],
    ["off-curve", OFF_CURVE_VAPID_PUBLIC_KEY],
    ["noncanonical", `${VALID_VAPID_PUBLIC_KEY}=`],
  ];

  for (const [name, publicKey] of cases) {
    await t.test(name, async () => {
      const runtime = installRuntime({
        fetchImpl: async () => { throw new Error("preflight must not call the API"); },
      });
      try {
        await assert.rejects(
          notificationClient.prepareNotificationSubscription(publicKey, CONFIGURATION_ID),
          (error) => error?.code === "invalid_public_key"
        );
        assert.equal(runtime.permissionRequests(), 0);
        assert.equal(runtime.subscribeCalls(), 0);
      } finally { runtime.restore(); }
    });
  }

  await t.test("Web Crypto unavailable", async () => {
    const runtime = installRuntime({
      fetchImpl: async () => { throw new Error("preflight must not call the API"); },
    });
    const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: undefined });
    try {
      await assert.rejects(
        notificationClient.prepareNotificationSubscription(VALID_VAPID_PUBLIC_KEY, CONFIGURATION_ID),
        (error) => error?.code === "invalid_public_key"
      );
      assert.equal(runtime.permissionRequests(), 0);
    } finally {
      if (cryptoDescriptor) Object.defineProperty(globalThis, "crypto", cryptoDescriptor);
      else delete globalThis.crypto;
      runtime.restore();
    }
  });
});

test("explicit subscribe invokes PushManager once, registers it, then stores only token and preferences", async () => {
  const requests = [];
  let promptCallbacks = 0;
  const preferences = prefillNotificationPreferences(4, "Asia/Kolkata");
  const runtime = installRuntime({
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return jsonResponse({ ok: true, deviceToken: "opaque.signed", preferences });
    },
  });
  try {
    assert.equal(runtime.permissionRequests(), 0, "module import and setup never prompt");
    assert.deepEqual(await subscribeToNotifications(preferences, {
      prepared: runtime.prepared(null),
      onPermissionPrompt: () => { promptCallbacks += 1; },
    }), { preferences });
    assert.equal(runtime.permissionRequests(), 0, "PushManager owns the browser permission prompt");
    assert.equal(promptCallbacks, 1);
    assert.equal(runtime.subscribeCalls(), 1);
    assert.equal(requests[0].url, "/api/notifications");
    assert.equal(requests[0].options.method, "POST");
    assert.equal(requests[0].options.credentials, "same-origin");
    assert.deepEqual(JSON.parse(requests[0].options.body), {
      configurationId: CONFIGURATION_ID,
      subscription: { endpoint: "https://push.example/device", expirationTime: null, keys: { p256dh: "key", auth: "auth" } },
      preferences,
    });
    assert.equal(runtime.storage.getItem(TOKEN_KEY), "opaque.signed");
    assert.deepEqual(JSON.parse(runtime.storage.getItem(PREFERENCES_KEY)), preferences);
    assert.equal(runtime.storage.getItem(CONFIGURATION_KEY), CONFIGURATION_ID);
    assert.doesNotMatch(JSON.stringify(requests.map(({ url }) => url)), /opaque\.signed/);
  } finally {
    runtime.restore();
  }
});

test("prompt callback runs exactly once immediately before PushManager.subscribe", async () => {
  const order = [];
  const preferences = prefillNotificationPreferences(3, "UTC");
  const runtime = installRuntime({
    fetchImpl: async (_url, options) => {
      order.push(options.method);
      return jsonResponse({ ok: true, deviceToken: "opaque.signed", preferences });
    },
  });
  const subscribe = runtime.pushManager.subscribe;
  runtime.pushManager.subscribe = (options) => {
    order.push("subscribe");
    runtime.notificationValue.permission = "granted";
    return subscribe(options);
  };
  try {
    await subscribeToNotifications(preferences, {
      prepared: runtime.prepared(null),
      onPermissionPrompt: () => order.push("promptCallback"),
    });
    assert.deepEqual(order, ["promptCallback", "subscribe", "POST", "PATCH"]);
    assert.equal(order.filter((value) => value === "promptCallback").length, 1);
    assert.equal(runtime.permissionRequests(), 0);
  } finally {
    runtime.restore();
  }
});

test("iPhone subscribe uses preflighted state before transient user activation can expire", async () => {
  const order = [];
  let activationActive = true;
  const preferences = prefillNotificationPreferences(3, "UTC");
  const runtime = installRuntime({
    fetchImpl: async (_url, options) => {
      order.push(options.method);
      if (options.method === "GET") {
        activationActive = false;
        return jsonResponse({ enabled: true, publicKey: VALID_VAPID_PUBLIC_KEY });
      }
      return jsonResponse({ ok: true, deviceToken: "opaque.signed", preferences });
    },
  });
  runtime.notificationValue.requestPermission = async () => {
    order.push("requestPermission");
    throw new Error("transient activation expired");
  };
  const prepared = {
    applicationServerKey: vapidKeyToUint8Array(VALID_VAPID_PUBLIC_KEY),
    configurationId: CONFIGURATION_ID,
    existingSubscription: null,
    preparedAt: Date.now(),
    registration: {
      pushManager: {
        subscribe: async (options) => {
          order.push("subscribe");
          assert.equal(activationActive, true, "PushManager.subscribe must run in the original tap activation");
          assert.equal(options.userVisibleOnly, true);
          runtime.notificationValue.permission = "granted";
          return {
            toJSON: () => ({
              endpoint: "https://push.example/iphone",
              expirationTime: null,
              keys: { p256dh: "key", auth: "auth" },
            }),
            unsubscribe: async () => true,
          };
        },
      },
    },
  };

  try {
    assert.deepEqual(await subscribeToNotifications(preferences, {
      prepared,
      onPermissionPrompt: () => order.push("promptCallback"),
    }), { preferences });
    assert.deepEqual(order, ["promptCallback", "subscribe", "POST", "PATCH"]);
  } finally {
    runtime.restore();
  }
});

test("granted permission immediately revalidates the existing browser subscription without prompting", async () => {
  let unsubscribeCalls = 0;
  const existing = {
    toJSON: () => ({ endpoint: "https://push.example/existing", expirationTime: null, keys: { p256dh: "key", auth: "auth" } }),
    unsubscribe: async () => { unsubscribeCalls += 1; return true; },
  };
  const preferences = prefillNotificationPreferences(2, "UTC");
  const runtime = installRuntime({
    permission: "granted",
    subscription: existing,
    fetchImpl: async () => jsonResponse({ ok: true, deviceToken: "opaque.signed", preferences }),
  });
  try {
    let callbacks = 0;
    await subscribeToNotifications(preferences, {
      prepared: runtime.prepared(existing),
      onPermissionPrompt: () => { callbacks += 1; },
    });
    assert.equal(runtime.permissionRequests(), 0);
    assert.equal(runtime.subscribeCalls(), 1);
    assert.equal(callbacks, 0);
    assert.equal(unsubscribeCalls, 0);
  } finally {
    runtime.restore();
  }
});

test("denial returns a safe enum and never creates or registers a subscription", async () => {
  const methods = [];
  const runtime = installRuntime({
    permission: "denied",
    fetchImpl: async (_url, options) => {
      methods.push(options.method);
      return jsonResponse({ enabled: true, publicKey: VALID_VAPID_PUBLIC_KEY });
    },
  });
  try {
    await assert.rejects(subscribeToNotifications(prefillNotificationPreferences(3, "UTC")), (error) => error?.code === "permission_denied" && !/response|endpoint|token/i.test(error.message));
    assert.equal(runtime.permissionRequests(), 0);
    assert.equal(runtime.subscribeCalls(), 0);
    assert.deepEqual(methods, []);
  } finally {
    runtime.restore();
  }
});

test("a failed server registration retains the browser subscription for a safe retry", async () => {
  let browserSubscription;
  let posts = 0;
  let unsubscribeCalls = 0;
  const preferences = prefillNotificationPreferences(3, "UTC");
  const runtime = installRuntime({
    fetchImpl: async (_url, options) => {
      posts += 1;
      browserSubscription = await runtime.pushManager.getSubscription();
      browserSubscription.unsubscribe = async () => { unsubscribeCalls += 1; return true; };
      return posts === 1
        ? jsonResponse({ error: "sensitive server detail" }, { ok: false, status: 500 })
        : jsonResponse({ ok: true, deviceToken: "opaque.signed", preferences });
    },
  });
  try {
    await assert.rejects(subscribeToNotifications(preferences, {
      prepared: runtime.prepared(null),
    }), (error) => error?.code === "registration_failed" && !error.message.includes("sensitive"));
    assert.equal(unsubscribeCalls, 0);
    assert.equal(runtime.storage.getItem(TOKEN_KEY), null);

    assert.deepEqual(await subscribeToNotifications(preferences, {
      prepared: runtime.prepared(browserSubscription),
    }), { preferences });
    assert.equal(unsubscribeCalls, 0);
    assert.equal(runtime.storage.getItem(TOKEN_KEY), "opaque.signed");
  } finally {
    runtime.restore();
  }
});

test("failed activation retains a controllable pending credential and retries without resubscribing", async () => {
  const requests = [];
  let activationAttempts = 0;
  const preferences = prefillNotificationPreferences(3, "UTC");
  const runtime = installRuntime({
    fetchImpl: async (_url, options) => {
      requests.push(options.method);
      if (options.method === "POST") {
        return jsonResponse({ ok: true, deviceToken: "opaque.signed", preferences }, { status: 201 });
      }
      activationAttempts += 1;
      return activationAttempts === 1
        ? jsonResponse({ error: "temporary activation failure" }, { ok: false, status: 503 })
        : jsonResponse({ ok: true, preferences });
    },
  });

  try {
    await assert.rejects(subscribeToNotifications(preferences, {
      prepared: runtime.prepared(null),
    }), (error) => error?.code === "activation_failed" && !error.message.includes("temporary"));
    assert.equal(runtime.storage.getItem(TOKEN_KEY), "opaque.signed");
    assert.equal(runtime.storage.getItem(PENDING_KEY), "true");
    assert.equal(notificationClient.hasNotificationSubscription(), false);
    assert.equal(notificationClient.hasNotificationCredential(), true);
    assert.equal(notificationClient.hasPendingNotificationRegistration(), true);
    assert.equal(runtime.subscribeCalls(), 1);

    assert.deepEqual(await subscribeToNotifications(preferences), { preferences });
    assert.deepEqual(requests, ["POST", "PATCH", "PATCH"]);
    assert.equal(runtime.subscribeCalls(), 1, "pending activation retries must not touch PushManager");
    assert.equal(runtime.storage.getItem(PENDING_KEY), null);
    assert.equal(notificationClient.hasNotificationSubscription(), true);
  } finally {
    runtime.restore();
  }
});

test("an expired pending credential can reauthorize only inside the deliberate Enable retry", async () => {
  const requests = [];
  const preferences = prefillNotificationPreferences(3, "UTC");
  const storage = memoryStorage({
    [TOKEN_KEY]: "expired-token.signature",
    [PREFERENCES_KEY]: JSON.stringify(preferences),
    [PENDING_KEY]: "true",
  });
  const runtime = installRuntime({
    permission: "granted",
    subscription: existingSubscription(),
    storage,
    fetchImpl: async (_url, options) => {
      requests.push(options);
      if (requests.length === 1) {
        return jsonResponse({ error: "expired" }, { ok: false, status: 401 });
      }
      if (options.method === "POST") {
        return jsonResponse({ ok: true, deviceToken: "new-token.signature", preferences }, { status: 201 });
      }
      return jsonResponse({ ok: true, preferences });
    },
  });

  try {
    assert.deepEqual(await subscribeToNotifications(preferences), { preferences });
    assert.deepEqual(requests.map(({ method }) => method), ["PATCH", "POST", "PATCH"]);
    assert.deepEqual(JSON.parse(requests[1].body), {
      configurationId: CONFIGURATION_ID,
      subscription: existingSubscription().toJSON(),
      preferences,
    });
    assert.deepEqual(JSON.parse(requests[2].body), { activate: true, preferences });
    assert.equal(runtime.subscribeCalls(), 0);
    assert.equal(storage.getItem(TOKEN_KEY), "new-token.signature");
    assert.equal(storage.getItem(PENDING_KEY), null);
  } finally {
    runtime.restore();
  }
});

test("pending registration never activates from workout completion or proactive renewal", async () => {
  const preferences = prefillNotificationPreferences(3, "UTC");
  const requests = [];
  const storage = memoryStorage({
    [TOKEN_KEY]: "expired-token.signature",
    [PREFERENCES_KEY]: JSON.stringify(preferences),
    [PENDING_KEY]: "true",
  });
  const runtime = installRuntime({
    permission: "granted",
    subscription: existingSubscription(),
    storage,
    fetchImpl: async (_url, options) => {
      requests.push(options);
      return jsonResponse({ error: "expired" }, { ok: false, status: 401 });
    },
  });

  try {
    assert.equal(await syncWorkoutCompletion("2026-07-17"), false);
    assert.deepEqual(
      await notificationClient.renewNotificationAuthorizationIfNeeded({ now: Date.now() }),
      { state: "pending" },
    );
    assert.equal(requests.length, 0);
    assert.equal(storage.getItem(PENDING_KEY), "true");
  } finally {
    runtime.restore();
  }
});

test("rollback never claims an ambiguous subscription created after a stale empty preflight", async () => {
  let unsubscribeCalls = 0;
  const concurrentSubscription = {
    toJSON: () => ({ endpoint: "https://push.example/concurrent", expirationTime: null, keys: { p256dh: "key", auth: "auth" } }),
    unsubscribe: async () => { unsubscribeCalls += 1; return true; },
  };
  const runtime = installRuntime({
    permission: "granted",
    fetchImpl: async () => jsonResponse({ error: "temporary failure" }, { ok: false, status: 500 }),
  });
  runtime.pushManager.subscribe = async () => concurrentSubscription;

  try {
    await assert.rejects(subscribeToNotifications(prefillNotificationPreferences(3, "UTC"), {
      prepared: runtime.prepared(null),
    }), (error) => error?.code === "registration_failed");
    assert.equal(unsubscribeCalls, 0, "a granted-permission subscription may belong to another same-origin context");
  } finally {
    runtime.restore();
  }
});

test("rollback retains a replacement returned after a stale existing preflight", async () => {
  let unsubscribeCalls = 0;
  const staleSubscription = existingSubscription();
  const replacement = {
    toJSON: () => ({ endpoint: "https://push.example/replacement", expirationTime: null, keys: { p256dh: "key", auth: "auth" } }),
    unsubscribe: async () => { unsubscribeCalls += 1; return true; },
  };
  const runtime = installRuntime({
    permission: "granted",
    fetchImpl: async () => jsonResponse({ error: "temporary failure" }, { ok: false, status: 500 }),
  });
  runtime.pushManager.subscribe = async () => replacement;

  try {
    await assert.rejects(subscribeToNotifications(prefillNotificationPreferences(3, "UTC"), {
      prepared: runtime.prepared(staleSubscription),
    }), (error) => error?.code === "registration_failed");
    assert.equal(unsubscribeCalls, 0, "a replacement cannot be attributed safely to this tap");
  } finally {
    runtime.restore();
  }
});

test("local persistence failure deletes the new server record and retains the browser subscription", async () => {
  const order = [];
  let created;
  const storage = {
    getItem: () => null,
    setItem: () => { throw new Error("quota detail"); },
    removeItem: (key) => order.push(`clear:${key}`),
  };
  const preferences = prefillNotificationPreferences(3, "UTC");
  const runtime = installRuntime({
    storage,
    fetchImpl: async (url, options) => {
      assert.equal(url, "/api/notifications");
      if (options.method === "POST") {
        order.push("POST");
        created = await runtime.pushManager.getSubscription();
        created.unsubscribe = async () => { order.push("unsubscribe"); return true; };
        return jsonResponse({ ok: true, deviceToken: "opaque.signed", preferences });
      }
      order.push("DELETE");
      assert.equal(options.headers.Authorization, "Bearer opaque.signed");
      return jsonResponse({ ok: true });
    },
  });
  try {
    await assert.rejects(subscribeToNotifications(preferences, {
      prepared: runtime.prepared(null),
    }), (error) => error?.code === "registration_failed" && !error.message.includes("quota"));
    assert.ok(order.indexOf("DELETE") > order.indexOf("POST"));
    assert.equal(order.includes("unsubscribe"), false);
    assert.equal(storage.getItem(TOKEN_KEY), null);
    assert.equal(storage.getItem(PREFERENCES_KEY), null);
  } finally {
    runtime.restore();
  }
});

test("subscription preflight and PushManager failures are always remapped to safe client errors", async (t) => {
  const rawMessage = "raw DOM exception with private detail";
  const preferences = prefillNotificationPreferences(3, "UTC");
  const noFetch = async () => { throw new Error("unexpected API request"); };

  await t.test("service worker ready rejection", async () => {
    const runtime = installRuntime({ permission: "granted", fetchImpl: noFetch });
    globalThis.navigator.serviceWorker.ready = { then: (_resolve, reject) => reject(new Error(rawMessage)) };
    try {
      await assert.rejects(
        notificationClient.prepareNotificationSubscription(VALID_VAPID_PUBLIC_KEY, CONFIGURATION_ID),
        (error) => error?.name === "NotificationClientError" && error?.code === "service_worker_unavailable" && !error.message.includes(rawMessage),
      );
    } finally { runtime.restore(); }
  });

  await t.test("getSubscription rejection", async () => {
    const runtime = installRuntime({ permission: "granted", fetchImpl: noFetch });
    runtime.pushManager.getSubscription = async () => { throw new Error(rawMessage); };
    try {
      await assert.rejects(
        notificationClient.prepareNotificationSubscription(VALID_VAPID_PUBLIC_KEY, CONFIGURATION_ID),
        (error) => error?.name === "NotificationClientError" && error?.code === "subscription_failed" && !error.message.includes(rawMessage),
      );
    } finally { runtime.restore(); }
  });

  await t.test("subscribe rejection", async () => {
    const runtime = installRuntime({ permission: "granted", fetchImpl: noFetch });
    runtime.pushManager.subscribe = async () => { throw new Error(rawMessage); };
    try {
      await assert.rejects(
        subscribeToNotifications(preferences, { prepared: runtime.prepared(null) }),
        (error) => error?.name === "NotificationClientError" && error?.code === "registration_failed" && !error.message.includes(rawMessage),
      );
    } finally { runtime.restore(); }
  });

  await t.test("permission denial from PushManager", async () => {
    let callbacks = 0;
    const runtime = installRuntime({ fetchImpl: noFetch });
    runtime.pushManager.subscribe = async () => {
      runtime.notificationValue.permission = "denied";
      throw new Error(rawMessage);
    };
    try {
      await assert.rejects(
        subscribeToNotifications(preferences, {
          prepared: runtime.prepared(null),
          onPermissionPrompt: () => { callbacks += 1; },
        }),
        (error) => error?.name === "NotificationClientError" && error?.code === "permission_denied" && !error.message.includes(rawMessage),
      );
      assert.equal(callbacks, 1);
    } finally { runtime.restore(); }
  });
});

test("preference and completion PATCH requests use bearer auth and minimal bodies", async () => {
  const preferences = prefillNotificationPreferences(5, "UTC");
  const requests = [];
  const storage = memoryStorage({ [TOKEN_KEY]: "opaque.signed", [PREFERENCES_KEY]: JSON.stringify(preferences) });
  const runtime = installRuntime({
    permission: "granted",
    storage,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return jsonResponse({ ok: true, preferences });
    },
  });
  try {
    assert.deepEqual(await updateNotificationPreferences(preferences), { preferences });
    assert.equal(await syncWorkoutCompletion("2026-07-17"), true);
    for (const request of requests) {
      assert.equal(request.url, "/api/notifications");
      assert.equal(request.options.method, "PATCH");
      assert.equal(request.options.credentials, "same-origin");
      assert.equal(request.options.headers.Authorization, "Bearer opaque.signed");
    }
    assert.deepEqual(JSON.parse(requests[0].options.body), { preferences });
    assert.deepEqual(JSON.parse(requests[1].options.body), { lastWorkoutCompletionDate: "2026-07-17" });
    assert.doesNotMatch(requests[1].options.body, /exercise|duration|volume|difficulty|pain|profile|name/i);
    await assert.rejects(syncWorkoutCompletion("17/07/2026"), (error) => error?.code === "invalid_completion_date");
  } finally {
    runtime.restore();
  }
});

test("a 401 silently reauthorizes the exact existing subscription with stored preferences before one retry", async () => {
  const stored = prefillNotificationPreferences(3, "UTC");
  const requested = { ...stored, paused: true };
  const requests = [];
  const storage = memoryStorage({
    [TOKEN_KEY]: "old-token.signature",
    [PREFERENCES_KEY]: JSON.stringify(stored),
  });
  const runtime = installRuntime({
    permission: "granted",
    subscription: existingSubscription(),
    storage,
    fetchImpl: async (_url, options) => {
      requests.push(options);
      if (requests.length === 1) {
        return jsonResponse({ error: "rotated secret and private backend detail" }, { ok: false, status: 401 });
      }
      if (options.method === "POST") {
        return jsonResponse({ ok: true, deviceToken: "new-token.signature", preferences: stored }, { status: 201 });
      }
      return jsonResponse({ ok: true, preferences: requested });
    },
  });

  try {
    assert.deepEqual(await updateNotificationPreferences(requested), { preferences: requested });
    assert.deepEqual(requests.map(({ method }) => method), ["PATCH", "POST", "PATCH", "PATCH"]);
    assert.equal(requests[0].headers.Authorization, "Bearer old-token.signature");
    assert.deepEqual(JSON.parse(requests[1].body), {
      configurationId: CONFIGURATION_ID,
      subscription: existingSubscription().toJSON(),
      preferences: stored,
    });
    assert.equal(requests[2].headers.Authorization, "Bearer new-token.signature");
    assert.deepEqual(JSON.parse(requests[2].body), { activate: true, preferences: stored });
    assert.equal(requests[3].headers.Authorization, "Bearer new-token.signature");
    assert.deepEqual(JSON.parse(requests[3].body), { preferences: requested });
    assert.equal(runtime.permissionRequests(), 0);
    assert.equal(runtime.subscribeCalls(), 0);
    assert.equal(storage.getItem(TOKEN_KEY), "new-token.signature");
  } finally {
    runtime.restore();
  }
});

test("completion sync and deletion each reauthorize then retry at most once without prompting", async (t) => {
  const stored = prefillNotificationPreferences(4, "UTC");
  for (const scenario of [
    { name: "completion", run: () => syncWorkoutCompletion("2026-07-17"), method: "PATCH" },
    { name: "deletion", run: () => deleteNotificationSubscription(), method: "DELETE" },
  ]) {
    await t.test(scenario.name, async () => {
      const requests = [];
      const storage = memoryStorage({
        [TOKEN_KEY]: "old-token.signature",
        [PREFERENCES_KEY]: JSON.stringify(stored),
      });
      const runtime = installRuntime({
        permission: "granted",
        subscription: existingSubscription(),
        storage,
        fetchImpl: async (_url, options) => {
          requests.push(options);
          const operationAttempts = requests.filter(({ method }) => method === scenario.method).length;
          if (options.method === scenario.method && operationAttempts === 1) {
            return jsonResponse({ error: "secret rotation" }, { ok: false, status: 401 });
          }
          if (options.method === "POST") {
            return jsonResponse({ ok: true, deviceToken: "new-token.signature", preferences: stored }, { status: 201 });
          }
          return jsonResponse({ ok: true, ...(scenario.method === "PATCH" ? { preferences: stored } : {}) });
        },
      });

      try {
        assert.equal(await scenario.run(), true);
        assert.deepEqual(
          requests.map(({ method }) => method),
          scenario.method === "DELETE"
            ? ["DELETE", "POST", "PATCH", "DELETE"]
            : ["PATCH", "POST", "PATCH", "PATCH"],
        );
        assert.equal(requests.filter(({ method }) => method === "POST").length, 1);
        assert.equal(runtime.permissionRequests(), 0);
        assert.equal(runtime.subscribeCalls(), 0);
        assert.equal(storage.getItem(TOKEN_KEY), scenario.method === "DELETE" ? null : "new-token.signature");
      } finally {
        runtime.restore();
      }
    });
  }
});

test("a second 401 stays safely typed and cannot start another reauthorization loop", async () => {
  const preferences = prefillNotificationPreferences(3, "UTC");
  const requests = [];
  const storage = memoryStorage({
    [TOKEN_KEY]: "old-token.signature",
    [PREFERENCES_KEY]: JSON.stringify(preferences),
  });
  const runtime = installRuntime({
    permission: "granted",
    subscription: existingSubscription(),
    storage,
    fetchImpl: async (_url, options) => {
      requests.push(options);
      if (options.method === "POST") {
        return jsonResponse({ ok: true, deviceToken: "new-token.signature", preferences }, { status: 201 });
      }
      return jsonResponse({ error: "sensitive authorization body" }, { ok: false, status: 401 });
    },
  });

  try {
    await assert.rejects(
      updateNotificationPreferences(preferences),
      (error) => error?.name === "NotificationClientError"
        && error?.code === "update_failed"
        && error?.status === 401
        && !error.message.includes("sensitive"),
    );
    assert.deepEqual(requests.map(({ method }) => method), ["PATCH", "POST", "PATCH"]);
    assert.equal(requests.filter(({ method }) => method === "POST").length, 1);
  } finally {
    runtime.restore();
  }
});

test("failed silent reauthorization preserves the original typed 401 and retry credential", async () => {
  const preferences = prefillNotificationPreferences(3, "UTC");
  const requests = [];
  const storage = memoryStorage({
    [TOKEN_KEY]: "old-token.signature",
    [PREFERENCES_KEY]: JSON.stringify(preferences),
  });
  const runtime = installRuntime({
    permission: "granted",
    subscription: existingSubscription(),
    storage,
    fetchImpl: async (_url, options) => {
      requests.push(options);
      return options.method === "PATCH"
        ? jsonResponse({ error: "secret rotation" }, { ok: false, status: 401 })
        : jsonResponse({ error: "refresh unavailable" }, { ok: false, status: 409 });
    },
  });

  try {
    await assert.rejects(
      updateNotificationPreferences(preferences),
      (error) => error?.code === "update_failed" && error?.status === 401,
    );
    assert.deepEqual(requests.map(({ method }) => method), ["PATCH", "POST"]);
    assert.equal(storage.getItem(TOKEN_KEY), "old-token.signature");
    assert.equal(runtime.permissionRequests(), 0);
    assert.equal(runtime.subscribeCalls(), 0);
  } finally {
    runtime.restore();
  }
});

test("a legacy local credential without a configuration ID fails closed without re-registering", async () => {
  const preferences = prefillNotificationPreferences(3, "UTC");
  const requests = [];
  const storage = memoryStorage({
    [TOKEN_KEY]: "legacy-token.signature",
    [PREFERENCES_KEY]: JSON.stringify(preferences),
  });
  storage.removeItem(CONFIGURATION_KEY);
  const runtime = installRuntime({
    permission: "granted",
    subscription: existingSubscription(),
    storage,
    fetchImpl: async (_url, options) => {
      requests.push(options);
      return jsonResponse({ error: "expired" }, { ok: false, status: 401 });
    },
  });

  try {
    await assert.rejects(
      updateNotificationPreferences(preferences),
      (error) => error?.code === "update_failed" && error?.status === 401,
    );
    assert.deepEqual(requests.map(({ method }) => method), ["PATCH"]);
    assert.equal(storage.getItem(TOKEN_KEY), "legacy-token.signature");
    assert.equal(storage.getItem(CONFIGURATION_KEY), null);
    assert.equal(runtime.permissionRequests(), 0);
    assert.equal(runtime.subscribeCalls(), 0);
  } finally {
    runtime.restore();
  }
});

test("a pending credential 401 cannot auto-activate through a non-enable mutation", async () => {
  const preferences = prefillNotificationPreferences(3, "UTC");
  const requests = [];
  const storage = memoryStorage({
    [TOKEN_KEY]: "pending-token.signature",
    [PREFERENCES_KEY]: JSON.stringify(preferences),
    [PENDING_KEY]: "true",
  });
  const runtime = installRuntime({
    permission: "granted",
    subscription: existingSubscription(),
    storage,
    fetchImpl: async (_url, options) => {
      requests.push(options);
      return jsonResponse({ error: "expired" }, { ok: false, status: 401 });
    },
  });

  try {
    await assert.rejects(
      updateNotificationPreferences(preferences),
      (error) => error?.code === "update_failed" && error?.status === 401,
    );
    assert.deepEqual(requests.map(({ method }) => method), ["PATCH"]);
    assert.equal(storage.getItem(PENDING_KEY), "true");
  } finally {
    runtime.restore();
  }
});

test("local persistence failure during reauthorization restores the previous retry credential", async () => {
  const preferences = prefillNotificationPreferences(3, "UTC");
  const values = new Map([
    [TOKEN_KEY, "old-token.signature"],
    [PREFERENCES_KEY, JSON.stringify(preferences)],
    [CONFIGURATION_KEY, CONFIGURATION_ID],
  ]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      if (key === TOKEN_KEY && value === "new-token.signature") throw new Error("private quota detail");
      values.set(key, String(value));
    },
    removeItem: (key) => values.delete(key),
  };
  const requests = [];
  const runtime = installRuntime({
    permission: "granted",
    subscription: existingSubscription(),
    storage,
    fetchImpl: async (_url, options) => {
      requests.push(options);
      return options.method === "PATCH"
        ? jsonResponse({ error: "rotated secret" }, { ok: false, status: 401 })
        : jsonResponse({ ok: true, deviceToken: "new-token.signature", preferences }, { status: 201 });
    },
  });

  try {
    await assert.rejects(
      updateNotificationPreferences(preferences),
      (error) => error?.code === "update_failed"
        && error?.status === 401
        && !error.message.includes("quota"),
    );
    assert.deepEqual(requests.map(({ method }) => method), ["PATCH", "POST"]);
    assert.equal(storage.getItem(TOKEN_KEY), "old-token.signature");
    assert.deepEqual(JSON.parse(storage.getItem(PREFERENCES_KEY)), preferences);
  } finally {
    runtime.restore();
  }
});

test("proactive authorization renewal refreshes only near-expiry credentials without prompting", async () => {
  assert.equal(typeof notificationClient.renewNotificationAuthorizationIfNeeded, "function");
  const now = Date.now();
  const preferences = prefillNotificationPreferences(3, "UTC");
  const requests = [];
  const storage = memoryStorage({
    [TOKEN_KEY]: lifecycleToken(now + (24 * 60 * 60 * 1000)),
    [PREFERENCES_KEY]: JSON.stringify(preferences),
  });
  const runtime = installRuntime({
    permission: "granted",
    subscription: existingSubscription(),
    storage,
    fetchImpl: async (_url, options) => {
      requests.push(options);
      return jsonResponse({ ok: true, deviceToken: "renewed-token.signature", preferences }, { status: 201 });
    },
  });

  try {
    assert.deepEqual(
      await notificationClient.renewNotificationAuthorizationIfNeeded({ now }),
      { state: "renewed", preferences },
    );
    assert.deepEqual(requests.map(({ method }) => method), ["POST", "PATCH"]);
    assert.equal(runtime.permissionRequests(), 0);
    assert.equal(runtime.subscribeCalls(), 0);
    assert.equal(storage.getItem(TOKEN_KEY), "renewed-token.signature");

    storage.setItem(TOKEN_KEY, lifecycleToken(now + (30 * 24 * 60 * 60 * 1000)));
    requests.length = 0;
    assert.deepEqual(
      await notificationClient.renewNotificationAuthorizationIfNeeded({ now }),
      { state: "current" },
    );
    assert.equal(requests.length, 0);
  } finally {
    runtime.restore();
  }
});

test("delete retains its retry credential after server failure and still unsubscribes locally", async () => {
  const order = [];
  const preferences = prefillNotificationPreferences(3, "UTC");
  const subscription = {
    toJSON: () => ({}),
    unsubscribe: async () => { order.push("unsubscribe"); return true; },
  };
  const storage = memoryStorage({
    [TOKEN_KEY]: "opaque.signed",
    [PREFERENCES_KEY]: JSON.stringify(preferences),
    [OFFERED_PLAN_KEY]: "123",
  });
  const runtime = installRuntime({
    permission: "granted",
    subscription,
    storage,
    fetchImpl: async (_url, options) => {
      order.push(options.method);
      return jsonResponse({ error: "hidden" }, { ok: false, status: 503 });
    },
  });
  try {
    await assert.rejects(deleteNotificationSubscription(), (error) => error?.code === "delete_failed" && !error.message.includes("hidden"));
    assert.deepEqual(order, ["DELETE", "unsubscribe"]);
    assert.equal(storage.getItem(TOKEN_KEY), "opaque.signed");
    assert.deepEqual(JSON.parse(storage.getItem(PREFERENCES_KEY)), preferences);
    assert.equal(storage.getItem(OFFERED_PLAN_KEY), "123");
  } finally {
    runtime.restore();
  }
});

test("delete preserves exact subscription proof when reauthorization fails and succeeds on a later retry", async () => {
  const preferences = prefillNotificationPreferences(3, "UTC");
  const proof = existingSubscription().toJSON();
  const requests = [];
  let refreshAttempts = 0;
  let unsubscribeAttempts = 0;
  const subscription = {
    toJSON: () => proof,
    unsubscribe: async () => { unsubscribeAttempts += 1; return true; },
  };
  const storage = memoryStorage({
    [TOKEN_KEY]: "old-token.signature",
    [PREFERENCES_KEY]: JSON.stringify(preferences),
  });
  const runtime = installRuntime({
    permission: "granted",
    subscription,
    storage,
    fetchImpl: async (_url, options) => {
      requests.push(options);
      if (options.method === "POST") {
        refreshAttempts += 1;
        return refreshAttempts === 1
          ? jsonResponse({ error: "private transient refresh detail" }, { ok: false, status: 409 })
          : jsonResponse({ ok: true, deviceToken: "new-token.signature", preferences }, { status: 201 });
      }
      if (options.headers.Authorization === "Bearer old-token.signature") {
        return jsonResponse({ error: "private rotated-secret detail" }, { ok: false, status: 401 });
      }
      assert.equal(options.headers.Authorization, "Bearer new-token.signature");
      return jsonResponse({ ok: true });
    },
  });

  try {
    await assert.rejects(
      deleteNotificationSubscription(),
      (error) => error?.name === "NotificationClientError"
        && error?.code === "delete_failed"
        && error?.status === 401
        && !/private|refresh|rotated|secret/i.test(error.message),
    );
    assert.deepEqual(requests.map(({ method }) => method), ["DELETE", "POST"]);
    assert.equal(unsubscribeAttempts, 0);
    assert.equal(storage.getItem(TOKEN_KEY), "old-token.signature");
    assert.deepEqual(JSON.parse(storage.getItem(PREFERENCES_KEY)), preferences);

    assert.equal(await deleteNotificationSubscription(), true);
    assert.deepEqual(requests.map(({ method }) => method), ["DELETE", "POST", "DELETE", "POST", "PATCH", "DELETE"]);
    for (const request of requests.filter(({ method }) => method === "POST")) {
      assert.deepEqual(JSON.parse(request.body), {
        configurationId: CONFIGURATION_ID,
        subscription: proof,
        preferences,
      });
    }
    assert.equal(refreshAttempts, 2);
    assert.equal(unsubscribeAttempts, 1);
    assert.equal(runtime.permissionRequests(), 0);
    assert.equal(runtime.subscribeCalls(), 0);
    assert.equal(storage.getItem(TOKEN_KEY), null);
    assert.equal(storage.getItem(PREFERENCES_KEY), null);
  } finally {
    runtime.restore();
  }
});

test("expired pending registration reauthorizes directly into deletion without temporary activation", async () => {
  const preferences = prefillNotificationPreferences(3, "UTC");
  const requests = [];
  let unsubscribeCalls = 0;
  const storage = memoryStorage({
    [TOKEN_KEY]: "old-token.signature",
    [PREFERENCES_KEY]: JSON.stringify(preferences),
    [PENDING_KEY]: "true",
  });
  const runtime = installRuntime({
    permission: "granted",
    subscription: {
      ...existingSubscription(),
      unsubscribe: async () => { unsubscribeCalls += 1; return true; },
    },
    storage,
    fetchImpl: async (_url, options) => {
      requests.push(options);
      if (options.method === "POST") {
        return jsonResponse({ ok: true, deviceToken: "new-token.signature", preferences }, { status: 201 });
      }
      return options.headers.Authorization === "Bearer old-token.signature"
        ? jsonResponse({ error: "expired" }, { ok: false, status: 401 })
        : jsonResponse({ ok: true });
    },
  });

  try {
    assert.equal(await deleteNotificationSubscription(), true);
    assert.deepEqual(requests.map(({ method }) => method), ["DELETE", "POST", "DELETE"]);
    assert.deepEqual(JSON.parse(requests[1].body), {
      configurationId: CONFIGURATION_ID,
      subscription: existingSubscription().toJSON(),
      preferences,
    });
    assert.equal(unsubscribeCalls, 1);
    assert.equal(storage.getItem(TOKEN_KEY), null);
    assert.equal(storage.getItem(PENDING_KEY), null);
  } finally {
    runtime.restore();
  }
});

test("server-confirmed deletion clears local credentials even when browser unsubscribe fails", async () => {
  const rawMessage = "raw unsubscribe detail";
  const subscription = {
    toJSON: () => ({}),
    unsubscribe: async () => { throw new Error(rawMessage); },
  };
  const storage = memoryStorage({ [TOKEN_KEY]: "opaque.signed", [PREFERENCES_KEY]: "{}" });
  const runtime = installRuntime({
    permission: "granted",
    subscription,
    storage,
    fetchImpl: async () => jsonResponse({ ok: true }),
  });
  try {
    await assert.rejects(deleteNotificationSubscription(), (error) => error?.name === "NotificationClientError" && error?.code === "delete_failed" && !error.message.includes(rawMessage));
    assert.equal(storage.getItem(TOKEN_KEY), null);
    assert.equal(storage.getItem(PREFERENCES_KEY), null);
  } finally {
    runtime.restore();
  }
});

test("a retry after transient server deletion failure reuses the credential then clears it on confirmation", async () => {
  let deleteAttempts = 0;
  let unsubscribeAttempts = 0;
  const preferences = prefillNotificationPreferences(4, "UTC");
  const subscription = {
    unsubscribe: async () => { unsubscribeAttempts += 1; return true; },
  };
  const storage = memoryStorage({
    [TOKEN_KEY]: "opaque.signed",
    [PREFERENCES_KEY]: JSON.stringify(preferences),
  });
  const runtime = installRuntime({
    permission: "granted",
    subscription,
    storage,
    fetchImpl: async (_url, options) => {
      assert.equal(options.headers.Authorization, "Bearer opaque.signed");
      deleteAttempts += 1;
      return deleteAttempts === 1
        ? jsonResponse({ error: "hidden" }, { ok: false, status: 503 })
        : jsonResponse({ ok: true });
    },
  });
  try {
    await assert.rejects(deleteNotificationSubscription(), (error) => error?.code === "delete_failed");
    assert.equal(storage.getItem(TOKEN_KEY), "opaque.signed");

    assert.equal(await deleteNotificationSubscription(), true);
    assert.equal(deleteAttempts, 2);
    assert.equal(unsubscribeAttempts, 2);
    assert.equal(storage.getItem(TOKEN_KEY), null);
    assert.equal(storage.getItem(PREFERENCES_KEY), null);
  } finally {
    runtime.restore();
  }
});
