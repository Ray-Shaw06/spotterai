import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createECDH,
  generateKeyPairSync,
} from "node:crypto";
import {
  createDeviceToken,
  createEndpointFingerprint,
  verifyDeviceToken,
} from "../lib/notification-auth.js";
import {
  getAdminFirestore,
  parseFirebaseServiceAccount,
} from "../lib/firebase-admin.js";
import { RegistrationCapError } from "../lib/notification-store.js";
import { validateNotificationConfig } from "../lib/notification-validation.js";
import notificationRoute, {
  createNotificationFetchHandler,
  createNotificationHandler,
} from "../api/notifications.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW_MS = Date.UTC(2026, 6, 17, 12, 0, 0);
const NOW = new Date(NOW_MS);
const AUTHORIZATION_EXPIRES_AT = new Date(NOW_MS + (180 * DAY_MS));
const DEVICE_ID = Buffer.alloc(32, 3).toString("base64url");
const EXISTING_DEVICE_ID = Buffer.alloc(32, 4).toString("base64url");
const TOKEN_SECRET = Buffer.alloc(32, 1).toString("base64url");
const DEDUP_SECRET = Buffer.alloc(32, 2).toString("base64url");
const AUTH = Buffer.alloc(16, 9).toString("base64url");
const PRIVATE_AUTH = Buffer.alloc(16, 11).toString("base64url");
const ALLOWED_ORIGIN = "https://app.spotterai.example";
const WAF_RULE_ID = "waf_rule_notification_post_01";

function p256PublicKey() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return ecdh.getPublicKey(undefined, "uncompressed").toString("base64url");
}

const PUBLIC_KEY = p256PublicKey();
const P256DH = p256PublicKey();
const PRIVATE_P256DH = p256PublicKey();
const INVALID_POINT = Buffer.concat([Buffer.from([4]), Buffer.alloc(64)]).toString("base64url");
const { privateKey: servicePrivateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const SERVICE_ACCOUNT = Object.freeze({
  project_id: "spotterai-notifications-test",
  client_email: "firebase-adminsdk@spotterai-notifications-test.iam.gserviceaccount.com",
  private_key: servicePrivateKey,
});
const ENV = Object.freeze({
  NOTIFICATION_REGISTRATION_ENABLED: "true",
  NOTIFICATION_REGISTRATION_DAILY_CAP: "100",
  NOTIFICATION_WAF_RATE_LIMIT_RULE_ID: WAF_RULE_ID,
  NOTIFICATION_ALLOWED_ORIGIN: ALLOWED_ORIGIN,
  NOTIFICATION_TOKEN_SECRET: TOKEN_SECRET,
  NOTIFICATION_DEDUP_SECRET: DEDUP_SECRET,
  WEB_PUSH_PUBLIC_KEY: PUBLIC_KEY,
  FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(SERVICE_ACCOUNT),
});
const WRITE_HEADERS = Object.freeze({
  "content-type": "application/json",
  origin: ALLOWED_ORIGIN,
  "sec-fetch-site": "same-origin",
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
    async create(...args) {
      calls.create.push(args);
      return overrides.create ? overrides.create(...args) : args[0];
    },
    async update(...args) {
      calls.update.push(args);
      return overrides.update?.(...args);
    },
    async remove(...args) {
      calls.remove.push(args);
      return overrides.remove?.(...args);
    },
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
    randomBytes: overrides.randomBytes || ((size) => Buffer.alloc(size, size === 32 ? 3 : 9)),
    logger,
  });
  return { handler, store, logs };
}

async function coreRequest(handler, method, body, headers = {}, { defaults = true } = {}) {
  const res = createMockResponse();
  const defaultHeaders = defaults && ["POST", "PATCH", "DELETE"].includes(method) ? WRITE_HEADERS : {};
  await handler({
    method,
    body,
    headers: { ...defaultHeaders, ...headers },
    url: "/api/notifications",
  }, res);
  return res;
}

