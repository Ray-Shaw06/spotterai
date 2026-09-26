/**
 * Entry point for notification features:
 *   - one-time cleanup of retired Web Push local storage;
 *   - the plan-results "Add workouts to calendar" export dialog;
 *   - the Account "Workout alerts" rest-timer control (workout-alerts.js);
 *   - workout, meal and water reminders (reminders-sync.js).
 *
 * Both push features ride one device subscription and the free QStash tier;
 * see api/rest-push.js and api/reminders.js.
 */
import { store } from "./store.js";
import { trackFunnel } from "./analytics.js";
import { initCalendarExport } from "./calendar-export.js";
import { initWorkoutAlertsUI, purgeLegacyNotificationStorage } from "./workout-alerts.js";
import { getState, subscribe } from "./tracker-store.js";
import { initReminders } from "./reminders-sync.js";

purgeLegacyNotificationStorage();

initCalendarExport({
  getPlan: () => store.plan,
  track: (name, props) => trackFunnel(name, props),
});

initWorkoutAlertsUI();

initReminders({
  doc: document,
  getTracker: getState,
  getPlan: () => store.plan,
  onTrackerChange: subscribe,
});
