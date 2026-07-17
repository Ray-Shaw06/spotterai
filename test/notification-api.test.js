import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDeviceToken, verifyDeviceToken } from "../lib/notification-auth.js";
import { parseFirebaseServiceAccount } from "../lib/firebase-admin.js";
import { createNotificationStore } from "../lib/notification-store.js";
import { createNotificationHandler } from "../api/notifications.js";

const NOW_MS = Date.UTC(2026, 6, 17, 12, 0, 0);
const NOW = new Date(NOW_MS);
const SECRET = "notification-token-secret-is-at-least-32-characters";
const PUBLIC_KEY = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString("base64url");
const P256DH = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 8)]).toString("base64url");
const AUTH = Buffer.alloc(16, 9).toString("base64url");
const PRIVATE_P256DH = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 10)]).toString("base64url");
const PRIVATE_AUTH = Buffer.alloc(16, 11).toString("base64url");
const ENV = Object.freeze({
  NOTIFICATION_TOKEN_SECRET: SECRET,
  WEB_PUSH_PUBLIC_KEY: PUBLIC_KEY,
});
const PREFERENCES = Object.freeze({
  timezone: "Asia/Kolkata",
  schedule: Object.freeze([{ weekday: 1, time: "18:00" }, { weekday: 4, time: "19:30" }]),
  quietHours: Object.freeze({ start: "22:00", end: "08:00" }),
  categories: Object.freeze({ workout: true, followUp: false, streak: true, recovery: true }),
  paused: false,
});
const SUBSCRIPTION = Object.freeze({
  endpoint: "https://push.example/subscription",
  expirationTime: null,
  keys: Object.freeze({ p256dh: P256DH, auth: AUTH }),
});

function createMockStore(overrides = {}) {
  const calls = { create: [], update: [], remove: [] };
  return {
    calls,
    async create(...args) { calls.create.push(args); },
    async update(...args) { calls.update.push(args); },
    async remove(...args) { calls.remove.push(args); },
    ...overrides,
  };
}

function createMockResponse() {
  return {
    statusCode: 200,
    body: undefined,
    headers: new Map(),
    setHeader(name, value) {
      this.headers.set(String(name).toLowerCase(), String(value));
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
  };
}

function setup(overrides = {}) {
  const store = overrides.store || createMockStore();
  const logs = [];
  const logger = overrides.logger || {
    info(entry) { logs.push(entry); },
    error(entry) { logs.push(entry); },
  };
  const handler = createNotificationHandler({
    store,
    env: overrides.env || { ...ENV },
    now: overrides.now || (() => NOW_MS),
    randomBytes: overrides.randomBytes || ((size) => Buffer.alloc(size, size === 32 ? 7 : 9)),
    logger,
  });
  return { handler, store, logs };
}

async function request(handler, method, body, headers = {}) {
  const res = createMockResponse();
  await handler({ method, body, headers, url: "/api/notifications" }, res);
  return res;
}

async function register(context = setup(), body = {}) {
  const res = await request(context.handler, "POST", {
    subscription: SUBSCRIPTION,
    preferences: PREFERENCES,
    ...body,
  });
  return { ...context, res };
}

test("GET exposes only safe notification capability configuration", async () => {
  const { handler, store } = setup({
    env: {
      ...ENV,
      WEB_PUSH_PRIVATE_KEY: "must-never-leave-the-server",
      FIREBASE_SERVICE_ACCOUNT_JSON: "must-never-leave-the-server-either",
    },
  });
  const res = await request(handler, "GET");

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { enabled: true, publicKey: PUBLIC_KEY });
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.has("access-control-allow-origin"), false);
  assert.equal(store.calls.create.length + store.calls.update.length + store.calls.remove.length, 0);
  assert.doesNotMatch(JSON.stringify(res.body), /private|service|secret|firebase/i);
});

test("missing or invalid server configuration fails closed with 503", async () => {
  for (const env of [
    { WEB_PUSH_PUBLIC_KEY: PUBLIC_KEY },
    { NOTIFICATION_TOKEN_SECRET: "short", WEB_PUSH_PUBLIC_KEY: PUBLIC_KEY },
    { NOTIFICATION_TOKEN_SECRET: SECRET, WEB_PUSH_PUBLIC_KEY: "not a vapid public key" },
  ]) {
    const { handler, store } = setup({ env });
    const res = await request(handler, "POST", { subscription: SUBSCRIPTION, preferences: PREFERENCES });
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.body, { error: "Service unavailable." });
    assert.equal(store.calls.create.length, 0);
  }
});

