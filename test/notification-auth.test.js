import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  createDeviceToken,
  createEndpointFingerprint,
  verifyDeviceToken,
} from "../lib/notification-auth.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW_MS = Date.UTC(2026, 6, 17, 12, 0, 0);
const SECRET = Buffer.alloc(32, 1).toString("base64url");
const DEDUP_SECRET = Buffer.alloc(32, 2).toString("base64url");
const DEVICE_ID = Buffer.alloc(32, 3).toString("base64url");
const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function signPayload(payload, secret = SECRET) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const key = Buffer.from(secret, "base64url");
  const signature = createHmac("sha256", key).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function malleateLastCharacter(value) {
  const lastIndex = BASE64URL_ALPHABET.indexOf(value.at(-1));
  assert.notEqual(lastIndex, -1);
  const replacement = BASE64URL_ALPHABET[(lastIndex & ~3) | ((lastIndex + 1) & 3)];
  const changed = `${value.slice(0, -1)}${replacement}`;
  assert.notEqual(changed, value);
  assert.deepEqual(Buffer.from(changed, "base64url"), Buffer.from(value, "base64url"));
  return changed;
}

test("device tokens use canonical 32-byte IDs/signatures and last exactly 180 days", () => {
  const token = createDeviceToken(DEVICE_ID, SECRET, NOW_MS);
  const [payloadPart, signaturePart] = token.split(".");
  const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));

  assert.match(signaturePart, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(signaturePart, "base64url").length, 32);
  assert.deepEqual(payload, {
    v: 1,
    sub: DEVICE_ID,
    iat: NOW_MS,
    exp: NOW_MS + (180 * DAY_MS),
  });
  assert.deepEqual(verifyDeviceToken(token, SECRET, NOW_MS), { deviceId: DEVICE_ID });
});

test("token and dedup secrets must be canonical base64url encodings of 32 bytes", () => {
  for (const invalid of [
    "too-short",
    "A".repeat(42),
    `${"A".repeat(42)}B`,
    `${SECRET}=`,
    Buffer.alloc(31, 1).toString("base64url"),
    Buffer.alloc(33, 1).toString("base64url"),
  ]) {
    assert.throws(() => createDeviceToken(DEVICE_ID, invalid, NOW_MS), /configuration/i, invalid);
    assert.throws(() => verifyDeviceToken("a.b", invalid, NOW_MS), /configuration/i, invalid);
    assert.throws(() => createEndpointFingerprint("https://push.example/a", invalid), /configuration/i, invalid);
  }
});

test("device subjects must be exact canonical 32-byte base64url values", () => {
  for (const invalid of [
    "device_a",
    "A".repeat(42),
    `${"A".repeat(42)}B`,
    `${DEVICE_ID}=`,
    Buffer.alloc(31, 3).toString("base64url"),
    Buffer.alloc(33, 3).toString("base64url"),
  ]) {
    assert.throws(() => createDeviceToken(invalid, SECRET, NOW_MS), /invalid/i, invalid);
    assert.throws(() => verifyDeviceToken(signPayload({
      v: 1,
      sub: invalid,
      iat: NOW_MS,
      exp: NOW_MS + (180 * DAY_MS),
    }), SECRET, NOW_MS), /invalid/i, invalid);
  }
});

test("expired and excessively future-issued tokens are rejected", () => {
  const token = createDeviceToken(DEVICE_ID, SECRET, NOW_MS);
  assert.throws(() => verifyDeviceToken(token, SECRET, NOW_MS + (180 * DAY_MS)), /invalid/i);

  const futureToken = createDeviceToken(DEVICE_ID, SECRET, NOW_MS + (5 * 60 * 1000) + 1);
  assert.throws(() => verifyDeviceToken(futureToken, SECRET, NOW_MS), /invalid/i);

  const boundaryToken = createDeviceToken(DEVICE_ID, SECRET, NOW_MS + (5 * 60 * 1000));
  assert.deepEqual(verifyDeviceToken(boundaryToken, SECRET, NOW_MS), { deviceId: DEVICE_ID });
});

test("tampering with either token part never authorizes a device", () => {
  const token = createDeviceToken(DEVICE_ID, SECRET, NOW_MS);
  const [payload, signature] = token.split(".");
  const changedPayload = `${payload.slice(0, -1)}${payload.endsWith("A") ? "B" : "A"}`;
  const changedSignature = `${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;

  assert.throws(() => verifyDeviceToken(`${changedPayload}.${signature}`, SECRET, NOW_MS), /invalid/i);
  assert.throws(() => verifyDeviceToken(`${payload}.${changedSignature}`, SECRET, NOW_MS), /invalid/i);
  assert.throws(() => verifyDeviceToken(token, Buffer.alloc(32, 9).toString("base64url"), NOW_MS), /invalid/i);
});

test("signature encodings with malleated unused bits are rejected", () => {
  const token = createDeviceToken(DEVICE_ID, SECRET, NOW_MS);
  const [payload, signature] = token.split(".");
  const malleatedSignature = malleateLastCharacter(signature);

  assert.throws(() => verifyDeviceToken(`${payload}.${malleatedSignature}`, SECRET, NOW_MS), /invalid/i);
});

test("malformed, unsupported, and unsafe token payloads are rejected", () => {
  const validTimes = { iat: NOW_MS, exp: NOW_MS + (180 * DAY_MS) };
  const invalidTokens = [
    "",
    "one-part",
    "one.two.three",
    "not-json.signature",
    signPayload({ v: 2, sub: DEVICE_ID, ...validTimes }),
    signPayload({ v: 1, sub: 42, ...validTimes }),
    signPayload({ v: 1, sub: DEVICE_ID, iat: "now", exp: validTimes.exp }),
    signPayload({ v: 1, sub: DEVICE_ID, iat: validTimes.iat, exp: Number.NaN }),
    signPayload({ v: 1, sub: DEVICE_ID, iat: validTimes.iat, exp: validTimes.iat }),
    signPayload({ v: 1, sub: DEVICE_ID, ...validTimes, extra: true }),
  ];

  for (const token of invalidTokens) {
    assert.throws(() => verifyDeviceToken(token, SECRET, NOW_MS), /invalid/i, token);
  }
});

test("endpoint fingerprints are stable keyed one-way values", () => {
  const endpoint = "https://push.example/subscription/private-value";
  const first = createEndpointFingerprint(endpoint, DEDUP_SECRET);
  const second = createEndpointFingerprint(endpoint, DEDUP_SECRET);

  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(first, "base64url").length, 32);
  assert.equal(first, second);
  assert.notEqual(first, createEndpointFingerprint(`${endpoint}-different`, DEDUP_SECRET));
  assert.equal(first.includes("private-value"), false);
});
