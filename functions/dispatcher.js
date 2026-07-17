import { isIP } from "node:net";
import { DateTime } from "luxon";
import { nextNotification } from "./notification-schedule.js";

const DEVICE_COLLECTION = "notificationDevices";
const ENDPOINT_INDEX_COLLECTION = "notificationEndpointIndex";
const REGISTRATION_COUNTER_COLLECTION = "notificationRegistrationCounters";
const DUE_LIMIT = 200;
const CLEANUP_LIMIT = 50;
const LEASE_MS = 10 * 60 * 1000;
const COUNTER_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;
const INDEX_REVIEW_AGE_MS = 24 * 60 * 60 * 1000;
const PUSH_TIMEOUT_MS = 15_000;
const PUSH_PROVIDER_HOSTS = new Set([
  "web.push.apple.com",
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
]);

function toMillis(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getTime();
  if (value && typeof value.toMillis === "function") {
    const result = value.toMillis();
    return Number.isFinite(result) ? result : null;
  }
  if (value && typeof value.toDate === "function") {
    const result = value.toDate();
    return result instanceof Date && !Number.isNaN(result.getTime()) ? result.getTime() : null;
  }
  return null;
}

function authorizationActive(record, nowMillis) {
  const expiresAt = toMillis(record?.authorizationExpiresAt);
  return expiresAt !== null && expiresAt > nowMillis;
}

function safeLeaseId(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= 128;
}

export function isAllowedPushEndpoint(endpoint) {
  if (typeof endpoint !== "string"
    || endpoint.length < 1
    || endpoint.length > 2048
    || endpoint.trim() !== endpoint
    || endpoint.includes("#")) return false;
  try {
    const url = new URL(endpoint);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === "https:"
      && url.username === ""
      && url.password === ""
      && url.hash === ""
      && url.port === ""
      && isIP(hostname) === 0
      && PUSH_PROVIDER_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

async function deleteMatchingDevice(db, ref, condition = () => true) {
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return false;
    const record = snapshot.data();
    if (!condition(record)) return false;

    const fingerprint = record?.endpointFingerprint;
    if (typeof fingerprint === "string" && fingerprint.length > 0) {
      const indexRef = db.collection(ENDPOINT_INDEX_COLLECTION).doc(fingerprint);
      const indexSnapshot = await transaction.get(indexRef);
      if (indexSnapshot.exists && indexSnapshot.data()?.deviceId === ref.id) {
        transaction.delete(indexRef);
      }
    }
    transaction.delete(ref);
    return true;
  });
}

async function cleanupExpiredDevices(db, nowDate, nowMillis) {
  const snapshot = await db.collection(DEVICE_COLLECTION)
    .where("authorizationExpiresAt", "<=", nowDate)
    .limit(CLEANUP_LIMIT)
    .get();
  let removed = 0;
  for (const document of snapshot.docs) {
    if (await deleteMatchingDevice(db, document.ref, (record) => !authorizationActive(record, nowMillis))) {
      removed += 1;
    }
  }
  return removed;
}

async function cleanupOrphanedIndexes(db, nowMillis) {
  const cutoff = new Date(nowMillis - INDEX_REVIEW_AGE_MS);
  const snapshot = await db.collection(ENDPOINT_INDEX_COLLECTION)
    .where("updatedAt", "<", cutoff)
    .limit(CLEANUP_LIMIT)
    .get();
  for (const document of snapshot.docs) {
    await db.runTransaction(async (transaction) => {
      const currentIndex = await transaction.get(document.ref);
      if (!currentIndex.exists) return;
      if ((toMillis(currentIndex.data()?.updatedAt) ?? Infinity) >= cutoff.getTime()) return;
      const deviceId = currentIndex.data()?.deviceId;
      if (typeof deviceId !== "string" || deviceId.length === 0) {
        transaction.delete(document.ref);
        return;
      }
      const deviceRef = db.collection(DEVICE_COLLECTION).doc(deviceId);
      const deviceSnapshot = await transaction.get(deviceRef);
      if (!deviceSnapshot.exists || !authorizationActive(deviceSnapshot.data(), nowMillis)) {
        transaction.delete(document.ref);
      } else {
        transaction.update(document.ref, { updatedAt: new Date(nowMillis) });
      }
    });
  }
}

