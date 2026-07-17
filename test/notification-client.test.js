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
  const values = new Map(Object.entries(initial));
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
      currentSubscription = {
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
    notificationValue,
    permissionRequests: () => permissionRequests,
    subscribeCalls: () => subscribeCalls,
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

test("configuration is fetched from the same-origin relative API and reports default-off honestly", async () => {
  const calls = [];
  const runtime = installRuntime({
    fetchImpl: async (...args) => {
      calls.push(args);
      return jsonResponse({ enabled: false, publicKey: null });
    },
  });
  try {
    assert.deepEqual(await getNotificationConfiguration(), { enabled: false, publicKey: null });
    assert.equal(calls[0][0], "/api/notifications");
    assert.equal(calls[0][1].method, "GET");
    assert.equal(calls[0][1].credentials, "same-origin");
  } finally {
    runtime.restore();
  }
});

test("subscribe checks server configuration before requesting permission", async () => {
  const calls = [];
  const runtime = installRuntime({
    fetchImpl: async (...args) => {
      calls.push(args);
      return jsonResponse({ enabled: false, publicKey: null });
    },
  });
  try {
    await assert.rejects(subscribeToNotifications(prefillNotificationPreferences(3, "UTC")), (error) => error?.code === "registration_unavailable");
    assert.equal(runtime.permissionRequests(), 0);
    assert.equal(runtime.subscribeCalls(), 0);
    assert.equal(calls.length, 1);
  } finally {
    runtime.restore();
  }
});

test("subscribe rejects an empty schedule before config, permission, or push work", async () => {
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

test("subscribe rejects a malformed public key before requesting permission", async () => {
  const runtime = installRuntime({
    fetchImpl: async () => jsonResponse({ enabled: true, publicKey: "not base64!" }),
  });
  try {
    await assert.rejects(subscribeToNotifications(prefillNotificationPreferences(3, "UTC")), (error) => error?.code === "invalid_public_key");
    assert.equal(runtime.permissionRequests(), 0);
    assert.equal(runtime.subscribeCalls(), 0);
  } finally {
    runtime.restore();
  }
});

test("short, off-curve, noncanonical, and unverifiable public keys never reach the permission boundary", async (t) => {
  const cases = [
    ["short", "AQIDBA"],
    ["off-curve", OFF_CURVE_VAPID_PUBLIC_KEY],
    ["noncanonical", `${VALID_VAPID_PUBLIC_KEY}=`],
  ];

  for (const [name, publicKey] of cases) {
    await t.test(name, async () => {
      let callbacks = 0;
      const runtime = installRuntime({
        fetchImpl: async () => jsonResponse({ enabled: true, publicKey }),
      });
      try {
        await assert.rejects(
          subscribeToNotifications(prefillNotificationPreferences(3, "UTC"), { onPermissionPrompt: () => { callbacks += 1; } }),
          (error) => error?.code === "invalid_public_key"
        );
        assert.equal(callbacks, 0);
        assert.equal(runtime.permissionRequests(), 0);
        assert.equal(runtime.subscribeCalls(), 0);
      } finally { runtime.restore(); }
    });
  }

  await t.test("Web Crypto unavailable", async () => {
    let callbacks = 0;
    const runtime = installRuntime({
      fetchImpl: async () => jsonResponse({ enabled: true, publicKey: VALID_VAPID_PUBLIC_KEY }),
    });
    const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: undefined });
    try {
      await assert.rejects(
        subscribeToNotifications(prefillNotificationPreferences(3, "UTC"), { onPermissionPrompt: () => { callbacks += 1; } }),
        (error) => error?.code === "invalid_public_key"
      );
      assert.equal(callbacks, 0);
      assert.equal(runtime.permissionRequests(), 0);
    } finally {
      if (cryptoDescriptor) Object.defineProperty(globalThis, "crypto", cryptoDescriptor);
      else delete globalThis.crypto;
      runtime.restore();
    }
  });
});

test("explicit subscribe prompts once, creates a browser subscription, registers it, then stores only token and preferences", async () => {
  const requests = [];
  const preferences = prefillNotificationPreferences(4, "Asia/Kolkata");
  const runtime = installRuntime({
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (options.method === "GET") return jsonResponse({ enabled: true, publicKey: VALID_VAPID_PUBLIC_KEY });
      return jsonResponse({ ok: true, deviceToken: "opaque.signed", preferences });
    },
  });
  try {
    assert.equal(runtime.permissionRequests(), 0, "module import and setup never prompt");
    assert.deepEqual(await subscribeToNotifications(preferences), { preferences });
    assert.equal(runtime.permissionRequests(), 1);
    assert.equal(runtime.subscribeCalls(), 1);
    assert.equal(requests[1].url, "/api/notifications");
    assert.equal(requests[1].options.method, "POST");
    assert.equal(requests[1].options.credentials, "same-origin");
    assert.deepEqual(JSON.parse(requests[1].options.body), {
      subscription: { endpoint: "https://push.example/device", expirationTime: null, keys: { p256dh: "key", auth: "auth" } },
      preferences,
    });
    assert.equal(runtime.storage.getItem(TOKEN_KEY), "opaque.signed");
    assert.deepEqual(JSON.parse(runtime.storage.getItem(PREFERENCES_KEY)), preferences);
    assert.doesNotMatch(JSON.stringify(requests.map(({ url }) => url)), /opaque\.signed/);
  } finally {
    runtime.restore();
  }
});

