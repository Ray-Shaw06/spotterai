import { randomUUID } from "node:crypto";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { defineSecret } from "firebase-functions/params";
import { onSchedule } from "firebase-functions/v2/scheduler";
import webpush from "web-push";
import { dispatchDue } from "./dispatcher.js";

const APP_NAME = "spotterai-notification-dispatcher";
const WEB_PUSH_PRIVATE_KEY = defineSecret("WEB_PUSH_PRIVATE_KEY");
const WEB_PUSH_SUBJECT = defineSecret("WEB_PUSH_SUBJECT");
const WEB_PUSH_PUBLIC_KEY = defineSecret("WEB_PUSH_PUBLIC_KEY");

function notificationApp() {
  return getApps().find((app) => app.name === APP_NAME) || initializeApp({}, APP_NAME);
}

export const dispatchNotifications = onSchedule({
  schedule: "every 5 minutes",
  timeZone: "UTC",
  region: "us-central1",
  secrets: [WEB_PUSH_PRIVATE_KEY, WEB_PUSH_SUBJECT, WEB_PUSH_PUBLIC_KEY],
}, async () => {
  webpush.setVapidDetails(
    WEB_PUSH_SUBJECT.value(),
    WEB_PUSH_PUBLIC_KEY.value(),
    WEB_PUSH_PRIVATE_KEY.value(),
  );
  return dispatchDue({
    db: getFirestore(notificationApp()),
    webpush,
    now: new Date(),
    leaseId: randomUUID(),
    logger,
  });
});
