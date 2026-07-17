import { getAdminFirestore } from "./firebase-admin.js";

const COLLECTION = "notificationDevices";

export function createNotificationStore(firestore) {
  const document = (deviceId) => (firestore || getAdminFirestore()).collection(COLLECTION).doc(deviceId);

  return Object.freeze({
    async create(deviceId, record) {
      await document(deviceId).create(record);
    },
    async update(deviceId, patch) {
      await document(deviceId).update(patch);
    },
    async remove(deviceId) {
      await document(deviceId).delete();
    },
  });
}
