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

const CACHE = "spotterai-v38";
// Explicit local module graph rooted at every <script type="module"> in index.html.
// test/service-worker-behavior.test.js derives the graph independently so a new
// boot import cannot be shipped without being added here.
const BOOT_MODULES = [
  "ai-errors.js",
  "ai.js",
  "analytics.js",
  "anim-gate.js",
  "app.js",
  "auth-ui.js",
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
  "gamify.js",
  "library-ui.js",
  "measurements.js",
  "movement-cues.js",
  "notification-client.js",
  "notification-guidance.js",
  "notification-ui.js",
  "notifications.js",
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

const NOTIFICATION_CATEGORIES = new Set(["workout", "follow_up", "streak", "recovery"]);
const FALLBACK_NOTIFICATION = Object.freeze({
  title: "SpotterAI reminder",
  body: "Your training plan is ready when you are.",
});

function safeText(value, fallback, maxLength) {
  if (typeof value !== "string") return fallback;
  const text = value.trim();
  if (!text || text.length > maxLength || /[\u0000-\u001f\u007f]/.test(text)) return fallback;
  return text;
}

function safeCategory(value) {
  return NOTIFICATION_CATEGORIES.has(value) ? value : "workout";
}

function safeTodayUrl(value) {
  if (typeof value !== "string" || value.length > 160) return "/#/today";
  try {
    const url = new URL(value, self.location.origin);
    if (url.origin === self.location.origin && url.pathname === "/" && url.hash === "#/today" && !url.username && !url.password) {
      return "/#/today";
    }
  } catch {}
  return "/#/today";
}

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let payload = {};
    try {
      payload = event.data ? event.data.json() : {};
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) payload = {};
    } catch {
      payload = {};
    }
    const category = safeCategory(payload.category);
    const title = safeText(payload.title, FALLBACK_NOTIFICATION.title, 90);
    const body = safeText(payload.body, FALLBACK_NOTIFICATION.body, 240);
    await self.registration.showNotification(title, {
      body,
      icon: "/icons/spotterai-192.png",
      tag: `spotterai-${category}`,
      renotify: false,
      data: { url: safeTodayUrl(payload.url), category },
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const category = safeCategory(event.notification?.data?.category);
    const destination = new URL(`/?notification=${encodeURIComponent(category)}#/today`, self.location.origin);
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
