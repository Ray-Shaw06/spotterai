import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

// `textContent` then `innerHTML` escapes & < > but NOT quotes. That is safe in
// element text and a hole inside a quoted attribute: nutrition-ui put
// esc(JSON.stringify(food)) in data-food='...', and an Open Food Facts product
// name (crowd-editable) carrying a ' injected an onmouseover handler. Every
// esc helper built that way must also escape both quote characters.
const sources = readdirSync(new URL("..", import.meta.url)).filter((f) => f.endsWith(".js"));

test("a textContent/innerHTML escape helper also escapes quotes", () => {
  const offenders = [];
  for (const f of sources) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    const re = /\.textContent = (?:t|text) == null \? "" : String\((?:t|text)\);\s*return (?:d|div).innerHTML([^\n]*)\n/g;
    for (const m of src.matchAll(re)) {
      if (!m[1].includes("&quot;") || !m[1].includes("&#39;")) offenders.push(f);
    }
  }
  assert.deepEqual(offenders, []);
});
