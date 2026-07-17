import { ECDH } from "node:crypto";
import { isIP } from "node:net";
import { parse as legacyParse } from "node:url";
import { DateTime } from "luxon";
import { isValidNotificationRecord, nextNotification } from "./notification-schedule.js";

const DEVICE_COLLECTION = "notificationDevices";
const ENDPOINT_INDEX_COLLECTION = "notificationEndpointIndex";
const REGISTRATION_COUNTER_COLLECTION = "notificationRegistrationCounters";
const DUE_LIMIT = 200;
const CLEANUP_LIMIT = 50;
const LEASE_MS = 10 * 60 * 1000;
const COUNTER_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;
const REVIEW_AGE_MS = 24 * 60 * 60 * 1000;
const PUSH_TIMEOUT_MS = 15_000;
const FINALIZE_ATTEMPTS = 3;
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

function createClock(now) {
  const source = typeof now === "function" ? now : () => now;
  return () => {
    const current = toMillis(source());
    if (current === null) throw new TypeError("Dispatcher clock returned an invalid date.");
    return current;
  };
}

function authorizationActive(record, nowMillis) {
  const expiresAt = toMillis(record?.authorizationExpiresAt);
  return expiresAt !== null && expiresAt > nowMillis;
}

function safeLeaseId(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= 128;
}

function canonicalBase64Url(value, byteLength) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const decoded = Buffer.from(value, "base64url");
    return decoded.length === byteLength && decoded.toString("base64url") === value ? decoded : null;
  } catch {
    return null;
  }
}

function validP256dh(value) {
  const decoded = canonicalBase64Url(value, 65);
  if (!decoded || decoded[0] !== 4) return false;
  try {
    const converted = ECDH.convertKey(decoded, "prime256v1", undefined, undefined, "uncompressed");
    return converted.equals(decoded);
  } catch {
    return false;
  }
}

function canonicalPushEndpoint(endpoint) {
  if (typeof endpoint !== "string"
    || endpoint.length < 1
    || endpoint.length > 2048
    || endpoint.trim() !== endpoint
    || endpoint.includes("#")
    || !/^https:\/\//i.test(endpoint)) return null;

  const authorityEnd = endpoint.slice(8).search(/[/?#]/);
  const authority = authorityEnd === -1 ? endpoint.slice(8) : endpoint.slice(8, 8 + authorityEnd);
  if (authority.length === 0 || authority.includes("%")) return null;

  try {
    const url = new URL(endpoint);
    const hostname = url.hostname.toLowerCase();
    const canonical = url.href;
    const legacyRaw = legacyParse(endpoint);
    const legacy = legacyParse(canonical);
    if (url.protocol !== "https:"
      || url.username !== ""
      || url.password !== ""
      || url.hash !== ""
      || url.port !== ""
      || isIP(hostname) !== 0
      || !PUSH_PROVIDER_HOSTS.has(hostname)
      || legacyRaw.protocol !== "https:"
      || legacyRaw.auth !== null
      || legacyRaw.hostname?.toLowerCase() !== hostname
      || legacy.protocol !== "https:"
      || legacy.auth !== null
      || legacy.port !== null
      || legacy.hostname?.toLowerCase() !== hostname) return null;
    return canonical;
  } catch {
    return null;
  }
}

export function isAllowedPushEndpoint(endpoint) {
  return canonicalPushEndpoint(endpoint) !== null;
}

function validLeaseState(record) {
  const leaseIdNull = record?.leaseId === null;
  const leaseUntilNull = record?.leaseUntil === null;
  if (leaseIdNull || leaseUntilNull) return leaseIdNull && leaseUntilNull;
  return safeLeaseId(record.leaseId) && toMillis(record.leaseUntil) !== null;
}

function validStoredDevice(id, record) {
  if (!canonicalBase64Url(id, 32)
    || !record || typeof record !== "object" || Array.isArray(record)
    || !canonicalPushEndpoint(record.endpoint)
    || !canonicalBase64Url(record.endpointFingerprint, 32)
    || !record.keys || typeof record.keys !== "object" || Array.isArray(record.keys)
    || Object.keys(record.keys).length !== 2
    || !validP256dh(record.keys.p256dh)
    || !canonicalBase64Url(record.keys.auth, 16)
    || !(record.expirationTime === null
      || (Number.isSafeInteger(record.expirationTime) && record.expirationTime >= 0))
    || !Number.isSafeInteger(record.subscriptionRevision)
    || record.subscriptionRevision < 1
    || toMillis(record.authorizationExpiresAt) === null
    || toMillis(record.createdAt) === null
    || toMillis(record.updatedAt) === null
    || !validLeaseState(record)
    || !isValidNotificationRecord(record)) return false;

  if (!(record.nextNotificationAt === null || toMillis(record.nextNotificationAt) !== null)) return false;
  return record.enabled === true || record.nextNotificationAt === null;
}

function claimIdentity(record, leaseId) {
  return Object.freeze({
    leaseId,
    subscriptionRevision: record.subscriptionRevision,
    endpoint: record.endpoint,
    endpointFingerprint: record.endpointFingerprint,
    p256dh: record.keys.p256dh,
    auth: record.keys.auth,
  });
}

function ownsClaim(record, identity) {
  return record?.leaseId === identity.leaseId
    && record?.subscriptionRevision === identity.subscriptionRevision
    && record?.endpoint === identity.endpoint
    && record?.endpointFingerprint === identity.endpointFingerprint
    && record?.keys?.p256dh === identity.p256dh
    && record?.keys?.auth === identity.auth;
}

async function quarantineInvalidDevice(db, ref, clock) {
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || validStoredDevice(ref.id, snapshot.data())) return false;
    transaction.update(ref, {
      enabled: false,
      nextNotificationAt: null,
      leaseId: null,
      leaseUntil: null,
      updatedAt: new Date(clock()),
    });
    return true;
  });
}