function registrationBody(overrides = {}) {
  return {
    subscription: SUBSCRIPTION,
    preferences: PREFERENCES,
    ...overrides,
  };
}

async function register(context = setup(), overrides = {}) {
  const res = await coreRequest(context.handler, "POST", registrationBody(overrides));
  return { ...context, res };
}

test("registration is disabled by default without exposing a public key", async () => {
  const { handler, store } = setup({ env: {} });
  const get = await coreRequest(handler, "GET");
  const post = await coreRequest(handler, "POST", registrationBody());

  assert.equal(get.statusCode, 200);
  assert.deepEqual(get.body, { enabled: false });
  assert.equal("publicKey" in get.body, false);
  assert.equal(post.statusCode, 503);
  assert.deepEqual(post.body, { error: "Service unavailable." });
  assert.equal(store.calls.create.length, 0);
});

test("enabled GET exposes only the on-curve public key after full readiness validation", async () => {
  const { handler, store } = setup();
  const res = await coreRequest(handler, "GET");

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { enabled: true, publicKey: PUBLIC_KEY });
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.has("access-control-allow-origin"), false);
  assert.equal(store.calls.create.length + store.calls.update.length + store.calls.remove.length, 0);
  assert.doesNotMatch(JSON.stringify(res.body), /private|service|secret|firebase|origin|waf/i);
});

test("enabled registration fails closed on every readiness requirement", async () => {
  const invalidConfigs = [
    { NOTIFICATION_TOKEN_SECRET: `${"A".repeat(42)}B` },
    { NOTIFICATION_DEDUP_SECRET: `${"A".repeat(42)}B` },
    { WEB_PUSH_PUBLIC_KEY: INVALID_POINT },
    { NOTIFICATION_ALLOWED_ORIGIN: "http://app.spotterai.example" },
    { NOTIFICATION_ALLOWED_ORIGIN: `${ALLOWED_ORIGIN}/path` },
    { NOTIFICATION_REGISTRATION_DAILY_CAP: "0" },
    { NOTIFICATION_REGISTRATION_DAILY_CAP: "100001" },
    { NOTIFICATION_REGISTRATION_DAILY_CAP: "many" },
    { NOTIFICATION_WAF_RATE_LIMIT_RULE_ID: "replace-with-rule-id" },
    { NOTIFICATION_WAF_RATE_LIMIT_RULE_ID: "" },
    { FIREBASE_SERVICE_ACCOUNT_JSON: "not-json" },
    { FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ ...SERVICE_ACCOUNT, private_key: "not-a-private-key" }) },
  ];

  for (const replacement of invalidConfigs) {
    const { handler, store } = setup({ env: { ...ENV, ...replacement } });
    const get = await coreRequest(handler, "GET");
    const post = await coreRequest(handler, "POST", registrationBody());
    assert.equal(get.statusCode, 503, JSON.stringify(replacement));
    assert.equal(post.statusCode, 503, JSON.stringify(replacement));
    assert.equal(store.calls.create.length, 0, JSON.stringify(replacement));
  }
});

test("POST registers the exact minimal record and passes only server-owned cap/dedup options", async () => {
  const { res, store } = await register();

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.ok, true);
  assert.match(res.body.deviceToken, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(res.body.preferences, PREFERENCES);
  assert.equal(store.calls.create.length, 1);

  const [requestedId, created, options] = store.calls.create[0];
  const endpointFingerprint = createEndpointFingerprint(SUBSCRIPTION.endpoint, DEDUP_SECRET);
  assert.equal(requestedId, DEVICE_ID);
  assert.deepEqual(verifyDeviceToken(res.body.deviceToken, TOKEN_SECRET, NOW_MS), { deviceId: DEVICE_ID });
  assert.deepEqual(created, {
    endpoint: SUBSCRIPTION.endpoint,
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
    endpointFingerprint,
    authorizationExpiresAt: AUTHORIZATION_EXPIRES_AT,
    createdAt: NOW,
    updatedAt: NOW,
  });
  assert.deepEqual(options, {
    endpointFingerprint,
    registrationDate: "2026-07-17",
    dailyCap: 100,
    now: NOW,
  });
});

