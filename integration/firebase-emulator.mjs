import test from "node:test";
import assert from "node:assert/strict";
import { createECDH, generateKeyPairSync } from "node:crypto";

import { createNotificationHandler } from "../api/notifications.js";
import { createEndpointFingerprint } from "../lib/notification-auth.js";
import { createNotificationStore } from "../lib/notification-store.js";
import { dispatchDue } from "../functions/dispatcher.js";

const PROJECT_ID = "demo-spotterai-release-1";
const NOW = new Date("2026-07-20T12:30:00.000Z");
const NOW_MS = NOW.getTime();
const DAY_MS = 24 * 60 * 60 * 1000;
const DEVICE_ID = Buffer.alloc(32, 3).toString("base64url");
const TOKEN_SECRET = Buffer.alloc(32, 1).toString("base64url");
const DEDUP_SECRET = Buffer.alloc(32, 2).toString("base64url");
const AUTH = Buffer.alloc(16, 4).toString("base64url");
const ORIGIN = "https://emulator.spotterai.invalid";
const FORBIDDEN_CHILD_ENV_KEYS = Object.freeze([
  "FIREBASE_TOKEN",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "FIREBASE_SERVICE_ACCOUNT_JSON",
  "NOTIFICATION_TOKEN_SECRET",
  "NOTIFICATION_DEDUP_SECRET",
  "WEB_PUSH_PRIVATE_KEY",
  "WEB_PUSH_PUBLIC_KEY",
  "WEB_PUSH_SUBJECT",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "OPENAI_API_KEY",
]);

function publicKey(scalar) {
  const ecdh = createECDH("prime256v1");
  const privateKey = Buffer.alloc(32);
  privateKey[31] = scalar;
  ecdh.setPrivateKey(privateKey);
  return ecdh.getPublicKey(undefined, "uncompressed").toString("base64url");
}

const PUBLIC_KEY = publicKey(1);
const P256DH = publicKey(2);
const SUBSCRIPTION = Object.freeze({
  endpoint: "https://fcm.googleapis.com/fcm/send/emulator-fixture",
  expirationTime: null,
  keys: Object.freeze({ p256dh: P256DH, auth: AUTH }),
});
const PREFERENCES = Object.freeze({
  timezone: "UTC",
  schedule: Object.freeze([{ weekday: 1, time: "12:30" }]),
  quietHours: Object.freeze({ start: "23:00", end: "06:00" }),
  categories: Object.freeze({ workout: true, followUp: false, streak: false, recovery: false }),
  paused: false,
});

function localEmulatorAddress(value) {
  if (typeof value !== "string") return null;
  const match = /^(127\.0\.0\.1|localhost):(\d{1,5})$/.exec(value);
  if (!match) return null;
  const port = Number(match[2]);
  return port >= 1 && port <= 65_535 ? { host: match[1], port } : null;
}

function responseRecorder() {
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

async function register(handler) {
  const response = responseRecorder();
  await handler({
    method: "POST",
    url: "/api/notifications",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      "sec-fetch-site": "same-origin",
    },
    body: { subscription: SUBSCRIPTION, preferences: PREFERENCES },
  }, response);
  return response;
}

const emulatorAddress = localEmulatorAddress(process.env.FIRESTORE_EMULATOR_HOST);
const controlledEnvironment = emulatorAddress && process.env.GCLOUD_PROJECT === PROJECT_ID;

test("the Firebase gate requires a local Firestore emulator and the fixed synthetic project", () => {
  assert.ok(emulatorAddress, "FIRESTORE_EMULATOR_HOST must point to a local emulator");
  assert.equal(process.env.GCLOUD_PROJECT, PROJECT_ID);
  assert.equal(process.env.GOOGLE_CLOUD_PROJECT, PROJECT_ID);
  for (const key of FORBIDDEN_CHILD_ENV_KEYS) {
    assert.equal(process.env[key], undefined, `${key} must not reach the emulator child process`);
  }
});

