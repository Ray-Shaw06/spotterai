# SpotterAI Release 1 Design

Date: 2026-07-17
Status: Approved by owner on 2026-07-17
Production baseline: `1b94973` (`origin/main`)
Deployment: Existing Vercel project

## Purpose

Release 1 turns the current public beta into a dependable first-launch product without replacing SpotterAI's static web architecture, Vercel deployment, Firebase sync, AI endpoints, PWA, or existing test suite. The release makes onboarding unambiguous, improves the path from plan generation to a first workout, adds privacy-conscious product analytics, gives AI failures useful recovery states, and introduces native-style scheduled Web Push for installed iPhone and Android users.

Release 1 is complete only when every acceptance criterion in this document has verifiable evidence in the release worklog.

## Product principles

- Keep all current consumer features free.
- Preserve health and training safety checks; notification copy must never pressure users to ignore pain, injury, or recovery needs.
- Ask for the minimum data required for each feature.
- Do not require Google sign-in to receive notifications.
- Prefer an honest limitation over a misleading claim or fragile workaround.
- Keep the current architecture and Vercel deployment.
- Treat installability, offline behavior, accessibility, and mobile layouts as release requirements rather than optional polish.

## Scope

Release 1 includes:

1. Clear metric and imperial height and weight inputs during onboarding.
2. A single, obvious action from a generated plan into the existing workout flow.
3. Critical-funnel events through the existing Vercel Analytics integration.
4. Actionable retry and fallback states for user-facing AI operations.
5. Standards-based Web Push for installed iPhone and Android PWAs, with a plan-prefilled schedule that the user confirms or edits.
6. Independent agent review, regression verification, and a version-controlled release worklog.

Release 1 does not include:

- A framework, hosting, database, authentication, or AI-provider migration.
- Native App Store or Play Store applications.
- Guaranteed background workout timers or iOS Live Activities.
- Persistent in-session rest alerts while the PWA is suspended.
- Paid consumer features, subscriptions, or advertising.
- A redesign of the plan generator, safety audit, nutrition logic, or workout tracker.
- Storing health-profile data solely to send notifications.

Best-effort in-session alerts, persistent timers, screen-wake behavior, richer Today views, and weekly reviews are deferred to Release 2.

## Experience design

### Onboarding measurements

The unit selector uses the labels **Metric** and **Imperial**.

Metric mode shows:

- Height: one numeric field with a visible `cm` suffix.
- Weight: one numeric field with a visible `kg` suffix.

Imperial mode shows:

- Height: separate numeric fields with visible `ft` and `in` suffixes.
- Weight: one numeric field with a visible `lb` suffix.

All fields use suitable mobile numeric keyboards and complete accessible labels such as “Height in feet.” Inches accept values from 0 through 11. Invalid or implausible values produce gentle inline guidance and do not silently corrupt later calculations. Measurements remain optional, and the user can continue without them.

Switching systems converts existing valid values in both directions instead of clearing or merely relabeling them. Conversion is stable enough that switching to the other system and back does not cause material drift. Weight is normalized to kilograms before the existing nutrition-target calculation. Height remains optional and is not represented as affecting calculations that do not use it; Release 1 does not expand height into plan prompting or permanent health-profile storage.

### First-workout activation

After successful plan generation, or after the existing safe sample fallback is shown, the primary next action is **Start my first workout**. It opens the existing workout experience with the generated plan available through the same state path already used by the application. It must not bypass plan validation, the deterministic safety audit, fallback disclosure, or existing persistence behavior.

The action is prominent once, not duplicated in competing sections, and remains usable on narrow mobile layouts and with keyboard navigation.

### AI recovery states

User-facing AI operations distinguish at least these recoverable conditions when the application can identify them safely:

- Offline or connection unavailable.
- Request timeout or temporary service problem.
- Rate limit or provider unavailability that caused a safe fallback.
- Terminal failure when neither a result nor fallback is available.

Messages use plain language, never expose provider responses, secrets, stack traces, prompts, or raw user content, and never suggest that an AI output is a medical guarantee. Where retrying is meaningful, one clear retry action preserves the user's prior form values or selected photo in memory when browser capabilities allow it. Existing safe plan and meal fallbacks remain intact and are labeled honestly.

### Notification onboarding and controls

Notifications are offered only after the first plan is created. The application first explains the benefit and shows the proposed schedule; the browser permission prompt appears only after the user deliberately taps **Enable notifications**. Denial does not block any SpotterAI feature.

