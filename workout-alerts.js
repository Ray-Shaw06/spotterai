/**
 * SpotterAI — workout alerts (zero-cost, opt-in per device)
 * ============================================================================
 * Two routes to a "Rest complete" notification, layered so the better one is
 * used when it exists and the other never goes away:
 *
 *   1. LOCAL (always). When the rest timer reaches zero AND alerts are on for
 *      THIS device AND permission is granted, the page asks the service-worker
 *      registration to show a short, branded notification. Fires from page JS,
 *      so it needs the page awake: on a locked iPhone that is at unlock, which
 *      is the one moment nobody needs it.
 *
 *   2. BOOKED (when the server is configured). The moment a rest is armed, the
 *      page books a Web Push for the deadline via /api/rest-push, which parks
 *      the message with QStash until then. That push wakes a locked phone, a
 *      backgrounded app, even a closed one, and on iPhone it is the ONLY route
 *      to a buzz, since WebKit has no vibration API. Skipping, +15s and
 *      re-arming cancel the booking. lib/rest-push.js has the design.
 *
 * If the server has no keys (`GET /api/rest-push` says `enabled: false`), or
 * the booking call fails, route 2 is silently absent and route 1 stands, which
 * is exactly what shipped before. The workout never depends on either: sound,
 * vibration where it exists, and the on-screen timer carry the common case.
 *
 * What leaves the device, and only when alerts are on: this device's push
 * address and the deadline. No account, no workout data, nothing stored
 * server-side (the address is sealed into the one pending message and gone
 * when it fires). The enabled flag and the address copy live in localStorage.
 */

import { restAudioMode, setRestAudioMode, MIX, SOLO } from "./rest-alarm.js";

export const REST_ALERTS_KEY = "spotterai.restAlerts.enabled";
/** This device's push endpoint plus the key it was minted with. Never the
 *  encryption secrets: the UI only needs to know a subscription exists, and
 *  /api/rest-push accepts a subscription from anyone, so a leaked copy of the
 *  full blob would let a stranger push banners at this device. */
export const REST_PUSH_SUBSCRIPTION_KEY = "spotterai.restAlerts.subscription";
export const REST_PUSH_ENDPOINT = "/api/rest-push";

// Legacy Web Push credentials/preferences. Deleted once on first load so the
// retired feature leaves nothing behind. Never performs a network request.
const LEGACY_NOTIFICATION_KEYS = Object.freeze([
  "spotterai.notifications.token",
  "spotterai.notifications.preferences",
  "spotterai.notifications.offeredPlanAt",
  "spotterai.notifications.pending",
  "spotterai.notifications.configurationId",
]);

/**
 * One-time local cleanup of retired Web Push keys. Touches only the
 * `spotterai.notifications.*` namespace — never workout, nutrition, plan,
 * onboarding, profile, or Firebase-sync data.
 */
export function purgeLegacyNotificationStorage(store = safeLocalStorage()) {
  if (!store) return;
  for (const key of LEGACY_NOTIFICATION_KEYS) {
    try {
      store.removeItem(key);
    } catch {
      /* storage disabled — nothing to clean */
    }
  }
}

function safeLocalStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null; // access can throw in locked-down contexts
  }
}

/** Is this an iPhone or iPad? Used only to tell "never" apart from "not yet". */
export function isIOS(env = globalThis) {
  const nav = env.navigator;
  if (!nav) return false;
  const ua = String(nav.userAgent || "");
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ reports a desktop Safari UA, and is only distinguishable by
  // having touch points on a "Macintosh".
  return /Macintosh/.test(ua) && (nav.maxTouchPoints || 0) > 1;
}

/** Running from the home screen rather than a browser tab. */
export function isInstalled(env = globalThis) {
  try {
    if (env.navigator && env.navigator.standalone === true) return true; // iOS
    return !!(env.matchMedia && env.matchMedia("(display-mode: standalone)").matches);
  } catch {
    return false;
  }
}

