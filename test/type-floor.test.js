/**
 * Nothing is set smaller than 11px.
 *
 * Small text was never one decision. It accumulated as 37 separate
 * declarations between 9px and 10.9px (tracked-caps tags, table heads,
 * badges, the sidebar's nav captions), each one a little smaller than the
 * one it sat beside. The 2026-09-29 re-audit measured eval tags at 9.6px and
 * the quick-log badge at 9.92px. Below 11px, caps and tabular figures stop
 * being readable at arm's length, which is where this app is used.
 *
 * So the smallest size is a token, --fs-micro, and nothing goes under it.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(root, "style.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const FLOOR_PX = 11;
const ROOT_PX = 16;

/** Custom properties that hold a plain length, e.g. --fs-small: 0.875rem. */
function lengthTokens() {
  const out = {};
  for (const [, name, value] of css.matchAll(/(--fs-[\w-]+)\s*:\s*([\d.]+(?:px|rem))\s*;/g)) out[name] = value;
  return out;
}

function toPx(value) {
  const m = value.match(/^([\d.]+)(px|rem)$/);
  if (!m) return null;
  return m[2] === "rem" ? Number(m[1]) * ROOT_PX : Number(m[1]);
}

test("the size tokens resolve, so the floor check below can read them", () => {
  // A token this file cannot parse would silently pass every rule that uses
  // it. --fs-micro is the floor itself.
  const tokens = lengthTokens();
  assert.equal(toPx(tokens["--fs-micro"] ?? ""), FLOOR_PX, "--fs-micro should be the 11px floor");
  assert.equal(toPx(tokens["--fs-small"] ?? ""), 14);
});

test(`no font-size resolves below ${FLOOR_PX}px`, () => {
  const tokens = lengthTokens();
  const small = [];
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const [, raw] of body.matchAll(/font-size\s*:\s*([^;!]+)/g)) {
      const value = raw.trim();
      const token = value.match(/^var\((--[\w-]+)\)$/)?.[1];
      const px = toPx(token ? tokens[token] ?? "" : value);
      if (px !== null && px < FLOOR_PX) small.push(`${selectors.trim().replace(/\s+/g, " ")} { font-size: ${value} } = ${px}px`);
    }
  }
  assert.deepEqual(small, [], `use var(--fs-micro) for the smallest text`);
});