async function deleteMatchingDevice(db, ref, condition = () => true) {
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return false;
    const record = snapshot.data();
    if (!condition(record)) return false;

    const fingerprint = record?.endpointFingerprint;
    if (canonicalBase64Url(fingerprint, 32)) {
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

async function cleanupExpiredDevices(db, clock) {
  const phaseNow = clock();
  const snapshot = await db.collection(DEVICE_COLLECTION)
    .where("authorizationExpiresAt", "<=", new Date(phaseNow))
    .limit(CLEANUP_LIMIT)
    .get();
  let removed = 0;
  let failed = 0;
  for (const document of snapshot.docs) {
    try {
      const currentNow = clock();
      if (await deleteMatchingDevice(db, document.ref, (record) => !authorizationActive(record, currentNow))) {
        removed += 1;
      }
    } catch {
      failed += 1;
    }
  }
  return { removed, failed };
}

async function reviewStoredDevices(db, clock) {
  const phaseNow = clock();
  const cutoff = new Date(phaseNow - REVIEW_AGE_MS);
  const snapshot = await db.collection(DEVICE_COLLECTION)
    .where("updatedAt", "<", cutoff)
    .limit(CLEANUP_LIMIT)
    .get();
  let failed = 0;
  for (const document of snapshot.docs) {
    try {
      await db.runTransaction(async (transaction) => {
        const current = await transaction.get(document.ref);
        if (!current.exists) return;
        const nowMillis = clock();
        if ((toMillis(current.data()?.updatedAt) ?? Infinity) >= nowMillis - REVIEW_AGE_MS) return;
        if (!validStoredDevice(document.ref.id, current.data())) {
          transaction.update(document.ref, {
            enabled: false,
            nextNotificationAt: null,
            leaseId: null,
            leaseUntil: null,
            updatedAt: new Date(nowMillis),
          });
        } else {
          transaction.update(document.ref, { updatedAt: new Date(nowMillis) });
        }
      });
    } catch {
      failed += 1;
    }
  }
  return { failed };
}

async function cleanupOrphanedIndexes(db, clock) {
  const phaseNow = clock();
  const cutoff = new Date(phaseNow - REVIEW_AGE_MS);
  const snapshot = await db.collection(ENDPOINT_INDEX_COLLECTION)
    .where("updatedAt", "<", cutoff)
    .limit(CLEANUP_LIMIT)
    .get();
  let failed = 0;
  for (const document of snapshot.docs) {
    try {
      await db.runTransaction(async (transaction) => {
        const currentIndex = await transaction.get(document.ref);
        if (!currentIndex.exists) return;
        const nowMillis = clock();
        if ((toMillis(currentIndex.data()?.updatedAt) ?? Infinity) >= nowMillis - REVIEW_AGE_MS) return;
        const deviceId = currentIndex.data()?.deviceId;
        if (!canonicalBase64Url(deviceId, 32)) {
          transaction.delete(document.ref);
          return;
        }
        const deviceRef = db.collection(DEVICE_COLLECTION).doc(deviceId);
        const deviceSnapshot = await transaction.get(deviceRef);
        const device = deviceSnapshot.exists ? deviceSnapshot.data() : null;
        if (!device
          || device.endpointFingerprint !== document.id
          || !authorizationActive(device, nowMillis)) {
          transaction.delete(document.ref);
        } else {
          transaction.update(document.ref, { updatedAt: new Date(nowMillis) });
        }
      });
    } catch {
      failed += 1;
    }
  }
  return { failed };
}

async function cleanupOldCounters(db, clock) {
  const phaseNow = clock();
  const cutoff = new Date(phaseNow - COUNTER_RETENTION_MS);
  const snapshot = await db.collection(REGISTRATION_COUNTER_COLLECTION)
    .where("updatedAt", "<", cutoff)
    .limit(CLEANUP_LIMIT)
    .get();
  let failed = 0;
  for (const document of snapshot.docs) {
    try {
      await db.runTransaction(async (transaction) => {
        const current = await transaction.get(document.ref);
        const nowMillis = clock();
        if (current.exists && (toMillis(current.data()?.updatedAt) ?? Infinity) < nowMillis - COUNTER_RETENTION_MS) {
          transaction.delete(document.ref);
        }
      });
    } catch {
      failed += 1;
    }
  }
  return { failed };
}

async function runMaintenancePhase(operation, result) {
  try {
    const outcome = await operation();
    result.expired += outcome?.removed ?? 0;
    result.failed += outcome?.failed ?? 0;
  } catch {
    result.failed += 1;
  }
}

async function claimEvent(db, ref, clock, leaseId) {
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return { status: "skipped" };
    const record = snapshot.data();
    const nowMillis = clock();
    const nowDate = new Date(nowMillis);
    if (!validStoredDevice(ref.id, record)) return { status: "invalid" };
    if (record.enabled !== true
      || (toMillis(record.nextNotificationAt) ?? Infinity) > nowMillis) return { status: "skipped" };
    if (record.paused === true) {
      transaction.update(ref, {
        nextNotificationAt: null,
        leaseId: null,
        leaseUntil: null,
        updatedAt: nowDate,
      });
      return { status: "future" };
    }
    if (!authorizationActive(record, nowMillis)) return { status: "expired" };

    const event = nextNotification(record, nowMillis);
    if (!event) return { status: "no_candidate" };
    if (event.dueAt > nowMillis) {
      transaction.update(ref, { nextNotificationAt: new Date(event.dueAt), updatedAt: nowDate });
      return { status: "future" };
    }
    if ((toMillis(record.leaseUntil) ?? -Infinity) > nowMillis) return { status: "leased" };

    const identity = claimIdentity(record, leaseId);
    transaction.update(ref, {
      leaseId,
      leaseUntil: new Date(nowMillis + LEASE_MS),
      updatedAt: nowDate,
    });
    return {
      status: "claimed",
      record,
      event,
      identity,
      canonicalEndpoint: canonicalPushEndpoint(record.endpoint),
    };
  });
}

