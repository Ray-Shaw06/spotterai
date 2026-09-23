/**
 * The service worker's BOOT_MODULES list vs. what the app actually imports.
 *
 * style.css and the font list already guard each other (see pwa.test.js). The
 * module list had no such guard, and it drifts the same way: add a module,
 * forget the worker, and the app still works perfectly online. It breaks only
 * offline, only for people who already installed the PWA, and it breaks as a
 * bare import failure that takes the whole importing module down with it —
 * chat.js missing one import means no coach at all, not a degraded coach.
 *
 * So this walks the real import graph from index.html's entry points and
 * asserts the worker precaches everything reachable. The reverse direction is
 * checked too: a precached path that no longer exists on disk fails
 * `cache.addAll` wholesale, which aborts the install and silently strands
 * every installed device on the previous worker.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, posix } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Entry points: every module the page itself loads. */
function entryPoints() {
  const html = readFileSync(join(root, "index.html"), "utf8");
  return [...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)]
    .map((m) => m[1].replace(/^\.?\//, ""))
    .filter((src) => !/^https?:/.test(src));
}

/** Relative specifiers only — bare and absolute ones are not ours to cache. */
function localImports(source) {
  const specs = [
    ...source.matchAll(/(?:^|[\s;])(?:import|export)[^'"]*?from\s*["']([^"']+)["']/g),
    ...source.matchAll(/(?:^|[\s;])import\s*["']([^"']+)["']/g),
    ...source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g),
  ].map((m) => m[1]);
  return specs.filter((s) => s.startsWith("./") || s.startsWith("../"));
}

/** Breadth-first walk of the static import graph from the page's entry points. */
function reachableModules() {
  const seen = new Set();
  const queue = entryPoints();

  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    const abs = join(root, rel);
    if (!existsSync(abs)) continue; // reported by the entry-point test below
    seen.add(rel);
    for (const spec of localImports(readFileSync(abs, "utf8"))) {
      queue.push(posix.normalize(posix.join(posix.dirname(rel), spec)));
    }
  }
  return seen;
}

function bootModules() {
  const sw = readFileSync(join(root, "service-worker.js"), "utf8");
  const block = /const BOOT_MODULES = \[([\s\S]*?)\];/.exec(sw);
  assert.ok(block, "service-worker.js must declare a BOOT_MODULES array");
  return new Set([...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
}

test("every module the page imports is precached by the service worker", () => {
  const precached = bootModules();
  const missing = [...reachableModules()].filter((m) => !precached.has(m)).sort();
  assert.deepEqual(
    missing,
    [],
    `these modules load in the browser but are not in BOOT_MODULES, so an ` +
      `offline launch would fail to import them: ${missing.join(", ")}`,
  );
});

test("every precached path still exists on disk", () => {
  // cache.addAll rejects as a unit: one 404 aborts the whole install, so a
  // stale entry is not a wasted download, it is a broken upgrade.
  const sw = readFileSync(join(root, "service-worker.js"), "utf8");
  const paths = [...sw.matchAll(/"((?:[\w./-]+)\.(?:js|css|html|json|woff2|png))"/g)].map((m) => m[1]);
  assert.ok(paths.length > 50, `expected a substantial precache list, parsed ${paths.length}`);
  const gone = [...new Set(paths)].filter((p) => !existsSync(join(root, p))).sort();
  assert.deepEqual(gone, [], `precached but missing from the repo: ${gone.join(", ")}`);
});

test("every module script in index.html exists", () => {
  const missing = entryPoints().filter((src) => !existsSync(join(root, src))).sort();
  assert.deepEqual(missing, [], `index.html loads modules that do not exist: ${missing.join(", ")}`);
});

test("nothing is precached that the page never imports", () => {
  // The other direction, to match how the font lists guard each other in
  // pwa.test.js. A stale entry does not break anything, which is exactly why
  // it would survive: it just costs every installing device a download for a
  // module nothing loads. The two lists are equal today; this keeps them that
  // way rather than leaving it to luck.
  const reachable = reachableModules();
  const dead = [...bootModules()].filter((m) => !reachable.has(m)).sort();
  assert.deepEqual(
    dead,
    [],
    `precached but nothing imports them — drop them from BOOT_MODULES, or if one ` +
      `is loaded a way this walk cannot see, say so here: ${dead.join(", ")}`,
  );
});
