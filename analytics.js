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
  // The plan -> first workout fork. 11 of the 14 people who got a plan in the
  // 30 days to 2026-08-16 never trained once, and the funnel could not say
  // whether they bounced AT the plan or somewhere between the plan and the gym.
  // Those want opposite fixes, so these two events split them:
  //
  //   plan_scrolled_to_end  they read the plan to the bottom (activation-once)
  //   returned_with_plan    they opened the app again on a LATER day, with
  //                         `trained` saying whether they had ever logged one
  //
  // Read against first_workout_started, the three branches separate:
  //   no scroll                  -> the audit wall lost them before the plan
  //   scroll, no return          -> the plan itself did not bring them back
  //   return with trained=false  -> they came back and still did not start
  plan_scrolled_to_end: {},
  returned_with_plan: { trained: ["true", "false"] },
  // Ongoing volume. Fires every time, so the data first_workout_completed used
  // to carry (accidentally) is still collected, just under an honest name.
  workout_completed: { source: ["plan", "today", "dashboard", "unknown"] },
  // Plan import. `plan_imported` is the activation event for the no-account
  // entry point: someone pasted a plan from elsewhere and got a verdict without
  // ever seeing onboarding. failure_class mirrors the enum the endpoint returns
  // so the drop-off has a cause attached rather than one flat number.
  plan_imported: { has_progression: ["true", "false"] },
  plan_import_failed: {
    failure_class: ["empty", "too_short", "rate_limited", "timeout", "unavailable", "invalid_response", "not_a_plan", "offline", "unknown"],
  },
  import_flags_opened: {},
  // Photo food logging. `succeeded` and `failed` were the only two events, so a
  // photo the user opened and abandoned looked exactly like one they never
  // opened, and there was no way to tell which DOOR they came in by. `source`
  // is the whole point of the 2026-08-16 front-door work: photo logging
  // out-converted the entire plan funnel from four clicks down a nav menu, and
  // "landing" vs "picker" says whether a real entry point changes that.
  meal_photo_started: { source: ["landing", "nutrition", "picker"] },
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
