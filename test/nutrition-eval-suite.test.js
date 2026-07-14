/**
 * CI guard for DB-grounding: every benchmark query must surface its curated
 * anchor, or grounding has silently stopped helping (e.g. a plural/tokenizing
 * regression). The live accuracy A/B lives in eval-nutrition.mjs (needs a key).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { anchorCoverage } from "../nutrition-eval-suite.js";

test("every nutrition eval case surfaces its DB anchor", () => {
  const misses = anchorCoverage().filter((c) => !c.covered);
  assert.deepEqual(
    misses.map((m) => m.query),
    [],
    "these queries no longer surface their DB anchor via grounding"
  );
});
