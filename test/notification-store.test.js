import test from "node:test";
import assert from "node:assert/strict";
import {
  createNotificationStore,
  RegistrationCapError,
} from "../lib/notification-store.js";

const NOW = new Date("2026-07-17T12:00:00.000Z");
const OLD = new Date("2026-07-01T12:00:00.000Z");
const EXPIRES = new Date("2027-01-13T12:00:00.000Z");
const EXPIRED = new Date("2026-07-16T12:00:00.000Z");
const DEVICE_ID = Buffer.alloc(32, 3).toString("base64url");
const OTHER_DEVICE_ID = Buffer.alloc(32, 4).toString("base64url");
const FINGERPRINT = Buffer.alloc(32, 5).toString("base64url");

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function createFakeFirestore(seed = {}) {
  const documents = new Map(Object.entries(seed).map(([path, value]) => [path, clone(value)]));
  const operations = [];

  const firestore = {
    collection(name) {
      return {
        doc(id) {
          return { id, path: `${name}/${id}` };
        },
      };
    },
    async runTransaction(callback) {
      const pending = [];
      const transaction = {
        async get(ref) {
          operations.push(["get", ref.path]);
          const value = documents.get(ref.path);
          return {
            exists: value !== undefined,
            data: () => clone(value),
          };
        },
        create(ref, value) {
          operations.push(["create", ref.path, clone(value)]);
          pending.push(() => {
            if (documents.has(ref.path)) throw new Error("already exists");
            documents.set(ref.path, clone(value));
          });
        },
        set(ref, value, options) {
          operations.push(["set", ref.path, clone(value), clone(options)]);
          pending.push(() => {
            const next = options?.merge
              ? { ...(documents.get(ref.path) || {}), ...clone(value) }
              : clone(value);
            documents.set(ref.path, next);
          });
        },
        update(ref, value) {
          operations.push(["update", ref.path, clone(value)]);
          pending.push(() => {
            if (!documents.has(ref.path)) throw new Error("missing document");
            documents.set(ref.path, { ...documents.get(ref.path), ...clone(value) });
          });
        },
        delete(ref) {
          operations.push(["delete", ref.path]);
          pending.push(() => documents.delete(ref.path));
        },
      };
      const result = await callback(transaction);
      for (const apply of pending) apply();
      return result;
    },
  };

  return { firestore, documents, operations };
}

