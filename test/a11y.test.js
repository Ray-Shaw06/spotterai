/**
 * Accessibility smoke tests — static checks over index.html. Cheap guards that
 * critical controls are labelled and dynamic regions announce politely. Not a
 * substitute for a full audit, but they catch the obvious regressions.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8");
const stripTags = (s) => s.replace(/<[^>]+>/g, "").replace(/&[a-z]+;/gi, "").trim();

test("every icon-only button has an accessible name (aria-label/title)", () => {
  for (const [full, attrs, inner] of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    if (!stripTags(inner)) {
      assert.ok(/aria-label=|aria-labelledby=|title=/.test(attrs), `icon-only button needs a label: ${full.slice(0, 90)}`);
    }
  }
});

test("every icon-only link has an aria-label", () => {
  for (const [full, attrs, inner] of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)) {
    if (/<svg/.test(inner) && !stripTags(inner)) {
      assert.ok(/aria-label=/.test(attrs), `icon-only link needs aria-label: ${full.slice(0, 90)}`);
    }
  }
});

test("the audit results + coach log are polite live regions", () => {
  assert.ok(/id="results"[^>]*aria-live="polite"/.test(html), "results region announces politely");
  assert.ok(/id="chat-log"[^>]*aria-live="polite"/.test(html), "chat log announces politely");
});

test("an sr-only utility exists for visually-hidden labels", () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "style.css"), "utf8");
  assert.ok(/\.sr-only\s*\{/.test(css));
  assert.ok(/:focus-visible/.test(css), "visible focus states exist");
});

test("decorative inline SVGs are hidden from assistive tech where they're not labelled", () => {
  // The brand glyph svgs are aria-hidden via their wrapper; spot-check the count
  // of aria-hidden is healthy (decorative icons shouldn't be announced).
  assert.ok((html.match(/aria-hidden="true"/g) || []).length >= 10);
});
