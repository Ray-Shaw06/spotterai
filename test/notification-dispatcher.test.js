import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createECDH } from "node:crypto";
import { parse as legacyParse } from "node:url";
import { dispatchDue } from "../functions/dispatcher.js";
import { createNotificationStore } from "../lib/notification-store.js";

const NOW = new Date("2026-07-20T12:30:00.000Z");
const AUTH_EXPIRES = new Date("2027-01-01T00:00:00.000Z");
const canonical32 = (byte) => Buffer.alloc(32, byte).toString("base64url");
const DEVICE_ID = canonical32(21);
const FINGERPRINT = canonical32(22);
const AUTH = Buffer.alloc(16, 23).toString("base64url");
function publicKey(scalar) {
  const ecdh = createECDH("prime256v1");
  const privateKey = Buffer.alloc(32);
  privateKey[31] = scalar;
  ecdh.setPrivateKey(privateKey);
  return ecdh.getPublicKey(undefined, "uncompressed").toString("base64url");
}

const P256DH = publicKey(1);
const P256DH_REFRESHED = publicKey(2);
const AUTH_REFRESHED = Buffer.alloc(16, 24).toString("base64url");

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function millis(value) {
  if (value instanceof Date) return value.getTime();
  if (value && typeof value.toMillis === "function") return value.toMillis();
  if (value && typeof value.toDate === "function") return value.toDate().getTime();
  return value;
}

