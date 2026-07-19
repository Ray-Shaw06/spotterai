# SpotterAI Zero-Cost Notifications Design

**Date:** 2026-07-19  
**Status:** Approved in conversation; awaiting written-spec review  
**Supersedes:** The dormant scheduled Web Push rollout in the Release 1 design. Historical Release 1 records remain intact, but this document is authoritative for the product's notification direction.

## Objective

Preserve useful notifications without requiring SpotterAI's owner to attach a billing account, deploy a scheduler, store push subscriptions, or operate notification infrastructure.

The shipped experience combines:

1. Native calendar reminders for planned workouts, created on the user's device and managed by the user's calendar application.
2. Local active-workout alerts for rest-timer completion, shown only when the installed or browser PWA is still running and the browser supports notifications.
3. Existing in-app vibration, sound, and visual timer feedback as the universal fallback.

This is not branded remote Web Push. SpotterAI must not claim that it can wake a closed app or send background push notifications.

## Product Boundaries

### Retained

- Installable branded PWA behavior, manifest, Home Screen icons, offline shell, and service worker.
- Firebase Authentication and existing owner-scoped Firestore user sync.
- AI endpoints, model fallback behavior, analytics, onboarding, plan generation, workout logging, nutrition, progress, and form checking.
- A user-controlled notification permission flow for local active-workout alerts.
- Notification-click routing from a rest-timer alert back to the active workout/Today surface.

### Removed

- User-selected server notification schedules, quiet hours, categories, pause state, and anonymous device subscription records.
- PushManager subscriptions and VAPID keys.
- `/api/notifications` and its authentication, validation, and Firestore storage layers.
- Firebase scheduled notification functions, dispatcher, notification-specific rules/indexes, secrets, and the `web-push` dependency.
- Vercel notification environment variables, notification WAF requirements, and notification function duration configuration.
- Workout-completion synchronization to the notification backend.
- Funnel events that describe Web Push offers, subscriptions, delivery, or opens.
- UI copy that promises background or scheduled SpotterAI notifications.

Historical implementation plans and worklogs are not erased. They receive a dated superseding decision so the repository remains auditable.

## User Experience

### Plan calendar export

After a plan is generated or loaded from fallback, the results expose a secondary action: **Add workouts to calendar**.

Selecting it opens a compact on-device dialog with:

- the plan's training days preselected;
- a user-selected start date;
- one local start time applied to exported workouts;
- a reminder choice of none, 10 minutes, 30 minutes, or 60 minutes before;
- an explicit **Download calendar file** action.

SpotterAI creates an `.ics` file entirely in the browser. Each training day becomes a weekly recurring calendar event. Event descriptions may contain the workout title and exercise names, sets, and reps already visible in the plan. They must not contain injuries, measurements, health notes, account identifiers, AI prompts/responses, or hidden safety data.

The interface explains that the user's Calendar app owns future reminders and edits after import. SpotterAI does not receive confirmation that an event was imported and does not store calendar selections beyond the current dialog.

If the browser cannot download a file, the app shows recovery copy and leaves the dialog editable so the user can retry.

### Active-workout alerts

Account replaces the dormant schedule editor with a small **Workout alerts** section:

- **Enable rest-timer alerts** requests notification permission only after a deliberate user tap.
- The preference is stored locally on the current device only.
- If permission is denied, the app explains how to change device settings and continues using vibration, sound, and the on-screen timer.
- If notifications are unsupported, the toggle is unavailable and the fallback behavior is stated plainly.
- Users can disable alerts locally without a network request.

When a rest timer reaches zero, SpotterAI:

1. updates the existing visual timer;
2. attempts vibration and sound as it does today;
3. when the local preference is enabled and notification permission is granted, calls the current service-worker registration's `showNotification()` with branded, bounded copy and a same-origin route back to the workout/Today surface.

No alert is promised after the app has been fully closed, suspended, or evicted. If notification display fails, the workout continues normally and the visual/audio fallback remains available.

## Architecture

### Calendar module

A focused browser-only module owns calendar behavior:

- normalize a published plan into training-day calendar events;
- validate start date, time, and reminder selection;
- escape iCalendar text and fold long content lines;
- generate a standards-compliant calendar string with stable local-only UIDs;
- create and revoke the download object URL;
- render and control the export dialog.

The pure generation functions have no DOM, storage, Firebase, analytics, or network dependency. The UI wrapper depends only on the generated/published plan event already used by the results view.

### Local alert module

A separate browser-only module owns:

- capability and installed-context guidance;
- the explicit notification permission request;
- the local `enabled` preference;
- safe calls to `ServiceWorkerRegistration.showNotification()`;
- typed, user-safe results for unsupported, denied, enabled, disabled, and display-failed states.

The workout module invokes one exported function when the existing rest timer completes. It never imports Firebase, PushManager, VAPID, scheduling, or remote storage code.

### Service worker

