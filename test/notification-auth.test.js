import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createDeviceToken, verifyDeviceToken } from "../lib/notification-auth.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW_MS = Date.UTC(2026, 6, 17, 12, 0, 0);
const SECRET = "notification-token-secret-is-at-least-32-characters";

function signPayload(payload, secret = SECRET) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

test("device tokens are versioned, signed, and valid for exactly 180 days", () => {
  const token = createDeviceToken("device_a", SECRET, NOW_MS);
  const [payloadPart, signaturePart] = token.split(".");
  const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));

  assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(signaturePart.length, 43);
  assert.deepEqual(payload, {
    v: 1,
    sub: "device_a",
    iat: NOW_MS,
    exp: NOW_MS + (180 * DAY_MS),
  });
  assert.deepEqual(verifyDeviceToken(token, SECRET, NOW_MS), { deviceId: "device_a" });
});

test("token secrets shorter than 32 characters are rejected", () => {
  assert.throws(() => createDeviceToken("device_a", "too-short", NOW_MS), /configuration/i);
  assert.throws(() => verifyDeviceToken("a.b", "too-short", NOW_MS), /configuration/i);
});

test("expired and excessively future-issued tokens are rejected", () => {
  const token = createDeviceToken("device_a", SECRET, NOW_MS);
  assert.throws(() => verifyDeviceToken(token, SECRET, NOW_MS + (180 * DAY_MS) + 1), /invalid/i);

  const futureToken = createDeviceToken("device_a", SECRET, NOW_MS + (5 * 60 * 1000) + 1);
  assert.throws(() => verifyDeviceToken(futureToken, SECRET, NOW_MS), /invalid/i);

  const boundaryToken = createDeviceToken("device_a", SECRET, NOW_MS + (5 * 60 * 1000));
  assert.deepEqual(verifyDeviceToken(boundaryToken, SECRET, NOW_MS), { deviceId: "device_a" });
});

test("tampering with either token part never authorizes a device", () => {
  const token = createDeviceToken("device_a", SECRET, NOW_MS);
  const [payload, signature] = token.split(".");
  const changedPayload = `${payload.slice(0, -1)}${payload.endsWith("A") ? "B" : "A"}`;
  const changedSignature = `${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;

  assert.throws(() => verifyDeviceToken(`${changedPayload}.${signature}`, SECRET, NOW_MS), /invalid/i);
  assert.throws(() => verifyDeviceToken(`${payload}.${changedSignature}`, SECRET, NOW_MS), /invalid/i);
  assert.throws(() => verifyDeviceToken(token, `${SECRET}-different`, NOW_MS), /invalid/i);
});

test("malformed, unsupported, and unsafe token payloads are rejected", () => {
  const validTimes = { iat: NOW_MS, exp: NOW_MS + DAY_MS };
  const invalidTokens = [
    "",
    "one-part",
    "one.two.three",
    "not-json.signature",
    signPayload({ v: 2, sub: "device_a", ...validTimes }),
    signPayload({ v: 1, sub: 42, ...validTimes }),
    signPayload({ v: 1, sub: "", ...validTimes }),
    signPayload({ v: 1, sub: "device_a", iat: "now", exp: validTimes.exp }),
    signPayload({ v: 1, sub: "device_a", iat: validTimes.iat, exp: Number.NaN }),
    signPayload({ v: 1, sub: "device_a", iat: validTimes.iat, exp: validTimes.iat }),
  ];

  for (const token of invalidTokens) {
    assert.throws(() => verifyDeviceToken(token, SECRET, NOW_MS), /invalid/i, token);
  }
});