async function cleanupOldCounters(db, nowMillis) {
  const cutoff = new Date(nowMillis - COUNTER_RETENTION_MS);
  const snapshot = await db.collection(REGISTRATION_COUNTER_COLLECTION)
    .where("updatedAt", "<", cutoff)
    .limit(CLEANUP_LIMIT)
    .get();
  for (const document of snapshot.docs) {
    await db.runTransaction(async (transaction) => {
      const current = await transaction.get(document.ref);
      if (current.exists && (toMillis(current.data()?.updatedAt) ?? Infinity) < cutoff.getTime()) {
        transaction.delete(document.ref);
      }
    });
  }
}

async function claimEvent(db, ref, nowDate, nowMillis, leaseId) {
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return { status: "skipped" };
    const record = snapshot.data();
    if (record.enabled !== true
      || record.paused !== false
      || !authorizationActive(record, nowMillis)
      || (toMillis(record.nextNotificationAt) ?? Infinity) > nowMillis) {
      return { status: "skipped" };
    }

    const event = nextNotification(record, nowMillis);
    if (!event) return { status: "skipped" };
    if (event.dueAt > nowMillis) {
      transaction.update(ref, { nextNotificationAt: new Date(event.dueAt), updatedAt: nowDate });
      return { status: "future" };
    }
    if (!isAllowedPushEndpoint(record.endpoint)) return { status: "invalid" };
    if ((toMillis(record.leaseUntil) ?? -Infinity) > nowMillis) return { status: "leased" };

    transaction.update(ref, {
      leaseId,
      leaseUntil: new Date(nowMillis + LEASE_MS),
      updatedAt: nowDate,
    });
    return { status: "claimed", record, event };
  });
}

async function deferNoCandidate(db, ref, nowDate, nowMillis) {
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || (toMillis(snapshot.data()?.nextNotificationAt) ?? Infinity) > nowMillis) return false;
    const record = snapshot.data();
    if (nextNotification(record, nowMillis)) return false;

    const localNow = DateTime.fromMillis(nowMillis, { zone: record.timezone });
    const atDailyCap = localNow.isValid
      && record.dailyDeliveryDate === localNow.toISODate()
      && Number.isSafeInteger(record.dailyDeliveryCount)
      && record.dailyDeliveryCount >= 2;
    transaction.update(ref, {
      nextNotificationAt: atDailyCap ? localNow.plus({ days: 1 }).startOf("day").toJSDate() : null,
      updatedAt: nowDate,
    });
    return true;
  });
}

async function releaseLease(db, ref, leaseId, nowDate) {
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || snapshot.data()?.leaseId !== leaseId) return false;
    transaction.update(ref, { leaseId: null, leaseUntil: null, updatedAt: nowDate });
    return true;
  });
}

async function finalizeSuccess(db, ref, event, leaseId, nowDate, nowMillis) {
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || snapshot.data()?.leaseId !== leaseId) return false;
    const record = snapshot.data();
    const deliveryDate = DateTime.fromMillis(nowMillis, { zone: record.timezone }).toISODate();
    if (!deliveryDate) return false;

    const previousCount = record.dailyDeliveryDate === deliveryDate
      && Number.isSafeInteger(record.dailyDeliveryCount)
      && record.dailyDeliveryCount >= 0
      ? record.dailyDeliveryCount
      : 0;
    const lastSentByCategory = {
      ...(record.lastSentByCategory && typeof record.lastSentByCategory === "object"
        ? record.lastSentByCategory
        : {}),
      [event.category]: event.localDate,
    };
    const projected = {
      ...record,
      dailyDeliveryDate: deliveryDate,
      dailyDeliveryCount: previousCount + 1,
      lastSentByCategory,
      leaseId: null,
      leaseUntil: null,
    };
    const next = nextNotification(projected, nowMillis);
    transaction.update(ref, {
      dailyDeliveryDate: deliveryDate,
      dailyDeliveryCount: previousCount + 1,
      lastSentByCategory,
      nextNotificationAt: next ? new Date(next.dueAt) : null,
      leaseId: null,
      leaseUntil: null,
      updatedAt: nowDate,
    });
    return true;
  });
}