test("POST registers an anonymous device with the exact minimal record", async () => {
  const context = await register();
  const { res, store } = context;

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.ok, true);
  assert.match(res.body.deviceToken, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(res.body.preferences, PREFERENCES);
  assert.equal(store.calls.create.length, 1);

  const [deviceId, created] = store.calls.create[0];
  assert.match(deviceId, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(verifyDeviceToken(res.body.deviceToken, SECRET, NOW_MS), { deviceId });
  assert.deepEqual(created, {
    endpoint: "https://push.example/subscription",
    keys: { p256dh: P256DH, auth: AUTH },
    expirationTime: null,
    timezone: "Asia/Kolkata",
    schedule: [{ weekday: 1, time: "18:00" }, { weekday: 4, time: "19:30" }],
    quietHours: { start: "22:00", end: "08:00" },
    categories: { workout: true, followUp: false, streak: true, recovery: true },
    paused: false,
    enabled: true,
    lastWorkoutCompletionDate: null,
    nextNotificationAt: NOW,
    dailyDeliveryDate: null,
    dailyDeliveryCount: 0,
    lastSentByCategory: {},
    leaseUntil: null,
    leaseId: null,
    createdAt: NOW,
    updatedAt: NOW,
  });
});

test("POST strips overposted health, identity, operational, and unknown fields before storage", async () => {
  const { res, store } = await register(setup(), {
    weight: 90,
    plan: { private: true },
    profile: { name: "Private Person" },
    deviceId: "attacker-chosen-id",
    enabled: false,
    nextNotificationAt: "attacker-controlled",
    subscription: {
      ...SUBSCRIPTION,
      email: "private@example.com",
      keys: { ...SUBSCRIPTION.keys, privateKey: "forbidden" },
    },
    preferences: {
      ...PREFERENCES,
      injury: "private injury",
      nutrition: { calories: 2000 },
      categories: { ...PREFERENCES.categories, freeText: "private" },
    },
  });

  assert.equal(res.statusCode, 201);
  const [deviceId, created] = store.calls.create[0];
  assert.notEqual(deviceId, "attacker-chosen-id");
  assert.equal(created.endpoint, "https://push.example/subscription");
  assert.equal("weight" in created, false);
  assert.equal("plan" in created, false);
  assert.equal("profile" in created, false);
  assert.equal("deviceId" in created, false);
  assert.equal("email" in created, false);
  assert.equal("privateKey" in created.keys, false);
  assert.equal("freeText" in created.categories, false);
  assert.doesNotMatch(JSON.stringify(created), /Private Person|private injury|calories|attacker-controlled|private@example/);
});

test("POST rejects invalid endpoints, encryption keys, expiration values, and preferences", async () => {
  const invalidBodies = [
    { subscription: { ...SUBSCRIPTION, endpoint: "http://push.example/subscription" }, preferences: PREFERENCES },
    { subscription: { ...SUBSCRIPTION, endpoint: `https://push.example/${"x".repeat(2049)}` }, preferences: PREFERENCES },
    { subscription: { ...SUBSCRIPTION, keys: { ...SUBSCRIPTION.keys, p256dh: "contains+padding=" } }, preferences: PREFERENCES },
    { subscription: { ...SUBSCRIPTION, keys: { ...SUBSCRIPTION.keys, p256dh: "A".repeat(87) } }, preferences: PREFERENCES },
    { subscription: { ...SUBSCRIPTION, keys: { ...SUBSCRIPTION.keys, auth: "tiny" } }, preferences: PREFERENCES },
    { subscription: { ...SUBSCRIPTION, expirationTime: "tomorrow" }, preferences: PREFERENCES },
    { subscription: SUBSCRIPTION, preferences: { ...PREFERENCES, timezone: "Not/AZone" } },
  ];

  for (const body of invalidBodies) {
    const { handler, store } = setup();
    const res = await request(handler, "POST", body);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, { error: "Invalid request." });
    assert.equal(store.calls.create.length, 0);
  }
});

test("request bodies larger than 32 KB are rejected before storage", async () => {
  const { handler, store } = setup();
  const res = await request(handler, "POST", {
    subscription: SUBSCRIPTION,
    preferences: PREFERENCES,
    padding: "x".repeat(33 * 1024),
  });
  assert.equal(res.statusCode, 413);
  assert.deepEqual(res.body, { error: "Request too large." });
  assert.equal(store.calls.create.length, 0);

  const headerRes = await request(handler, "POST", {}, { "content-length": String((32 * 1024) + 1) });
  assert.equal(headerRes.statusCode, 413);
});

