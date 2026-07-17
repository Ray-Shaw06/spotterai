import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { notificationDeniedGuidance } from "../notification-guidance.js";

test("denied notification guidance points installed iPhone users to iOS app settings", () => {
  const guidance = notificationDeniedGuidance("ios_pwa");

  assert.match(guidance, /iPhone/);
  assert.match(guidance, /Settings/);
  assert.match(guidance, /SpotterAI/);
  assert.match(guidance, /Allow Notifications/);
  assert.doesNotMatch(guidance, /browser settings/i);
});

test("denied notification guidance gives Android and fallback recovery paths", () => {
  const android = notificationDeniedGuidance("android_pwa");
  const fallback = notificationDeniedGuidance("unknown");

  assert.match(android, /Android/);
  assert.match(android, /Settings/);
  assert.match(android, /SpotterAI/);
  assert.match(android, /Notifications/);
  assert.match(fallback, /app or site notification settings/i);
});

test("the offline shell includes the guidance module used by notification UI", () => {
  const serviceWorker = readFileSync(new URL("../service-worker.js", import.meta.url), "utf8");

  assert.match(serviceWorker, /"notification-guidance\.js"/);
});