test("same-endpoint dedup returns a token for the store's effective existing device", async () => {
  const store = createMockStore({ create: async () => EXISTING_DEVICE_ID });
  const { res } = await register(setup({ store }));

  assert.equal(res.statusCode, 201);
  assert.deepEqual(verifyDeviceToken(res.body.deviceToken, TOKEN_SECRET, NOW_MS), { deviceId: EXISTING_DEVICE_ID });
  assert.equal("deviceId" in res.body, false);
});

test("a durable global-cap rejection returns 429 without issuing a token", async () => {
  const store = createMockStore({
    create: async () => { throw new RegistrationCapError(); },
  });
  const { res } = await register(setup({ store }));

  assert.equal(res.statusCode, 429);
  assert.deepEqual(res.body, { error: "Registration unavailable." });
  assert.equal("deviceToken" in res.body, false);
  assert.equal(store.calls.update.length + store.calls.remove.length, 0);
});

test("overposted health, identity, fingerprint, expiry, and scheduler fields never reach storage", async () => {
  const { res, store } = await register(setup(), {
    weight: 90,
    plan: { private: true },
    deviceId: EXISTING_DEVICE_ID,
    endpointFingerprint: "attacker-fingerprint",
    authorizationExpiresAt: "attacker-expiry",
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
  const [requestedId, created] = store.calls.create[0];
  assert.equal(requestedId, DEVICE_ID);
  assert.notEqual(created.endpointFingerprint, "attacker-fingerprint");
  assert.deepEqual(created.authorizationExpiresAt, AUTHORIZATION_EXPIRES_AT);
  assert.equal("weight" in created, false);
  assert.equal("plan" in created, false);
  assert.equal("deviceId" in created, false);
  assert.equal("email" in created, false);
  assert.equal("privateKey" in created.keys, false);
  assert.equal("freeText" in created.categories, false);
  assert.doesNotMatch(JSON.stringify(created), /private injury|calories|attacker-controlled|private@example|attacker-expiry/);
});

test("POST rejects invalid endpoints, off-curve encryption keys, expiration values, and preferences", async () => {
  const invalidBodies = [
    { subscription: { ...SUBSCRIPTION, endpoint: "http://push.example/subscription" }, preferences: PREFERENCES },
    { subscription: { ...SUBSCRIPTION, endpoint: `https://push.example/${"x".repeat(2049)}` }, preferences: PREFERENCES },
    { subscription: { ...SUBSCRIPTION, keys: { ...SUBSCRIPTION.keys, p256dh: INVALID_POINT } }, preferences: PREFERENCES },
    { subscription: { ...SUBSCRIPTION, keys: { ...SUBSCRIPTION.keys, p256dh: "contains+padding=" } }, preferences: PREFERENCES },
    { subscription: { ...SUBSCRIPTION, keys: { ...SUBSCRIPTION.keys, auth: "tiny" } }, preferences: PREFERENCES },
    { subscription: { ...SUBSCRIPTION, expirationTime: "tomorrow" }, preferences: PREFERENCES },
    { subscription: SUBSCRIPTION, preferences: { ...PREFERENCES, timezone: "Not/AZone" } },
  ];

  for (const body of invalidBodies) {
    const { handler, store } = setup();
    const res = await coreRequest(handler, "POST", body);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, { error: "Invalid request." });
    assert.equal(store.calls.create.length, 0);
  }
});

test("enabled body methods enforce exact HTTPS origin, JSON content type, and Sec-Fetch-Site", async () => {
  const cases = [
    [{ "content-type": "text/plain", origin: ALLOWED_ORIGIN, "sec-fetch-site": "same-origin" }, 415],
    [{ "content-type": "application/json", origin: "https://evil.example", "sec-fetch-site": "same-origin" }, 403],
    [{ "content-type": "application/json", origin: ALLOWED_ORIGIN, "sec-fetch-site": "cross-site" }, 403],
    [{ "content-type": "application/json", origin: ALLOWED_ORIGIN, "sec-fetch-site": "Cross-Site" }, 403],
    [{ "content-type": "application/json", "sec-fetch-site": "same-origin" }, 403],
  ];

  for (const [headers, status] of cases) {
    const { handler, store } = setup();
    const res = await coreRequest(handler, "POST", JSON.stringify(registrationBody()), headers, { defaults: false });
    assert.equal(res.statusCode, status);
    assert.equal(store.calls.create.length, 0);
    assert.equal(res.headers.has("access-control-allow-origin"), false);
  }

  const { handler, store } = setup();
  const deletion = await coreRequest(handler, "DELETE", "", { origin: ALLOWED_ORIGIN }, { defaults: false });
  assert.equal(deletion.statusCode, 415);
  assert.equal(store.calls.remove.length, 0);
});

test("legacy core inputs still enforce 32 KB and accept Buffer/string JSON", async () => {
  const context = setup();
  const oversized = await coreRequest(context.handler, "POST", ` ${" ".repeat(33 * 1024)}${JSON.stringify(registrationBody())}`);
  assert.equal(oversized.statusCode, 413);
  assert.equal(context.store.calls.create.length, 0);

  const stringResponse = await coreRequest(context.handler, "POST", JSON.stringify(registrationBody()));
  const bufferResponse = await coreRequest(context.handler, "POST", Buffer.from(JSON.stringify(registrationBody())));
  assert.equal(stringResponse.statusCode, 201);
  assert.equal(bufferResponse.statusCode, 201);
});

test("PATCH and DELETE remain strictly bound to the canonical token device", async () => {
  const { handler, store } = setup();
  const token = createDeviceToken(DEVICE_ID, TOKEN_SECRET, NOW_MS);
  const authorization = { authorization: `Bearer ${token}` };
  const patch = await coreRequest(handler, "PATCH", {
    deviceId: EXISTING_DEVICE_ID,
    enabled: false,
    preferences: { ...PREFERENCES, weight: 90 },
  }, authorization);
  const completion = await coreRequest(handler, "PATCH", {
    lastWorkoutCompletionDate: "2026-07-17",
    plan: "private",
  }, authorization);
  const deletion = await coreRequest(handler, "DELETE", { deviceId: EXISTING_DEVICE_ID }, authorization);

  assert.equal(patch.statusCode, 200);
  assert.deepEqual(patch.body, { ok: true, preferences: PREFERENCES });
  assert.equal(completion.statusCode, 200);
  assert.equal(deletion.statusCode, 200);
  assert.equal(store.calls.update.every(([deviceId]) => deviceId === DEVICE_ID), true);
  assert.deepEqual(store.calls.remove, [[DEVICE_ID]]);
  assert.doesNotMatch(JSON.stringify(store.calls.update), /weight|enabled|private/);
});

test("missing, expired, and tampered bearer tokens cannot access any device", async () => {
  const expired = createDeviceToken(DEVICE_ID, TOKEN_SECRET, NOW_MS - (181 * DAY_MS));
  const valid = createDeviceToken(DEVICE_ID, TOKEN_SECRET, NOW_MS);
  const tampered = `${valid.slice(0, -1)}${valid.endsWith("A") ? "B" : "A"}`;

  for (const authorization of [undefined, "Basic abc", "Bearer invalid.token", `Bearer ${expired}`, `Bearer ${tampered}`]) {
    const { handler, store } = setup();
    const headers = authorization ? { authorization } : {};
    const patch = await coreRequest(handler, "PATCH", { preferences: PREFERENCES }, headers);
    const deletion = await coreRequest(handler, "DELETE", {}, headers);
    assert.equal(patch.statusCode, 401);
    assert.equal(deletion.statusCode, 401);
    assert.equal(store.calls.update.length + store.calls.remove.length, 0);
  }
});

test("only GET, POST, PATCH, and DELETE are allowed without opening CORS", async () => {
  for (const method of ["PUT", "HEAD", "OPTIONS", "TRACE"]) {
    const { handler } = setup();
    const res = await coreRequest(handler, method);
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.get("allow"), "GET, POST, PATCH, DELETE");
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.has("access-control-allow-origin"), false);
    assert.deepEqual(res.body, { error: "Method not allowed." });
  }
});

