import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_VERSION = 1;
const TOKEN_LIFETIME_MS = 180 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const TOKEN_PART_PATTERN = /^[A-Za-z0-9_-]+$/;
const CANONICAL_32_BYTE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isCanonical32ByteBase64url(value) {
  if (typeof value !== "string" || !CANONICAL_32_BYTE_PATTERN.test(value)) return false;
  try {
    const decoded = Buffer.from(value, "base64url");
    return decoded.length === 32 && decoded.toString("base64url") === value;
  } catch {
    return false;
  }
}

function requireSecret(secret) {
  if (!isCanonical32ByteBase64url(secret)) {
    throw new Error("Notification token configuration is invalid.");
  }
  return Buffer.from(secret, "base64url");
}

function requireNow(nowMs) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new Error("Notification token configuration is invalid.");
  }
  return nowMs;
}

function invalidToken() {
  return new Error("Invalid device token.");
}

function signatureFor(encodedPayload, secret) {
  return createHmac("sha256", requireSecret(secret)).update(encodedPayload).digest();
}

export function createDeviceToken(deviceId, secret, nowMs = Date.now()) {
  requireSecret(secret);
  requireNow(nowMs);
  if (!isCanonical32ByteBase64url(deviceId)) {
    throw invalidToken();
  }

  const payload = {
    v: TOKEN_VERSION,
    sub: deviceId,
    iat: nowMs,
    exp: nowMs + TOKEN_LIFETIME_MS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = signatureFor(encodedPayload, secret).toString("base64url");
  return `${encodedPayload}.${signature}`;
}

export function verifyDeviceToken(token, secret, nowMs = Date.now()) {
  requireSecret(secret);
  requireNow(nowMs);
  if (typeof token !== "string") throw invalidToken();

  const parts = token.split(".");
  if (parts.length !== 2 || parts.some((part) => !TOKEN_PART_PATTERN.test(part))) {
    throw invalidToken();
  }

  const [encodedPayload, encodedSignature] = parts;
  if (!isCanonical32ByteBase64url(encodedSignature)) throw invalidToken();
  const expectedSignature = signatureFor(encodedPayload, secret);
  let actualSignature;
  try {
    actualSignature = Buffer.from(encodedSignature, "base64url");
  } catch {
    throw invalidToken();
  }
  if (actualSignature.length !== expectedSignature.length || !timingSafeEqual(actualSignature, expectedSignature)) {
    throw invalidToken();
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    throw invalidToken();
  }

  const exactKeys = payload && typeof payload === "object" && !Array.isArray(payload)
    ? Object.keys(payload).sort().join(",") === "exp,iat,sub,v"
    : false;
  const validPayload = exactKeys
    && payload.v === TOKEN_VERSION
    && typeof payload.sub === "string"
    && isCanonical32ByteBase64url(payload.sub)
    && Number.isSafeInteger(payload.iat)
    && Number.isSafeInteger(payload.exp)
    && payload.exp - payload.iat === TOKEN_LIFETIME_MS
    && payload.iat <= nowMs + MAX_FUTURE_SKEW_MS
    && payload.exp > nowMs;
  if (!validPayload) throw invalidToken();

  return { deviceId: payload.sub };
}

export function createEndpointFingerprint(endpoint, secret) {
  if (typeof endpoint !== "string" || !endpoint) {
    throw new Error("Notification endpoint configuration is invalid.");
  }
  return createHmac("sha256", requireSecret(secret)).update(endpoint, "utf8").digest("base64url");
}
