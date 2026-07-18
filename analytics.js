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
  first_workout_started: { source: ["plan", "today", "dashboard"] },
  first_workout_completed: { source: ["plan", "today", "dashboard", "unknown"] },
  meal_photo_succeeded: {},
  meal_photo_failed: { failure_class: ["offline", "timeout", "rate_limited", "unavailable", "invalid_response", "unknown"] },
  notification_offer_shown: { platform_group: ["ios_pwa", "android_pwa", "unsupported"] },
  notification_prompted: { platform_group: ["ios_pwa", "android_pwa"] },
  notification_allowed: { platform_group: ["ios_pwa", "android_pwa"] },
  notification_denied: { platform_group: ["ios_pwa", "android_pwa"] },
  notification_opened: { notification_category: ["workout", "follow_up", "streak", "recovery"] },
});

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
