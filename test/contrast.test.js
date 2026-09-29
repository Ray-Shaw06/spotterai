/**
 * Both palettes, against WCAG AA, read out of style.css itself.
 *
 * The stylesheet used to claim verified ratios in a comment, and the claim was
 * true — but a comment cannot stop the next edit from quietly invalidating it,
 * and adding a second palette for dark mode doubled the surface area for
 * exactly that kind of rot.
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

/** Every bare `:root {...}` block, concatenated. There is one today, holding
 *  both the light palette and the --d-* set the dark selectors map from, but
 *  reading only the first block would silently find the wrong one if that ever
 *  splits again. Scoped selectors like :root[data-theme="dark"] are excluded by
 *  the trailing brace. */
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

/** Every dark literal lives on one `--d-*` set, so both dark selectors share a
 *  single source of truth. That is what the last test in this file checks. */
function palettes() {
  // Later declarations win, so scan the whole sheet rather than the first hit.
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
      warn: all["--warn"], warnInk: all["--warn-ink"],
      danger: all["--danger"], dangerInk: all["--danger-ink"],
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
      warn: pick(dark, "--d-warn"), warnInk: dark["--d-warn-ink"],
      danger: pick(dark, "--d-danger"), dangerInk: dark["--d-danger-ink"],
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

  test(`${name} palette: ink on a filled warn cue clears AA`, () => {
    // The live form-check cue ("go a little deeper") is read at arm's length
    // mid-set. Its ink was a literal tuned for the dark theme's bright amber and
    // measured 2.50:1 on the light theme's dark amber.
    assert.ok(p.warnInk, `${name}: no warn ink token; a filled warn cue needs an ink from its own palette`);
    const r = contrast(p.warnInk, p.warn);
    assert.ok(r >= AA_BODY, `${name}: warn ink is ${r.toFixed(2)}:1 on the warn fill`);
  });

  test(`${name} palette: ink on a filled danger button clears AA`, () => {
    // "Clear all data" fills with --danger on hover. Its ink was a literal
    // white, which clears AA on the light theme's red and measured 2.72:1 on
    // the dark theme's brighter one.
    assert.ok(p.dangerInk, `${name}: no danger ink token; a filled danger button needs an ink from its own palette`);
    const r = contrast(p.dangerInk, p.danger);
    assert.ok(r >= AA_BODY, `${name}: danger ink is ${r.toFixed(2)}:1 on the danger fill`);
  });
}

/** [selectorList, body] for every rule in the sheet, comments stripped. */
function rules() {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selectors, body]) => [
    selectors.split(",").map((s) => s.trim()),
    body,
  ]);
}

test("a rule that fills with a status colour takes its text colour from that colour's ink", () => {
  // Each fill has an ink tuned for it in both palettes. A literal ink is right
  // for one theme at most: the warn cue (2.50:1) and the dark danger hover
  // (2.72:1) both shipped that way, and token-only checks could not see them.
  const INK = {
    "--accent": "--accent-ink",
    "--success": "--accent-ink",
    "--warn": "--warn-ink",
    "--danger": "--danger-ink",
  };
  const wrong = [];
  for (const [selectors, body] of rules()) {
    const fill = body.match(/background(?:-color)?\s*:\s*var\((--[a-z-]+)\)\s*;/)?.[1];
    if (!INK[fill]) continue;
    const colour = body.match(/(?:^|[;\s])color\s*:\s*([^;]+);/)?.[1].trim();
    if (colour && colour !== `var(${INK[fill]})`) wrong.push(`${selectors.join(", ")} { color: ${colour} } on ${fill}`);
  }
  assert.deepEqual(wrong, [], "text on a status fill must use that fill's ink token");
});

test("text on the camera stage clears AA in both themes", () => {
  // The stage frames a video, so it is black whatever the theme. On the light
  // theme its text inherited the page's dark inks: "Camera is off" measured
  // 1.13:1, and the live rep count was as dark as the frame behind it.
  const stage = rules().find(([selectors, body]) => selectors.includes(".camera__stage") && /background\s*:/.test(body))?.[1];
  const ground = stage?.match(/background\s*:\s*(#[0-9a-fA-F]{3,6})/)?.[1];
  assert.ok(ground, "the camera stage should declare a literal background colour");

  // Custom properties re-declared on the stage win over the page's palette.
  const onStage = {};
  for (const [selectors, body] of rules()) {
    if (!selectors.includes(".camera__stage")) continue;
    for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*var\((--d-[a-z0-9-]+)\)/g)) onStage[m[1]] = m[2];
  }
  const dark = tokensIn(rootBlock());
  const failures = [];
  for (const [theme, p] of Object.entries(palettes())) {
    for (const [tier, token] of [["text", "--text"], ["muted", "--text-muted"], ["faint", "--text-faint"]]) {
      const colour = onStage[token] ? dark[onStage[token]] : p.text[tier];
      const r = contrast(colour, ground);
      if (r < AA_BODY) failures.push(`${theme} ${tier} = ${r.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(failures, [], `text on the black camera stage: ${failures.join("; ")}`);
});

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

test("text steps back through a text tier, never through opacity", () => {
  // Every tier above is proven on every ground. Opacity is the one way around
  // that proof: it blends a passing ink into its ground after the fact. The
  // 2026-09-29 re-audit found the last AA misses exactly this way, each on a
  // token that passes here: days outside the month at 1.73:1, days still to
  // come at 2.06:1, the Safety Lab filter counts at 4.45:1.
  //
  // So partial opacity is kept for things that are not text, or not live.
  const NOT_TEXT = [
    [/:disabled\b|\[disabled\]/, "an inactive control, which WCAG exempts"],
    [/\.is-loading\b/, "a busy option, inert until it loads"],
    [/\.ex-shadow\b/, "the floor shadow under an exercise figure"],
    [/\.nav-link__icon\b/, "a nav icon; its label names it at full contrast"],
    [/\.empty-art\b/, "an empty-state illustration"],
    [/\.privacy-col li::before/, "a list bullet drawn as a dot"],
    [/\.cal-mark--fuel\b|\.cal-day__marks\b/, "calendar marker dots, named in the legend"],
  ];
  const KEYFRAME = /^(?:\d+(?:\.\d+)?%|from|to)$/;
  const dimmed = [];
  for (const [selectors, body] of rules()) {
    if (selectors.every((s) => KEYFRAME.test(s))) continue;
    for (const m of body.matchAll(/(?:^|[;\s])opacity\s*:\s*([\d.]+)/g)) {
      const value = Number(m[1]);
      if (value <= 0 || value >= 1) continue;
      const bare = selectors.filter((s) => !NOT_TEXT.some(([pattern]) => pattern.test(s)));
      if (bare.length) dimmed.push(`${bare.join(", ")} { opacity: ${value} }`);
    }
  }
  assert.deepEqual(dimmed, [], "dim text with --text-muted or --text-faint, which this file proves on every ground");
});