test("PATCH requires a valid per-device bearer token", async () => {
  const { handler, store } = setup();
  for (const authorization of [undefined, "Basic abc", "Bearer", "Bearer invalid.token"]) {
    const headers = authorization ? { authorization } : {};
    const res = await request(handler, "PATCH", { preferences: PREFERENCES }, headers);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { error: "Unauthorized." });
  }
  assert.equal(store.calls.update.length, 0);
});

test("PATCH updates only normalized preferences for the token's own device", async () => {
  const { handler, store } = setup();
  const token = createDeviceToken("device_a", SECRET, NOW_MS);
  const res = await request(handler, "PATCH", {
    deviceId: "device_b",
    enabled: false,
    preferences: {
      ...PREFERENCES,
      weight: 90,
      categories: { ...PREFERENCES.categories, diagnosis: "private" },
    },
  }, { authorization: `Bearer ${token}` });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, preferences: PREFERENCES });
  assert.deepEqual(store.calls.update, [["device_a", {
    ...PREFERENCES,
    nextNotificationAt: NOW,
    updatedAt: NOW,
  }]]);
  assert.doesNotMatch(JSON.stringify(store.calls.update), /device_b|weight|diagnosis|private|enabled/);
});

test("PATCH accepts a valid completion date and rejects invalid or ambiguous patches", async () => {
  const token = createDeviceToken("device_a", SECRET, NOW_MS);
  const authorization = { authorization: `Bearer ${token}` };
  const { handler, store } = setup();
  const res = await request(handler, "PATCH", { lastWorkoutCompletionDate: "2026-07-17", plan: "private" }, authorization);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.deepEqual(store.calls.update, [["device_a", {
    lastWorkoutCompletionDate: "2026-07-17",
    nextNotificationAt: NOW,
    updatedAt: NOW,
  }]]);

  for (const body of [
    {},
    { lastWorkoutCompletionDate: "17-07-2026" },
    { lastWorkoutCompletionDate: "2026-02-30" },
    { lastWorkoutCompletionDate: "2026-07-17", preferences: PREFERENCES },
  ]) {
    const invalid = await request(handler, "PATCH", body, authorization);
    assert.equal(invalid.statusCode, 400);
    assert.deepEqual(invalid.body, { error: "Invalid request." });
  }
  assert.equal(store.calls.update.length, 1);
});

test("DELETE removes only the device authorized by its bearer token", async () => {
  const { handler, store } = setup();
  const token = createDeviceToken("device_a", SECRET, NOW_MS);
  const res = await request(handler, "DELETE", { deviceId: "device_b" }, { authorization: `Bearer ${token}` });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.deepEqual(store.calls.remove, [["device_a"]]);
});

test("expired and tampered bearer tokens cannot access any device", async () => {
  const expired = createDeviceToken("device_a", SECRET, NOW_MS - (181 * 24 * 60 * 60 * 1000));
  const valid = createDeviceToken("device_a", SECRET, NOW_MS);
  const tampered = `${valid.slice(0, -1)}${valid.endsWith("A") ? "B" : "A"}`;

  for (const token of [expired, tampered]) {
    const { handler, store } = setup();
    const patchRes = await request(handler, "PATCH", { preferences: PREFERENCES }, { authorization: `Bearer ${token}` });
    const deleteRes = await request(handler, "DELETE", undefined, { authorization: `Bearer ${token}` });
    assert.equal(patchRes.statusCode, 401);
    assert.equal(deleteRes.statusCode, 401);
    assert.equal(store.calls.update.length + store.calls.remove.length, 0);
  }
});

test("only GET, POST, PATCH, and DELETE are allowed and CORS is not opened", async () => {
  for (const method of ["PUT", "HEAD", "OPTIONS", "TRACE"]) {
    const { handler } = setup();
    const res = await request(handler, method);
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.get("allow"), "GET, POST, PATCH, DELETE");
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.has("access-control-allow-origin"), false);
    assert.deepEqual(res.body, { error: "Method not allowed." });
  }
});