test("the production default is a Vercel Web Handler and streams raw bodies before parsing", async () => {
  assert.equal(typeof notificationRoute, "object");
  assert.equal(typeof notificationRoute.fetch, "function");
  assert.notEqual(typeof notificationRoute, "function");

  const context = setup();
  const fetchHandler = createNotificationFetchHandler({ coreHandler: context.handler });
  const response = await fetchHandler.fetch(new Request(`${ALLOWED_ORIGIN}/api/notifications`, {
    method: "POST",
    headers: WRITE_HEADERS,
    body: JSON.stringify(registrationBody()),
  }));
  assert.equal(response.status, 201);
  assert.equal((await response.json()).ok, true);
  assert.equal(context.store.calls.create.length, 1);
});

test("Fetch adapter rejects whitespace-padded 40 KB JSON without trusting content length", async () => {
  const context = setup();
  const fetchHandler = createNotificationFetchHandler({ coreHandler: context.handler });
  const raw = `${" ".repeat(40 * 1024)}${JSON.stringify(registrationBody())}`;
  const response = await fetchHandler.fetch(new Request(`${ALLOWED_ORIGIN}/api/notifications`, {
    method: "POST",
    headers: WRITE_HEADERS,
    body: raw,
  }));

  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: "Request too large." });
  assert.equal(context.store.calls.create.length, 0);
});

