import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { productionRows } from "../safety-lab-production.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "safety-lab.js"), "utf8");

const aggregate = {
  audits: 100,
  since: "2026-08-18",
  byCheck: {
    rest_days: { pass: 90, warn: 0, fail: 10, not_assessed: 0 },
    equipment_fit: { pass: 0, warn: 0, fail: 0, not_assessed: 100 },
    muscle_balance: { pass: 75, warn: 20, fail: 5, not_assessed: 0 },
  },
};

test("a check's fired count is its warn plus fail, never its passes", () => {
  const { rows } = productionRows(aggregate);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(byId.rest_days.fired, 10);
  assert.equal(byId.muscle_balance.fired, 25);
});

test("not_assessed is not a firing", () => {
  const { rows } = productionRows(aggregate);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(byId.equipment_fit.fired, 0);
});

test("rates are computed against the audit total", () => {
  const { rows } = productionRows(aggregate);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(byId.rest_days.rate, 10);
  assert.equal(byId.muscle_balance.rate, 25);
});

test("rows are ordered by how often the check fires", () => {
  const { rows } = productionRows(aggregate);
  assert.deepEqual(rows.map((r) => r.id), ["muscle_balance", "rest_days", "equipment_fit"]);
});

test("no data returns null so the block can be omitted rather than showing a zero", () => {
  assert.equal(productionRows({ audits: 0, byCheck: {}, since: null }), null);
  assert.equal(productionRows(null), null);
  assert.equal(productionRows({}), null);
  assert.equal(productionRows("nope"), null);
});

test("the Safety Lab labels the production number unverified", () => {
  assert.match(source, /unverified/i);
});
