/**
 * Decoration that the product already decided against stays gone.
 *
 * The July passes and the light-forest redesign removed side stripes, glowing
 * halos and always-on pulses. The readout rebuild brought all three back on
 * the landing hero, where they were the first thing a visitor saw, and the
 * 2026-09-29 re-audit found them still there: a 2px coloured stripe on each
 * check row, a pulsing dot beside "deterministic", a pulsing, glowing dot on
 * every exercise caption. Nothing in CI could see them.
 *
 * Status is carried by icons, colour and words. These rules keep it that way.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(root, "style.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** [selector, body] for every innermost rule, keyframe steps included. */
function rules() {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selectors, body]) => [
    selectors.trim().replace(/\s+/g, " "),
    body,
  ]);
}

test("no row, card or callout wears a coloured side stripe", () => {
  // A border on one side wider than a hairline is an accent stripe, not a
  // divider. The hero's check rows carried one per status; the status icon
  // beside each row already said the same thing.
  const stripes = [];
  for (const [selector, body] of rules()) {
    for (const m of body.matchAll(/border-(?:left|right)(?:-width)?\s*:\s*([\d.]+)px/g)) {
      if (Number(m[1]) > 1) stripes.push(`${selector} { ${m[0]} }`);
    }
  }
  assert.deepEqual(stripes, [], "use a hairline divider, or let the row's icon carry its status");
});

test("only the exercise demo and live status loop forever", () => {
  // An endless animation says something is happening right now. That is true
  // of a spinner, the mic while it listens and the camera while it records,
  // and it is the whole point of the exercise figure. A dot beside a static
  // label is not happening; it only looks busy.
  const LIVE = [
    [/\[data-(?:anim|pose)\b|\.ex-musc\b/, "the exercise demonstration itself"],
    [/\.spinner\b|\.is-loading\b|\.skeleton-row\b/, "something is loading"],
    [/\.is-recording\b/, "the mic is listening"],
    [/\.rest-timer\.is-running\b/, "the rest timer is counting down"],
    [/\.cam-overlay__rec-dot\b/, "the camera is recording"],
    [/\.chat-typing\b/, "the coach is writing a reply"],
  ];
  const loops = [];
  for (const [selector, body] of rules()) {
    if (!/animation[^;]*\binfinite\b/.test(body)) continue;
    if (!LIVE.some(([pattern]) => pattern.test(selector))) loops.push(selector);
  }
  assert.deepEqual(loops, [], "an endless animation must mean something live is happening");
});

test("depth comes from offset shadows, never a zero-offset glow", () => {
  // A blurred shadow with no offset is a halo: it lights an element up rather
  // than lifting it. Focus rings are zero-offset too, but they have no blur,
  // so a spread with a 0 blur stays allowed.
  const halos = [];
  for (const [selector, body] of rules()) {
    for (const [, value] of body.matchAll(/box-shadow\s*:\s*([^;]+)/g)) {
      for (const layer of value.split(/,(?![^(]*\))/)) {
        const m = layer.trim().match(/^(?:inset\s+)?0(?:px)?\s+0(?:px)?\s+([\d.]+)px/);
        if (m && Number(m[1]) > 0) halos.push(`${selector} { box-shadow: ${layer.trim()} }`);
      }
    }
  }
  assert.deepEqual(halos, [], "give the shadow an offset, or drop it");
});

test("no label sits above a heading", () => {
  // A kicker over a heading says the heading could not stand alone. Eleven
  // did, on the landing hero, audit cards, Today and the first week (live
  // audit, 2026-09-29). Where the label carried facts ("Day 3 of 7", a
  // session's length, "deterministic"), they now sit under the heading.
  const files = ["index.html", ...readdirSync(root).filter((f) => f.endsWith(".js") && f !== "eslint.config.js")];
  const found = [];
  for (const file of files) {
    const source = readFileSync(join(root, file), "utf8");
    for (const m of source.matchAll(/<p class="([^"]*(?:eyebrow|kicker)[^"]*)"[^>]*>[\s\S]*?<\/p>\s*<h[1-6]\b/g)) {
      found.push(`${file}: .${m[1].split(" ")[0]}`);
    }
  }
  assert.deepEqual(found, [], "let the heading speak; put any facts the label carried under it");
});
