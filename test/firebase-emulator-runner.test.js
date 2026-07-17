import test from "node:test";
import assert from "node:assert/strict";

const PROJECT_ID = "demo-spotterai-release-1";
const FORBIDDEN_KEYS = Object.freeze([
  "FIREBASE_TOKEN",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "FIREBASE_SERVICE_ACCOUNT_JSON",
  "NOTIFICATION_TOKEN_SECRET",
  "NOTIFICATION_DEDUP_SECRET",
  "WEB_PUSH_PRIVATE_KEY",
  "WEB_PUSH_PUBLIC_KEY",
  "WEB_PUSH_SUBJECT",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "OPENAI_API_KEY",
]);

test("the emulator child environment forwards only safe runtime prerequisites", async () => {
  const { buildFirebaseEmulatorEnvironment } = await import(
    "../scripts/firebase-emulator-environment.mjs"
  );
  const sourceEnv = {
    PATH: "/project/node:/usr/bin",
    JAVA_HOME: "/temporary/java",
    LANG: "en_US.UTF-8",
    LC_ALL: "en_US.UTF-8",
    TMPDIR: "/temporary/controller",
    HOME: "/Users/controller",
    XDG_CONFIG_HOME: "/Users/controller/.config",
    FIREBASE_EMULATORS_PATH: "/untrusted/ambient/cache",
  };
  for (const key of FORBIDDEN_KEYS) sourceEnv[key] = `sentinel-${key}`;

  const childEnv = buildFirebaseEmulatorEnvironment({
    sourceEnv,
    isolatedHome: "/temporary/isolated-home",
    controllerHome: "/Users/controller",
  });

  assert.equal(childEnv.PATH, sourceEnv.PATH);
  assert.equal(childEnv.JAVA_HOME, sourceEnv.JAVA_HOME);
  assert.equal(childEnv.LANG, sourceEnv.LANG);
  assert.equal(childEnv.LC_ALL, sourceEnv.LC_ALL);
  assert.equal(childEnv.TMPDIR, sourceEnv.TMPDIR);
  assert.equal(childEnv.HOME, "/temporary/isolated-home");
  assert.equal(childEnv.XDG_CONFIG_HOME, "/temporary/isolated-home/.config");
  assert.equal(childEnv.CLOUDSDK_CONFIG, "/temporary/isolated-home/.config/gcloud");
  assert.equal(childEnv.FIREBASE_EMULATORS_PATH, "/Users/controller/.cache/firebase/emulators");
  assert.equal(childEnv.GCLOUD_PROJECT, PROJECT_ID);
  assert.equal(childEnv.GOOGLE_CLOUD_PROJECT, PROJECT_ID);
  assert.equal(childEnv.CI, "true");
  for (const key of FORBIDDEN_KEYS) {
    assert.equal(Object.hasOwn(childEnv, key), false, `${key} must not be forwarded`);
  }
});