test("Fetch adapter enforces 32 KB on chunked bodies with no content-length", async () => {
  const context = setup();
  const fetchHandler = createNotificationFetchHandler({ coreHandler: context.handler });
  const encoder = new TextEncoder();
  const chunks = [encoder.encode(" ".repeat(20 * 1024)), encoder.encode(" ".repeat(20 * 1024))];
  const body = new ReadableStream({
    pull(controller) {
      const chunk = chunks.shift();
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
  });
  const request = new Request(`${ALLOWED_ORIGIN}/api/notifications`, {
    method: "POST",
    headers: WRITE_HEADERS,
    body,
    duplex: "half",
  });
  assert.equal(request.headers.has("content-length"), false);

  const response = await fetchHandler.fetch(request);
  assert.equal(response.status, 413);
  assert.equal(context.store.calls.create.length, 0);
});

test("Fetch adapter maps malformed JSON to a generic 400", async () => {
  const context = setup();
  const fetchHandler = createNotificationFetchHandler({ coreHandler: context.handler });
  const response = await fetchHandler.fetch(new Request(`${ALLOWED_ORIGIN}/api/notifications`, {
    method: "POST",
    headers: WRITE_HEADERS,
    body: "{not-json",
  }));

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Invalid request." });
  assert.equal(context.store.calls.create.length, 0);
});

test("operational logs exclude endpoint, fingerprint, keys, token, device ID, dates, and bodies", async () => {
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
  const token = registration.res.body.deviceToken;
  const fingerprint = registration.store.calls.create[0][1].endpointFingerprint;
  await coreRequest(context.handler, "PATCH", { lastWorkoutCompletionDate: "2026-07-17" }, { authorization: `Bearer ${token}` });
  await coreRequest(context.handler, "PATCH", { preferences: PREFERENCES }, { authorization: `Bearer ${token}tampered` });

  const serialized = JSON.stringify(logs);
  for (const forbidden of [
    "private-push", "secret-endpoint", PRIVATE_P256DH, PRIVATE_AUTH,
    DEVICE_ID, token, fingerprint, "2026-07-17", TOKEN_SECRET, DEDUP_SECRET,
    "subscription", "lastWorkoutCompletionDate",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  for (const entry of logs) {
    assert.deepEqual(Object.keys(entry).sort(), Object.keys(entry).filter((key) => [
      "durationMs", "event", "failureClass", "method", "requestId", "route", "status",
    ].includes(key)).sort());
  }
});

test("Firebase service-account parsing requires a real RSA private key", () => {
  const escaped = JSON.stringify({ ...SERVICE_ACCOUNT, private_key: servicePrivateKey.replace(/\n/g, "\\n") });
  const parsed = parseFirebaseServiceAccount(escaped);

  assert.equal(parsed.project_id, SERVICE_ACCOUNT.project_id);
  assert.equal(parsed.private_key, servicePrivateKey);
  assert.throws(() => parseFirebaseServiceAccount("not-json"), /configuration/i);
  assert.throws(() => parseFirebaseServiceAccount(JSON.stringify({ ...SERVICE_ACCOUNT, private_key: "not-pem" })), /configuration/i);
});

test("Firebase Admin reuses only its dedicated named app with matching project identity", () => {
  const initialized = [];
  const existing = { name: "spotterai-notifications", options: { projectId: SERVICE_ACCOUNT.project_id } };
  const deps = {
    getApps: () => [
      { name: "unrelated-default", options: { projectId: "wrong-project" } },
      existing,
    ],
    initializeApp: (...args) => { initialized.push(args); return { name: args[1], options: args[0] }; },
    cert: (value) => ({ serviceAccount: value }),
    getFirestore: (app) => ({ app }),
  };

  const firestore = getAdminFirestore({ FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(SERVICE_ACCOUNT) }, deps);
  assert.equal(firestore.app, existing);
  assert.equal(initialized.length, 0);

  assert.throws(() => getAdminFirestore({ FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
    ...SERVICE_ACCOUNT,
    project_id: "different-project",
  }) }, deps), /configuration/i);
});

test("server configuration stays disabled/invalid in examples and pins Vercel to Node 22", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const packageLock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
  const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  const envExample = readFileSync(new URL("../.env.example", import.meta.url), "utf8");

  assert.equal(packageJson.engines.node, "22.x");
  assert.equal(packageLock.packages[""].engines.node, "22.x");
  assert.equal(packageJson.dependencies["firebase-admin"], "^13.4.0");
  assert.deepEqual(vercel.functions["api/notifications.js"], { maxDuration: 10 });
  assert.match(envExample, /^NOTIFICATION_REGISTRATION_ENABLED=false$/m);
  for (const name of [
    "FIREBASE_SERVICE_ACCOUNT_JSON",
    "NOTIFICATION_TOKEN_SECRET",
    "NOTIFICATION_DEDUP_SECRET",
    "NOTIFICATION_ALLOWED_ORIGIN",
    "NOTIFICATION_REGISTRATION_DAILY_CAP",
    "NOTIFICATION_WAF_RATE_LIMIT_RULE_ID",
    "WEB_PUSH_PUBLIC_KEY",
  ]) {
    assert.match(envExample, new RegExp(`^${name}=$`, "m"), name);
  }

  const exampleEnv = Object.fromEntries(envExample.split("\n")
    .filter((line) => /^[A-Z0-9_]+=/.test(line))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    }));
  assert.deepEqual(validateNotificationConfig(exampleEnv), { enabled: false, valid: true });
  assert.equal(validateNotificationConfig({ ...exampleEnv, NOTIFICATION_REGISTRATION_ENABLED: "true" }).valid, false);
  assert.doesNotMatch(envExample, /BEGIN (?:RSA )?PRIVATE KEY-----|AIza[0-9A-Za-z_-]{20,}/);
});
