/**
 * Entry point for zero-cost notification features:
 *   - one-time cleanup of retired Web Push local storage;
 *   - the plan-results "Add workouts to calendar" export dialog;
 *   - the Account "Workout alerts" local rest-timer control.
 *
 * No Web Push, no VAPID, no subscription, no server. See calendar-export.js and
 * workout-alerts.js.
 */
import { store } from "./store.js";
import { trackFunnel } from "./analytics.js";
import { initCalendarExport } from "./calendar-export.js";
import { initWorkoutAlertsUI, purgeLegacyNotificationStorage } from "./workout-alerts.js";

purgeLegacyNotificationStorage();

initCalendarExport({
  getPlan: () => store.plan,
  track: (name, props) => trackFunnel(name, props),
});

initWorkoutAlertsUI();
