/**
 * Colours come from the palette, and keep their meaning.
 *
 * test/contrast.test.js checks the tokens. It cannot see a colour typed
 * straight into a rule, and that is where the theming bugs lived: a charcoal
 * shimmer from the old dark theme sweeping the light loading screen, Tailwind
 * emerald and amber on the form-check chips, red borders on an unlocked badge
 * and the XP toast in a product where red means critical (2026-09-27 audit).
 *
 * So a literal outside the token blocks has to be on the list below with a
 * reason. Adding one means saying why it is not a palette colour.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(root, "style.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** [selector, property, value] for every declaration outside the token blocks. */
function declarations() {
  const out = [];
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = selectors.trim().replace(/\s+/g, " ");
    if (selector.includes(":root")) continue; // the palette itself
    for (const decl of body.split(";")) {
      const at = decl.indexOf(":");
      if (at === -1) continue;
      out.push([selector, decl.slice(0, at).trim(), decl.slice(at + 1).trim()]);
    }
  }
  return out;
}

const LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|\b(?:white|black)\b/g;

/** Where a literal colour is right, and why. Matched against the selector. */
const ALLOWED = [
  { selector: /^\.camera__stage$|^\.cam-overlay__|^\.form-video__player$|^\.scan-box/, why: "on or around live video, black in every theme" },
  { selector: /^\.google-btn/, why: "Google's own sign-in button colours" },
  { selector: /^\.ex-/, why: "the exercise illustration's own palette" },
  { selector: /^\.water__bar span$/, value: /^#6b8fa3$/, why: "the one water series colour, legible on both grounds" },
];

/** Shadows are dark on either ground, so a black shadow is not a theme colour. */
const isBlackShadow = (property, literal) =>
  property === "box-shadow" && /^rgba?\(\s*0[\s,]+0[\s,]+0\b/.test(literal);

test("every colour outside the palette is on the allowed list, with a reason", () => {
  const stray = [];
  for (const [selector, property, value] of declarations()) {
    for (const literal of value.match(LITERAL) ?? []) {
      if (isBlackShadow(property, literal)) continue;
      const allowed = ALLOWED.some((a) => a.selector.test(selector) && (!a.value || a.value.test(literal)));
      if (!allowed) stray.push(`${selector} { ${property}: ${literal} }`);
    }
  }
  assert.deepEqual(stray, [], "use a palette token, or add the rule to ALLOWED with the reason it is not one");
});

test("the suggestion tier is never painted green", () => {
  // Green means passed, safe, or SpotterAI itself (core value 7). The hero
  // meter drew the one suggestion in pine green, 1.24:1 against the passes
  // beside it, and Split Lab labelled suggestions in brand green, while the
  // plan audit showed the same tier in grey.
  const green = [];
  for (const [selector, property, value] of declarations()) {
    if (!/flag--suggestion|\.is-sugg\b/.test(selector)) continue;
    if (/var\(--(?:accent|success)[a-z0-9-]*\)/.test(value)) green.push(`${selector} { ${property}: ${value} }`);
  }
  assert.deepEqual(green, []);
});