async function deferNoCandidate(db, ref, clock) {
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return false;
    const nowMillis = clock();
    const record = snapshot.data();
    if (!validStoredDevice(ref.id, record)
      || (toMillis(record.nextNotificationAt) ?? Infinity) > nowMillis
      || nextNotification(record, nowMillis)) return false;

    const localNow = DateTime.fromMillis(nowMillis, { zone: record.timezone });
    const atDailyCap = localNow.isValid
      && record.dailyDeliveryDate === localNow.toISODate()
      && record.dailyDeliveryCount >= 2;
    transaction.update(ref, {
      nextNotificationAt: atDailyCap ? localNow.plus({ days: 1 }).startOf("day").toJSDate() : null,
      leaseId: null,
      leaseUntil: null,
      updatedAt: new Date(nowMillis),
    });
    return true;
  });
}

async function releaseLease(db, ref, identity, clock) {
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || !ownsClaim(snapshot.data(), identity)) return false;
    transaction.update(ref, { leaseId: null, leaseUntil: null, updatedAt: new Date(clock()) });
    return true;
  });
}

async function finalizeSuccess(db, ref, event, identity, clock) {
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || !ownsClaim(snapshot.data(), identity)) return false;
    const record = snapshot.data();
    const nowMillis = clock();
    const nowDate = new Date(nowMillis);
    const deliveryDate = DateTime.fromMillis(nowMillis, { zone: record.timezone }).toISODate();
    if (!deliveryDate) return false;

    const previousCount = record.dailyDeliveryDate === deliveryDate ? record.dailyDeliveryCount : 0;
    const lastSentByCategory = { ...record.lastSentByCategory, [event.category]: event.localDate };
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

async function finalizeWithRetries(db, ref, event, identity, clock) {
  for (let attempt = 0; attempt < FINALIZE_ATTEMPTS; attempt += 1) {
    try {
      return await finalizeSuccess(db, ref, event, identity, clock);
    } catch {
      if (attempt === FINALIZE_ATTEMPTS - 1) return false;
    }
  }
  return false;
}

