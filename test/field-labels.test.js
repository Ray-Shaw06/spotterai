/**
 * Every field and choice group a screen reader lands on needs a name that says
 * what it is for.
 *
 * The onboarding intake printed its questions as bare spans, so its chip
 * groups announced as "Yes, toggle button" with no question attached (the
 * pain question included), and its free-text fields were named only by their
 * placeholder, which vanishes as soon as you type. The food quick-add did the
 * same for "Food name". Found by the 2026-09-27 audit.
 *
 * The onboarding steps are rendered for real. The quick-add form is built
 * inside a DOM-bound function, so it is read as source, in the style of
 * ui-layout.test.js.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// onboarding-ui.js is a browser module: stub what it touches when imported.
class MemoryStorage {
  #map = new Map();
  getItem(k) { return this.#map.has(k) ? this.#map.get(k) : null; }
  setItem(k, v) { this.#map.set(k, String(v)); }
  removeItem(k) { this.#map.delete(k); }
  clear() { this.#map.clear(); }
}
globalThis.localStorage = new MemoryStorage();
globalThis.window = { addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } };
globalThis.CustomEvent = class CustomEvent {
  constructor(type, init) { this.type = type; this.detail = init?.detail; }
};
globalThis.document = { getElementById: () => null };

const { stepMarkup } = await import("../onboarding-ui.js");
const { ONBOARDING_STEPS } = await import("../onboarding.js");

const VOID = new Set(["input", "br", "img", "hr", "meta", "link", "source", "wbr"]);
const decode = (s) =>
  s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();
const attr = (attrs, name) => attrs.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1];

/**
 * Every text field, select and chip group in `html`, with the name a screen
 * reader would announce for it. Stricter than a browser in one way: a
 * placeholder does not count as a name.
 */
function controls(html) {
  const textAfter = (i) => decode(html.slice(i).match(/^[^<]*/)[0]);
  const ids = new Map();
  const labelsFor = new Map();
  for (const m of html.matchAll(/<([a-z0-9]+)(\s[^>]*)?>/g)) {
    const id = attr(m[2] ?? "", "id");
    if (id) ids.set(id, textAfter(m.index + m[0].length));
    const forId = m[1] === "label" && attr(m[2] ?? "", "for");
    if (forId) labelsFor.set(forId, textAfter(m.index + m[0].length));
  }

  const found = [];
  const open = [];
  for (const m of html.matchAll(/<(\/?)([a-z0-9]+)(\s[^>]*?)?\s*(\/?)>/g)) {
    const [whole, closing, tag, attrs = "", selfClosing] = m;
    if (closing) {
      const at = open.map((e) => e.tag).lastIndexOf(tag);
      if (at !== -1) open.length = at;
      continue;
    }
    const el = { tag, attrs, text: textAfter(m.index + whole.length) };
    const type = attr(attrs, "type");
    const isField = (tag === "input" && type !== "hidden" && type !== "checkbox") || tag === "select" || tag === "textarea";
    const isChoiceGroup = /(?:^|\s)class="[^"]*\bonb-chips\b/.test(attrs);
    if (isField || isChoiceGroup) {
      let name;
      if (isField) {
        const id = attr(attrs, "id");
        const labelledBy = attr(attrs, "aria-labelledby");
        name = attr(attrs, "aria-label")
          ?? (labelledBy && ids.get(labelledBy))
          ?? (id && labelsFor.get(id))
          ?? open.findLast((e) => e.tag === "label")?.text;
      } else {
        const group = [...open, el].findLast((e) => attr(e.attrs, "role") === "group");
        const labelledBy = group && attr(group.attrs, "aria-labelledby");
        name = (labelledBy && ids.get(labelledBy)) || (group && attr(group.attrs, "aria-label"));
      }
      found.push({
        key: attr(attrs, "data-input") ?? attr(attrs, "data-field") ?? attr(attrs, "id"),
        name: decode(name || ""),
      });
    }
    if (!VOID.has(tag) && !selfClosing) open.push(el);
  }
  return found;
}

test("every onboarding question has a name a screen reader announces", () => {
  const names = new Map();
  for (const units of ["kg", "lb"]) {
    for (let i = 0; i < ONBOARDING_STEPS.length; i += 1) {
      for (const c of controls(stepMarkup(i, { units }))) {
        assert.ok(c.name, `step ${i + 1} (${units}): "${c.key}" has no accessible name`);
        names.set(c.key, c.name);
      }
    }
  }
  // The safety questions and the three free-text fields, by hand: each must be
  // named by its own question, not a neighbour's and not its placeholder.
  assert.equal(names.get("goal"), "What's your main goal?");
  assert.equal(names.get("currentPain"), "Any current pain or discomfort?");
  assert.equal(names.get("safetyAreas"), "Areas to be careful with");
  assert.equal(names.get("avoid"), "Movements to avoid (optional)");
  assert.equal(names.get("likes"), "Exercises you like");
  assert.equal(names.get("dislikes"), "Exercises you dislike");
});

test("the food quick-add names every field, the food name included", () => {
  const src = readFileSync(join(root, "nutrition-ui.js"), "utf8");
  const start = src.indexOf("if (quick) {");
  assert.notEqual(start, -1, "nutrition-ui.js no longer has the quick-add branch");
  const found = controls(src.slice(start, src.indexOf("return;", start)));
  assert.ok(found.length >= 6, `expected the six quick-add fields, found ${found.length}`);
  for (const c of found) assert.ok(c.name, `quick-add "${c.key}" has no accessible name`);
  assert.equal(found.find((c) => c.key === "qa-name")?.name, "Food name");
});

test("a quote typed into an onboarding answer survives the step re-rendering", () => {
  // esc() used to leave quotes alone, so value="rows, "Pendlay" rows" ended at
  // the second quote and the field came back as "rows, " after Back and Next.
  const typed = `rows, "Pendlay" rows, don't rush`;
  const html = stepMarkup(4, { likes: typed });
  const value = html.match(/data-input="likes"[^>]*\svalue="([^"]*)"/)?.[1];
  assert.equal(decode(value ?? ""), typed);
});

test("no onboarding step repeats an id, so each label names exactly one question", () => {
  for (const units of ["kg", "lb"]) {
    for (let i = 0; i < ONBOARDING_STEPS.length; i += 1) {
      const ids = [...stepMarkup(i, { units }).matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
      const repeated = ids.filter((id, n) => ids.indexOf(id) !== n);
      assert.deepEqual(repeated, [], `step ${i + 1} (${units}) repeats ${repeated.join(", ")}`);
    }
  }
});
