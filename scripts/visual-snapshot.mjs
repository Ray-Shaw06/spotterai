#!/usr/bin/env node
/**
 * Visual regression net for refactors.
 * ----------------------------------------------------------------------------
 * This app has no automated browser suite, which is fine for behaviour — the
 * unit tests cover that — but it means nothing catches a stylesheet change that
 * quietly moves something. That gap is not hypothetical: flattening the
 * stylesheet's layers produced two regressions that read as obviously correct
 * in the diff. Hoisting a rule past an @media block doubled the desktop icon
 * rail (244px base, 96px above 961px). Hoisting `.section-head` past
 * `.section-head--start` re-centred every page header. Both were invisible at
 * one viewport and wrong at another.
 *
 * So this fingerprints what the browser actually computes, not what the CSS
 * says: every element on every route, in both themes, at two widths, across ~50
 * layout- and paint-affecting properties. Roughly 108,000 fingerprints.
 *
 * It is a BEFORE/AFTER tool, not a golden-file test, and deliberately so:
 *
 *     npm run visual:baseline    # on the code you trust
 *     ...make the change...
 *     npm run visual:check       # fails if anything computed differently
 *
 * A committed baseline would be the obvious alternative and is the wrong shape
 * here. Computed values include resolved layout (`height: 4952.5px`), which
 * depends on font rasterisation and the exact browser build, so a baseline
 * recorded on one machine reports hundreds of false differences on another.
 * Comparing two runs in the same environment has no such problem. That is why
 * this is not a CI gate and is not pretending to be one.
 *
 * Needs a browser: `npx playwright install chromium` once, or set
 * PLAYWRIGHT_BROWSERS_PATH if you already have one.
 */

import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, normalize } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, ".visual");

/** Routes worth covering: every page a reader can reach from the nav. */
const ROUTES = ["", "#/evals", "#/dashboard", "#/nutrition", "#/import", "#/library", "#/today", "#/progress"];
const VIEWPORTS = [[1280, 900], [390, 844]];
const THEMES = ["light", "dark"];

/** Layout- and paint-affecting properties. Anything a refactor could move. */
const PROPS = [
  "color", "backgroundColor", "backgroundImage", "borderTopColor", "borderTopWidth",
  "borderTopStyle", "borderBottomWidth", "borderLeftWidth", "borderRadius",
  "fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "lineHeight",
  "textTransform", "textAlign", "textDecorationLine",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "marginTop", "marginRight", "marginBottom", "marginLeft",
  "display", "position", "top", "right", "bottom", "left",
  "width", "height", "minWidth", "minHeight", "maxWidth",
  "boxShadow", "opacity", "gap", "gridTemplateColumns", "flexDirection",
  "alignItems", "justifyContent", "zIndex", "overflow", "transform", "visibility",
];

const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2",
  ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon",
};

/** Serve the repo as static files, so running this needs no separate terminal. */
async function serve() {
  const server = createServer(async (req, res) => {
    const rel = normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
    const file = join(ROOT, rel === "/" ? "index.html" : rel);
    if (!file.startsWith(ROOT) || !existsSync(file)) {
      res.writeHead(404).end("not found");
      return;
    }
    try {
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
      res.end(await readFile(file));
    } catch {
      res.writeHead(500).end("read error");
    }
  });
  await new Promise((ready) => { server.listen(0, "127.0.0.1", ready); });
  return { server, port: server.address().port };
}

