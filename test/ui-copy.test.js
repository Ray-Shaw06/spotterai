/**
 * UI copy / label guardrails — read index.html as text and assert the
 * user-facing positioning and navigation stay consistent. These are cheap
 * regression guards, not a DOM test.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "index.html"), "utf8");
const router = readFileSync(join(root, "router.js"), "utf8");

test("nav uses 'Safety Lab', not the old 'Evals' label", () => {
  assert.ok(html.includes("<span>Safety Lab</span>"), "Safety Lab nav label present");
  assert.ok(!html.includes("<span>Evals</span>"), "old Evals nav label gone");
  assert.ok(router.includes("Safety Lab · SpotterAI"));
});

test("positioning is the AI fitness copilot promise, not the old coach line", () => {
  assert.ok(/AI fitness copilot/i.test(html), "copilot positioning present");
  // The old tagline must be gone from user-facing copy (title + footer).
  assert.ok(!/coach that audits its own safety/i.test(html), "old tagline removed");
});

test("footer carries the full copilot description", () => {
  assert.ok(/AI fitness copilot that helps you build plans/i.test(html));
});

test("homepage has the three user scenario cards", () => {
  assert.ok(/See how SpotterAI handles real training situations/i.test(html));
  for (const t of ["Healthy beginner", "Knee limitation", "Inconsistent training logs"]) {
    assert.ok(html.includes(t), `scenario card present: ${t}`);
  }
});

test("homepage has the 'What not to trust SpotterAI for' limitations section", () => {
  assert.ok(/What not to trust SpotterAI for/i.test(html));
  assert.ok(/Diagnosing pain or injuries/i.test(html));
  assert.ok(/still help you create a more conservative general plan/i.test(html));
});