test("prompt callback runs exactly once immediately before requestPermission after every preflight", async () => {
  const order = [];
  const preferences = prefillNotificationPreferences(3, "UTC");
  const runtime = installRuntime({
    fetchImpl: async (_url, options) => {
      order.push(options.method);
      return options.method === "GET"
        ? jsonResponse({ enabled: true, publicKey: VALID_VAPID_PUBLIC_KEY })
        : jsonResponse({ ok: true, deviceToken: "opaque.signed", preferences });
    },
  });
  runtime.notificationValue.requestPermission = async () => {
    order.push("requestPermission");
    runtime.notificationValue.permission = "granted";
    return "granted";
  };
  try {
    await subscribeToNotifications(preferences, {
      onPermissionPrompt: () => order.push("promptCallback"),
    });
    assert.deepEqual(order.slice(0, 3), ["GET", "promptCallback", "requestPermission"]);
    assert.equal(order.filter((value) => value === "promptCallback").length, 1);
  } finally {
    runtime.restore();
  }
});

test("disabled config, malformed key, granted permission, and existing denial never call the prompt callback", async (t) => {
  const scenarios = [
    ["disabled config", "default", { enabled: false, publicKey: null }],
    ["malformed key", "default", { enabled: true, publicKey: "AQIDBA" }],
    ["already granted", "granted", { enabled: true, publicKey: VALID_VAPID_PUBLIC_KEY }],
    ["existing denial", "denied", { enabled: true, publicKey: VALID_VAPID_PUBLIC_KEY }],
  ];
  for (const [name, permission, config] of scenarios) {
    await t.test(name, async () => {
      let callbacks = 0;
      const preferences = prefillNotificationPreferences(3, "UTC");
      const existing = permission === "granted" ? {
        toJSON: () => ({ endpoint: "https://push.example/existing", expirationTime: null, keys: { p256dh: "key", auth: "auth" } }),
      } : null;
      const runtime = installRuntime({
        permission,
        subscription: existing,
        fetchImpl: async (_url, options) => options.method === "GET"
          ? jsonResponse(config)
          : jsonResponse({ ok: true, deviceToken: "opaque.signed", preferences }),
      });
      try {
        await subscribeToNotifications(preferences, { onPermissionPrompt: () => { callbacks += 1; } }).catch(() => {});
        assert.equal(callbacks, 0);
      } finally { runtime.restore(); }
    });
  }
});

test("granted permission reuses an existing browser subscription without prompting", async () => {
  let unsubscribeCalls = 0;
  const existing = {
    toJSON: () => ({ endpoint: "https://push.example/existing", expirationTime: null, keys: { p256dh: "key", auth: "auth" } }),
    unsubscribe: async () => { unsubscribeCalls += 1; return true; },
  };
  const preferences = prefillNotificationPreferences(2, "UTC");
  const runtime = installRuntime({
    permission: "granted",
    subscription: existing,
    fetchImpl: async (_url, options) => options.method === "GET"
      ? jsonResponse({ enabled: true, publicKey: VALID_VAPID_PUBLIC_KEY })
      : jsonResponse({ ok: true, deviceToken: "opaque.signed", preferences }),
  });
  try {
    await subscribeToNotifications(preferences);
    assert.equal(runtime.permissionRequests(), 0);
    assert.equal(runtime.subscribeCalls(), 0);
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
    assert.deepEqual(methods, ["GET"]);
  } finally {
    runtime.restore();
  }
});

