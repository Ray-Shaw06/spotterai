/**
 * Connected product layout guardrails.
 *
 * These tests protect the shared spacing and empty-state hooks without trying
 * to replace browser-based visual verification.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(root, "style.css"), "utf8");

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `missing CSS rule for ${selector}`);
  return match[1];
}

test("connected cards own their desktop inset and wide grid gutter", () => {
  assert.match(rule(".quicklog"), /padding:\s*var\(--space-5\)/);
  assert.match(rule(".dash-card"), /padding:\s*var\(--space-5\)/);
  assert.match(rule(".dash-grid"), /gap:\s*var\(--space-5\)/);
});

test("connected spacing compacts at the approved breakpoints", () => {
  assert.match(
    css,
    /@media \(max-width: 960px\)\s*\{[\s\S]*?\.dash-grid\s*\{[^}]*gap:\s*var\(--space-4\)/
  );
  assert.match(
    css,
    /@media \(max-width: 600px\)\s*\{[\s\S]*?\.dash-card,\s*\.quicklog\s*\{[^}]*padding:\s*var\(--space-4\)/
  );
});