/**
 * What the current device can do, without prompting.
 *   "unsupported"       — no Notification API, and none is coming
 *   "needs-install"     — iOS in a browser tab: notifications exist ONLY for a
 *                         home-screen install (16.4+), so this is fixable
 *   "needs-permission"  — supported, permission is "default" (never asked)
 *   "denied"            — the user blocked notifications
 *   "ready"             — permission granted; alerts can fire when enabled
 *
 * The `needs-install` tier exists because the old code returned "unsupported"
 * for an iPhone in Safari and told the user their device "can't show
 * notifications". It can. It needs Add to Home Screen first, and a dead end is
 * a worse answer than an instruction.
 */
export function restAlertCapability(env = globalThis) {
  const hasNotification = typeof env.Notification === "function";
  const hasSW = !!(env.navigator && env.navigator.serviceWorker);
  if (!hasNotification || !hasSW) {
    return !hasNotification && isIOS(env) && !isInstalled(env) ? "needs-install" : "unsupported";
  }
  const perm = env.Notification.permission;
  if (perm === "granted") return "ready";
  if (perm === "denied") return "denied";
  return "needs-permission";
}

/**
 * What this device can do to get your attention physically.
 *   "vibration"         — navigator.vibrate works (Android)
 *   "notification-only" — no Vibration API, but a notification will buzz if the
 *                         OS is set to. This is every iPhone: WebKit has never
 *                         shipped the Vibration API, so the notification is the
 *                         ONLY route to a haptic.
 *   "none"              — neither
 */
export function hapticsCapability(env = globalThis) {
  if (typeof env.navigator?.vibrate === "function") return "vibration";
  return restAlertCapability(env) === "unsupported" ? "none" : "notification-only";
}

/** Local enabled flag. Fails closed to `false` on any read problem. */
export function restAlertsEnabled(store = safeLocalStorage()) {
  if (!store) return false;
  try {
    return store.getItem(REST_ALERTS_KEY) === "true";
  } catch {
    return false;
  }
}

export function setRestAlertsEnabled(enabled, store = safeLocalStorage()) {
  if (!store) return;
  try {
    if (enabled) store.setItem(REST_ALERTS_KEY, "true");
    else store.removeItem(REST_ALERTS_KEY);
  } catch {
    /* storage disabled — preference is best-effort */
  }
}

/**
 * Ask for notification permission after a deliberate tap, then enable local
 * alerts if granted. Returns a typed result the UI can render:
 *   { state: "unsupported" | "denied" | "enabled", enabled: boolean, booked?: boolean }
 * `booked` says whether a push could also be booked with the server, which is
 * the difference between a notification that survives a locked screen and one
 * that waits for the unlock.
 */
export async function enableRestAlerts(env = globalThis, store = safeLocalStorage()) {
  const cap = restAlertCapability(env);
  if (cap === "unsupported") return { state: "unsupported", enabled: false };
  if (cap === "denied") return { state: "denied", enabled: false };

  let permission = env.Notification.permission;
  if (permission !== "granted") {
    try {
      permission = await env.Notification.requestPermission();
    } catch {
      permission = "denied";
    }
  }
  if (permission !== "granted") return { state: "denied", enabled: false };

  setRestAlertsEnabled(true, store);
  // Best effort, and only now: a subscription is worthless without permission,
  // and it is the server's GET that decides whether one is even wanted.
  const subscription = await subscribeRestPush(env, store).catch(() => null);
  return { state: "enabled", enabled: true, booked: !!subscription };
}

export function disableRestAlerts(env = globalThis, store = safeLocalStorage()) {
  setRestAlertsEnabled(false, store);
  forgetRestPushSubscription(env, store);
  return { state: "disabled", enabled: false };
}

/**
 * Fire the rest-complete notification if — and only if — alerts are enabled on
 * this device and permission is granted. Never throws; a display failure is
 * non-fatal and the caller's vibration/sound/visual feedback stands alone.
 * Returns a typed result mostly for tests: "shown" | "skipped" | "failed".
 */