test("a newly-created browser subscription is rolled back when server registration fails", async () => {
  let created;
  const runtime = installRuntime({
    fetchImpl: async (_url, options) => {
      if (options.method === "GET") return jsonResponse({ enabled: true, publicKey: VALID_VAPID_PUBLIC_KEY });
      created = await runtime.pushManager.getSubscription();
      created.unsubscribe = async () => { created.unsubscribed = true; return true; };
      return jsonResponse({ error: "sensitive server detail" }, { ok: false, status: 500 });
    },
  });
  try {
    await assert.rejects(subscribeToNotifications(prefillNotificationPreferences(3, "UTC")), (error) => error?.code === "registration_failed" && !error.message.includes("sensitive"));
    assert.equal(created.unsubscribed, true);
    assert.equal(runtime.storage.getItem(TOKEN_KEY), null);
  } finally {
    runtime.restore();
  }
});

test("local persistence failure deletes the new server record before browser rollback", async () => {
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
      if (options.method === "GET") return jsonResponse({ enabled: true, publicKey: VALID_VAPID_PUBLIC_KEY });
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
    await assert.rejects(subscribeToNotifications(preferences), (error) => error?.code === "registration_failed" && !error.message.includes("quota"));
    assert.ok(order.indexOf("DELETE") > order.indexOf("POST"));
    assert.ok(order.indexOf("unsubscribe") > order.indexOf("DELETE"));
    assert.equal(storage.getItem(TOKEN_KEY), null);
    assert.equal(storage.getItem(PREFERENCES_KEY), null);
  } finally {
    runtime.restore();
  }
});

test("browser permission and service-worker promise failures are always remapped to safe client errors", async (t) => {
  const rawMessage = "raw DOM exception with private detail";
  const preferences = prefillNotificationPreferences(3, "UTC");
  const configFetch = async () => jsonResponse({ enabled: true, publicKey: VALID_VAPID_PUBLIC_KEY });

  await t.test("requestPermission rejection", async () => {
    const runtime = installRuntime({ fetchImpl: configFetch });
    runtime.notificationValue.requestPermission = async () => { throw new Error(rawMessage); };
    try {
      await assert.rejects(subscribeToNotifications(preferences), (error) => error?.name === "NotificationClientError" && error?.code === "permission_failed" && !error.message.includes(rawMessage));
    } finally { runtime.restore(); }
  });

  await t.test("service worker ready rejection", async () => {
    const runtime = installRuntime({ permission: "granted", fetchImpl: configFetch });
    globalThis.navigator.serviceWorker.ready = { then: (_resolve, reject) => reject(new Error(rawMessage)) };
    try {
      await assert.rejects(subscribeToNotifications(preferences), (error) => error?.name === "NotificationClientError" && error?.code === "service_worker_unavailable" && !error.message.includes(rawMessage));
    } finally { runtime.restore(); }
  });

  await t.test("getSubscription rejection", async () => {
    const runtime = installRuntime({ permission: "granted", fetchImpl: configFetch });
    runtime.pushManager.getSubscription = async () => { throw new Error(rawMessage); };
    try {
      await assert.rejects(subscribeToNotifications(preferences), (error) => error?.name === "NotificationClientError" && error?.code === "subscription_failed" && !error.message.includes(rawMessage));
    } finally { runtime.restore(); }
  });

  await t.test("subscribe rejection", async () => {
    const runtime = installRuntime({ permission: "granted", fetchImpl: configFetch });
    runtime.pushManager.subscribe = async () => { throw new Error(rawMessage); };
    try {
      await assert.rejects(subscribeToNotifications(preferences), (error) => error?.name === "NotificationClientError" && error?.code === "registration_failed" && !error.message.includes(rawMessage));
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
    assert.deepEqual(requests.map(({ method }) => method), ["PATCH", "POST", "PATCH"]);
    assert.equal(requests[0].headers.Authorization, "Bearer old-token.signature");
    assert.deepEqual(JSON.parse(requests[1].body), {
      subscription: existingSubscription().toJSON(),
      preferences: stored,
    });
    assert.equal(requests[2].headers.Authorization, "Bearer new-token.signature");
    assert.deepEqual(JSON.parse(requests[2].body), { preferences: requested });
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
        assert.deepEqual(requests.map(({ method }) => method), [scenario.method, "POST", scenario.method]);
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

test("local persistence failure during reauthorization restores the previous retry credential", async () => {
  const preferences = prefillNotificationPreferences(3, "UTC");
  const values = new Map([
    [TOKEN_KEY, "old-token.signature"],
    [PREFERENCES_KEY, JSON.stringify(preferences)],
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
    assert.deepEqual(requests.map(({ method }) => method), ["POST"]);
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
    assert.deepEqual(requests.map(({ method }) => method), ["DELETE", "POST", "DELETE", "POST", "DELETE"]);
    for (const request of requests.filter(({ method }) => method === "POST")) {
      assert.deepEqual(JSON.parse(request.body), { subscription: proof, preferences });
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
