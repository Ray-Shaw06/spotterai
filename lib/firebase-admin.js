import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

let cachedFirestore;

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

  return {
    ...parsed,
    private_key: parsed.private_key.replace(/\\n/g, "\n"),
  };
}

export function getAdminFirestore(env = process.env) {
  if (cachedFirestore) return cachedFirestore;

  const existingApp = getApps()[0];
  const app = existingApp || initializeApp({
    credential: cert(parseFirebaseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT_JSON)),
  });
  cachedFirestore = getFirestore(app);
  return cachedFirestore;
}
