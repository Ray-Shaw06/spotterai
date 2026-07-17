import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dispatchDue } from "../functions/dispatcher.js";

const NOW = new Date("2026-07-20T12:30:00.000Z");
const AUTH_EXPIRES = new Date("2027-01-01T00:00:00.000Z");
const DEVICE_ID = "device-sensitive-id";
const FINGERPRINT = "endpoint-sensitive-fingerprint";

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function millis(value) {
  if (value instanceof Date) return value.getTime();
  if (value && typeof value.toMillis === "function") return value.toMillis();
  if (value && typeof value.toDate === "function") return value.toDate().getTime();
  return value;
}

function createFakeFirestore(seed = {}) {
  const documents = new Map(Object.entries(seed).map(([path, value]) => [path, clone(value)]));
  const operations = [];
  const queryLimits = [];
  let transactionTail = Promise.resolve();

  function snapshot(ref, value) {
    return {
      id: ref.id,
      ref,
      exists: value !== undefined,
      data: () => clone(value),
    };
  }

  function query(collectionName, filters = [], ordering = null, maximum = Infinity) {
    return {
      doc(id) {
        return { id, path: `${collectionName}/${id}`, collectionName };
      },
      where(field, operator, value) {
        return query(collectionName, [...filters, { field, operator, value }], ordering, maximum);
      },
      orderBy(field, direction = "asc") {
        return query(collectionName, filters, { field, direction }, maximum);
      },
      limit(value) {
        queryLimits.push([collectionName, value]);
        return query(collectionName, filters, ordering, value);
      },
      async get() {
        let rows = [...documents.entries()]
          .filter(([path]) => path.startsWith(`${collectionName}/`))
          .map(([path, value]) => {
            const id = path.slice(collectionName.length + 1);
            const ref = { id, path, collectionName };
            return snapshot(ref, value);
          });
        rows = rows.filter((row) => filters.every(({ field, operator, value }) => {
          const actual = millis(row.data()?.[field]);
          const expected = millis(value);
          if (operator === "==") return actual === expected;
          if (operator === "<=") return actual <= expected;
          if (operator === "<") return actual < expected;
          throw new Error(`Unsupported fake query operator: ${operator}`);
        }));
        if (ordering) {
          const factor = ordering.direction === "desc" ? -1 : 1;
          rows.sort((a, b) => (millis(a.data()?.[ordering.field]) - millis(b.data()?.[ordering.field])) * factor);
        } else {
          rows.sort((a, b) => a.ref.path.localeCompare(b.ref.path));
        }
        return { docs: rows.slice(0, maximum), empty: rows.length === 0 };
      },
    };
  }

  const firestore = {
    collection(name) {
      return query(name);
    },
    runTransaction(callback) {
      const run = transactionTail.then(async () => {
        const pending = [];
        const transaction = {
          async get(ref) {
            operations.push(["get", ref.path]);
            return snapshot(ref, documents.get(ref.path));
          },
          update(ref, patch) {
            operations.push(["update", ref.path, clone(patch)]);
            pending.push(() => {
              if (!documents.has(ref.path)) throw new Error("missing document");
              documents.set(ref.path, { ...documents.get(ref.path), ...clone(patch) });
            });
          },
          set(ref, value, options) {
            operations.push(["set", ref.path, clone(value), clone(options)]);
            pending.push(() => {
              documents.set(ref.path, options?.merge
                ? { ...(documents.get(ref.path) || {}), ...clone(value) }
                : clone(value));
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
      });
      transactionTail = run.catch(() => {});
      return run;
    },
  };

  return { firestore, documents, operations, queryLimits };
}

function device(overrides = {}) {
  return {
    endpoint: "https://fcm.googleapis.com/fcm/send/provider-token",
    keys: { p256dh: "private-p256dh", auth: "private-auth" },
    expirationTime: null,
    endpointFingerprint: FINGERPRINT,
    authorizationExpiresAt: AUTH_EXPIRES,
    enabled: true,
    paused: false,
    timezone: "Asia/Kolkata",
    schedule: [{ weekday: 1, time: "18:00" }],
    quietHours: { start: "22:00", end: "08:00" },
    categories: { workout: true, followUp: true, streak: true, recovery: true },
    lastWorkoutCompletionDate: null,
    nextNotificationAt: NOW,
    dailyDeliveryDate: null,
    dailyDeliveryCount: 0,
    lastSentByCategory: {},
    leaseUntil: null,
    leaseId: null,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: NOW,
    ...overrides,
  };
}

function seedFor(record = device(), id = DEVICE_ID) {
  return {
    [`notificationDevices/${id}`]: record,
    [`notificationEndpointIndex/${record.endpointFingerprint}`]: {
      deviceId: id,
      authorizationExpiresAt: record.authorizationExpiresAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    },
  };
}

function sender(result = { statusCode: 201 }) {
  const calls = [];
  return {
    calls,
    async sendNotification(...args) {
      calls.push(clone(args));
      if (result instanceof Error) throw result;
      return clone(result);
    },
  };
}

test("a recalculation sentinel is moved to its actual future due time without sending", async () => {
  const fake = createFakeFirestore(seedFor(device({
    schedule: [{ weekday: 1, time: "20:00" }],
    nextNotificationAt: new Date("2026-07-20T11:30:00.000Z"),
  })));
  const webpush = sender();

  const result = await dispatchDue({ db: fake.firestore, webpush, now: new Date("2026-07-20T11:30:00.000Z"), leaseId: "lease-a" });

  assert.deepEqual(result, { claimed: 0, sent: 0, expired: 0, failed: 0, skipped: 1 });
  assert.equal(webpush.calls.length, 0);
  assert.equal(fake.documents.get(`notificationDevices/${DEVICE_ID}`).nextNotificationAt.toISOString(), "2026-07-20T14:30:00.000Z");
});

test("a device at its local daily cap is deferred so it cannot starve the due query", async () => {
  const fake = createFakeFirestore(seedFor(device({
    dailyDeliveryDate: "2026-07-20",
    dailyDeliveryCount: 2,
  })));
  const webpush = sender();

  const result = await dispatchDue({ db: fake.firestore, webpush, now: NOW, leaseId: "daily-cap" });

  assert.deepEqual(result, { claimed: 0, sent: 0, expired: 0, failed: 0, skipped: 1 });
  assert.equal(webpush.calls.length, 0);
  assert.equal(fake.documents.get(`notificationDevices/${DEVICE_ID}`).nextNotificationAt.toISOString(), "2026-07-20T18:30:00.000Z");
});

test("201 and 204 atomically finalize delivery state and advance the next event", async () => {
  for (const statusCode of [201, 204]) {
    const fake = createFakeFirestore(seedFor());
    const webpush = sender({ statusCode });

    const result = await dispatchDue({ db: fake.firestore, webpush, now: NOW, leaseId: `lease-${statusCode}` });

    assert.deepEqual(result, { claimed: 1, sent: 1, expired: 0, failed: 0, skipped: 0 });
    assert.equal(webpush.calls.length, 1);
    const [subscription, payload] = webpush.calls[0];
    assert.deepEqual(subscription, {
      endpoint: device().endpoint,
      keys: device().keys,
      expirationTime: null,
    });
    assert.deepEqual(Object.keys(JSON.parse(payload)).sort(), ["body", "category", "icon", "tag", "title", "url"]);
    const stored = fake.documents.get(`notificationDevices/${DEVICE_ID}`);
    assert.equal(stored.dailyDeliveryDate, "2026-07-20");
    assert.equal(stored.dailyDeliveryCount, 1);
    assert.equal(stored.lastSentByCategory.workout, "2026-07-20");
    assert.equal(stored.leaseId, null);
    assert.equal(stored.leaseUntil, null);
    assert.ok(stored.nextNotificationAt > NOW);
  }
});

test("concurrent dispatchers cannot both claim or send one event", async () => {
  const fake = createFakeFirestore(seedFor());
  const webpush = sender({ statusCode: 201 });

  const [first, second] = await Promise.all([
    dispatchDue({ db: fake.firestore, webpush, now: NOW, leaseId: "lease-first" }),
    dispatchDue({ db: fake.firestore, webpush, now: NOW, leaseId: "lease-second" }),
  ]);

  assert.equal(webpush.calls.length, 1);
  assert.equal(first.sent + second.sent, 1);
  assert.equal(first.claimed + second.claimed, 1);
  assert.equal(first.skipped + second.skipped, 1);
});

test("an expired lease is reclaimable while a live lease is skipped", async () => {
  const expiredLease = createFakeFirestore(seedFor(device({
    leaseUntil: new Date("2026-07-20T12:29:59.000Z"),
    leaseId: "stale-lease",
  })));
  const firstSender = sender();
  const reclaimed = await dispatchDue({ db: expiredLease.firestore, webpush: firstSender, now: NOW, leaseId: "fresh-lease" });
  assert.equal(reclaimed.sent, 1);

  const liveLease = createFakeFirestore(seedFor(device({
    leaseUntil: new Date("2026-07-20T12:30:01.000Z"),
    leaseId: "live-lease",
  })));
  const secondSender = sender();
  const skipped = await dispatchDue({ db: liveLease.firestore, webpush: secondSender, now: NOW, leaseId: "other-lease" });
  assert.equal(skipped.skipped, 1);
  assert.equal(secondSender.calls.length, 0);
});

test("404 and 410 delete the device plus only its matching endpoint index", async () => {
  for (const statusCode of [404, 410]) {
    const fake = createFakeFirestore(seedFor());
    const result = await dispatchDue({ db: fake.firestore, webpush: sender({ statusCode }), now: NOW, leaseId: `gone-${statusCode}` });

    assert.deepEqual(result, { claimed: 1, sent: 0, expired: 1, failed: 0, skipped: 0 });
    assert.equal(fake.documents.has(`notificationDevices/${DEVICE_ID}`), false);
    assert.equal(fake.documents.has(`notificationEndpointIndex/${FINGERPRINT}`), false);
  }
});

test("429, 5xx, and network failures release only the owned lease without advancing", async () => {
  const failures = [{ statusCode: 429 }, { statusCode: 503 }, Object.assign(new Error("private endpoint text"), { code: "ECONNRESET" })];
  for (const failure of failures) {
    const fake = createFakeFirestore(seedFor());
    const before = fake.documents.get(`notificationDevices/${DEVICE_ID}`).nextNotificationAt;
    const result = await dispatchDue({ db: fake.firestore, webpush: sender(failure), now: NOW, leaseId: "retry-lease" });

    assert.deepEqual(result, { claimed: 1, sent: 0, expired: 0, failed: 1, skipped: 0 });
    const stored = fake.documents.get(`notificationDevices/${DEVICE_ID}`);
    assert.equal(stored.nextNotificationAt.getTime(), before.getTime());
    assert.equal(stored.lastSentByCategory.workout, undefined);
    assert.equal(stored.leaseId, null);
    assert.equal(stored.leaseUntil, null);
  }
});

test("expired authorization is removed before push with only a still-matching index", async () => {
  const expired = device({ authorizationExpiresAt: new Date("2026-07-20T12:29:59.000Z") });
  const fake = createFakeFirestore(seedFor(expired));
  const webpush = sender();

  const result = await dispatchDue({ db: fake.firestore, webpush, now: NOW, leaseId: "expired-auth" });

  assert.equal(result.expired, 1);
  assert.equal(webpush.calls.length, 0);
  assert.equal(fake.documents.has(`notificationDevices/${DEVICE_ID}`), false);
  assert.equal(fake.documents.has(`notificationEndpointIndex/${FINGERPRINT}`), false);
});

test("stale device cleanup preserves an endpoint index that maps to a newer device", async () => {
  const stale = device({ authorizationExpiresAt: new Date("2026-07-20T12:29:59.000Z") });
  const newerId = "newer-device";
  const fake = createFakeFirestore({
    [`notificationDevices/${DEVICE_ID}`]: stale,
    [`notificationDevices/${newerId}`]: device({
      endpointFingerprint: "newer-fingerprint",
      nextNotificationAt: new Date("2026-07-21T12:30:00.000Z"),
    }),
    [`notificationEndpointIndex/${FINGERPRINT}`]: {
      deviceId: newerId,
      authorizationExpiresAt: AUTH_EXPIRES,
      updatedAt: NOW,
    },
  });

  await dispatchDue({ db: fake.firestore, webpush: sender(), now: NOW, leaseId: "stale-cleanup" });

  assert.equal(fake.documents.has(`notificationDevices/${DEVICE_ID}`), false);
  assert.equal(fake.documents.get(`notificationEndpointIndex/${FINGERPRINT}`).deviceId, newerId);
});

test("only exact installed-device push-provider hosts may reach web-push", async () => {
  const allowed = [
    "https://web.push.apple.com/subscription",
    "https://fcm.googleapis.com/fcm/send/subscription",
    "https://updates.push.services.mozilla.com/wpush/v2/subscription",
  ];
  for (const [index, endpoint] of allowed.entries()) {
    const id = `allowed-${index}`;
    const fingerprint = `allowed-fingerprint-${index}`;
    const fake = createFakeFirestore(seedFor(device({ endpoint, endpointFingerprint: fingerprint }), id));
    const webpush = sender();
    const result = await dispatchDue({ db: fake.firestore, webpush, now: NOW, leaseId: `allowed-lease-${index}` });
    assert.equal(result.sent, 1, endpoint);
    assert.equal(webpush.calls.length, 1, endpoint);
  }
});

test("IP, private, link-local, internal, unsupported, fragment, credential, and nondefault-port endpoints make zero outbound calls", async () => {
  const rejected = [
    "https://127.0.0.1/push",
    "https://[::1]/push",
    "https://10.0.0.4/push",
    "https://172.16.0.4/push",
    "https://192.168.1.4/push",
    "https://169.254.169.254/latest/meta-data",
    "https://localhost/push",
    "https://push.internal/push",
    "https://example.com/redirect?to=https://fcm.googleapis.com/fcm/send/x",
    "http://fcm.googleapis.com/fcm/send/x",
    "https://fcm.googleapis.com/fcm/send/x#fragment",
    "https://user:password@fcm.googleapis.com/fcm/send/x",
    "https://fcm.googleapis.com:444/fcm/send/x",
    "https://fcm.googleapis.com.evil.example/fcm/send/x",
    "https://web.push.apple.com./subscription",
  ];
  for (const [index, endpoint] of rejected.entries()) {
    const id = `rejected-${index}`;
    const fingerprint = `rejected-fingerprint-${index}`;
    const fake = createFakeFirestore(seedFor(device({ endpoint, endpointFingerprint: fingerprint }), id));
    const webpush = sender();
    const result = await dispatchDue({ db: fake.firestore, webpush, now: NOW, leaseId: `rejected-lease-${index}` });
    assert.equal(webpush.calls.length, 0, endpoint);
    assert.equal(result.expired, 1, endpoint);
    assert.equal(fake.documents.has(`notificationDevices/${id}`), false, endpoint);
  }
});

test("a provider redirect response is invalidated and never followed", async () => {
  const fake = createFakeFirestore(seedFor());
  const webpush = sender({ statusCode: 302, headers: { location: "http://127.0.0.1/private" } });

  const result = await dispatchDue({ db: fake.firestore, webpush, now: NOW, leaseId: "redirect-lease" });

  assert.equal(webpush.calls.length, 1);
  assert.equal(result.expired, 1);
  assert.equal(fake.documents.has(`notificationDevices/${DEVICE_ID}`), false);
});

test("expired-device, orphan-index, and old-counter maintenance is bounded", async () => {
  const seed = {};
  const old = new Date("2026-07-01T00:00:00.000Z");
  for (let index = 0; index < 60; index += 1) {
    seed[`notificationDevices/expired-${String(index).padStart(2, "0")}`] = device({
      endpointFingerprint: `expired-fingerprint-${String(index).padStart(2, "0")}`,
      authorizationExpiresAt: old,
      nextNotificationAt: new Date("2026-07-25T00:00:00.000Z"),
    });
    seed[`notificationEndpointIndex/orphan-${String(index).padStart(2, "0")}`] = {
      deviceId: `missing-${index}`,
      authorizationExpiresAt: AUTH_EXPIRES,
      updatedAt: old,
    };
    seed[`notificationRegistrationCounters/2026-05-${String(index).padStart(2, "0")}`] = { count: 1, updatedAt: old };
  }
  const fake = createFakeFirestore(seed);

  await dispatchDue({ db: fake.firestore, webpush: sender(), now: NOW, leaseId: "maintenance" });

  const deletedDevices = fake.operations.filter(([op, path]) => op === "delete" && path.startsWith("notificationDevices/")).length;
  const deletedIndexes = fake.operations.filter(([op, path]) => op === "delete" && path.startsWith("notificationEndpointIndex/")).length;
  const deletedCounters = fake.operations.filter(([op, path]) => op === "delete" && path.startsWith("notificationRegistrationCounters/")).length;
  assert.ok(deletedDevices > 0 && deletedDevices <= 50);
  assert.ok(deletedIndexes > 0 && deletedIndexes <= 50);
  assert.equal(deletedCounters, 50);
  for (const [collection, limit] of fake.queryLimits) {
    if (["notificationDevices", "notificationEndpointIndex", "notificationRegistrationCounters"].includes(collection)) {
      assert.ok(limit <= 200);
    }
  }
});

test("bounded index maintenance rotates past healthy rows instead of starving old orphans", async () => {
  const seed = {};
  const old = new Date("2026-07-01T00:00:00.000Z");
  for (let index = 0; index < 50; index += 1) {
    const suffix = String(index).padStart(2, "0");
    const id = `active-device-${suffix}`;
    const fingerprint = `a-active-index-${suffix}`;
    seed[`notificationDevices/${id}`] = device({
      endpointFingerprint: fingerprint,
      nextNotificationAt: new Date("2026-07-25T00:00:00.000Z"),
      updatedAt: old,
    });
    seed[`notificationEndpointIndex/${fingerprint}`] = {
      deviceId: id,
      authorizationExpiresAt: AUTH_EXPIRES,
      updatedAt: old,
    };
  }
  seed["notificationEndpointIndex/z-old-orphan"] = {
    deviceId: "missing-device",
    authorizationExpiresAt: AUTH_EXPIRES,
    updatedAt: old,
  };
  const fake = createFakeFirestore(seed);

  await dispatchDue({ db: fake.firestore, webpush: sender(), now: NOW, leaseId: "rotate-first" });
  await dispatchDue({ db: fake.firestore, webpush: sender(), now: NOW, leaseId: "rotate-second" });

  assert.equal(fake.documents.has("notificationEndpointIndex/z-old-orphan"), false);
});

test("aggregate operational logs contain no endpoint, key, document, payload, or activity-date data", async () => {
  const fake = createFakeFirestore(seedFor());
  const entries = [];
  const logger = { info: (entry) => entries.push(clone(entry)), error: (entry) => entries.push(clone(entry)) };

  await dispatchDue({ db: fake.firestore, webpush: sender(), now: NOW, leaseId: "privacy-lease", logger });

  const output = JSON.stringify(entries);
  for (const forbidden of [
    DEVICE_ID,
    FINGERPRINT,
    device().endpoint,
    device().keys.p256dh,
    device().keys.auth,
    "2026-07-20",
    "Your planned session",
  ]) assert.equal(output.includes(forbidden), false, forbidden);
  assert.match(output, /notification_dispatch_complete/);
});

test("Firebase configuration preserves user sync and denies all three Task 5 collections", async () => {
  const [rules, indexes, firebase] = await Promise.all([
    readFile(new URL("../firestore.rules", import.meta.url), "utf8"),
    readFile(new URL("../firestore.indexes.json", import.meta.url), "utf8"),
    readFile(new URL("../firebase.json", import.meta.url), "utf8"),
  ]);

  assert.match(rules, /match \/users\/\{uid\}[\s\S]*request\.auth != null[\s\S]*request\.auth\.uid == uid/);
  for (const collection of ["notificationDevices", "notificationEndpointIndex", "notificationRegistrationCounters"]) {
    assert.match(rules, new RegExp(`match /${collection}/\\{[^}]+\\} \\{\\s*allow read, write: if false;`));
  }
  assert.match(rules, /match \/\{document=\*\*\}[\s\S]*allow read, write: if false/);

  const parsedIndexes = JSON.parse(indexes);
  assert.deepEqual(parsedIndexes.indexes, [{
    collectionGroup: "notificationDevices",
    queryScope: "COLLECTION",
    fields: [
      { fieldPath: "enabled", order: "ASCENDING" },
      { fieldPath: "nextNotificationAt", order: "ASCENDING" },
    ],
  }]);
  assert.deepEqual(JSON.parse(firebase), {
    functions: { source: "functions" },
    firestore: { rules: "firestore.rules", indexes: "firestore.indexes.json" },
  });
});

test("the scheduled export is Node 22, five-minute us-central1, and secret-backed", async () => {
  const [source, packageText] = await Promise.all([
    readFile(new URL("../functions/index.js", import.meta.url), "utf8"),
    readFile(new URL("../functions/package.json", import.meta.url), "utf8"),
  ]);
  const manifest = JSON.parse(packageText);

  assert.equal(manifest.engines.node, "22");
  assert.deepEqual(manifest.dependencies, {
    "firebase-admin": "^14.1.0",
    "firebase-functions": "^7.2.5",
    luxon: "^3.7.2",
    "web-push": "^3.6.7",
  });
  assert.match(source, /export const dispatchNotifications = onSchedule/);
  assert.match(source, /schedule:\s*"every 5 minutes"/);
  assert.match(source, /timeZone:\s*"UTC"/);
  assert.match(source, /region:\s*"us-central1"/);
  for (const secret of ["WEB_PUSH_PRIVATE_KEY", "WEB_PUSH_SUBJECT", "WEB_PUSH_PUBLIC_KEY"]) {
    assert.match(source, new RegExp(`secrets:[\\s\\S]*${secret}`));
  }
  assert.doesNotMatch(source, /process\.env\.(WEB_PUSH_PRIVATE_KEY|WEB_PUSH_SUBJECT|WEB_PUSH_PUBLIC_KEY)/);
});