/** Any Chromium already on disk, newest build first. */
function findInstalledChromium() {
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    join(process.env.HOME ?? "", ".cache", "ms-playwright"),
    join(process.env.LOCALAPPDATA ?? "", "ms-playwright"),
  ].filter(Boolean);
  const relatives = [
    ["chrome-linux", "chrome"],
    ["chrome-linux", "headless_shell"],
    ["chrome-headless-shell-linux64", "chrome-headless-shell"],
    ["chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"],
    ["chrome-win", "chrome.exe"],
  ];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const builds = readdirSync(root)
      .filter((d) => d.startsWith("chromium"))
      .sort()
      .reverse();
    for (const build of builds) {
      for (const rel of relatives) {
        const candidate = join(root, build, ...rel);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

async function capture() {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    throw new Error("playwright is not installed — run `npm install` first");
  }

  const { server, port } = await serve();
  let browser;
  try {
    browser = await chromium.launch();
  } catch (first) {
    // Playwright wants the exact build it shipped with. Plenty of environments
    // — CI images, devcontainers, Nix — already carry a Chromium that works but
    // is a revision or two off, and re-downloading is often blocked anyway. If
    // one is present, use it rather than failing.
    const found = findInstalledChromium();
    if (!found) {
      server.close();
      throw new Error(
        `could not launch Chromium (${first.message.split("\n")[0]}).\n` +
          "Run `npx playwright install chromium`, or point PLAYWRIGHT_BROWSERS_PATH at an existing build.",
      );
    }
    try {
      browser = await chromium.launch({ executablePath: found });
      console.log(`using the Chromium already installed at ${found}`);
    } catch (second) {
      server.close();
      throw new Error(`could not launch Chromium at ${found}: ${second.message.split("\n")[0]}`);
    }
  }

  const snap = {};
  let count = 0;
  for (const theme of THEMES) {
    for (const [width, height] of VIEWPORTS) {
      for (const route of ROUTES) {
        const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
        await page.addInitScript((t) => {
          try { localStorage.setItem("spotter.theme", t); } catch { /* private mode */ }
        }, theme);
        await page.goto(`http://127.0.0.1:${port}/index.html${route}`, { waitUntil: "networkidle" });
        // Let transitions land; a mid-flight value is noise, not a difference.
        await page.waitForTimeout(1800);
        const key = `${theme}|${width}|${route || "/"}`;
        snap[key] = await page.evaluate((props) => {
          /** Structural path — stable across runs, and independent of the class
           *  names a refactor is most likely to be changing. */
          const pathOf = (el) => {
            const parts = [];
            for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
              parts.push(`${n.tagName}:${[...(n.parentElement?.children ?? [])].indexOf(n)}`);
            }
            return parts.reverse().join("/");
          };
          const out = {};
          for (const el of document.querySelectorAll("*")) {
            if (el.tagName === "SCRIPT" || el.tagName === "STYLE") continue;
            const cs = getComputedStyle(el);
            // A running animation samples differently every run. That is timing
            // noise, and at ~108k elements it would drown the real signal.
            if (cs.animationName !== "none") continue;
            out[pathOf(el)] = props.map((p) => cs[p]).join("|");
          }
          return out;
        }, PROPS);
        count += Object.keys(snap[key]).length;
        await page.close();
      }
    }
  }
  await browser.close();
  server.close();
  return { snap, count };
}

function compare(before, after) {
  const diffs = [];
  const byProp = new Map();
  let compared = 0;
  for (const key of Object.keys(before)) {
    const a = before[key];
    const b = after[key] ?? {};
    for (const path of Object.keys(a)) {
      compared++;
      if (!(path in b)) {
        diffs.push({ key, path, prop: "(element)", from: "present", to: "absent" });
        continue;
      }
      if (a[path] === b[path]) continue;
      const av = a[path].split("|");
      const bv = b[path].split("|");
      for (let i = 0; i < PROPS.length; i++) {
        if (av[i] === bv[i]) continue;
        byProp.set(PROPS[i], (byProp.get(PROPS[i]) ?? 0) + 1);
        if (diffs.length < 40) diffs.push({ key, path, prop: PROPS[i], from: av[i], to: bv[i] });
      }
    }
  }
  return { diffs, byProp, compared };
}

// ---- CLI --------------------------------------------------------------------

const mode = process.argv[2];
const BASELINE = join(OUT_DIR, "baseline.json");

if (mode === "baseline") {
  const { snap, count } = await capture();
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(BASELINE, JSON.stringify(snap));
  console.log(`baseline: ${Object.keys(snap).length} page-states, ${count} element fingerprints`);
  console.log(`saved to .visual/baseline.json — make your change, then: npm run visual:check`);
} else if (mode === "check") {
  if (!existsSync(BASELINE)) {
    console.error("no baseline yet. Run `npm run visual:baseline` on the code you trust first.");
    process.exit(1);
  }
  const before = JSON.parse(readFileSync(BASELINE, "utf8"));
  const { snap, count } = await capture();
  const { diffs, byProp, compared } = compare(before, snap);

  console.log(`compared ${compared} element fingerprints across ${Object.keys(before).length} page-states`);
  if (!diffs.length) {
    console.log(`no visual change — every computed style identical (${count} captured)`);
    process.exit(0);
  }
  console.error(`\n${diffs.length >= 40 ? "40+" : diffs.length} differences. By property:`);
  for (const [p, n] of [...byProp].sort((a, b) => b[1] - a[1])) {
    console.error(`  ${String(n).padStart(6)}  ${p}`);
  }
  console.error("\nFirst differences:");
  for (const d of diffs.slice(0, 20)) {
    console.error(`  [${d.key}] ${d.path.split("/").slice(-2).join("/")}`);
    console.error(`      ${d.prop}: ${d.from}  ->  ${d.to}`);
  }
  console.error("\nIf the change was intentional, re-run `npm run visual:baseline`.");
  process.exit(1);
} else {
  console.error("usage: node scripts/visual-snapshot.mjs <baseline|check>");
  process.exit(1);
}