export async function notifyRestComplete(env = globalThis) {
  if (!restAlertsEnabled()) return "skipped";
  if (restAlertCapability(env) !== "ready") return "skipped";
  try {
    const reg = await env.navigator.serviceWorker.ready;
    if (!reg || typeof reg.showNotification !== "function") return "failed";
    await reg.showNotification("Rest complete", {
      body: "Time for your next set.",
      icon: "/icons/spotterai-192.png",
      badge: "/icons/spotterai-192.png",
      tag: "spotterai-rest",
      // NOT renotify: the booked push and this local banner share a tag, so the
      // tag alone replaces the banner silently. With renotify the shared tag
      // would instead alert twice, a few seconds apart, on every set where both
      // land, which is the common case whenever the app is open.
      renotify: false,
      // Android buzzes from the notification itself. On iOS this key is
      // ignored and the OS decides from the user's own notification settings,
      // which is the only haptic route WebKit offers.
      vibrate: [200, 80, 200],
      silent: false,
      // The SW notificationclick handler ignores any payload URL and routes to
      // a fixed same-origin destination, so nothing here can redirect the user.
      data: { kind: "rest" },
    });
    return "shown";
  } catch {
    return "failed"; // workout continues; audio/vibration/visual remain
  }
}

// ---------------------------------------------------------------------------
// Booked push — the route that survives a locked screen
// ---------------------------------------------------------------------------

/** Cached answer to GET /api/rest-push. `undefined` until asked. */
let pushConfig;
/** The in-flight GET, so two rests armed at once do not both ask. */
let pushConfigPending = null;

/** Every call here is on a workout's critical path and none is worth waiting on
 *  past a few seconds: gym wifi that hangs must not hold a rest hostage. */
const REST_PUSH_TIMEOUT_MS = 5000;
function timeoutSignal() {
  try {
    return AbortSignal.timeout(REST_PUSH_TIMEOUT_MS);
  } catch {
    return undefined; // older engine; the request simply has no deadline
  }
}
/** Cancel token for the booking that is currently pending, if any. */
let pendingToken = null;
/**
 * Which arm the pending booking belongs to. A booking takes two round trips to
 * create (subscribe, then POST) and one synchronous line to cancel, so a Skip
 * tapped during the booking would otherwise find nothing to cancel and the POST
 * would then install a token nobody owns: a "Rest complete" push arriving for a
 * rest the user already skipped. Every schedule claims a generation, every
 * cancel burns one, and a booking that comes back to a burned generation
 * cancels itself instead of being stored.
 */
let restPushGeneration = 0;
/**
 * A cancel token whose DELETE failed in transit. Dropping it would strand a
 * live booking: the push then fires for a rest the user already skipped, and
 * nothing on the device can reach it any more. Held here and retried on the
 * next booking, which is the next thing the user does anyway.
 */
let orphanToken = null;

/** Test seam: forget the cached server answer and any pending booking. */
export function __resetRestPushForTests() {
  pushConfig = undefined;
  pushConfigPending = null;
  pendingToken = null;
  orphanToken = null;
  restPushGeneration = 0;
}

function fetchOf(env) {
  const f = env.fetch || globalThis.fetch;
  return typeof f === "function" ? f.bind(env.fetch ? env : globalThis) : null;
}

/** VAPID public key (base64url) to the Uint8Array subscribe() wants.
 *  `atob` is the one decoder both halves have: every browser that ships push,
 *  and Node 16+, which is what lets this run under the test suite unchanged. */
