import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// firestore.rules only lets the app WRITE the collections it syncs. A kind
// added to SYNCED_RECORD_KINDS but not to the rules would sync fine locally and
// come back permission-denied in production, so the two lists are pinned.
test("firestore.rules whitelists exactly the synced record kinds", () => {
  // tracker-store.js is a browser module (it touches window on import), so the
  // list is read from its source rather than imported.
  const store = readFileSync(new URL("../tracker-store.js", import.meta.url), "utf8");
  const declared = store.match(/SYNCED_RECORD_KINDS = Object\.freeze\(\[([^\]]*)\]/)?.[1] ?? "";
  const SYNCED_RECORD_KINDS = [...declared.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(SYNCED_RECORD_KINDS.length >= 8, "found the synced kinds");
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  const list = rules.match(/kind in \[([^\]]*)\]/)?.[1] ?? "";
  const inRules = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(inRules, [...SYNCED_RECORD_KINDS].sort());
});