The proposed schedule is derived from the plan's selected training days when possible and otherwise uses a sensible editable default. Before subscribing, the user can confirm or change reminder days and local times. Default quiet hours are 10:00 PM through 8:00 AM in the user's time zone.

Release 1 notification categories are:

- Planned workout reminder.
- Optional follow-up when the planned workout is still unlogged.
- Streak-protection reminder when a streak is genuinely at risk.
- Next-morning recovery check-in after a completed workout.

Users can enable or disable each category, edit the schedule and quiet hours, pause all notifications, and delete the device subscription. SpotterAI sends no more than two notifications per device per local calendar day. Copy is gentle, specific, and non-shaming. Notification taps open the relevant Today or workout destination.

Official Release 1 support is limited to installed iPhone Home Screen PWAs and installed Android PWAs with Web Push support. Unsupported browsers receive clear instructions rather than a broken permission flow.

## Notification architecture

### Chosen approach

Use standards-based Web Push through `PushManager`, not the Firebase Cloud Messaging browser SDK. Store minimal scheduling records in Firestore and dispatch due notifications from a Firebase scheduled Cloud Function approximately every five minutes. Keep the existing Vercel deployment for the website and API routes.

Vercel Hobby cron is not used because its daily, imprecise scheduling is unsuitable for user-selected reminder times. Firebase scheduled functions require a Blaze-linked Firebase project; enabling billing is an explicit owner action and is not authorized by this design approval alone.

### Components

1. The existing service worker handles `push` and `notificationclick` events while preserving current caching and offline behavior.
2. The installed client creates or restores an anonymous per-device identifier and obtains a signed, opaque device token from a Vercel API route.
3. Vercel API routes validate and store subscription, preference, and minimal activity updates using Firebase Admin credentials held only in server-side environment variables.
4. A Firebase scheduled function queries due enabled records, applies quiet hours and daily caps, sends standards-based Web Push using VAPID credentials, advances the next eligible timestamp atomically, and removes endpoints that return HTTP 404 or 410.
5. The client records notification opens using a privacy-safe analytics event and routes the user to the intended in-app destination.

### Minimal notification record

Each anonymous device record may contain only what the notification system needs:

- Random device identifier or its one-way representation.
- Push endpoint and browser-provided encryption keys.
- Time zone and confirmed schedule.
- Quiet hours and category preferences.
- Last workout completion date.
- Next eligible notification timestamp and category.
- Daily delivery count/date and operational timestamps.
- Revocation or paused state.

The notification record must not contain body weight, height, nutrition, injuries, workout contents, photographs, AI conversations, provider prompts, email addresses, or names. Firestore rules deny direct client access to this server-managed collection. Logs and analytics must not contain the endpoint, encryption keys, signed device token, or health inputs.

### Security and reliability

- VAPID private keys and Firebase Admin credentials are secrets and are never committed.
- Device tokens are signed, expire or rotate, and authorize access only to their own record.
- Request bodies have strict schemas and size limits.
- Schedule updates and dispatch are idempotent.
- Concurrent dispatcher runs cannot double-send the same due notification.
- The dispatcher records only operational failure classes, not sensitive payload data.
- Expired subscriptions are deleted after push services return 404 or 410.
- Deleting a subscription removes the server record and attempts a local `unsubscribe()`.
- Time-zone and daylight-saving changes recalculate future delivery times without violating quiet hours or daily caps.

### Billing and secret gate

Implementation may prepare and test the notification feature locally, but production dispatch cannot be declared complete until the owner has explicitly approved and completed Firebase Blaze billing and configured the required production secrets. The worklog must record the gate without recording secret values.

## Analytics design

Use the existing Vercel Analytics integration. Track only product actions and coarse outcomes:

- `landing_cta_clicked`
- `onboarding_started`
- `onboarding_completed`
- `plan_generation_succeeded`
- `plan_generation_failed`
- `plan_fallback_shown`
- `first_workout_started`
- `first_workout_completed`
- `meal_photo_succeeded`
- `meal_photo_failed`
- `notification_offer_shown`
- `notification_prompted`
- `notification_allowed`
- `notification_denied`
- `notification_opened`

Allowed properties are small enums needed to understand the funnel, such as `source`, `failure_class`, `fallback_used`, `platform_group`, or `notification_category`. Events must never include measurements, goals entered as free text, injury data, food descriptions or images, workout content, AI output, account identifiers, push endpoints, or raw errors.

Event helpers should fail silently if analytics is unavailable and must never interrupt the core workout, plan, meal, or notification flow. Event names and allowed properties are centralized so later changes cannot casually introduce sensitive payloads.

