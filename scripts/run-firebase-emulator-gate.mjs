import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildFirebaseEmulatorEnvironment,
  FIREBASE_EMULATOR_PROJECT_ID,
} from "./firebase-emulator-environment.mjs";

const firebaseCli = fileURLToPath(new URL("../node_modules/firebase-tools/lib/bin/firebase.js", import.meta.url));
const projectRoot = fileURLToPath(new URL("..", import.meta.url));

if (!existsSync(firebaseCli)) {
  console.error("FIREBASE_EMULATOR_PREREQUISITE_MISSING: run npm install to provide the project-local Firebase CLI.");
  process.exit(2);
}

const isolatedHome = mkdtempSync(join(tmpdir(), "spotterai-firebase-emulator-"));
let exitCode = 1;

try {
  const childEnv = buildFirebaseEmulatorEnvironment({
    sourceEnv: process.env,
    isolatedHome,
    controllerHome: userInfo().homedir,
  });
  const java = spawnSync("java", ["-version"], { encoding: "utf8", env: childEnv });
  if (java.error || java.status !== 0) {
    console.error("FIREBASE_EMULATOR_PREREQUISITE_MISSING: a working Java runtime is required.");
    exitCode = 2;
  } else {
    const integrationCommand = `${JSON.stringify(process.execPath)} --test integration/firebase-emulator.mjs`;
    const result = spawnSync(process.execPath, [
      firebaseCli,
      "--non-interactive",
      "emulators:exec",
      integrationCommand,
      "--only",
      "firestore",
      "--project",
      FIREBASE_EMULATOR_PROJECT_ID,
      "--config",
      "firebase.json",
    ], {
      cwd: projectRoot,
      env: childEnv,
      stdio: "inherit",
    });

    if (result.error) {
      console.error("FIREBASE_EMULATOR_GATE_FAILED: the local Firebase CLI could not start.");
      exitCode = 1;
    } else {
      exitCode = result.status ?? 1;
    }
  }
} finally {
  rmSync(isolatedHome, { recursive: true, force: true });
}

process.exitCode = exitCode;
