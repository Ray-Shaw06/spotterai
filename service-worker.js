/**
 * SpotterAI — service worker (installable PWA + offline shell)
 * ============================================================================
 * Makes SpotterAI installable and usable offline:
 *   - Precaches the complete local app shell on install.
 *   - Navigations: network-first, falling back to the cached shell (so the SPA
 *     still loads with no connection).
 *   - Same-origin static assets (CSS, the ES modules, icons): stale-while-
 *     revalidate, so the cache paints immediately and the refresh lands in the
 *     background for the next load. Bumping CACHE is what forces a clean
 *     re-fetch on a release.
 *   - /api/* is never cached (the AI features degrade gracefully when offline).
 *   - Cross-origin requests (fonts, MediaPipe/Firebase CDNs) go straight to the
 *     network.
 *
 * Bump CACHE when shipping changes so old caches are cleaned on activate.
 */

const CACHE = "spotterai-v74";
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
  "audit-telemetry-client.js",
  "audit-view.js",
  "auth-session-probe.js",
  "auth-ui.js",
  "calendar-export.js",
  "calendar-ui.js",
  "catch-up.js",
  "charts.js",
  "chat-actions.js",
  "chat-guard.js",
  "chat.js",
  "demo-data.js",
  "eval-suite.js",
  "eval-ui.js",
  "evaluator.js",
  "exercise-anim.js",
  "exercise-catalog.js",
  "exercise-data.js",
  "exercise-metadata.js",
  "exercises.js",
  "fab-tuck.js",
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
  "import-ui.js",
  "lib/plan.js",
  "lib/sentry.js",
  "lib/telemetry-schema.js",
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
  "route-gate.js",
  "router.js",
  "rule-explanations.js",
  "safety-boundaries.js",
  "safety-lab.js",
  "safety-lab-history.js",
  "safety-lab-production.js",
  "sentry-init.js",
  "share-card.js",
  "split-analyzer.js",
  "split-ui.js",
  "store.js",
  "sync.js",
  "theme.js",
  "today-ui.js",
  "today.js",
  "tracker-store.js",
  "tracker-ui.js",
  "trust-history.js",
  "trust.js",
  "rest-alarm.js",
  "workout-alerts.js",
  "workout-summary.js",
  "workout-ui.js",
];
// Self-hosted fonts. These MUST be precached: they used to come from
// fonts.gstatic.com, which the worker never cached either, so an offline
// launch silently fell back to system faces. Now that they are same-origin
// there is no reason for that to still be true.
const FONTS = [
  "fonts/inter-latin.woff2",
  "fonts/inter-latin-ext.woff2",
  "fonts/jetbrains-mono-latin.woff2",
  "fonts/jetbrains-mono-latin-ext.woff2",
];
const CORE = [
  "./",
  "index.html",
  "style.css",
  "manifest.json",
  ...BOOT_MODULES,
  ...FONTS,
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

  // Same-origin assets → STALE-WHILE-REVALIDATE.
  //
  // This used to be network-first, which meant every CSS file and every one of
  // the ~70 ES modules waited on a network round trip before the app could
  // paint. On a phone on gym wifi that is the lag you feel on every cold start,
  // and it happened even though a perfectly good copy was already cached.
  //
  // Now the cache answers immediately and the network refresh lands in the
  // background for the next load. The tradeoff is honest: a deploy shows up one
  // load later than it used to. That is acceptable because `activate` deletes
  // every cache that is not the current CACHE, so bumping CACHE on a release
  // still forces a clean re-fetch — which is exactly why the constant must be
  // bumped on every ship.
  if (sameOrigin) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(request);

        const refresh = fetch(request)
          .then((res) => {
            if (res && res.ok) cache.put(request, res.clone());
            return res;
          })
          .catch(() => null);

        if (cached) {
          // Do not await the refresh: serving the cached copy is the whole point.
          event.waitUntil(refresh);
          return cached;
        }
        return (await refresh) || Response.error();
      })()
    );
  }
  // Cross-origin (fonts, CDNs) → default network handling.
});

// Rest-timer alerts are the only notifications SpotterAI shows, by two routes:
// the page's own showNotification (workout-alerts.js) and a push booked for the
// rest's deadline (api/rest-push.js), which is what still fires with the screen
// locked. Both render the same banner. The click handler always routes to a
// FIXED same-origin destination, never a payload-provided URL, so a notification
// can only ever reopen the app's Today surface.
const NOTIFICATION_DESTINATION = "/#/today";

/** How late a rest push can be and still claim the rest just ended. */
const REST_FRESH_MS = 90 * 1000;

const REST_NOTIFICATION = Object.freeze({
  body: "Time for your next set.",
  icon: "/icons/spotterai-192.png",
  badge: "/icons/spotterai-192.png",
  tag: "spotterai-rest",
  // NOT renotify: this banner and the page's own (workout-alerts.js) share a
  // tag, so the tag alone replaces whichever landed first, silently. With
  // renotify the shared tag would alert twice a few seconds apart on every set
  // where both arrive, which is every set with the app open.
  renotify: false,
  vibrate: [200, 80, 200],
  silent: false,
  data: { kind: "rest" },
});

// Every push shows a notification, whatever it carries. Two reasons: only our
// own server can address this subscription, so an unrecognised payload is a
// bug, not a stranger; and iOS revokes push permission after a few pushes that
// show nothing, so "ignore it" would be the one response that makes things
// worse. The payload is treated as untrusted anyway: nothing in it is rendered
// or navigated to, it only picks between two fixed banners.
self.addEventListener("push", (event) => {
  let payload = null;
  try {
    payload = event.data ? event.data.json() : null;
  } catch {
    payload = null;
  }
  const isRest = !!payload && payload.kind === "rest";
  // A push can arrive late: QStash retries, or a phone that reconnects after
  // being out of signal. "Rest complete — time for your next set" is wrong by
  // then, and buzzes the user mid-set. Past this window the banner still shows
  // (a push that displays nothing gets the subscription revoked on iOS) but it
  // stops asserting that a rest just ended.
  const endsAt = Number(payload?.endsAt);
  const fresh = !Number.isFinite(endsAt) || Date.now() - endsAt <= REST_FRESH_MS;
  const title = isRest ? (fresh ? "Rest complete" : "Rest timer") : "SpotterAI";
  const body = isRest
    ? (fresh ? REST_NOTIFICATION.body : "Your rest ended a while ago.")
    : "Open SpotterAI.";
  event.waitUntil(
    self.registration
      .showNotification(title, { ...REST_NOTIFICATION, body })
      // A push that shows nothing is the one failure iOS punishes, by revoking
      // the subscription, so fall back to the plainest banner the engine can
      // possibly render rather than letting waitUntil reject.
      .catch(() => self.registration.showNotification(title, { body, tag: REST_NOTIFICATION.tag }))
  );
});

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
      } catch { /* client went away mid-focus; fall through to openWindow */ }
    }
    await self.clients.openWindow(destination.href);
  })());
});