## Accessibility and mobile quality

- New controls have visible focus, programmatic labels, logical tab order, and adequate touch targets.
- Status and error changes are announced without repeatedly interrupting screen-reader users.
- Color is never the sole error or status signal.
- Measurement rows, recovery states, notification controls, and the first-workout action are checked at representative narrow and wide viewports.
- Installed standalone mode uses the existing branded icons, theme color, safe-area handling, and service-worker update behavior.

## Verification strategy

Implementation follows test-first changes where practical and preserves every existing test. Required automated coverage includes:

- Metric and imperial input rendering and validation.
- Both-direction measurement conversion and rounding stability.
- Saved onboarding progress and nutrition weight compatibility.
- First-workout action routing and plan/fallback preservation.
- Analytics event names, property allow-listing, and non-blocking failure behavior.
- AI error classification, retry behavior, preserved input, and fallback disclosure.
- Push capability detection, permission-state handling, subscription creation/update/delete, preference validation, and unsupported-platform messaging.
- Dispatcher due-time calculation, quiet hours, daylight-saving behavior, daily cap, category controls, idempotency, concurrency, recovery check-ins, follow-ups, and expired endpoint cleanup.
- Service-worker push display, click routing, and preservation of cache/offline behavior.

Release verification also includes:

- Full existing automated test suite.
- Production build or equivalent static validation.
- Browser smoke tests for the landing-to-plan-to-first-workout path.
- Installed-PWA checks on an iPhone and Android device for permission, background receipt, tap routing, preference changes, and unsubscribe.
- Vercel preview verification before production promotion.
- Firebase function emulator or controlled test-project verification before production scheduling is enabled.

Tests must use fake push services, clocks, and Firebase emulators where possible; automated tests must not send real notifications to arbitrary endpoints.

## Agent workflow and evidence

Release work occurs on a clean `codex/` branch and isolated worktree based on production baseline `1b94973`, so unrelated local work cannot enter the release. The orchestrating agent breaks the approved implementation plan into bounded tasks. Implementation agents may write code only within that plan. Independent review agents inspect correctness, privacy, accessibility, regressions, and scope. A verifier reruns release gates from the final combined state.

Agents do not approve work by majority vote. A task is accepted only when its objective acceptance criteria and tests pass, review findings are resolved or explicitly rejected with evidence, and the result is documented. Material architecture changes, new billing, new private-data collection, destructive actions, and public deployment still require the owner's explicit authorization.

`docs/release-1-worklog.md` is the source of truth for:

- Scope and status by release gate.
- Decisions and rejected alternatives.
- Agent assignments and independent review results.
- Files and commits changed.
- Commands or manual checks used as evidence.
- Deployment identifiers and production checks.
- Blockers, owner approvals, and remaining work.

The worklog never stores secrets, push endpoints, personal data, or submitted health information.

## Rollout

1. Establish a clean release branch from the production baseline and retain the approved spec and worklog.
2. Implement each scope area behind safe capability checks; notification UI remains unavailable or clearly marked until its server configuration is ready.
3. Verify the combined release on a Vercel preview and Firebase emulator or controlled test project.
4. Obtain the owner's explicit approval for Firebase Blaze billing and production secret configuration before deploying the scheduled dispatcher.
5. Run real-device installed-PWA notification tests with owner-controlled test devices.
6. Promote only after automated tests, independent reviews, preview checks, and the release checklist pass.
7. Monitor privacy-safe funnel and notification operational outcomes; retain an immediate server-side pause path for notification dispatch.

## Release 1 acceptance criteria

Release 1 is ready only when:

- Metric and imperial onboarding are unambiguous, accessible, optional, validated, and conversion-tested.
- Existing nutrition weight behavior remains correct.
- A generated or fallback plan has one clear path into the existing first workout.
- Every specified funnel event fires at the correct boundary without sensitive properties and without blocking the product.
- AI failures show an accurate recovery or fallback state with a useful retry where possible.
- An installed supported PWA can subscribe without an account, receive scheduled background notifications within the declared scheduling tolerance, open the correct destination, edit preferences, pause, and unsubscribe.
- Quiet hours, category controls, two-per-day cap, time zones, idempotency, and expired-subscription cleanup are verified.
- The PWA remains installable, branded, responsive, accessible, and usable offline to the same degree as the production baseline.
- All existing and new automated tests pass from the final release state.
- Independent reviewers report no unresolved release-blocking finding.
- The Vercel preview and production deployment are verified and recorded.
- The release worklog contains evidence for every gate and lists no unresolved blocker.