The service worker keeps offline caching and notification-click routing, but removes the `push` event listener. Its cache version is incremented so existing installed users receive the deletion and new local-alert modules atomically. The click handler accepts only a fixed same-origin destination created by SpotterAI, never a payload-provided URL.

### Firebase and hosting

`firebase.json` retains only Firestore rules/index configuration and the local emulator needed for user-sync verification. `firestore.rules` retains the authenticated `/users/{uid}` rule plus the deny-all fallback. The notification collections and notification composite index are removed. The `functions/` notification package and notification-only Vercel API configuration are deleted.

The root `firebase-admin` dependency is removed if no remaining production file imports it after the notification API deletion. Firebase browser SDK development dependencies remain because existing sync and rules tests use them.

## Privacy and Cost Guarantees

- Calendar generation is local; no calendar data leaves the device.
- Local alert preferences remain in local storage on the current device.
- No push endpoint, device identifier, schedule, calendar selection, or reminder preference is stored in Firebase or Vercel.
- No Cloud Function, Cloud Scheduler job, Secret Manager secret, remote push service, or notification database is required.
- No notification feature requires Firebase Blaze.
- Calendar export and local alerts make no AI calls.
- Existing third-party free-tier usage for unrelated AI, hosting, analytics, and Firebase sync remains outside this feature's cost guarantee and is documented separately.

## Analytics

Analytics remains privacy-safe and uses the current allow-listed Vercel virtual pageview transport.

Allowed events are limited to:

- `calendar_export_opened`;
- `calendar_export_downloaded` with only an allow-listed reminder bucket;
- `local_alert_prompted`;
- `local_alert_allowed`;
- `local_alert_denied`.

Calendar dates, times, plan contents, workout names, exercise names, device details, and notification text never enter analytics.

## Error Handling

- Invalid calendar input blocks download with a field-level message.
- Calendar serialization or download failure produces generic retry copy without exposing browser internals.
- Permission denial is treated as a stable user choice, not an application failure.
- Service-worker readiness or notification display failure is non-fatal; vibration, sound, and visual feedback remain.
- Missing or malformed saved local preference fails closed to disabled.
- Removing legacy notification local-storage credentials is a one-time local cleanup and never performs a network request.

## Migration and Repository Cleanup

- On first load after deployment, delete only the legacy `spotterai.notifications.*` local-storage keys. Do not touch workout, nutrition, onboarding, profile, plan, or Firebase-sync data.
- Remove notification-only source files and tests after replacement tests fail first and the new behavior passes.
- Remove notification modules from the offline precache and add the new local modules.
- Update README setup, architecture, privacy, PWA, notification, and cost sections.
- Add a dated worklog entry explaining that the paid notification path was retired before activation; production had always remained default-off, so there is no server subscription data to migrate.
- Keep historical design/plan/worklog text for traceability and add clear superseding pointers instead of rewriting history.

## Testing Strategy

### Test-first replacement gates

1. Add failing repository-boundary tests that reject notification API, VAPID, PushManager, scheduled functions, notification collections/indexes, notification environment variables, and `web-push` dependencies.
2. Add failing calendar-generation tests for recurrence, escaping, line folding, reminders, stable bounded fields, privacy exclusions, and invalid input.
3. Add failing local-alert tests for explicit permission, local enable/disable, safe notification payload, same-origin click route, denial, unsupported browsers, display failure, and legacy-key cleanup.
4. Add failing UI/copy/accessibility tests for the calendar dialog and Account alert controls.
5. Implement the smallest product changes that satisfy each gate, then remove obsolete notification tests alongside the implementation they covered.

### Final verification

- Full root test suite passes with zero failures or skips introduced by this change.
- Firestore emulator verifies existing `/users/{uid}` ownership and deny-all behavior without notification collections or functions.
- `git diff --check` passes.
- Production-like local browser verification covers 390×844 and desktop widths with no console errors or horizontal overflow.
- Calendar file is parsed by an independent iCalendar parser in tests and manually imported on at least one owner-controlled phone before production promotion.
- Installed-PWA rest-timer alert is tested on at least one owner-controlled supported phone; lack of background delivery after app closure is recorded as expected behavior, not a defect.
- An independent reviewer confirms there is no remaining billable notification path, misleading background-notification promise, or regression to PWA installation/offline behavior.

## Acceptance Criteria

The change is complete only when:

- users can export their training plan as valid recurring calendar events with an optional native calendar reminder;
- users can explicitly enable or disable local rest-timer alerts on the current device;
- visual, vibration, and audio rest-timer feedback remains available regardless of notification support;
- SpotterAI makes no promise of closed-app or scheduled branded push;
- no notification API, push subscription, VAPID secret, notification Firestore storage, scheduled function, WAF requirement, or `web-push` dependency remains in active product/configuration code;
- Firebase user sync, AI endpoints, analytics, PWA installation, branded icons, offline shell, and unrelated tests remain intact;
- documentation clearly distinguishes calendar reminders, active-workout alerts, and unavailable remote push;
- all automated, emulator, browser, and independent-review gates pass;
- the release is not promoted until the owner approves the exact verified commit.
