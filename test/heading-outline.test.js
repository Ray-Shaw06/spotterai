/**
 * Headings step down one level at a time.
 *
 * Screen-reader users move through a page by its headings, and a skipped level
 * reads as a missing section. The 2026-09-27 audit found seven views going
 * straight from their h1 to h3 cards, and the rendered results went further:
 * the plan's Trust Report and the nutrition safety card jumped to h5.
 *
 * index.html is read in document order. The views each open with an h1, so a
 * drop back up to h1 or h2 is always fine; going deeper may only take one step.
 * The modules that render into a view are held to the levels they must emit:
 * the level directly under the one they are mounted beneath, and one more.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(root, f), "utf8");
const levels = (src) => [...src.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));

test("index.html never goes more than one heading level deeper", () => {
  const html = read("index.html").replace(/<!--[\s\S]*?-->/g, "");
  const skips = [];
  let prev = 1;
  for (const m of html.matchAll(/<h([1-6])\b[^>]*>([^<]{0,40})/g)) {
    const level = Number(m[1]);
    if (level > prev + 1) skips.push(`h${prev} -> h${level} at "${m[2].trim()}"`);
    prev = level;
  }
  assert.deepEqual(skips, []);
});

/** Each module, the heading levels it may emit, and where its markup lands. */
const MODULES = {
  "today-ui.js": { levels: [2], under: "the Today view's h1" },
  "first-week-ui.js": { levels: [2], under: "the Today view's h1" },
  "split-ui.js": { levels: [2], under: "the Split Lab view's h1" },
  "safety-lab.js": { levels: [2, 3], under: "the Safety Lab view's h1" },
  "form-report.js": { levels: [2, 3], under: "the form check view's h1" },
  "nutrition-ui.js": { levels: [2, 3], under: "the Food diary view's h1" },
  "app.js": { levels: [3, 4], under: "the plan results, beside the h3 verdict" },
  "library-ui.js": { levels: [3, 4], under: "the exercise dialog's h2" },
};

for (const [file, { levels: want, under }] of Object.entries(MODULES)) {
  test(`${file} renders headings at h${want.join("/h")}, directly under ${under}`, () => {
    const got = [...new Set(levels(read(file)))].sort();
    assert.deepEqual(got, want);
  });
}
