import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "index.html"), "utf8");
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const serviceWorker = readFileSync(join(root, "service-worker.js"), "utf8");
const reminders = readFileSync(join(root, "reminders.js"), "utf8");
const workoutAlerts = readFileSync(join(root, "workout-alerts.js"), "utf8");

const ICONS = {
  apple: "icons/spotterai-apple-touch-180.png",
  small: "icons/spotterai-192.png",
  large: "icons/spotterai-512.png",
  maskable: "icons/spotterai-maskable-512.png",
};

function pngSize(relativePath) {
  const absolutePath = join(root, relativePath);
  assert.ok(existsSync(absolutePath), `${relativePath} must exist`);
  const png = readFileSync(absolutePath);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${relativePath} must be a PNG`);
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

test("manifest defines a stable standalone app rooted at SpotterAI", () => {
  assert.equal(manifest.id, "/");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.theme_color, "#f5f8f6");
  assert.equal(manifest.background_color, "#f5f8f6");
});

test("manifest and iOS metadata use the branded cache-safe icons", () => {
  assert.match(html, new RegExp(`<link rel="apple-touch-icon" sizes="180x180" href="${ICONS.apple}"`));
  assert.match(html, /<meta name="mobile-web-app-capable" content="yes"/);
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes"/);

  assert.deepEqual(manifest.icons, [
    { src: ICONS.small, sizes: "192x192", type: "image/png", purpose: "any" },
    { src: ICONS.large, sizes: "512x512", type: "image/png", purpose: "any" },
    { src: ICONS.maskable, sizes: "512x512", type: "image/png", purpose: "maskable" },
  ]);
});

test("home-screen artwork has the required platform dimensions", () => {
  assert.deepEqual(pngSize(ICONS.apple), { width: 180, height: 180 });
  assert.deepEqual(pngSize(ICONS.small), { width: 192, height: 192 });
  assert.deepEqual(pngSize(ICONS.large), { width: 512, height: 512 });
  assert.deepEqual(pngSize(ICONS.maskable), { width: 512, height: 512 });
});

test("icon source is the forest-green SpotterAI shield and barbell, not the red-ring placeholder", () => {
  const sourcePath = join(root, "icons/spotterai-app-icon.svg");
  assert.ok(existsSync(sourcePath), "the reusable app-icon source must exist");
  const source = readFileSync(sourcePath, "utf8");
  assert.match(source, /#1a5c42/i);
  assert.match(source, /M16 3\.6l9\.4 3\.4v7\.6/);
  assert.match(source, /M12 18h8/);
  assert.doesNotMatch(source, /#ff3b3f|#ff3838/i);
});

test("social previews use the canonical SpotterAI domain", () => {
  assert.match(html, /<meta property="og:url" content="https:\/\/spotterai\.xyz\/"/);
  assert.match(html, /<meta property="og:image" content="https:\/\/spotterai\.xyz\/og-home\.png"/);
  assert.match(html, /<meta name="twitter:image" content="https:\/\/spotterai\.xyz\/og-home\.png"/);
  assert.doesNotMatch(html, /spotterai-flax\.vercel\.app/);
});

test("inline favicon uses the current light forest brand", () => {
  const favicon = html.match(/<link\s+rel="icon"\s+href="([^"]+)"/s)?.[1] || "";
  assert.match(favicon, /%23f5f8f6/i);
  assert.match(favicon, /%231a5c42/i);
  assert.doesNotMatch(favicon, /%230a090f|%238a6dff/i);
});

test("offline shell precaches every current install asset under a fresh cache", () => {
  assert.match(serviceWorker, /const CACHE = "spotterai-v47"/);
  for (const path of ["manifest.json", "calendar-export.js", "workout-alerts.js", "reminders.js", ...Object.values(ICONS)]) {
    assert.ok(serviceWorker.includes(`"${path}"`), `${path} must be precached`);
  }
});

test("service worker has no remote push path and routes clicks to a fixed same-origin Today URL", () => {
  // Web Push is retired: no push listener, no remote subscription surface.
  assert.doesNotMatch(serviceWorker, /addEventListener\(\s*["']push["']/);
  assert.doesNotMatch(serviceWorker, /event\.data\.json\(\)/);
  assert.doesNotMatch(serviceWorker, /PushManager|applicationServerKey|VAPID/i);

  // The only notification interaction is a click handler with a FIXED destination.
  assert.match(serviceWorker, /addEventListener\("notificationclick"/);
  assert.match(serviceWorker, /NOTIFICATION_DESTINATION = "\/#\/today"/);
  assert.match(serviceWorker, /clients\.matchAll/);
  assert.match(serviceWorker, /clients\.openWindow/);
  assert.match(serviceWorker, /url\.origin\s*!==\s*self\.location\.origin/);
  // A payload URL must never reach navigate/openWindow.
  assert.doesNotMatch(serviceWorker, /openWindow\(\s*event\.notification\.data/);
  assert.doesNotMatch(serviceWorker, /navigate\(\s*event\.notification\.data/);
});

test("the only notification shown is the local rest alert, branded and same-origin", () => {
  assert.match(workoutAlerts, /showNotification\(/);
  assert.match(workoutAlerts, /icon:\s*"\/?icons\/spotterai-192\.png"/);
  // On-device only: no subscription, VAPID, or server call anywhere in the module.
  assert.doesNotMatch(workoutAlerts, /PushManager|applicationServerKey|VAPID|fetch\(/i);
});

test("production UI never points users back to the legacy red icons", () => {
  const productionFiles = { html, manifest: JSON.stringify(manifest), serviceWorker, reminders, workoutAlerts };
  const legacyIcon = /icons\/(?:icon-192|icon-512|maskable-512)\.png/;

  for (const [name, contents] of Object.entries(productionFiles)) {
    assert.doesNotMatch(contents, legacyIcon, `${name} must use the branded icon set`);
  }
});