if (controlledEnvironment) {
  test("checked-in rules, registration, dispatch, and cleanup run against real emulated Firestore", async (t) => {
    const [rulesTesting, clientFirestore, adminApp, adminFirestore] = await Promise.all([
      import("@firebase/rules-unit-testing"),
      import("firebase/firestore"),
      import("firebase-admin/app"),
      import("firebase-admin/firestore"),
    ]);
    const {
      assertFails,
      assertSucceeds,
      initializeTestEnvironment,
    } = rulesTesting;
    const { doc, getDoc, setDoc, setLogLevel } = clientFirestore;
    const { deleteApp, initializeApp } = adminApp;
    const { getFirestore } = adminFirestore;

    setLogLevel("silent");
    const testEnvironment = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: emulatorAddress,
    });
    const app = initializeApp({ projectId: PROJECT_ID }, "task-8-controlled-emulator");
    const db = getFirestore(app);

    await testEnvironment.clearFirestore();
    t.after(async () => {
      await testEnvironment.cleanup();
      await deleteApp(app);
    });

    await t.test("security rules preserve user ownership and deny notification collections", async () => {
      const unauthenticated = testEnvironment.unauthenticatedContext().firestore();
      const alice = testEnvironment.authenticatedContext("alice").firestore();
      const bob = testEnvironment.authenticatedContext("bob").firestore();

      await assertSucceeds(setDoc(doc(alice, "users", "alice"), { unit: "kg" }));
      await assertSucceeds(getDoc(doc(alice, "users", "alice")));
      await assertFails(getDoc(doc(bob, "users", "alice")));
      await assertFails(getDoc(doc(unauthenticated, "users", "alice")));
      await assertFails(setDoc(doc(bob, "users", "alice"), { unit: "lb" }));
      await assertFails(setDoc(doc(unauthenticated, "users", "alice"), { unit: "lb" }));

      for (const collection of [
        "notificationDevices",
        "notificationEndpointIndex",
        "notificationRegistrationCounters",
      ]) {
        await assertFails(getDoc(doc(alice, collection, "blocked")));
        await assertFails(setDoc(doc(alice, collection, "blocked"), { exposed: true }));
      }
    });

    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const env = {
      NOTIFICATION_REGISTRATION_ENABLED: "true",
      NOTIFICATION_REGISTRATION_DAILY_CAP: "100",
      NOTIFICATION_WAF_RATE_LIMIT_RULE_ID: "controlled_gate_01",
      NOTIFICATION_ALLOWED_ORIGIN: ORIGIN,
      NOTIFICATION_TOKEN_SECRET: TOKEN_SECRET,
      NOTIFICATION_DEDUP_SECRET: DEDUP_SECRET,
      WEB_PUSH_PUBLIC_KEY: PUBLIC_KEY,
      FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
        project_id: PROJECT_ID,
        client_email: `firebase-adminsdk@${PROJECT_ID}.iam.gserviceaccount.com`,
        private_key: privateKey,
      }),
    };
    const handler = createNotificationHandler({
      store: createNotificationStore(db),
      env,
      now: () => NOW_MS,
      randomBytes: (size) => Buffer.alloc(size, size === 32 ? 3 : 9),
      logger: { info() {}, error() {} },
    });

    await t.test("the real API and store register atomically without exposing records to clients", async () => {
      const response = await register(handler);
      assert.equal(response.statusCode, 201);
      assert.equal(response.body?.ok, true);
      assert.equal(typeof response.body?.deviceToken, "string");

      const fingerprint = createEndpointFingerprint(SUBSCRIPTION.endpoint, DEDUP_SECRET);
      const [device, endpointIndex, counter] = await Promise.all([
        db.collection("notificationDevices").doc(DEVICE_ID).get(),
        db.collection("notificationEndpointIndex").doc(fingerprint).get(),
        db.collection("notificationRegistrationCounters").doc("2026-07-20").get(),
      ]);
      assert.equal(device.exists, true);
      assert.equal(device.data().endpoint, SUBSCRIPTION.endpoint);
      assert.equal(device.data().nextNotificationAt.toMillis(), NOW_MS);
      assert.equal(endpointIndex.data()?.deviceId, DEVICE_ID);
      assert.equal(counter.data()?.count, 1);

      const alice = testEnvironment.authenticatedContext("alice").firestore();
      await assertFails(getDoc(doc(alice, "notificationDevices", DEVICE_ID)));
    });

    await t.test("the dispatcher sends the due record and cleans expired state with a stubbed sender", async () => {
      const registered = (await db.collection("notificationDevices").doc(DEVICE_ID).get()).data();
      const expiredDeviceId = Buffer.alloc(32, 5).toString("base64url");
      const expiredFingerprint = Buffer.alloc(32, 6).toString("base64url");
      const oldDate = new Date(NOW_MS - (7 * DAY_MS));
      await Promise.all([
        db.collection("notificationDevices").doc(expiredDeviceId).set({
          ...registered,
          endpoint: "https://fcm.googleapis.com/fcm/send/expired-emulator-fixture",
          endpointFingerprint: expiredFingerprint,
          authorizationExpiresAt: new Date(NOW_MS - 1),
          nextNotificationAt: new Date(NOW_MS + DAY_MS),
          createdAt: oldDate,
          updatedAt: oldDate,
        }),
        db.collection("notificationEndpointIndex").doc(expiredFingerprint).set({
          deviceId: expiredDeviceId,
          authorizationExpiresAt: new Date(NOW_MS - 1),
          createdAt: oldDate,
          updatedAt: oldDate,
        }),
        db.collection("notificationRegistrationCounters").doc("2026-07-01").set({
          count: 1,
          updatedAt: oldDate,
        }),
      ]);

      const calls = [];
      let releaseSender;
      let recordSenderEntry;
      const senderEntered = new Promise((resolve) => {
        recordSenderEntry = resolve;
      });
      const senderReleased = new Promise((resolve) => {
        releaseSender = resolve;
      });
      const webpush = {
        async sendNotification(subscription, payload, options) {
          calls.push({ subscription, payload: JSON.parse(payload), options });
          recordSenderEntry();
          await senderReleased;
          return { statusCode: 201 };
        },
      };
      const dispatchPromise = dispatchDue({
        db,
        webpush,
        now: NOW,
        leaseId: "controlled-emulator-lease",
        logger: { info() {} },
      });
      await senderEntered;

      try {
        const leased = await db.collection("notificationDevices").doc(DEVICE_ID).get();
        assert.equal(leased.data()?.leaseId, "controlled-emulator-lease");
        assert.ok(leased.data()?.leaseUntil.toMillis() > NOW_MS);
      } finally {
        releaseSender();
      }
      const result = await dispatchPromise;

      assert.equal(result.sent, 1);
      assert.equal(result.expired, 1);
      assert.equal(result.failed, 0);
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0].subscription, SUBSCRIPTION);
      assert.deepEqual(calls[0].payload, {
        title: "Your SpotterAI workout is ready",
        body: "Your planned session is waiting when you're ready.",
        category: "workout",
        url: "/#/today",
        tag: "spotterai-workout",
        icon: "/icons/spotterai-192.png",
      });
      assert.deepEqual(calls[0].options, { TTL: 300, timeout: 15_000 });

      const [current, expired, expiredIndex, oldCounter, currentCounter] = await Promise.all([
        db.collection("notificationDevices").doc(DEVICE_ID).get(),
        db.collection("notificationDevices").doc(expiredDeviceId).get(),
        db.collection("notificationEndpointIndex").doc(expiredFingerprint).get(),
        db.collection("notificationRegistrationCounters").doc("2026-07-01").get(),
        db.collection("notificationRegistrationCounters").doc("2026-07-20").get(),
      ]);
      assert.equal(current.data()?.dailyDeliveryCount, 1);
      assert.equal(current.data()?.lastSentByCategory?.workout, "2026-07-20");
      assert.equal(current.data()?.leaseId, null);
      assert.equal(current.data()?.leaseUntil, null);
      assert.equal(expired.exists, false);
      assert.equal(expiredIndex.exists, false);
      assert.equal(oldCounter.exists, false);
      assert.equal(currentCounter.data()?.count, 1);
    });
  });
}