function createFakeFirestore(seed = {}, behavior = {}) {
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
        if (behavior.failQuery?.({ collectionName, filters, ordering, maximum })) {
          throw new Error("injected query failure");
        }
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
            if (behavior.failUpdate?.(ref, patch)) throw new Error("injected update failure");
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
            if (behavior.failDelete?.(ref)) throw new Error("injected delete failure");
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
    keys: { p256dh: P256DH, auth: AUTH },
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
    subscriptionRevision: 1,
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
      if (typeof result === "function") return result(...args);
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

test("paused and all-category-disabled records are parked without being quarantined or starving due work", async () => {
  const records = [
    device({ paused: true }),
    device({ categories: { workout: false, followUp: false, streak: false, recovery: false } }),
  ];
  for (const [index, record] of records.entries()) {
    const fake = createFakeFirestore(seedFor(record));
    const webpush = sender();

    const result = await dispatchDue({ db: fake.firestore, webpush, now: NOW, leaseId: `parked-${index}` });

    assert.equal(result.skipped, 1);
    assert.equal(webpush.calls.length, 0);
    const stored = fake.documents.get(`notificationDevices/${DEVICE_ID}`);
    assert.equal(stored.enabled, true);
    assert.equal(stored.nextNotificationAt, null);
  }
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

test("dispatcher expiration accepts only null or a nonnegative safe integer", async () => {
  for (const [index, expirationTime] of [null, 0, 1, Number.MAX_SAFE_INTEGER].entries()) {
    const id = canonical32(220 + index);
    const fingerprint = canonical32(224 + index);
    const fake = createFakeFirestore(seedFor(device({ expirationTime, endpointFingerprint: fingerprint }), id));
    const webpush = sender();

    const result = await dispatchDue({ db: fake.firestore, webpush, now: NOW, leaseId: `valid-expiration-${index}` });

    assert.equal(result.sent, 1, String(expirationTime));
    assert.equal(webpush.calls[0][0].expirationTime, expirationTime);
  }

  const invalid = [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, -Infinity, NaN];
  for (const [index, expirationTime] of invalid.entries()) {
    const id = canonical32(228 + index);
    const fingerprint = canonical32(234 + index);
    const fake = createFakeFirestore(seedFor(device({ expirationTime, endpointFingerprint: fingerprint }), id));
    const webpush = sender();

    await dispatchDue({ db: fake.firestore, webpush, now: NOW, leaseId: `invalid-expiration-${index}` });

    assert.equal(webpush.calls.length, 0, String(expirationTime));
    const stored = fake.documents.get(`notificationDevices/${id}`);
    assert.equal(stored.enabled, false, String(expirationTime));
    assert.equal(stored.nextNotificationAt, null, String(expirationTime));
    assert.equal(stored.leaseId, null, String(expirationTime));
    assert.equal(stored.leaseUntil, null, String(expirationTime));
  }
});

test("a previous-local-day quiet-shifted workout is sent exactly once with its original activity date", async () => {
  const tuesdayMorning = new Date("2026-07-21T02:35:00.000Z");
  const record = device({
    schedule: [{ weekday: 1, time: "23:00" }],
    categories: { workout: true, followUp: false, streak: false, recovery: false },
    nextNotificationAt: tuesdayMorning,
    updatedAt: tuesdayMorning,
  });
  const fake = createFakeFirestore(seedFor(record));
  const webpush = sender();

  const first = await dispatchDue({ db: fake.firestore, webpush, now: tuesdayMorning, leaseId: "cross-midnight-workout" });
  const second = await dispatchDue({ db: fake.firestore, webpush, now: tuesdayMorning, leaseId: "cross-midnight-workout-second" });

  assert.equal(first.sent, 1);
  assert.equal(second.sent, 0);
  assert.equal(webpush.calls.length, 1);
  assert.equal(fake.documents.get(`notificationDevices/${DEVICE_ID}`).lastSentByCategory.workout, "2026-07-20");
});

test("a previous-local-day quiet-shifted follow-up is sent exactly once with its original activity date", async () => {
  const tuesdayMorning = new Date("2026-07-21T02:35:00.000Z");
  const record = device({
    schedule: [{ weekday: 1, time: "21:00" }],
    categories: { workout: false, followUp: true, streak: false, recovery: false },
    nextNotificationAt: tuesdayMorning,
    updatedAt: tuesdayMorning,
  });
  const fake = createFakeFirestore(seedFor(record));
  const webpush = sender();

  const first = await dispatchDue({ db: fake.firestore, webpush, now: tuesdayMorning, leaseId: "cross-midnight-follow-up" });
  const second = await dispatchDue({ db: fake.firestore, webpush, now: tuesdayMorning, leaseId: "cross-midnight-follow-up-second" });

  assert.equal(first.sent, 1);
  assert.equal(second.sent, 0);
  assert.equal(webpush.calls.length, 1);
  assert.equal(fake.documents.get(`notificationDevices/${DEVICE_ID}`).lastSentByCategory.follow_up, "2026-07-20");
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

test("a claimed send blocks confirmed deletion until delivery finalization clears its lease", async () => {
  const fake = createFakeFirestore(seedFor());
  const store = createNotificationStore(fake.firestore);
  let signalStarted;
  let releaseSend;
  const started = new Promise((resolve) => { signalStarted = resolve; });
  const sendGate = new Promise((resolve) => { releaseSend = resolve; });
  const webpush = sender(async () => {
    signalStarted();
    await sendGate;
    return { statusCode: 201 };
  });

  const dispatch = dispatchDue({
    db: fake.firestore,
    webpush,
    now: NOW,
    leaseId: "claim-before-delete",
  });
  await started;

  let deletionError = null;
  try {
    await store.remove(DEVICE_ID, { now: NOW });
  } catch (error) {
    deletionError = error;
  } finally {
    releaseSend();
  }
  const result = await dispatch;

  assert.equal(deletionError?.name, "NotificationLeaseConflictError");
  assert.equal(result.sent, 1);
  assert.equal(webpush.calls.length, 1);
  assert.equal(fake.documents.has(`notificationDevices/${DEVICE_ID}`), true);

  await store.remove(DEVICE_ID, { now: new Date(NOW.getTime() + 1) });
  assert.equal(fake.documents.has(`notificationDevices/${DEVICE_ID}`), false);
  const afterDelete = await dispatchDue({
    db: fake.firestore,
    webpush: sender(),
    now: new Date(NOW.getTime() + 1),
    leaseId: "after-confirmed-delete",
  });
  assert.equal(afterDelete.sent, 0);
});

test("a claimed send blocks PATCH until delivery finalization clears its lease", async () => {
  const fake = createFakeFirestore(seedFor());
  const store = createNotificationStore(fake.firestore);
  let signalStarted;
  let releaseSend;
  const started = new Promise((resolve) => { signalStarted = resolve; });
  const sendGate = new Promise((resolve) => { releaseSend = resolve; });
  const webpush = sender(async () => {
    signalStarted();
    await sendGate;
    return { statusCode: 201 };
  });

  const dispatch = dispatchDue({
    db: fake.firestore,
    webpush,
    now: NOW,
    leaseId: "claim-before-patch",
  });
  await started;

  let updateError = null;
  try {
    await store.update(DEVICE_ID, { paused: true }, { now: NOW });
  } catch (error) {
    updateError = error;
  } finally {
    releaseSend();
  }
  const result = await dispatch;

  assert.equal(updateError?.name, "NotificationLeaseConflictError");
  assert.equal(result.sent, 1);
  assert.equal(fake.documents.get(`notificationDevices/${DEVICE_ID}`).paused, false);

  await store.update(DEVICE_ID, { paused: true }, { now: new Date(NOW.getTime() + 1) });
  assert.equal(fake.documents.get(`notificationDevices/${DEVICE_ID}`).paused, true);
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

test("non-terminal push responses and network failures release only the owned lease without advancing", async () => {
  const failures = [
    ...[400, 401, 403, 413, 429, 500, 503].map((statusCode) => ({ statusCode })),
    Object.assign(new Error("private endpoint text"), { code: "ECONNRESET" }),
  ];
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

test("a refreshed subscription cannot be deleted by the old subscription's terminal response", async () => {
  const fake = createFakeFirestore(seedFor());
  const webpush = sender(() => {
    const path = `notificationDevices/${DEVICE_ID}`;
    const current = fake.documents.get(path);
    fake.documents.set(path, {
      ...current,
      keys: { p256dh: P256DH_REFRESHED, auth: AUTH_REFRESHED },
      subscriptionRevision: 2,
    });
    return { statusCode: 410 };
  });

  const result = await dispatchDue({ db: fake.firestore, webpush, now: NOW, leaseId: "refresh-terminal-race" });

  assert.deepEqual(result, { claimed: 1, sent: 0, expired: 0, failed: 1, skipped: 0 });
  const stored = fake.documents.get(`notificationDevices/${DEVICE_ID}`);
  assert.equal(stored.subscriptionRevision, 2);
  assert.deepEqual(stored.keys, { p256dh: P256DH_REFRESHED, auth: AUTH_REFRESHED });
});

test("a refreshed subscription cannot be finalized by the old subscription's accepted response", async () => {
  const fake = createFakeFirestore(seedFor());
  const webpush = sender(() => {
    const path = `notificationDevices/${DEVICE_ID}`;
    const current = fake.documents.get(path);
    fake.documents.set(path, {
      ...current,
      keys: { p256dh: P256DH_REFRESHED, auth: AUTH_REFRESHED },
      subscriptionRevision: 2,
    });
    return { statusCode: 201 };
  });

  const result = await dispatchDue({ db: fake.firestore, webpush, now: NOW, leaseId: "refresh-success-race" });

  assert.deepEqual(result, { claimed: 1, sent: 0, expired: 0, failed: 1, skipped: 0 });
  const stored = fake.documents.get(`notificationDevices/${DEVICE_ID}`);
  assert.equal(stored.subscriptionRevision, 2);
  assert.equal(stored.dailyDeliveryCount, 0);
  assert.deepEqual(stored.lastSentByCategory, {});
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
  const newerId = canonical32(24);
  const newerFingerprint = canonical32(25);
  const fake = createFakeFirestore({
    [`notificationDevices/${DEVICE_ID}`]: stale,
    [`notificationDevices/${newerId}`]: device({
      endpointFingerprint: newerFingerprint,
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
    const id = canonical32(30 + index);
    const fingerprint = canonical32(40 + index);
    const fake = createFakeFirestore(seedFor(device({ endpoint, endpointFingerprint: fingerprint }), id));
    const webpush = sender();
    const result = await dispatchDue({ db: fake.firestore, webpush, now: NOW, leaseId: `allowed-lease-${index}` });
    assert.equal(result.sent, 1, endpoint);
    assert.equal(webpush.calls.length, 1, endpoint);
  }
});

test("the endpoint is canonicalized once and the legacy parser agrees with the outbound hostname", async () => {
  const rawEndpoint = "https://FCM.GOOGLEAPIS.COM:443/fcm/send/%7Eprovider-token";
  const canonicalEndpoint = new URL(rawEndpoint).href;
  const fake = createFakeFirestore(seedFor(device({ endpoint: rawEndpoint })));
  const webpush = sender((subscription) => {
    assert.equal(subscription.endpoint, canonicalEndpoint);
    assert.equal(legacyParse(subscription.endpoint).hostname, "fcm.googleapis.com");
    return { statusCode: 201 };
  });

  const result = await dispatchDue({ db: fake.firestore, webpush, now: NOW, leaseId: "canonical-endpoint" });

  assert.equal(result.sent, 1);
  assert.equal(webpush.calls.length, 1);
});

test("percent-encoded push authorities are rejected before parser normalization", async () => {
  const rejected = [
    "https://fcm%2Egoogleapis.com/fcm/send/x",
    "https://fcm.googleapis%2Ecom/fcm/send/x",
    "https://%66cm.googleapis.com/fcm/send/x",
  ];
  for (const [index, endpoint] of rejected.entries()) {
    const id = canonical32(184 + index);
    const fingerprint = canonical32(188 + index);
    const fake = createFakeFirestore(seedFor(device({ endpoint, endpointFingerprint: fingerprint }), id));
    const webpush = sender();

    const result = await dispatchDue({ db: fake.firestore, webpush, now: NOW, leaseId: `encoded-authority-${index}` });

    assert.equal(webpush.calls.length, 0, endpoint);
    assert.equal(result.expired, 0, endpoint);
    const stored = fake.documents.get(`notificationDevices/${id}`);
    assert.equal(stored.enabled, false, endpoint);
    assert.equal(stored.nextNotificationAt, null, endpoint);
  }
});

test("IP, private, link-local, internal, unsupported, fragment, credential, and nondefault-port endpoints are quarantined", async () => {
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
    "https:///fcm.googleapis.com/fcm/send/x",
  ];
  for (const [index, endpoint] of rejected.entries()) {
    const id = canonical32(50 + index);
    const fingerprint = canonical32(70 + index);
    const fake = createFakeFirestore(seedFor(device({ endpoint, endpointFingerprint: fingerprint }), id));
    const webpush = sender();
    const result = await dispatchDue({ db: fake.firestore, webpush, now: NOW, leaseId: `rejected-lease-${index}` });
    assert.equal(webpush.calls.length, 0, endpoint);
    assert.equal(result.expired, 0, endpoint);
    const stored = fake.documents.get(`notificationDevices/${id}`);
    assert.equal(stored.enabled, false, endpoint);
    assert.equal(stored.nextNotificationAt, null, endpoint);
  }
});

test("reviewed 3xx provider responses are invalidated and never followed", async () => {
  for (const statusCode of [300, 301, 302, 303, 307, 308, 399]) {
    const fake = createFakeFirestore(seedFor());
    const webpush = sender({ statusCode, headers: { location: "http://127.0.0.1/private" } });

    const result = await dispatchDue({ db: fake.firestore, webpush, now: NOW, leaseId: `redirect-lease-${statusCode}` });

    assert.equal(webpush.calls.length, 1);
    assert.equal(result.expired, 1);
    assert.equal(fake.documents.has(`notificationDevices/${DEVICE_ID}`), false);
  }
});

test("expired-device, orphan-index, and old-counter maintenance is bounded", async () => {
  const seed = {};
  const old = new Date("2026-07-01T00:00:00.000Z");
  for (let index = 0; index < 60; index += 1) {
    const expiredId = canonical32(90 + index);
    const expiredFingerprint = canonical32(150 + index);
    seed[`notificationDevices/${expiredId}`] = device({
      endpointFingerprint: expiredFingerprint,
      authorizationExpiresAt: old,
      nextNotificationAt: new Date("2026-07-25T00:00:00.000Z"),
    });
    seed[`notificationEndpointIndex/${canonical32((index + 1) % 60)}`] = {
      deviceId: canonical32(210 + (index % 40)),
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
    const id = canonical32(30 + index);
    const fingerprint = canonical32(130 + index);
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
  const orphanFingerprint = canonical32(250);
  seed[`notificationEndpointIndex/${orphanFingerprint}`] = {
    deviceId: canonical32(249),
    authorizationExpiresAt: AUTH_EXPIRES,
    updatedAt: old,
  };
  const fake = createFakeFirestore(seed);

  await dispatchDue({ db: fake.firestore, webpush: sender(), now: NOW, leaseId: "rotate-first" });
  await dispatchDue({ db: fake.firestore, webpush: sender(), now: NOW, leaseId: "rotate-second" });

  assert.equal(fake.documents.has(`notificationEndpointIndex/${orphanFingerprint}`), false);
});

test("an endpoint index is healthy only when its document id matches the device fingerprint", async () => {
  const old = new Date("2026-07-01T00:00:00.000Z");
  const mismatchedFingerprint = canonical32(248);
  const fake = createFakeFirestore({
    ...seedFor(device({ nextNotificationAt: new Date("2026-07-25T00:00:00.000Z"), updatedAt: old })),
    [`notificationEndpointIndex/${mismatchedFingerprint}`]: {
      deviceId: DEVICE_ID,
      authorizationExpiresAt: AUTH_EXPIRES,
      updatedAt: old,
    },
  });

  await dispatchDue({ db: fake.firestore, webpush: sender(), now: NOW, leaseId: "mismatched-index" });

  assert.equal(fake.documents.has(`notificationEndpointIndex/${mismatchedFingerprint}`), false);
  assert.equal(fake.documents.has(`notificationDevices/${DEVICE_ID}`), true);
});

test("malformed stored device state is quarantined without any outbound request", async () => {
  const old = new Date("2026-07-01T00:00:00.000Z");
  const offCurveKey = Buffer.concat([Buffer.from([4]), Buffer.alloc(64)]).toString("base64url");
  const cases = [
    { name: "document id", id: "not-canonical", overrides: {} },
    { name: "fingerprint", overrides: { endpointFingerprint: "not-canonical" } },
    { name: "P-256 key", overrides: { keys: { p256dh: offCurveKey, auth: AUTH } } },
    { name: "auth key", overrides: { keys: { p256dh: P256DH, auth: "short" } } },
    { name: "expiration", overrides: { expirationTime: -1 } },
    { name: "revision", overrides: { subscriptionRevision: 0 } },
    { name: "authorization date", overrides: { authorizationExpiresAt: "tomorrow" } },
    { name: "created date", overrides: { createdAt: "yesterday" } },
    { name: "updated date", overrides: { updatedAt: "today" } },
    { name: "next date", overrides: { nextNotificationAt: "soon" } },
    { name: "lease pair", overrides: { leaseId: "orphaned-lease", leaseUntil: null } },
    {
      name: "scheduler state",
      overrides: { schedule: [{ weekday: 1, time: "18:00" }, { weekday: 1, time: "19:00" }] },
    },
  ];

  for (const [index, entry] of cases.entries()) {
    const id = entry.id ?? canonical32(10 + index);
    const fingerprint = entry.overrides.endpointFingerprint ?? canonical32(200 + index);
    const record = device({ endpointFingerprint: fingerprint, updatedAt: old, ...entry.overrides });
    const fake = createFakeFirestore(seedFor(record, id));
    const webpush = sender();

    await dispatchDue({ db: fake.firestore, webpush, now: NOW, leaseId: `quarantine-${index}` });

    assert.equal(webpush.calls.length, 0, entry.name);
    const stored = fake.documents.get(`notificationDevices/${id}`);
    assert.ok(stored, entry.name);
    assert.equal(stored.enabled, false, entry.name);
    assert.equal(stored.nextNotificationAt, null, entry.name);
    assert.equal(stored.leaseId, null, entry.name);
    assert.equal(stored.leaseUntil, null, entry.name);
  }
});

test("transient finalize failures are retried after an accepted push", async () => {
  let failuresRemaining = 2;
  const fake = createFakeFirestore(seedFor(), {
    failUpdate(_ref, patch) {
      if (Object.hasOwn(patch, "dailyDeliveryDate") && failuresRemaining > 0) {
        failuresRemaining -= 1;
        return true;
      }
      return false;
    },
  });

  const result = await dispatchDue({ db: fake.firestore, webpush: sender(), now: NOW, leaseId: "finalize-retry" });

  assert.deepEqual(result, { claimed: 1, sent: 1, expired: 0, failed: 0, skipped: 0 });
  assert.equal(failuresRemaining, 0);
  assert.equal(fake.documents.get(`notificationDevices/${DEVICE_ID}`).dailyDeliveryCount, 1);
});

test("an ambiguously accepted push keeps its lease when finalize retries are exhausted", async () => {
  let finalizeAttempts = 0;
  const fake = createFakeFirestore(seedFor(), {
    failUpdate(_ref, patch) {
      if (Object.hasOwn(patch, "dailyDeliveryDate")) {
        finalizeAttempts += 1;
        return true;
      }
      return false;
    },
  });

  const result = await dispatchDue({ db: fake.firestore, webpush: sender(), now: NOW, leaseId: "ambiguous-accept" });

  assert.deepEqual(result, { claimed: 1, sent: 0, expired: 0, failed: 1, skipped: 0 });
  assert.equal(finalizeAttempts, 3);
  const stored = fake.documents.get(`notificationDevices/${DEVICE_ID}`);
  assert.equal(stored.leaseId, "ambiguous-accept");
  assert.ok(stored.leaseUntil > NOW);
});

test("maintenance failures are contained and later due records still run", async () => {
  const fake = createFakeFirestore(seedFor(), {
    failQuery({ collectionName }) {
      return collectionName === "notificationEndpointIndex";
    },
  });
  const webpush = sender();

  const result = await dispatchDue({ db: fake.firestore, webpush, now: NOW, leaseId: "maintenance-fail-stop" });

  assert.equal(result.sent, 1);
  assert.equal(result.failed, 1);
  assert.equal(webpush.calls.length, 1);
});

test("one cleanup transaction failure does not stop a later due record", async () => {
  const expiredId = canonical32(3);
  const dueId = canonical32(4);
  const expiredFingerprint = canonical32(9);
  const dueFingerprint = canonical32(11);
  let injectFailure = true;
  const fake = createFakeFirestore({
    ...seedFor(device({
      endpointFingerprint: expiredFingerprint,
      authorizationExpiresAt: new Date(NOW.getTime() - 1),
      nextNotificationAt: new Date(NOW.getTime() + 86_400_000),
    }), expiredId),
    ...seedFor(device({ endpointFingerprint: dueFingerprint }), dueId),
  }, {
    failDelete(ref) {
      if (injectFailure && ref.id === expiredId) {
        injectFailure = false;
        return true;
      }
      return false;
    },
  });
  const webpush = sender();

  const result = await dispatchDue({ db: fake.firestore, webpush, now: NOW, leaseId: "cleanup-item-fail-stop" });

  assert.equal(result.sent, 1);
  assert.equal(result.failed, 1);
  assert.equal(webpush.calls.length, 1);
  assert.equal(fake.documents.has(`notificationDevices/${expiredId}`), true);
});

test("one record's claim failure does not stop a later due record", async () => {
  const firstId = canonical32(5);
  const secondId = canonical32(6);
  const firstFingerprint = canonical32(7);
  const secondFingerprint = canonical32(8);
  const fake = createFakeFirestore({
    ...seedFor(device({ endpointFingerprint: firstFingerprint }), firstId),
    ...seedFor(device({ endpointFingerprint: secondFingerprint }), secondId),
  }, {
    failUpdate(ref, patch) {
      return ref.id === firstId && patch.leaseId === "continue-after-claim-failure";
    },
  });
  const webpush = sender();

  const result = await dispatchDue({
    db: fake.firestore,
    webpush,
    now: NOW,
    leaseId: "continue-after-claim-failure",
  });

  assert.equal(result.sent, 1);
  assert.equal(result.failed, 1);
  assert.equal(webpush.calls.length, 1);
  assert.equal(fake.documents.get(`notificationDevices/${secondId}`).dailyDeliveryCount, 1);
});

test("a throwing logger cannot fail an otherwise completed dispatch", async () => {
  const fake = createFakeFirestore(seedFor());
  const logger = { info() { throw new Error("logger unavailable"); } };

  const result = await dispatchDue({ db: fake.firestore, webpush: sender(), now: NOW, leaseId: "safe-logger", logger });

  assert.deepEqual(result, { claimed: 1, sent: 1, expired: 0, failed: 0, skipped: 0 });
});

test("the dispatcher accepts an injected clock function and reads it beyond startup", async () => {
  let reads = 0;
  const clock = () => {
    reads += 1;
    return new Date(NOW.getTime() + reads);
  };
  const fake = createFakeFirestore(seedFor());

  const result = await dispatchDue({ db: fake.firestore, webpush: sender(), now: clock, leaseId: "clock-function" });

  assert.equal(result.sent, 1);
  assert.ok(reads >= 3);
});

test("authorization is rechecked with the fresh clock after a claim and before outbound push", async () => {
  let reads = 0;
  const clock = () => {
    reads += 1;
    return new Date(NOW.getTime() + reads);
  };
  const fake = createFakeFirestore(seedFor(device({
    authorizationExpiresAt: new Date(NOW.getTime() + 7),
  })));
  const webpush = sender();

  const result = await dispatchDue({ db: fake.firestore, webpush, now: clock, leaseId: "fresh-auth-clock" });

  assert.equal(result.claimed, 1);
  assert.equal(result.expired, 1);
  assert.equal(webpush.calls.length, 0);
  assert.ok(reads >= 7);
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
  assert.match(source, /now:\s*\(\)\s*=>\s*new Date\(\)/);
  for (const secret of ["WEB_PUSH_PRIVATE_KEY", "WEB_PUSH_SUBJECT", "WEB_PUSH_PUBLIC_KEY"]) {
    assert.match(source, new RegExp(`secrets:[\\s\\S]*${secret}`));
  }
  assert.doesNotMatch(source, /process\.env\.(WEB_PUSH_PRIVATE_KEY|WEB_PUSH_SUBJECT|WEB_PUSH_PUBLIC_KEY)/);
});
