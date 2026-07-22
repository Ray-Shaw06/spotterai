/**
 * SpotterAI — service worker (installable PWA + offline shell)
 * ============================================================================
 * Makes SpotterAI installable and usable offline:
 *   - Precaches the complete local app shell on install.
 *   - Navigations: network-first, falling back to the cached shell (so the SPA
 *     still loads with no connection).
 *   - Same-origin static assets (CSS, the ES modules, icons): network-first with
 *     a cached fallback, so deploys stay fresh and the app still works offline.
 *   - /api/* is never cached (the AI features degrade gracefully when offline).
 *   - Cross-origin requests (fonts, MediaPipe/Firebase CDNs) go straight to the
 *     network.
 *
 * Bump CACHE when shipping changes so old caches are cleaned on activate.
 */

const CACHE = "spotterai-v42";
// Explicit local module graph rooted at every <script type="module"> in index.html.
// test/service-worker-behavior.test.js derives the graph independently so a new
// boot import cannot be shipped without being added here.
const BOOT_MODULES = [
  "adapt-engine.js",
  "ai-errors.js",
  "ai.js",
  "analytics.js",
  "anim-gate.js",
  "app.js",
  "auth-ui.js",
  "calendar-export.js",
  "charts.js",
  "chat-actions.js",
  "chat-guard.js",
  "chat.js",
  "demo-data.js",
  "eval-suite.js",
  "eval-ui.js",
  "evaluator.js",
  "exercise-anim.js",
  "exercise-data.js",
  "exercises.js",
  "firebase-config.js",
  "first-week-ui.js",
  "first-week.js",
  "focus-trap.js",
  "foods.js",
  "form-coach.js",
  "form-confidence.js",
  "form-evaluator.js",
  "form-report.js",
  "form-session.js",
  "gamify.js",
  "library-ui.js",
  "measurements.js",
  "movement-cues.js",
  "nutrition-safety.js",
  "nutrition-ui.js",
  "onboarding-ui.js",
  "onboarding.js",
  "pain-ui.js",
  "pain.js",
  "plan-edit.js",
  "profile-store.js",
  "progression.js",
  "quick-log.js",
  "reminders.js",
  "repair.js",
  "router.js",
  "rule-explanations.js",
  "safety-boundaries.js",
  "safety-lab.js",
  "share-card.js",
  "split-analyzer.js",
  "split-ui.js",
  "store.js",
  "sync.js",
  "today-ui.js",
  "today.js",
  "tracker-store.js",
  "tracker-ui.js",
  "trust.js",
  "workout-alerts.js",
  "workout-summary.js",
  "workout-ui.js",
];
const CORE = [
  "./",
  "index.html",
  "style.css",
  "manifest.json",
  ...BOOT_MODULES,
  "icons/spotterai-apple-touch-180.png",
  "icons/spotterai-192.png",
  "icons/spotterai-512.png",
  "icons/spotterai-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Keep the current worker active unless the complete offline shell is ready.
      await cache.addAll(CORE);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  // Let API calls hit the network (they fail gracefully when offline).
  if (sameOrigin && url.pathname.startsWith("/api/")) return;

  // Navigations → network-first, fall back to the cached app shell.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => (await caches.match("index.html")) || (await caches.match("./")) || Response.error())
    );
    return;
  }

  // Same-origin assets → NETWORK-FIRST (so deploys always show up), with the
  // cache as an offline fallback. Avoids the classic PWA "I don't see my changes"
  // staleness from cache-first on CSS/JS.
  if (sameOrigin) {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(request);
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        } catch {
          return (await caches.match(request)) || Response.error();
        }
      })()
    );
  }
  // Cross-origin (fonts, CDNs) → default network handling.
});

// Local rest-timer alerts (workout-alerts.js) are the only notifications SpotterAI
// shows — there is no `push` listener and no remote push path. The click handler
// always routes to a FIXED same-origin destination, never a payload-provided URL,
// so a notification can only ever reopen the app's Today surface.
const NOTIFICATION_DESTINATION = "/#/today";

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const destination = new URL(NOTIFICATION_DESTINATION, self.location.origin);
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      try {
        const url = new URL(client.url);
        if (url.origin !== self.location.origin) continue;
        if (typeof client.navigate === "function") await client.navigate(destination.href);
        await client.focus();
        return;
      } catch {}
    }
    await self.clients.openWindow(destination.href);
  })());
});
