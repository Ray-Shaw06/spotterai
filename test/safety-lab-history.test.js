import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "safety-lab.js"), "utf8");

// safety-lab.js touches `document` at module scope, so it can only be READ as
// text under Node, never imported. That is why the pure shaping lives in
// safety-lab-history.js, which imports cleanly.
import { historyRows } from "../safety-lab-history.js";

test("the committed history file is a non-empty array of well-formed records", () => {
  const history = JSON.parse(readFileSync(join(root, "docs", "benchmark-history.json"), "utf8"));
  assert.equal(Array.isArray(history), true);
  assert.ok(history.length >= 1);
  for (const r of history) {
    assert.match(r.evaluatorVersion, /^v\d+\.\d+\.\d+$/);
    assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(Number.isInteger(r.riskyCaught), true);
    assert.equal(Number.isInteger(r.riskyTotal), true);
  }
});

test("rows carry the version, the catch rate and the false positives", () => {
  const rows = historyRows([
    { date: "2026-08-18", evaluatorVersion: "v1.3.0", riskyCaught: 17, riskyTotal: 17, falsePositives: 0 },
  ]);
  assert.deepEqual(rows, [
    { version: "v1.3.0", date: "2026-08-18", riskyCaught: 17, riskyTotal: 17, falsePositives: 0, regressed: false },
  ]);
});

test("a drop in risky-caught marks the row as a regression", () => {
  const rows = historyRows([
    { date: "2026-08-18", evaluatorVersion: "v1.3.0", riskyCaught: 17, riskyTotal: 17, falsePositives: 0 },
    { date: "2026-09-01", evaluatorVersion: "v1.4.0", riskyCaught: 16, riskyTotal: 17, falsePositives: 0 },
  ]);
  assert.equal(rows[0].regressed, false);
  assert.equal(rows[1].regressed, true);
});

test("a rise in risky-caught is not a regression", () => {
  const rows = historyRows([
    { date: "2026-08-18", evaluatorVersion: "v1.3.0", riskyCaught: 16, riskyTotal: 17, falsePositives: 0 },
    { date: "2026-09-01", evaluatorVersion: "v1.4.0", riskyCaught: 17, riskyTotal: 17, falsePositives: 0 },
  ]);
  assert.equal(rows[1].regressed, false);
});

test("an empty or malformed history yields no rows rather than throwing", () => {
  assert.deepEqual(historyRows([]), []);
  assert.deepEqual(historyRows(null), []);
  assert.deepEqual(historyRows("nope"), []);
});

test("the Safety Lab labels the bundled benchmark reproducible", () => {
  assert.match(source, /reproducible/i);
});
