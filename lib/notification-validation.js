import { validateNotificationPreferences } from "../notifications.js";
import { ECDH } from "node:crypto";
import { parseFirebaseServiceAccount } from "./firebase-admin.js";
import { isCanonical32ByteBase64url } from "./notification-auth.js";

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isCanonicalBase64url(value, minLength, maxLength) {
  if (typeof value !== "string" || value.length < minLength || value.length > maxLength || !BASE64URL_PATTERN.test(value)) {
    return false;
  }
  try {
    return Buffer.from(value, "base64url").toString("base64url") === value;
  } catch {
    return false;
  }
}

function isP256dh(value) {
  if (!isCanonicalBase64url(value, 87, 87)) return false;
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== 65 || decoded[0] !== 4) return false;
  try {
    ECDH.convertKey(decoded, "prime256v1", undefined, undefined, "uncompressed");
    return true;
  } catch {
    return false;
  }
}

function isAuthSecret(value) {
  return isCanonicalBase64url(value, 22, 22)
    && Buffer.from(value, "base64url").length === 16;
}

export function validateNotificationConfig(env = {}) {
  if (env.NOTIFICATION_REGISTRATION_ENABLED !== "true") {
    return { enabled: false, valid: true };
  }

  const secret = env.NOTIFICATION_TOKEN_SECRET;
  const dedupSecret = env.NOTIFICATION_DEDUP_SECRET;
  const publicKey = env.WEB_PUSH_PUBLIC_KEY;
  const allowedOrigin = env.NOTIFICATION_ALLOWED_ORIGIN;
  const dailyCap = Number(env.NOTIFICATION_REGISTRATION_DAILY_CAP);
  const wafRuleId = env.NOTIFICATION_WAF_RATE_LIMIT_RULE_ID;
  if (!isCanonical32ByteBase64url(secret)
    || !isCanonical32ByteBase64url(dedupSecret)
    || secret === dedupSecret
    || !isP256dh(publicKey)
    || !Number.isSafeInteger(dailyCap)
    || dailyCap < 1
    || dailyCap > 100_000
    || typeof wafRuleId !== "string"
    || !/^[A-Za-z0-9_-]{8,128}$/.test(wafRuleId)
    || /placeholder|replace|example|test/i.test(wafRuleId)) {
    return { valid: false };
  }

  try {
    const origin = new URL(allowedOrigin);
    if (origin.protocol !== "https:"
      || origin.origin !== allowedOrigin
      || origin.username
      || origin.password) return { valid: false };
    parseFirebaseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  } catch {
    return { valid: false };
  }
  return {
    enabled: true,
    valid: true,
    secret,
    dedupSecret,
    publicKey,
    allowedOrigin,
    dailyCap,
    wafRuleId,
  };
}

export function validatePushSubscription(value) {
  if (!isRecord(value)
    || !hasOwn(value, "endpoint")
    || !hasOwn(value, "keys")
    || !hasOwn(value, "expirationTime")
    || typeof value.endpoint !== "string"
    || value.endpoint.length < 1
    || value.endpoint.length > 2048
    || value.endpoint.trim() !== value.endpoint
    || value.endpoint.includes("#")
    || !isRecord(value.keys)
    || !hasOwn(value.keys, "p256dh")
    || !hasOwn(value.keys, "auth")
    || !isP256dh(value.keys.p256dh)
    || !isAuthSecret(value.keys.auth)
    || !(value.expirationTime === null || (typeof value.expirationTime === "number" && Number.isFinite(value.expirationTime) && value.expirationTime >= 0))) {
    return { valid: false };
  }

  try {
    const endpoint = new URL(value.endpoint);
    if (endpoint.protocol !== "https:" || !endpoint.hostname || endpoint.username || endpoint.password) {
      return { valid: false };
    }
    value = { ...value, endpoint: endpoint.href };
  } catch {
    return { valid: false };
  }

  return {
    valid: true,
    value: {
      endpoint: value.endpoint,
      keys: { p256dh: value.keys.p256dh, auth: value.keys.auth },
      expirationTime: value.expirationTime,
    },
  };
}

export function validatePreferences(value) {
  const result = validateNotificationPreferences(value);
  return result.valid ? { valid: true, value: result.value } : { valid: false };
}

export function isCompletionDate(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export { hasOwn, isRecord };
