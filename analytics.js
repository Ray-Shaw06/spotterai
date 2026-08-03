import { funnelKey } from "./profile-store.js";

/**
 * Sanitized activation-funnel telemetry.
 *
 * Vercel Hobby supports pageviews but not custom events. Each approved funnel
 * action therefore becomes a virtual pageview with only allow-listed segments.
 */
function deepFreeze(value) {
  Object.values(value).forEach((child) => {
    if (child && typeof child === "object") deepFreeze(child);
  });
  return Object.freeze(value);
}

export const FUNNEL_EVENTS = deepFreeze({
  landing_cta_clicked: { source: ["hero", "final", "today"] },
  onboarding_started: { source: ["landing", "today", "plan"] },
  onboarding_completed: {},
  plan_generation_succeeded: { fallback_used: ["true", "false"] },
  plan_generation_failed: { failure_class: ["offline", "timeout", "rate_limited", "unavailable", "invalid_response", "unknown"] },
  plan_fallback_shown: { failure_class: ["offline", "timeout", "rate_limited", "unavailable", "invalid_response", "unknown"] },
  // first_* are ACTIVATION events: they fire once per profile, ever, via
  // trackFunnelOnce. They answer "did a new person get going?" and must stay
  // free of the owner's own repeat logging, which is what made both traffic
  // snapshots unreadable before 2026-08-03.
  first_workout_started: { source: ["plan", "today", "dashboard"] },
  first_workout_completed: { source: ["plan", "today", "dashboard", "unknown"] },
  // Ongoing volume. Fires every time, so the data first_workout_completed used
  // to carry (accidentally) is still collected, just under an honest name.
  workout_completed: { source: ["plan", "today", "dashboard", "unknown"] },
  meal_photo_succeeded: {},
  meal_photo_failed: { failure_class: ["offline", "timeout", "rate_limited", "unavailable", "invalid_response", "unknown"] },
  calendar_export_opened: {},
  calendar_export_downloaded: { reminder: ["0", "10", "30", "60"] },
  local_alert_prompted: {},
  local_alert_allowed: {},
  local_alert_denied: {},
});

/**
 * Fire a funnel event at most once per profile, ever.
 *
 * Activation events must not repeat. `first_workout_completed` used to fire on
 * every logged workout, so the owner's own training kept it lit in every
 * window and it could never distinguish him from a stranger. The marker is
 * persisted, so it survives reloads, and profile-scoped, so a genuinely new
 * profile still registers.
 *
 * Storage failures fall through to firing the event: over-reporting once is
 * better than silently losing an activation.
 */
export function trackFunnelOnce(name, properties = {}) {
  if (!FUNNEL_EVENTS[name]) return false;
  let fired = [];
  try {
    fired = JSON.parse(localStorage.getItem(funnelKey()) || "[]");
  } catch {
    fired = [];
  }
  if (!Array.isArray(fired)) fired = [];
  if (fired.includes(name)) return false;

  const sent = trackFunnel(name, properties);
  if (!sent) return false;
  try {
    localStorage.setItem(funnelKey(), JSON.stringify([...fired, name]));
  } catch {
    /* storage full / disabled — the event still counted */
  }
  return true;
}

export function trackFunnel(name, properties = {}) {
  const schema = FUNNEL_EVENTS[name];
  if (!schema) return false;
  const segments = [];
  const routeSegments = [];
  for (const [key, allowed] of Object.entries(schema)) {
    const value = String(properties[key] ?? "");
    if (!allowed.includes(value)) continue;
    routeSegments.push(`[${key}]`);
    segments.push(value);
  }
  const route = ["", "funnel", name, ...routeSegments].join("/");
  const path = ["", "funnel", name, ...segments].join("/");
  try { window.va?.("pageview", { route, path }); } catch {}
  return true;
}
