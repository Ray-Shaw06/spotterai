# Release 3 worklog — zero-cost notifications + bench press form check

**Date:** 2026-07-22
**Scope:** Retire the (never-activated) remote Web Push path and replace it with
zero-cost, on-device reminders; add bench press to the real-time form check.
No secrets, personal data, or raw AI content in this file.

## 1. Web Push retired before activation

The scheduled Web Push feature was **committed but dormant** — production always
ran default-off and fail-closed, with no billing account, VAPID secrets, or
scheduled function ever enabled. Because it never activated, **there is no server
subscription data to migrate or delete**. This change removes the whole path
rather than waking it.

Removed (code + config):

- `api/notifications.js`; `lib/notification-validation.js`,
  `lib/notification-store.js`, `lib/notification-auth.js`, `lib/firebase-admin.js`
- `functions/` (Firebase scheduled dispatcher + deps) and its Firebase config
- `notification-client.js`, `notification-ui.js`, `notification-guidance.js`,
  `notifications.js`
- Service worker `push` listener; notification Firestore collections + index;
  `NOTIFICATION_*` / `WEB_PUSH_*` env vars; `web-push`; root `firebase-admin` dep
- Every `notification-*` test file

Replaced with (zero-cost, no operator setup):

- **`calendar-export.js`** — in-browser `.ics` export of training days as
  weekly-recurring events with an optional native reminder (none/10/30/60 min).
  Pure generation functions (escaping, line folding, RRULE, VALARM, stable
  local UIDs); the user's calendar app owns reminders after import.
- **`workout-alerts.js`** — local rest-timer notification shown by the existing
  service worker on rest-timer completion, gated on an explicit per-device opt-in
  and granted permission. One-time cleanup of legacy `spotterai.notifications.*`
  local-storage keys. No subscription, no VAPID, no server, and **no promise of
  any notification after the app is closed** — vibration/sound/on-screen timer are
  the universal fallback.
- Service worker: `push` listener removed; `notificationclick` routes to a
  **fixed** same-origin `/#/today` (never a payload URL); cache bumped v40 → v41.
- Firestore now stores only owner-scoped `/users/{uid}` sync; the emulator gate
  (`integration/firebase-emulator.mjs`) was rewritten to prove ownership +
  deny-all with `@firebase/rules-unit-testing`.

## 2. Bench press form check

Bench press was deferred in Release 2 ("lying posture defeats the camera
heuristics"). It is a **supported horizontal press**, so it uses the same
elbow-driven pattern as the push-up, filmed side-on at bench height on the
pressing arm. Reliability is gated on the arm joints only (shoulder/elbow/wrist),
so a bench cutting off the legs is fine.

- Rep: elbow flexion, `DOWN: 120 / UP: 155 / MIN_RANGE: 35`.
- Depth: `GOOD_DEPTH 90` (bar to chest) / `SHALLOW_DEPTH 110`. `DOWN` sits above
  `SHALLOW_DEPTH` so a too-shallow rep still counts, then gets flagged.
- Cues: "Full lockout" at the top; "Good depth — bar to chest" vs "Lower the bar
  to your chest" at the bottom.
- **Honest limit** (stated in the camera tips): a single 2D side camera reads
  elbow depth and lockout but CANNOT judge elbow flare or left/right bar-path
  symmetry, so we do not pretend to cue them.

## Verification

- `node --test`: **303/303 pass**, 0 fail (new unit suites for calendar export,
  workout alerts, and bench press rep counting/depth/cues/reliability).
- `git diff --check`: clean.
- Browser (local static server): no console errors on load; Account → Workout
  alerts renders with the correct capability-aware status; the `.ics` builder
  produces 2 weekly events + VALARM + escaped fields with rest days excluded; the
  bench rep counter counts a clean press and reports "Bar to chest" depth — all
  verified in-page.

## Deferred (owner gates, not open work)

- Real-device checks: import the exported `.ics` on an owner phone; confirm the
  installed-PWA rest-timer alert on one supported phone (lack of background
  delivery after app closure is expected behavior, not a defect).
- Independent review + exact-commit production promotion approval.
