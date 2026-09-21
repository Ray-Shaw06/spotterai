/**
 * Both palettes, against WCAG AA, read out of style.css itself.
 *
 * Layer A's comments claimed verified ratios for the light palette, and the
 * claim was true — but it was a comment, so nothing stopped the next edit from
 * quietly invalidating it. Layer G then added a whole second palette for dark
 * mode, doubling the surface area for exactly that kind of rot.
 *
 * So the arithmetic runs here instead of living in a comment. Every text tier
 * is checked against every ground it can actually sit on — --bg, --surface and
 * --surface-2, since cards sit on the page and controls sit on cards — plus
 * ink-on-accent for filled buttons. The values are parsed from the stylesheet
 * rather than duplicated, so this fails when the CSS changes, which is the
 * entire point.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(root, "style.css"), "utf8");

// ---- WCAG 2.1 relative luminance + contrast ratio ---------------------------

function channels(hex) {
  const v = hex.replace("#", "").trim();
  const full = v.length === 3 ? [...v].map((c) => c + c).join("") : v;
  assert.equal(full.length, 6, `not a 6-digit hex colour: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
}
const linear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function luminance(hex) {
  const [r, g, b] = channels(hex).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test("the contrast helper matches known WCAG reference pairs", () => {
  // A wrong helper would pass every palette silently, so check it first.
  assert.equal(Number(contrast("#000000", "#ffffff").toFixed(2)), 21);
  assert.equal(Number(contrast("#ffffff", "#ffffff").toFixed(2)), 1);
  assert.ok(Math.abs(contrast("#777777", "#ffffff") - 4.48) < 0.02);
});

// ---- Read the palettes out of the stylesheet --------------------------------

/** Literal hex values declared in a block, e.g. `--d-bg: #0a0e0c;`. */
function tokensIn(block) {
  const out = {};
  for (const m of block.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,6})\s*;/g)) {
    out[m[1]] = m[2];
  }
  return out;
}

/** Every bare `:root {...}` block, concatenated. The stylesheet is layered —
 *  layer A opens one and layer G opens another to retune light and declare the
 *  --d-* set — so reading only the first finds the wrong one. Scoped selectors
 *  like :root[data-theme="dark"] are excluded by the trailing brace. */
function rootBlock() {
  const blocks = [];
  for (const m of css.matchAll(/:root\s*\{/g)) {
    const open = css.indexOf("{", m.index);
    let depth = 0;
    for (let i = open; i < css.length; i += 1) {
      if (css[i] === "{") depth += 1;
      if (css[i] === "}") depth -= 1;
      if (depth === 0) { blocks.push(css.slice(open + 1, i)); break; }
    }
  }
  assert.ok(blocks.length, "style.css must declare at least one :root block");
  return blocks.join("\n");
}

/** Layer G keeps every dark literal on one `--d-*` set, so both dark
 *  selectors share a single source of truth. That is what we check. */
function palettes() {
  // Light literals are spread across layers (A defines, G retunes); later wins.
  const all = {};
  for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,6})\s*;/g)) {
    all[m[1]] = m[2];
  }
  const dark = tokensIn(rootBlock());
  const pick = (o, ...keys) => {
    for (const k of keys) if (o[k]) return o[k];
    assert.fail(`no literal hex found for any of: ${keys.join(", ")}`);
  };
  return {
    light: {
      grounds: { bg: all["--bg"], surface: all["--surface"], "surface-2": all["--surface-2"] },
      text: {
        text: all["--text"], muted: all["--text-muted"], faint: all["--text-faint"],
        accent: all["--accent"], warn: all["--warn"], danger: all["--danger"],
      },
      accent: all["--accent"], accentInk: all["--accent-ink"],
    },
    dark: {
      grounds: {
        bg: pick(dark, "--d-bg"), surface: pick(dark, "--d-surface"), "surface-2": pick(dark, "--d-surface-2"),
      },
      text: {
        text: pick(dark, "--d-text"), muted: pick(dark, "--d-muted"), faint: pick(dark, "--d-faint"),
        accent: pick(dark, "--d-accent"), warn: pick(dark, "--d-warn"), danger: pick(dark, "--d-danger"),
      },
      accent: pick(dark, "--d-accent"), accentInk: pick(dark, "--d-accent-ink"),
    },
  };
}

const AA_BODY = 4.5;

for (const [name, p] of Object.entries(palettes())) {
  test(`${name} palette: every text tier clears AA on every ground it sits on`, () => {
    const failures = [];
    for (const [tier, colour] of Object.entries(p.text)) {
      assert.ok(colour, `${name}: missing colour for tier "${tier}"`);
      for (const [groundName, ground] of Object.entries(p.grounds)) {
        assert.ok(ground, `${name}: missing ground "${groundName}"`);
        const r = contrast(colour, ground);
        if (r < AA_BODY) failures.push(`${tier} on ${groundName} = ${r.toFixed(2)}:1`);
      }
    }
    assert.deepEqual(failures, [], `${name}: below ${AA_BODY}:1 — ${failures.join("; ")}`);
  });

  test(`${name} palette: ink on a filled accent button clears AA`, () => {
    const r = contrast(p.accentInk, p.accent);
    assert.ok(r >= AA_BODY, `${name}: accent ink is ${r.toFixed(2)}:1 on the accent fill`);
  });
}

test("the dark palette is declared once and referenced twice", () => {
  // Both the media query and the explicit [data-theme="dark"] override must
  // map from the same --d-* set. A literal hex inside either one means the two
  // can drift, and only one of them is easy to notice.
  for (const selector of ['@media (prefers-color-scheme: dark)', ':root[data-theme="dark"]']) {
    const at = css.indexOf(selector);
    assert.notEqual(at, -1, `style.css must contain ${selector}`);
  }
  const explicit = css.slice(css.indexOf(':root[data-theme="dark"]'));
  const block = explicit.slice(0, explicit.indexOf("\n}"));
  const literals = [...block.matchAll(/--[a-z0-9-]+\s*:\s*#[0-9a-fA-F]{3,6}\s*;/g)];
  assert.deepEqual(
    literals.map((m) => m[0]),
    [],
    "the explicit dark override should map from --d-* vars, not restate hex literals",
  );
});