export function applicationServerKey(base64url) {
  const padded = String(base64url || "") + "=".repeat((4 - (String(base64url || "").length % 4)) % 4);
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Whether the server can book pushes, and with which key. Asked once per page
 * load and remembered; any failure reads as "not enabled", which is the same
 * answer as an operator who never set the keys, and costs the user nothing.
 */
export async function restPushConfig(env = globalThis) {
  if (pushConfig !== undefined) return pushConfig;
  if (pushConfigPending) return pushConfigPending; // two sets armed at once ask once
  const f = fetchOf(env);
  if (!f) return (pushConfig = { enabled: false });
  pushConfigPending = (async () => {
    try {
      const res = await f(REST_PUSH_ENDPOINT, { method: "GET", signal: timeoutSignal() });
      const json = res.ok ? await res.json() : null;
      pushConfig = json && json.enabled === true && typeof json.publicKey === "string" && json.publicKey
        ? { enabled: true, publicKey: json.publicKey }
        : { enabled: false };
    } catch {
      pushConfig = { enabled: false };
    }
    pushConfigPending = null;
    return pushConfig;
  })();
  return pushConfigPending;
}

/** The stored subscription copy, or null. Sync, so the Account UI can read it. */
export function storedRestPushSubscription(store = safeLocalStorage()) {
  if (!store) return null;
  try {
    const raw = store.getItem(REST_PUSH_SUBSCRIPTION_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed.endpoint === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function rememberSubscription(subscription, publicKey, store) {
  if (!store) return;
  try {
    store.setItem(REST_PUSH_SUBSCRIPTION_KEY, JSON.stringify({ endpoint: subscription.endpoint, publicKey }));
  } catch {
    /* storage disabled; the live registration still holds it */
  }
}

/** Forget the stored copy without touching the browser subscription. Used when
 *  the server stops advertising the capability, so the Account copy stops
 *  promising a booking that can no longer be made. */
function forgetStoredSubscription(store = safeLocalStorage()) {
  try {
    store?.removeItem(REST_PUSH_SUBSCRIPTION_KEY);
  } catch {
    /* ignore */
  }
}

async function pushManagerOf(env) {
  const sw = env.navigator?.serviceWorker;
  if (!sw) return null;
  try {
    const reg = await sw.ready;
    return reg && reg.pushManager && typeof reg.pushManager.getSubscription === "function" ? reg.pushManager : null;
  } catch {
    return null;
  }
}

/**
 * Get this device's push subscription, creating one if needed. Requires
 * permission already granted (subscribe() does not prompt on its own) and a
 * server that wants it. Returns the toJSON() shape, or null when any link in
 * that chain is missing. The live registration is preferred over the stored
 * copy every time, so a browser that silently rotated the subscription is
 * picked up on the next arm rather than never.
 */
export async function subscribeRestPush(env = globalThis, store = safeLocalStorage()) {
  if (restAlertCapability(env) !== "ready") return null;
  const cfg = await restPushConfig(env);
  if (!cfg.enabled) return null;
  const manager = await pushManagerOf(env);
  if (!manager) return null;
  try {
    let sub = await manager.getSubscription();
    // A subscription is bound to the VAPID key it was minted with. If the
    // operator rotates keys, the old subscription still looks healthy here but
    // every push against it is refused by the push service, forever, with
    // nothing on the device noticing. Re-mint when the key we recorded is not
    // the key the server is advertising now.
    const remembered = storedRestPushSubscription(store);
    if (sub && remembered && remembered.publicKey && remembered.publicKey !== cfg.publicKey) {
      try {
        await sub.unsubscribe?.();
      } catch {
        /* the re-subscribe below is what matters */
      }
      sub = null;
    }
    if (!sub) {
      sub = await manager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(cfg.publicKey) });
    }
    const json = typeof sub?.toJSON === "function" ? sub.toJSON() : sub;
    if (!json || typeof json.endpoint !== "string") return null;
    rememberSubscription(json, cfg.publicKey, store);
    return json;
  } catch {
    return null;
  }
}

/** Drop the stored copy and release the browser subscription. Best effort. */
export function forgetRestPushSubscription(env = globalThis, store = safeLocalStorage()) {
  try {
    store?.removeItem(REST_PUSH_SUBSCRIPTION_KEY);
  } catch {
    /* ignore */
  }
  pushManagerOf(env)
    .then((manager) => manager?.getSubscription())
    .then((sub) => sub?.unsubscribe?.())
    .catch(() => {});
}

/**
 * Book a push for `endsAtMs`. Called from startRest() and addRest() in
 * workout-ui.js, so once per rest and again on +15s. Any previous booking is
 * cancelled first: two pushes for one rest would be two banners.
 *
 * Returns "booked" | "superseded" | "skipped" | "failed". "superseded" means
 * the rest was skipped or re-armed while this booking was in flight, so the
 * booking cancelled itself on the way in. Only "booked" leaves a pending token.
 */
export async function scheduleRestPush(endsAtMs, env = globalThis, store = safeLocalStorage()) {
  if (!restAlertsEnabled(store)) return "skipped";
  cancelRestPush(env).catch(() => {});
  // A cancel that never reached the server left a booking live. Try it again
  // now, before adding another: the user is arming a new rest, so the old one
  // firing would be a buzz in the middle of this set.
  if (orphanToken) {
    const stranded = orphanToken;
    orphanToken = null;
    deleteBooking(stranded, env).catch(() => {});
  }
  // Claimed AFTER the cancel above, which burns a generation of its own.
  const mine = ++restPushGeneration;
  const subscription = await subscribeRestPush(env, store);
  if (!subscription) return "skipped";
  const f = fetchOf(env);
  if (!f) return "skipped";
  try {
    const res = await f(REST_PUSH_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // `now` travels with `endsAt` so the server can take the INTERVAL from
      // this device and the origin from its own clock. A phone whose clock is
      // off would otherwise book every push by exactly that much.
      body: JSON.stringify({ subscription, endsAt: Math.round(Number(endsAtMs)), now: Date.now() }),
      // The tap that armed the rest may be the last thing before the screen
      // locks; keepalive lets the request finish anyway.
      keepalive: true,
    });
    if (res.status === 503) {
      // Only latch on the server's own "not configured" marker. A bare 503 can
      // come from the platform (a paused deployment, an edge error) and must
      // not switch the feature off for the rest of the page's life.
      const json = await res.json().catch(() => null);
      if (json && json.configured === false) {
        pushConfig = { enabled: false };
        forgetStoredSubscription(store); // stop the Account copy promising a booking
      }
      return "skipped";
    }
    if (!res.ok) return "failed";
    const json = await res.json();
    if (!json || typeof json.token !== "string") return "failed";
    // Skipped or re-armed while this was in flight: the rest this booking was
    // for is over. Hand the token straight back rather than storing it, or it
    // fires later with nothing left to cancel it.
    if (mine !== restPushGeneration) {
      deleteBooking(json.token, env).catch(() => {});
      return "superseded";
    }
    pendingToken = json.token;
    return "booked";
  } catch {
    return "failed";
  }
}

/**
 * DELETE one booking by token. Shared by cancel and the superseded path.
 * A token the server did not recognise (400) is spent; anything else means the
 * booking may still be live, so the token is kept for a retry.
 */
async function deleteBooking(token, env) {
  const f = fetchOf(env);
  if (!f) return "failed";
  try {
    const res = await f(`${REST_PUSH_ENDPOINT}?token=${encodeURIComponent(token)}`, {
      method: "DELETE",
      keepalive: true,
      signal: timeoutSignal(),
    });
    if (res.ok || res.status === 400) return "cancelled";
    orphanToken = token;
    return "failed";
  } catch {
    orphanToken = token;
    return "failed";
  }
}

/** True while a push is booked for the current rest. */
export function restPushBooked() {
  return pendingToken != null;
}

/**
 * Cancel the pending booking, if any. Returns "cancelled" | "none" | "failed".
 * The token is dropped before the request goes out, so a second call during
 * the first is a no-op rather than a double cancel.
 */
export async function cancelRestPush(env = globalThis) {
  // Burn the generation first: a booking still in flight belongs to the rest
  // being cancelled, so it must not be stored when it lands.
  restPushGeneration += 1;
  const token = pendingToken;
  pendingToken = null;
  if (!token) return "none";
  return deleteBooking(token, env);
}

// ---------------------------------------------------------------------------
// Account UI — "Workout alerts" section (installed-device local control)
// ---------------------------------------------------------------------------

export function initWorkoutAlertsUI(doc = globalThis.document) {
  if (!doc) return;
  const section = doc.getElementById("account-workout-alerts");
  if (!section) return;

  const toggle = doc.getElementById("rest-alerts-toggle");
  const status = doc.getElementById("rest-alerts-status");
  const setStatus = (msg) => {
    if (status) status.textContent = msg;
  };

  function render() {
    const cap = restAlertCapability();
    const enabled = restAlertsEnabled();
    if (toggle) {
      toggle.checked = enabled && cap === "ready";
      toggle.disabled = cap === "unsupported" || cap === "denied" || cap === "needs-install";
      toggle.setAttribute("aria-checked", String(toggle.checked));
    }
    if (cap === "needs-install") {
      setStatus("Add SpotterAI to your home screen first: Share, then Add to Home Screen. iOS only gives notifications to installed apps, not to a Safari tab. The rest timer still beeps and counts down either way.");
    } else if (cap === "unsupported") {
      setStatus("This device can't show notifications. The rest timer still beeps and counts down on screen.");
    } else if (cap === "denied") {
      setStatus("Notifications are blocked in your device settings. The rest timer still beeps and counts down on screen.");
    } else if (enabled && cap === "ready" && storedRestPushSubscription() && pushConfig?.enabled !== false) {
      setStatus("On, and booked: the moment a rest timer starts, its end is booked with the server, so the notification reaches this device with the screen locked, the app in the background, or closed. Only this device's push address and the end time leave your phone, and nothing is kept once it fires.");
    } else if (enabled && cap === "ready") {
      setStatus("On, when a rest timer ends you'll get a notification on this device while SpotterAI is open. With the screen locked it shows when you unlock. Nothing is sent when the app is closed, and nothing fires if you force-quit it.");
    } else {
      setStatus(hapticsCapability() === "vibration"
        ? "Off, turn on to get a notification on this device when a rest timer ends. The alarm sound, vibration and countdown work either way."
        : "Off, turn on to get a notification when a rest timer ends. On iPhone that notification is also the only way to get a buzz: Safari has no vibration API, so the sound and the countdown are what you get without it.");
    }
    section.removeAttribute("aria-busy");
  }

  toggle?.addEventListener("change", async () => {
    if (toggle.checked) {
      const result = await enableRestAlerts();
      if (result.state === "denied") {
        setStatus("Notifications are blocked. Allow them for SpotterAI in your device settings, then try again. Vibration and sound still work.");
      }
    } else {
      disableRestAlerts();
    }
    render();
  });

  initRestAudioModeUI(doc);
  render();
  // The booked-vs-local copy above depends on what the server says, so ask
  // once and re-render. Also warms the cache for the first rest of the session,
  // which otherwise pays this round trip on the critical path.
  if (restAlertsEnabled()) restPushConfig().then(render).catch(() => {});
}

/**
 * "Interrupt other audio for the alarm". Off by default, because the rest timer
 * used to hold a non-mixable audio session for the whole rest and that STOPPED
 * whatever the user had playing every time they checked off a set.
 *
 * Kept as a control rather than a silent change: for someone training without
 * music, interrupting is strictly the better alarm — it rings through the
 * ring/silent switch and is the version most likely to survive a locked screen.
 */
export function initRestAudioModeUI(doc = globalThis.document) {
  if (!doc) return;
  const toggle = doc.getElementById("rest-audio-solo-toggle");
  if (!toggle) return;
  const status = doc.getElementById("rest-audio-status");

  function render() {
    const solo = restAudioMode() === SOLO;
    toggle.checked = solo;
    toggle.setAttribute("aria-checked", String(solo));
    if (!status) return;
    status.textContent = solo
      ? "On, the alarm takes over the audio output, so it rings even with your phone on silent and is the most reliable with the screen locked. Music, podcasts and anything else you have playing are paused for the length of each rest."
      : "Off, the rest timer plays over your music and leaves it running.";
  }

  toggle.addEventListener("change", () => {
    setRestAudioMode(toggle.checked ? SOLO : MIX);
    render();
  });

  render();
}
