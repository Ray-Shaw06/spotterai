import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createPrivateKey } from "node:crypto";

const APP_NAME = "spotterai-notifications";
const defaultDependencies = { cert, getApps, initializeApp, getFirestore };

function configurationError() {
  return new Error("Firebase Admin configuration is invalid.");
}

export function parseFirebaseServiceAccount(value) {
  if (typeof value !== "string" || !value.trim()) throw configurationError();

  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw configurationError();
  }

  if (parsed === null
    || typeof parsed !== "object"
    || Array.isArray(parsed)
    || typeof parsed.project_id !== "string"
    || !parsed.project_id
    || typeof parsed.client_email !== "string"
    || !parsed.client_email
    || typeof parsed.private_key !== "string"
    || !parsed.private_key) {
    throw configurationError();
  }

  const normalized = {
    ...parsed,
    private_key: parsed.private_key.replace(/\\n/g, "\n"),
  };
  try {
    const key = createPrivateKey(normalized.private_key);
    if (key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength || 0) < 2048) {
      throw configurationError();
    }
  } catch {
    throw configurationError();
  }
  return normalized;
}

export function getAdminFirestore(env = process.env, dependencies = defaultDependencies) {
  const serviceAccount = parseFirebaseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const existingApp = dependencies.getApps().find((app) => app.name === APP_NAME);
  if (existingApp && existingApp.options?.projectId !== serviceAccount.project_id) {
    throw configurationError();
  }
  const app = existingApp || dependencies.initializeApp({
    credential: dependencies.cert(serviceAccount),
    projectId: serviceAccount.project_id,
  }, APP_NAME);
  if (app.options?.projectId !== serviceAccount.project_id) throw configurationError();
  return dependencies.getFirestore(app);
}