function responseStatus(value) {
  const status = Number(value?.statusCode ?? value?.status);
  return Number.isInteger(status) ? status : null;
}

function responseClass(status) {
  if (status === 201 || status === 204) return "success";
  if (status === 404 || status === 410 || (status !== null && status >= 300 && status < 500 && status !== 429)) {
    return "expired";
  }
  return "retry";
}

export async function dispatchDue({ db, webpush, now, leaseId, logger } = {}) {
  const nowMillis = toMillis(now);
  if (!db || typeof db.collection !== "function" || typeof db.runTransaction !== "function"
    || !webpush || typeof webpush.sendNotification !== "function"
    || nowMillis === null
    || !safeLeaseId(leaseId)) {
    throw new TypeError("Dispatcher dependencies are invalid.");
  }
  const nowDate = new Date(nowMillis);
  const result = { claimed: 0, sent: 0, expired: 0, failed: 0, skipped: 0 };

  result.expired += await cleanupExpiredDevices(db, nowDate, nowMillis);
  await cleanupOrphanedIndexes(db, nowMillis);
  await cleanupOldCounters(db, nowMillis);

  const due = await db.collection(DEVICE_COLLECTION)
    .where("enabled", "==", true)
    .where("nextNotificationAt", "<=", nowDate)
    .orderBy("nextNotificationAt", "asc")
    .limit(DUE_LIMIT)
    .get();

  for (const document of due.docs) {
    const initial = document.data();
    if (!authorizationActive(initial, nowMillis)) {
      if (await deleteMatchingDevice(db, document.ref, (record) => !authorizationActive(record, nowMillis))) {
        result.expired += 1;
      }
      continue;
    }
    const preview = nextNotification(initial, nowMillis);
    if (!preview) {
      await deferNoCandidate(db, document.ref, nowDate, nowMillis);
      result.skipped += 1;
      continue;
    }
    if (!isAllowedPushEndpoint(initial.endpoint)) {
      if (await deleteMatchingDevice(db, document.ref, (record) => !isAllowedPushEndpoint(record.endpoint))) {
        result.expired += 1;
      }
      continue;
    }

    const claim = await claimEvent(db, document.ref, nowDate, nowMillis, leaseId);
    if (claim.status === "future" || claim.status === "leased" || claim.status === "skipped") {
      result.skipped += 1;
      continue;
    }
    if (claim.status === "invalid") {
      if (await deleteMatchingDevice(db, document.ref, (record) => !isAllowedPushEndpoint(record.endpoint))) {
        result.expired += 1;
      }
      continue;
    }

    result.claimed += 1;
    const subscription = {
      endpoint: claim.record.endpoint,
      keys: { p256dh: claim.record.keys?.p256dh, auth: claim.record.keys?.auth },
      expirationTime: claim.record.expirationTime ?? null,
    };
    let status = null;
    try {
      const response = await webpush.sendNotification(
        subscription,
        JSON.stringify(claim.event.payload),
        { TTL: 300, timeout: PUSH_TIMEOUT_MS },
      );
      status = responseStatus(response);
    } catch (error) {
      status = responseStatus(error);
    }

    const classification = responseClass(status);
    if (classification === "success") {
      if (await finalizeSuccess(db, document.ref, claim.event, leaseId, nowDate, nowMillis)) {
        result.sent += 1;
      } else {
        result.failed += 1;
      }
      continue;
    }
    if (classification === "expired") {
      if (await deleteMatchingDevice(db, document.ref, (record) => record.leaseId === leaseId)) {
        result.expired += 1;
      } else {
        result.failed += 1;
      }
      continue;
    }
    await releaseLease(db, document.ref, leaseId, nowDate);
    result.failed += 1;
  }

  logger?.info?.({ event: "notification_dispatch_complete", ...result });
  return result;
}

export const DISPATCH_LIMITS = Object.freeze({ due: DUE_LIMIT, cleanup: CLEANUP_LIMIT, leaseMs: LEASE_MS });
