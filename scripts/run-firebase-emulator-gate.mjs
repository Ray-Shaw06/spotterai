import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PROJECT_ID = "demo-spotterai-release-1";
const firebaseCli = fileURLToPath(new URL("../node_modules/firebase-tools/lib/bin/firebase.js", import.meta.url));

const java = spawnSync("java", ["-version"], { encoding: "utf8" });
if (java.error || java.status !== 0) {
  console.error("FIREBASE_EMULATOR_PREREQUISITE_MISSING: a working Java runtime is required.");
  process.exit(2);
}
if (!existsSync(firebaseCli)) {
  console.error("FIREBASE_EMULATOR_PREREQUISITE_MISSING: run npm install to provide the project-local Firebase CLI.");
  process.exit(2);
}

const result = spawnSync(process.execPath, [
  firebaseCli,
  "--non-interactive",
  "emulators:exec",
  "node --test integration/firebase-emulator.mjs",
  "--only",
  "firestore",
  "--project",
  PROJECT_ID,
  "--config",
  "firebase.json",
], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  env: {
    ...process.env,
    GCLOUD_PROJECT: PROJECT_ID,
    GOOGLE_CLOUD_PROJECT: PROJECT_ID,
  },
  stdio: "inherit",
});

if (result.error) {
  console.error("FIREBASE_EMULATOR_GATE_FAILED: the local Firebase CLI could not start.");
  process.exit(1);
}
process.exit(result.status ?? 1);
