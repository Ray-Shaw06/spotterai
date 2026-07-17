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

function asDate(value) {
  if (value instanceof Date) return value;
  if (value && typeof value.toDate === "function") return value.toDate();
  return null;
}

function activeAuthorization(record, now) {
  const expiresAt = asDate(record?.authorizationExpiresAt);
  return record?.enabled === true && expiresAt && expiresAt.getTime() > now.getTime();
}

export function createNotificationStore(firestore) {
  const database = () => firestore || getAdminFirestore();
  const document = (collection, id) => database().collection(collection).doc(id);

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

        if (existingDeviceSnapshot?.exists && activeAuthorization(existingDeviceSnapshot.data(), now)) {
          const existingRecord = existingDeviceSnapshot.data();
          transaction.set(existingDevice, {
            ...record,
            createdAt: existingRecord.createdAt,
          }, { merge: true });
          transaction.set(endpointIndex, {
            deviceId: indexed.deviceId,
            authorizationExpiresAt: record.authorizationExpiresAt,
            createdAt: indexed.createdAt || existingRecord.createdAt || now,
            updatedAt: now,
          });
          return indexed.deviceId;
        }

        const counterSnapshot = await transaction.get(counter);
        const currentCount = counterSnapshot.exists ? counterSnapshot.data()?.count : 0;
        if (!Number.isSafeInteger(currentCount) || currentCount < 0 || currentCount >= dailyCap) {
          throw new RegistrationCapError();
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

    async update(deviceId, patch) {
      await document(DEVICE_COLLECTION, deviceId).update(patch);
    },

    async remove(deviceId) {
      const db = database();
      const device = db.collection(DEVICE_COLLECTION).doc(deviceId);
      await db.runTransaction(async (transaction) => {
        const deviceSnapshot = await transaction.get(device);
        if (!deviceSnapshot.exists) return;
        const fingerprint = deviceSnapshot.data()?.endpointFingerprint;
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
