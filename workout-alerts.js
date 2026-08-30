/**
 * SpotterAI — local workout alerts (zero-cost, on-device only)
 * ============================================================================
 * Replaces the retired remote push path. There is NO server, NO push
 * subscription, NO signing key, and NO promise of a notification after the app
 * is closed. This is
 * a purely local nicety: when the rest timer reaches zero AND the user has
 * turned rest-timer alerts on for THIS device AND granted notification
 * permission, we ask the active service-worker registration to show a short,
 * branded notification that routes back to the workout. If any of that is
 * missing, the workout continues normally with vibration, sound, and the
 * on-screen timer — exactly as before.
 *
 * Everything here is on-device: the enabled flag lives in localStorage on this
 * device only and never leaves it.
 */

export const REST_ALERTS_KEY = "spotterai.restAlerts.enabled";

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
 *   { state: "unsupported" | "denied" | "enabled", enabled: boolean }
 */
export async function enableRestAlerts(env = globalThis) {
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

  setRestAlertsEnabled(true);
  return { state: "enabled", enabled: true };
}

export function disableRestAlerts() {
  setRestAlertsEnabled(false);
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
      renotify: true,
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
    } else if (enabled && cap === "ready") {
      setStatus("On, when a rest timer ends you'll get a notification on this device, booked in advance so a locked screen doesn't delay it. Nothing is sent when the app is closed, and nothing fires if you force-quit it.");
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

  render();
}
