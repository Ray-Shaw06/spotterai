import { getAdminFirestore } from "./firebase-admin.js";

const DEVICE_COLLECTION = "notificationDevices";
const ENDPOINT_INDEX_COLLECTION = "notificationEndpointIndex";
const REGISTRATION_COUNTER_COLLECTION = "notificationRegistrationCounters";

export class RegistrationCapError extends Error {
  constructor() {
    super("Notification registration daily cap reached.");
    this.name = "RegistrationCapError";
  }
}

export class RegistrationUnavailableError extends Error {
  constructor() {
    super("Notification registration is unavailable for this endpoint.");
    this.name = "RegistrationUnavailableError";
  }
}

export class NotificationLeaseConflictError extends Error {
  constructor() {
    super("Notification mutation conflicts with an active delivery.");
    this.name = "NotificationLeaseConflictError";
  }
}

function asDate(value) {
  if (value instanceof Date) return value;
  if (value && typeof value.toDate === "function") return value.toDate();
  return null;
}

function activeAuthorization(record, now) {
  const expiresAt = asDate(record?.authorizationExpiresAt);
  return record?.enabled === true && expiresAt && expiresAt.getTime() > now.getTime();
}

function matchesSubscriptionProof(record, existing) {
  return existing?.endpoint === record?.endpoint
    && existing?.keys?.p256dh === record?.keys?.p256dh
    && existing?.keys?.auth === record?.keys?.auth;
}

function leaseState(record, now) {
  if (record?.leaseId === null && record?.leaseUntil === null) return "none";
  const leaseUntil = asDate(record?.leaseUntil);
  if (typeof record?.leaseId !== "string"
    || record.leaseId.length < 1
    || record.leaseId.length > 128
    || !leaseUntil) return "invalid";
  return leaseUntil.getTime() > now.getTime() ? "live" : "stale";
}

function registrationRefresh(record, existing) {
  if (!Number.isSafeInteger(existing?.subscriptionRevision)
    || existing.subscriptionRevision < 1
    || existing.subscriptionRevision >= Number.MAX_SAFE_INTEGER) {
    throw new RegistrationUnavailableError();
  }
  return {
    endpoint: record.endpoint,
    keys: record.keys,
    expirationTime: record.expirationTime,
    timezone: record.timezone,
    schedule: record.schedule,
    quietHours: record.quietHours,
    categories: record.categories,
    paused: record.paused,
    enabled: existing.enabled,
    registrationPending: existing.registrationPending === true,
    configurationId: record.configurationId,
    authorizationExpiresAt: record.authorizationExpiresAt,
    nextNotificationAt: existing.registrationPending === true ? null : existing.nextNotificationAt,
    subscriptionRevision: existing.subscriptionRevision + 1,
    leaseUntil: null,
    leaseId: null,
    updatedAt: record.updatedAt,
  };
}

