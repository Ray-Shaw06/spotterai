import { join } from "node:path";

export const FIREBASE_EMULATOR_PROJECT_ID = "demo-spotterai-release-1";

const SAFE_RUNTIME_KEYS = Object.freeze([
  "PATH",
  "JAVA_HOME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TMPDIR",
  "TMP",
  "TEMP",
]);

export function buildFirebaseEmulatorEnvironment({
  sourceEnv,
  isolatedHome,
  controllerHome,
}) {
  const childEnv = {};
  for (const key of SAFE_RUNTIME_KEYS) {
    if (typeof sourceEnv[key] === "string" && sourceEnv[key].length > 0) {
      childEnv[key] = sourceEnv[key];
    }
  }

  const configHome = join(isolatedHome, ".config");
  return {
    ...childEnv,
    HOME: isolatedHome,
    XDG_CONFIG_HOME: configHome,
    CLOUDSDK_CONFIG: join(configHome, "gcloud"),
    FIREBASE_EMULATORS_PATH: join(controllerHome, ".cache", "firebase", "emulators"),
    GCLOUD_PROJECT: FIREBASE_EMULATOR_PROJECT_ID,
    GOOGLE_CLOUD_PROJECT: FIREBASE_EMULATOR_PROJECT_ID,
    CI: "true",
  };
}
