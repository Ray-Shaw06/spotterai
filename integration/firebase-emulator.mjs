/**
 * Firestore security-rules gate (runs under `firebase emulators:exec`).
 *
 * Zero-cost notifications removed every notification collection, so the only
 * remaining server-side data is per-user sync at `/users/{uid}`. This test
 * proves two things against the real Firestore emulator:
 *   1. a signed-in user owns exactly their own `/users/{uid}` document;
 *   2. everything else (any other collection, any other user's doc) is denied.
 *
 * The gate script (scripts/run-firebase-emulator-gate.mjs) only treats the run
 * as passed when the marker below is printed AND `node --test` exits 0.
 */
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";

import {
  FIREBASE_EMULATOR_PROJECT_ID,
  FIREBASE_EMULATOR_INTEGRATION_MARKER,
} from "../scripts/firebase-emulator-environment.mjs";

console.log(FIREBASE_EMULATOR_INTEGRATION_MARKER);

const rules = readFileSync(fileURLToPath(new URL("../firestore.rules", import.meta.url)), "utf8");
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080").split(":");

const testEnv = await initializeTestEnvironment({
  projectId: FIREBASE_EMULATOR_PROJECT_ID,
  firestore: { rules, host, port: Number(port) },
});

test.after(async () => {
  await testEnv.cleanup();
});

test("a signed-in user can read and write their own /users/{uid} document", async () => {
  const alice = testEnv.authenticatedContext("alice").firestore();
  await assertSucceeds(setDoc(doc(alice, "users/alice"), { plan: "mine", updatedAt: 1 }));
  await assertSucceeds(getDoc(doc(alice, "users/alice")));
});

test("a signed-in user cannot touch another user's /users/{uid} document", async () => {
  const alice = testEnv.authenticatedContext("alice").firestore();
  await assertFails(getDoc(doc(alice, "users/bob")));
  await assertFails(setDoc(doc(alice, "users/bob"), { plan: "theirs" }));
});

test("an unauthenticated request cannot read any /users document", async () => {
  const anon = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(anon, "users/alice")));
});

test("every non-user collection is denied, even for a signed-in user", async () => {
  const alice = testEnv.authenticatedContext("alice").firestore();
  // Notification collections are gone; the catch-all deny must still hold.
  await assertFails(getDoc(doc(alice, "notificationDevices/whatever")));
  await assertFails(setDoc(doc(alice, "arbitrary/thing"), { x: 1 }));
});