export function createNotificationStore(firestore) {
  const database = () => firestore || getAdminFirestore();

  return Object.freeze({
    async create(deviceId, record, options = {}) {
      const {
        endpointFingerprint,
        registrationDate,
        dailyCap,
        now,
      } = options;
      if (typeof endpointFingerprint !== "string"
        || typeof registrationDate !== "string"
        || !Number.isSafeInteger(dailyCap)
        || dailyCap < 1
        || !(now instanceof Date)
        || Number.isNaN(now.getTime())) {
        throw new Error("Notification store configuration is invalid.");
      }

      const db = database();
      const requestedDevice = db.collection(DEVICE_COLLECTION).doc(deviceId);
      const endpointIndex = db.collection(ENDPOINT_INDEX_COLLECTION).doc(endpointFingerprint);
      const counter = db.collection(REGISTRATION_COUNTER_COLLECTION).doc(registrationDate);

      return db.runTransaction(async (transaction) => {
        const indexSnapshot = await transaction.get(endpointIndex);
        const indexed = indexSnapshot.exists ? indexSnapshot.data() : null;
        let existingDevice = null;
        let existingDeviceSnapshot = null;
        if (typeof indexed?.deviceId === "string") {
          existingDevice = db.collection(DEVICE_COLLECTION).doc(indexed.deviceId);
          existingDeviceSnapshot = await transaction.get(existingDevice);
        }

        const existingRecord = existingDeviceSnapshot?.exists ? existingDeviceSnapshot.data() : null;
        const recoverablePending = existingRecord?.enabled === false
          && existingRecord?.registrationPending === true;
        const refreshableActive = existingRecord?.enabled === true
          && existingRecord?.registrationPending !== true;
        if (existingRecord && (!matchesSubscriptionProof(record, existingRecord)
          || (!refreshableActive && !recoverablePending)
          || !["none", "stale"].includes(leaseState(existingRecord, now)))) {
          throw new RegistrationUnavailableError();
        }

        const counterSnapshot = await transaction.get(counter);
        const currentCount = counterSnapshot.exists ? counterSnapshot.data()?.count : 0;
        if (!Number.isSafeInteger(currentCount) || currentCount < 0 || currentCount >= dailyCap) {
          throw new RegistrationCapError();
        }

        if (existingRecord && (activeAuthorization(existingRecord, now) || recoverablePending)) {
          transaction.update(existingDevice, registrationRefresh(record, existingRecord));
          transaction.update(endpointIndex, {
            authorizationExpiresAt: record.authorizationExpiresAt,
            updatedAt: now,
          });
          transaction.set(counter, { count: currentCount + 1, updatedAt: now });
          return indexed.deviceId;
        }

        transaction.create(requestedDevice, record);
        transaction.set(endpointIndex, {
          deviceId,
          authorizationExpiresAt: record.authorizationExpiresAt,
          createdAt: now,
          updatedAt: now,
        });
        transaction.set(counter, { count: currentCount + 1, updatedAt: now });
        return deviceId;
      });
    },

    async update(deviceId, patch, { now, registrationActivation = false, configurationId } = {}) {
      if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
        throw new Error("Notification store configuration is invalid.");
      }
      const db = database();
      const device = db.collection(DEVICE_COLLECTION).doc(deviceId);
      await db.runTransaction(async (transaction) => {
        const deviceSnapshot = await transaction.get(device);
        if (!deviceSnapshot.exists) throw new Error("Notification device is unavailable.");
        const existing = deviceSnapshot.data();
        if (!["none", "stale"].includes(leaseState(existing, now))) {
          throw new NotificationLeaseConflictError();
        }
        if (registrationActivation
          && !((existing.enabled === false && existing.registrationPending === true)
            || (existing.enabled === true && existing.registrationPending !== true))) {
          throw new RegistrationUnavailableError();
        }
        if (registrationActivation && existing.configurationId !== configurationId) {
          throw new RegistrationUnavailableError();
        }
        transaction.update(device, patch);
      });
    },

    async remove(deviceId, { now } = {}) {
      if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
        throw new Error("Notification store configuration is invalid.");
      }
      const db = database();
      const device = db.collection(DEVICE_COLLECTION).doc(deviceId);
      await db.runTransaction(async (transaction) => {
        const deviceSnapshot = await transaction.get(device);
        if (!deviceSnapshot.exists) return;
        const record = deviceSnapshot.data();
        if (!["none", "stale"].includes(leaseState(record, now))) {
          throw new NotificationLeaseConflictError();
        }
        const fingerprint = record?.endpointFingerprint;
        let endpointIndex = null;
        let indexSnapshot = null;
        if (typeof fingerprint === "string") {
          endpointIndex = db.collection(ENDPOINT_INDEX_COLLECTION).doc(fingerprint);
          indexSnapshot = await transaction.get(endpointIndex);
        }
        if (indexSnapshot?.exists && indexSnapshot.data()?.deviceId === deviceId) {
          transaction.delete(endpointIndex);
        }
        transaction.delete(device);
      });
    },
  });
}