test("operational logs contain only request metadata and safe failure classes", async () => {
  const logs = [];
  const logger = { info: (entry) => logs.push(entry), error: (entry) => logs.push(entry) };
  const context = setup({ logger });
  const registration = await register(context, {
    subscription: {
      endpoint: "https://private-push.example/secret-endpoint",
      expirationTime: null,
      keys: { p256dh: PRIVATE_P256DH, auth: PRIVATE_AUTH },
    },
  });
  const [deviceId] = registration.store.calls.create[0];
  const token = registration.res.body.deviceToken;
  await request(context.handler, "PATCH", { lastWorkoutCompletionDate: "2026-07-17" }, { authorization: `Bearer ${token}` });
  await request(context.handler, "PATCH", { preferences: PREFERENCES }, { authorization: `Bearer ${token}tampered` });

  const serialized = JSON.stringify(logs);
  for (const forbidden of [
    "private-push", "secret-endpoint", PRIVATE_P256DH, PRIVATE_AUTH,
    deviceId, token, "2026-07-17", SECRET, "subscription", "lastWorkoutCompletionDate",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  for (const entry of logs) {
    assert.deepEqual(Object.keys(entry).sort(), Object.keys(entry).filter((key) => [
      "durationMs", "event", "failureClass", "method", "requestId", "route", "status",
    ].includes(key)).sort());
    assert.equal(entry.route, "/api/notifications");
    assert.match(entry.requestId, /^[A-Za-z0-9_-]+$/);
  }
  assert.ok(logs.some((entry) => entry.event === "notification_request_failure" && entry.failureClass === "auth"));
});

test("storage failures return generic responses without leaking exception details", async () => {
  const store = createMockStore({
    async create() { throw new Error("firebase secret endpoint private details"); },
  });
  const { handler, logs } = setup({ store });
  const res = await request(handler, "POST", { subscription: SUBSCRIPTION, preferences: PREFERENCES });

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: "Request failed." });
  assert.doesNotMatch(JSON.stringify({ body: res.body, logs }), /firebase secret endpoint private details/);
  assert.ok(logs.some((entry) => entry.failureClass === "storage"));
});

test("the Firestore adapter uses only the server-managed notificationDevices collection", async () => {
  const operations = [];
  const firestore = {
    collection(name) {
      operations.push(["collection", name]);
      return {
        doc(id) {
          operations.push(["doc", id]);
          return {
            async create(record) { operations.push(["create", record]); },
            async update(patch) { operations.push(["update", patch]); },
            async delete() { operations.push(["delete"]); },
          };
        },
      };
    },
  };
  const store = createNotificationStore(firestore);
  await store.create("device_a", { enabled: true });
  await store.update("device_a", { paused: true });
  await store.remove("device_a");

  assert.deepEqual(operations, [
    ["collection", "notificationDevices"], ["doc", "device_a"], ["create", { enabled: true }],
    ["collection", "notificationDevices"], ["doc", "device_a"], ["update", { paused: true }],
    ["collection", "notificationDevices"], ["doc", "device_a"], ["delete"],
  ]);
});

test("Firebase service-account parsing normalizes escaped private-key newlines", () => {
  const parsed = parseFirebaseServiceAccount(JSON.stringify({
    project_id: "example-project",
    client_email: "firebase-admin@example-project.iam.gserviceaccount.com",
    private_key: "-----BEGIN PRIVATE KEY-----\\nexample\\n-----END PRIVATE KEY-----\\n",
  }));

  assert.equal(parsed.project_id, "example-project");
  assert.equal(parsed.private_key, "-----BEGIN PRIVATE KEY-----\nexample\n-----END PRIVATE KEY-----\n");
  assert.throws(() => parseFirebaseServiceAccount("not-json"), /configuration/i);
  assert.throws(() => parseFirebaseServiceAccount("{}"), /configuration/i);
});

test("server-only notification configuration is documented and routed without real secrets", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  const envExample = readFileSync(new URL("../.env.example", import.meta.url), "utf8");

  assert.equal(packageJson.dependencies["firebase-admin"], "^13.4.0");
  assert.deepEqual(vercel.functions["api/notifications.js"], { maxDuration: 10 });
  for (const name of [
    "FIREBASE_SERVICE_ACCOUNT_JSON",
    "NOTIFICATION_TOKEN_SECRET",
    "WEB_PUSH_PUBLIC_KEY",
    "WEB_PUSH_PRIVATE_KEY",
    "WEB_PUSH_SUBJECT",
  ]) {
    assert.match(envExample, new RegExp(`^${name}=`, "m"), name);
  }
  assert.match(envExample, /^WEB_PUSH_SUBJECT=mailto:owner@example\.com$/m);
  assert.doesNotMatch(envExample, /BEGIN (?:RSA )?PRIVATE KEY-----\\nM[A-Za-z0-9+/]{40}/);
});
