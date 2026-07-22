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

/**
 * What the current device can do, without prompting.
 *   "unsupported"       — no Notification API or no service worker
 *   "needs-permission"  — supported, permission is "default" (never asked)
 *   "denied"            — the user blocked notifications
 *   "ready"             — permission granted; alerts can fire when enabled
 */
export function restAlertCapability(env = globalThis) {
  const hasNotification = typeof env.Notification === "function";
  const hasSW = !!(env.navigator && env.navigator.serviceWorker);
  if (!hasNotification || !hasSW) return "unsupported";
  const perm = env.Notification.permission;
  if (perm === "granted") return "ready";
  if (perm === "denied") return "denied";
  return "needs-permission";
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
      toggle.disabled = cap === "unsupported" || cap === "denied";
      toggle.setAttribute("aria-checked", String(toggle.checked));
    }
    if (cap === "unsupported") {
      setStatus("This device can't show notifications. The rest timer still buzzes, beeps, and counts down on screen.");
    } else if (cap === "denied") {
      setStatus("Notifications are blocked in your device settings. The rest timer still buzzes, beeps, and counts down on screen.");
    } else if (enabled && cap === "ready") {
      setStatus("On — when a rest timer ends you'll get a notification on this device. Nothing is sent when the app is closed.");
    } else {
      setStatus("Off — turn on to get a notification on this device when a rest timer ends. Vibration and sound always work.");
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