function registrationRecord(overrides = {}) {
  return {
    endpoint: "https://push.example/subscription",
    keys: { p256dh: "new-p256dh", auth: "new-auth" },
    expirationTime: null,
    timezone: "Asia/Kolkata",
    schedule: [{ weekday: 1, time: "18:00" }],
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
    endpointFingerprint: FINGERPRINT,
    authorizationExpiresAt: EXPIRES,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function registrationOptions(overrides = {}) {
  return {
    endpointFingerprint: FINGERPRINT,
    registrationDate: "2026-07-17",
    dailyCap: 2,
    now: NOW,
    ...overrides,
  };
}

test("new registration atomically creates device/index and increments the global daily cap", async () => {
  const fake = createFakeFirestore();
  const store = createNotificationStore(fake.firestore);

  const effectiveId = await store.create(DEVICE_ID, registrationRecord(), registrationOptions());

  assert.equal(effectiveId, DEVICE_ID);
  assert.deepEqual(fake.documents.get(`notificationDevices/${DEVICE_ID}`), registrationRecord());
  assert.deepEqual(fake.documents.get(`notificationEndpointIndex/${FINGERPRINT}`), {
    deviceId: DEVICE_ID,
    authorizationExpiresAt: EXPIRES,
    createdAt: NOW,
    updatedAt: NOW,
  });
  assert.deepEqual(fake.documents.get("notificationRegistrationCounters/2026-07-17"), {
    count: 1,
    updatedAt: NOW,
  });
});

test("active endpoint refresh consumes quota and changes only registration-owned fields", async () => {
  const existingRecord = registrationRecord({
    endpoint: "https://push.example/old",
    keys: { p256dh: "old-p256dh", auth: "old-auth" },
    expirationTime: 123,
    timezone: "UTC",
    schedule: [{ weekday: 2, time: "07:30" }],
    quietHours: { start: "21:00", end: "07:00" },
    categories: { workout: false, followUp: true, streak: false, recovery: false },
    paused: true,
    lastWorkoutCompletionDate: "2026-07-10",
    dailyDeliveryDate: "2026-07-17",
    dailyDeliveryCount: 2,
    lastSentByCategory: { workout: OLD },
    leaseUntil: EXPIRES,
    leaseId: "existing-lease",
    createdAt: OLD,
    updatedAt: OLD,
    dispatcherOwnedFutureField: { preserve: true },
  });
  const seed = {
    [`notificationDevices/${OTHER_DEVICE_ID}`]: existingRecord,
    [`notificationEndpointIndex/${FINGERPRINT}`]: {
      deviceId: OTHER_DEVICE_ID,
      authorizationExpiresAt: EXPIRES,
      createdAt: OLD,
      updatedAt: OLD,
    },
    "notificationRegistrationCounters/2026-07-17": { count: 1, updatedAt: OLD },
  };
  const fake = createFakeFirestore(seed);
  const store = createNotificationStore(fake.firestore);

  const effectiveId = await store.create(DEVICE_ID, registrationRecord(), registrationOptions());

  assert.equal(effectiveId, OTHER_DEVICE_ID);
  assert.equal(fake.documents.has(`notificationDevices/${DEVICE_ID}`), false);
  const refreshed = fake.documents.get(`notificationDevices/${OTHER_DEVICE_ID}`);
  for (const field of [
    "endpoint", "keys", "expirationTime", "timezone", "schedule", "quietHours",
    "categories", "paused", "authorizationExpiresAt", "nextNotificationAt", "updatedAt",
  ]) {
    assert.deepEqual(refreshed[field], registrationRecord()[field], field);
  }
  for (const field of [
    "enabled", "lastWorkoutCompletionDate", "dailyDeliveryDate", "dailyDeliveryCount",
    "lastSentByCategory", "leaseUntil", "leaseId", "createdAt", "endpointFingerprint",
    "dispatcherOwnedFutureField",
  ]) {
    assert.deepEqual(refreshed[field], existingRecord[field], field);
  }
  assert.deepEqual(fake.documents.get("notificationRegistrationCounters/2026-07-17"), { count: 2, updatedAt: NOW });
  assert.deepEqual(fake.documents.get(`notificationEndpointIndex/${FINGERPRINT}`), {
    deviceId: OTHER_DEVICE_ID,
    authorizationExpiresAt: EXPIRES,
    createdAt: OLD,
    updatedAt: NOW,
  });
  assert.equal(fake.operations.some(([operation, path]) => operation === "create" && path === `notificationDevices/${DEVICE_ID}`), false);
});

test("active endpoint refresh checks the durable cap before every mutation", async () => {
  const seed = {
    [`notificationDevices/${OTHER_DEVICE_ID}`]: registrationRecord({ createdAt: OLD, updatedAt: OLD }),
    [`notificationEndpointIndex/${FINGERPRINT}`]: {
      deviceId: OTHER_DEVICE_ID,
      authorizationExpiresAt: EXPIRES,
      createdAt: OLD,
      updatedAt: OLD,
    },
    "notificationRegistrationCounters/2026-07-17": { count: 2, updatedAt: OLD },
  };
  const fake = createFakeFirestore(seed);
  const before = clone(Object.fromEntries(fake.documents));
  const store = createNotificationStore(fake.firestore);

  await assert.rejects(
    () => store.create(DEVICE_ID, registrationRecord(), registrationOptions()),
    (error) => error instanceof RegistrationCapError,
  );

  assert.deepEqual(Object.fromEntries(fake.documents), before);
  assert.equal(fake.operations.some(([operation]) => ["create", "set", "update", "delete"].includes(operation)), false);
});

test("repeated active registrations are bounded by the same daily write counter", async () => {
  const fake = createFakeFirestore({
    [`notificationDevices/${OTHER_DEVICE_ID}`]: registrationRecord({ createdAt: OLD, updatedAt: OLD }),
    [`notificationEndpointIndex/${FINGERPRINT}`]: {
      deviceId: OTHER_DEVICE_ID,
      authorizationExpiresAt: EXPIRES,
      createdAt: OLD,
      updatedAt: OLD,
    },
  });
  const store = createNotificationStore(fake.firestore);

  assert.equal(await store.create(DEVICE_ID, registrationRecord(), registrationOptions()), OTHER_DEVICE_ID);
  assert.equal(await store.create(DEVICE_ID, registrationRecord(), registrationOptions()), OTHER_DEVICE_ID);
  const beforeThird = clone(Object.fromEntries(fake.documents));
  const operationBoundary = fake.operations.length;
  await assert.rejects(
    () => store.create(DEVICE_ID, registrationRecord(), registrationOptions()),
    (error) => error instanceof RegistrationCapError,
  );

  assert.equal(fake.documents.get("notificationRegistrationCounters/2026-07-17").count, 2);
  assert.deepEqual(Object.fromEntries(fake.documents), beforeThird);
  assert.equal(fake.operations.slice(operationBoundary)
    .some(([operation]) => ["create", "set", "update", "delete"].includes(operation)), false);
});

test("an indexed disabled device fails closed without replacement or re-enablement", async () => {
  const revoked = registrationRecord({
    enabled: false,
    authorizationExpiresAt: EXPIRED,
    createdAt: OLD,
    updatedAt: OLD,
  });
  const fake = createFakeFirestore({
    [`notificationDevices/${OTHER_DEVICE_ID}`]: revoked,
    [`notificationEndpointIndex/${FINGERPRINT}`]: {
      deviceId: OTHER_DEVICE_ID,
      authorizationExpiresAt: EXPIRED,
      createdAt: OLD,
      updatedAt: OLD,
    },
  });
  const before = clone(Object.fromEntries(fake.documents));
  const store = createNotificationStore(fake.firestore);

  await assert.rejects(
    () => store.create(DEVICE_ID, registrationRecord(), registrationOptions()),
    (error) => error?.name === "RegistrationUnavailableError",
  );

  assert.deepEqual(Object.fromEntries(fake.documents), before);
  assert.equal(fake.documents.has(`notificationDevices/${DEVICE_ID}`), false);
  assert.equal(fake.operations.some(([operation]) => ["create", "set", "update", "delete"].includes(operation)), false);
});

test("the global cap rejects atomically before creating a device or endpoint index", async () => {
  const fake = createFakeFirestore({
    "notificationRegistrationCounters/2026-07-17": { count: 2, updatedAt: OLD },
  });
  const store = createNotificationStore(fake.firestore);

  await assert.rejects(
    () => store.create(DEVICE_ID, registrationRecord(), registrationOptions()),
    (error) => error instanceof RegistrationCapError,
  );

  assert.equal(fake.documents.has(`notificationDevices/${DEVICE_ID}`), false);
  assert.equal(fake.documents.has(`notificationEndpointIndex/${FINGERPRINT}`), false);
  assert.deepEqual(fake.documents.get("notificationRegistrationCounters/2026-07-17"), { count: 2, updatedAt: OLD });
  assert.equal(fake.operations.some(([operation]) => ["create", "set", "update", "delete"].includes(operation)), false);
});

test("an expired endpoint index is replaced and consumes one new quota slot", async () => {
  const fake = createFakeFirestore({
    [`notificationDevices/${OTHER_DEVICE_ID}`]: registrationRecord({
      authorizationExpiresAt: EXPIRED,
      createdAt: OLD,
      updatedAt: OLD,
    }),
    [`notificationEndpointIndex/${FINGERPRINT}`]: {
      deviceId: OTHER_DEVICE_ID,
      authorizationExpiresAt: EXPIRED,
      createdAt: OLD,
      updatedAt: OLD,
    },
    "notificationRegistrationCounters/2026-07-17": { count: 1, updatedAt: OLD },
  });
  const store = createNotificationStore(fake.firestore);

  const effectiveId = await store.create(DEVICE_ID, registrationRecord(), registrationOptions());

  assert.equal(effectiveId, DEVICE_ID);
  assert.equal(fake.documents.has(`notificationDevices/${DEVICE_ID}`), true);
  assert.equal(fake.documents.get("notificationRegistrationCounters/2026-07-17").count, 2);
  assert.equal(fake.documents.get(`notificationEndpointIndex/${FINGERPRINT}`).deviceId, DEVICE_ID);
});

test("remove atomically deletes the device and only its matching endpoint index", async () => {
  const fake = createFakeFirestore({
    [`notificationDevices/${DEVICE_ID}`]: registrationRecord(),
    [`notificationEndpointIndex/${FINGERPRINT}`]: {
      deviceId: DEVICE_ID,
      authorizationExpiresAt: EXPIRES,
      createdAt: NOW,
      updatedAt: NOW,
    },
  });
  const store = createNotificationStore(fake.firestore);

  await store.remove(DEVICE_ID);

  assert.equal(fake.documents.has(`notificationDevices/${DEVICE_ID}`), false);
  assert.equal(fake.documents.has(`notificationEndpointIndex/${FINGERPRINT}`), false);
  assert.ok(fake.operations.some(([operation, path]) => operation === "delete" && path === `notificationDevices/${DEVICE_ID}`));
  assert.ok(fake.operations.some(([operation, path]) => operation === "delete" && path === `notificationEndpointIndex/${FINGERPRINT}`));
});

test("update preserves the public per-device store interface", async () => {
  const updates = [];
  const firestore = {
    collection(name) {
      assert.equal(name, "notificationDevices");
      return {
        doc(id) {
          assert.equal(id, DEVICE_ID);
          return { async update(patch) { updates.push(patch); } };
        },
      };
    },
  };
  const store = createNotificationStore(firestore);
  await store.update(DEVICE_ID, { paused: true });
  assert.deepEqual(updates, [{ paused: true }]);
});