function responseStatus(value) {
  const status = Number(value?.statusCode ?? value?.status);
  return Number.isInteger(status) ? status : null;
}

function responseClass(status) {
  if (status === 201 || status === 204) return "success";
  if (status === 404 || status === 410 || (status !== null && status >= 300 && status < 400)) {
    return "expired";
  }
  return "retry";
}

function safeLog(logger, entry) {
  try {
    logger?.info?.(entry);
  } catch {
    // Logging is intentionally best-effort; dispatch state is authoritative.
  }
}

async function processDocument({ db, webpush, document, clock, leaseId, result }) {
  let claim;
  try {
    claim = await claimEvent(db, document.ref, clock, leaseId);
  } catch {
    result.failed += 1;
    return;
  }

  if (["future", "leased", "skipped"].includes(claim.status)) {
    result.skipped += 1;
    return;
  }
  if (claim.status === "invalid") {
    try {
      await quarantineInvalidDevice(db, document.ref, clock);
    } catch {
      result.failed += 1;
    }
    return;
  }
  if (claim.status === "expired") {
    try {
      const nowMillis = clock();
      if (await deleteMatchingDevice(db, document.ref, (record) => !authorizationActive(record, nowMillis))) {
        result.expired += 1;
      }
    } catch {
      result.failed += 1;
    }
    return;
  }
  if (claim.status === "no_candidate") {
    try {
      await deferNoCandidate(db, document.ref, clock);
      result.skipped += 1;
    } catch {
      result.failed += 1;
    }
    return;
  }

  result.claimed += 1;
  try {
    if (!authorizationActive(claim.record, clock())) {
      if (await deleteMatchingDevice(db, document.ref, (record) => ownsClaim(record, claim.identity))) {
        result.expired += 1;
      } else {
        result.failed += 1;
      }
      return;
    }
  } catch {
    result.failed += 1;
    return;
  }

  const subscription = {
    endpoint: claim.canonicalEndpoint,
    keys: { p256dh: claim.identity.p256dh, auth: claim.identity.auth },
    expirationTime: claim.record.expirationTime,
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
    if (await finalizeWithRetries(db, document.ref, claim.event, claim.identity, clock)) {
      result.sent += 1;
    } else {
      result.failed += 1;
    }
    return;
  }
  if (classification === "expired") {
    try {
      if (await deleteMatchingDevice(db, document.ref, (record) => ownsClaim(record, claim.identity))) {
        result.expired += 1;
      } else {
        result.failed += 1;
      }
    } catch {
      result.failed += 1;
    }
    return;
  }
  try {
    await releaseLease(db, document.ref, claim.identity, clock);
  } catch {
    // A failed release leaves the finite lease in place; it must not abort later records.
  }
  result.failed += 1;
}

export async function dispatchDue({ db, webpush, now, leaseId, logger } = {}) {
  if (!db || typeof db.collection !== "function" || typeof db.runTransaction !== "function"
    || !webpush || typeof webpush.sendNotification !== "function"
    || !safeLeaseId(leaseId)) {
    throw new TypeError("Dispatcher dependencies are invalid.");
  }
  const clock = createClock(now);
  const initialNow = clock();
  const result = { claimed: 0, sent: 0, expired: 0, failed: 0, skipped: 0 };

  await runMaintenancePhase(() => cleanupExpiredDevices(db, clock), result);
  await runMaintenancePhase(() => reviewStoredDevices(db, clock), result);
  await runMaintenancePhase(() => cleanupOrphanedIndexes(db, clock), result);
  await runMaintenancePhase(() => cleanupOldCounters(db, clock), result);

  let due;
  try {
    due = await db.collection(DEVICE_COLLECTION)
      .where("enabled", "==", true)
      .where("nextNotificationAt", "<=", new Date(initialNow))
      .orderBy("nextNotificationAt", "asc")
      .limit(DUE_LIMIT)
      .get();
  } catch {
    result.failed += 1;
    safeLog(logger, { event: "notification_dispatch_complete", ...result });
    return result;
  }

  for (const document of due.docs) {
    await processDocument({ db, webpush, document, clock, leaseId, result });
  }

  safeLog(logger, { event: "notification_dispatch_complete", ...result });
  return result;
}

export const DISPATCH_LIMITS = Object.freeze({
  due: DUE_LIMIT,
  cleanup: CLEANUP_LIMIT,
  leaseMs: LEASE_MS,
  finalizeAttempts: FINALIZE_ATTEMPTS,
});
