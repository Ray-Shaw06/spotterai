/**
 * A page's own code loads when you first open that page.
 *
 * The landing page is what most visitors see, and it booted every page of the
 * app to show it: 21 module scripts, 74 modules, about 283KB gzipped. The
 * router already loaded four pages on first visit. The re-audit on 2026-09-29
 * found seven more modules that touch nothing outside their own page.
 *
 * Two things can go wrong, and each test catches one. A module creeps back
 * into the boot graph (a <script> tag, or a static import from a boot
 * module), and the landing page pays for a page it is not showing. Or a page
 * loses its loader, and the page opens empty.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, posix } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

/** Which page owns which module. A module may belong to two pages. */
const OWNED = {
  today: ["today-ui.js", "first-week-ui.js"],
  dashboard: ["tracker-ui.js", "quick-log.js", "share-card.js"],
  progress: ["tracker-ui.js", "calendar-ui.js"],
  library: ["library-ui.js"],
  split: ["split-ui.js"],
  "form-check": ["form-coach.js"],
  import: ["import-ui.js"],
  evals: ["eval-ui.js"],
};

/** Everything the page evaluates before it can paint: <script type="module">
 *  entry points and their static imports. Dynamic import() is not followed. */
function bootGraph() {
  const entries = [...read("index.html").matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)].map((m) => m[1]);
  const seen = new Set();
  const queue = [...entries];
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel) || !existsSync(join(root, rel))) continue;
    seen.add(rel);
    const source = read(rel);
    const specs = [
      ...source.matchAll(/(?:^|[\s;])(?:import|export)[^'"()]*?from\s*["'](\.[^"']+)["']/g),
      ...source.matchAll(/(?:^|[\s;])import\s*["'](\.[^"']+)["']/g),
    ].map((m) => m[1]);
    for (const spec of specs) queue.push(posix.normalize(posix.join(posix.dirname(rel), spec)));
  }
  return seen;
}

/** route -> modules its loader in router.js imports. */
function routeLoaders() {
  const block = read("router.js").match(/const ROUTE_MODULES = \{([\s\S]*?)\n\};/)?.[1];
  assert.ok(block, "router.js must declare ROUTE_MODULES");
  const out = {};
  for (const line of block.split("\n")) {
    const route = line.match(/^\s*"?([\w-]+)"?\s*:/)?.[1];
    if (!route) continue;
    out[route] = [...line.matchAll(/import\(\s*"\.\/([\w-]+\.js)"\s*\)/g)].map((m) => m[1]);
  }
  return out;
}

test("no page's own module is in the landing page's boot graph", () => {
  const boot = bootGraph();
  assert.ok(boot.has("router.js") && boot.has("app.js"), "the walk should reach the app's real entry points");
  const eager = [...new Set(Object.values(OWNED).flat())].filter((m) => boot.has(m)).sort();
  assert.deepEqual(eager, [], "these load on every page; load them from their route in router.js instead");
});

test("every page's modules are loaded by that page's route", () => {
  const loaders = routeLoaders();
  const missing = [];
  for (const [route, modules] of Object.entries(OWNED)) {
    for (const m of modules) if (!(loaders[route] ?? []).includes(m)) missing.push(`#/${route} -> ${m}`);
  }
  assert.deepEqual(missing, [], "opening these pages would show them empty");
});
