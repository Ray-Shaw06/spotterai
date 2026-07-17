# SpotterAI Release 1 Worklog

This document is the version-controlled source of truth for Release 1 progress, decisions, verification evidence, deployment state, blockers, and remaining work. It must not contain secrets, push endpoints, personal data, submitted health information, photographs, or raw AI content.

## Release baseline

| Item | Value |
| --- | --- |
| Production baseline | `1b94973` (`origin/main`) |
| Existing deployment | Vercel |
| Existing sync | Firebase Auth and Firestore |
| Release branch | `codex/release-1`, created from the approved Release 1 baseline |
| Design | `docs/superpowers/specs/2026-07-17-release-1-design.md` |
| Implementation plan | `docs/superpowers/plans/2026-07-17-release-1.md` |
| Current phase | Tasks 1–5 implemented; Task 5 review fixes complete and independent re-review pending; remaining Release 1 tasks/final integration verification pending |

## Gate status

| Gate | Status | Evidence or next action |
| --- | --- | --- |
| Product scope approved in conversation | Complete | Scope and constraints captured in the Release 1 design |
| Written design approved | Complete | Owner approved the written specification on 2026-07-17 |
| Implementation plan approved | Complete | Plan derives directly from the approved design and the owner selected autonomous agent execution |
| Clean release worktree | Complete | Release work proceeds on isolated `codex/release-1`; unrelated local work is excluded |
| Measurements and conversions | Complete | Task 1 committed: metric/imperial onboarding conversions, validation, and accessibility checks |
| First-workout activation | Complete | Task 2 committed: plan day-one action and bounded activation funnel behavior |
| Funnel analytics | Complete | Task 2 committed: privacy-safe allow-listed Vercel virtual pageviews |
| AI retry and recovery states | Complete | Task 3 committed: bounded client timeouts, safe recovery copy, saved-plan retry, and in-memory photo retry |
| Web Push client and preferences | In progress | Task 4 defines and tests the pure, privacy-safe schedule and preference domain; client controls remain pending |
| Notification API and dispatcher | In progress | Task 5 review fixes add default-off readiness, same-origin/raw-body controls, durable registration cap, and endpoint dedup; dispatcher and Firestore rules remain Task 6 |
| Independent reviews resolved | In progress | Per-task reviews for Tasks 1–4 are resolved; Task 5 re-review and final integration review remain pending |
| Full automated verification | Pending | Run from final combined state |
| iPhone and Android installed-PWA checks | Pending | Requires owner-controlled physical devices |
| Vercel preview verification | Pending | Deploy after implementation gates pass |
| Production notification configuration | Blocked by owner gate | Requires explicit approval of Firebase Blaze billing and production secrets |
| Production promotion and smoke test | Pending | Requires all prior release gates |

## Decisions

| Date | Decision | Reason |
| --- | --- | --- |
| 2026-07-17 | Keep the current static application, Vercel hosting, Firebase sync, PWA, AI endpoints, and tests. | Release 1 improves the current product without migration risk. |
| 2026-07-17 | Support installed iPhone and Android PWAs with standards-based Web Push. | This gives native-style background notifications while retaining the website/PWA model. |
| 2026-07-17 | Use Firestore plus a Firebase scheduled Cloud Function for notification dispatch. | User-selected reminder times need more frequent and predictable scheduling than Vercel Hobby cron provides. |
| 2026-07-17 | Use an anonymous per-device subscription and minimal operational data. | Notifications must work without Google sign-in and without creating a new health-data store. |
| 2026-07-17 | Ask for notification permission only after plan creation and a deliberate enable action. | This keeps permission contextual and user-controlled. |
| 2026-07-17 | Prefill reminder days from the plan, then require confirmation or editing. | The schedule is useful immediately but remains under user control. |
| 2026-07-17 | Default quiet hours to 10:00 PM–8:00 AM and cap at two notifications per day. | Notifications should be useful without becoming intrusive. |
| 2026-07-17 | Label onboarding systems Metric and Imperial; use cm/kg and ft/in/lb inputs. | Users should never have to infer a measurement unit. |
| 2026-07-17 | Keep height optional and do not claim it affects calculations that do not use it. | The current plan and nutrition paths do not use height. |
| 2026-07-17 | Keep consumer features free in Release 1. | Monetization experiments are not allowed to weaken the core user experience. |
| 2026-07-17 | Represent critical funnel actions as sanitized manual Vercel pageviews under `/funnel/<event>`. | Official Vercel documentation currently limits custom events to Pro/Enterprise, while manual pageviews remain compatible with Hobby and require no new analytics provider. |

## Rejected or deferred alternatives

| Alternative | Outcome | Reason |
| --- | --- | --- |
| Firebase Cloud Messaging browser SDK for all supported devices | Rejected | Standards-based Web Push provides the intended installed-iPhone path without relying on an unsupported assumption. |
| Vercel Hobby cron as the reminder dispatcher | Rejected | Daily, imprecise invocation cannot honor user-selected times. |
| Request notification permission on first visit | Rejected | It lacks context and is likely to reduce trust and opt-in quality. |
| Store full plans or health profiles for notification targeting | Rejected | The Release 1 notification use cases need only schedule and minimal activity state. |
| Guaranteed iOS Live Activities or background rest timers | Deferred to native-app investigation | Web PWAs cannot promise native background execution semantics. |
| Paid consumer features | Deferred | Release 1 keeps the complete consumer product free. |

## Chronological log

### 2026-07-17 — Release definition and design

- Role: Product orchestrator.
- Work: Audited the current architecture and converted the approved Release 1 decisions into a written design.
- Result: Defined measurement UX, first-workout activation, analytics taxonomy, AI recovery states, notification architecture, privacy boundaries, tests, rollout, and release gates.
- Evidence: `docs/superpowers/specs/2026-07-17-release-1-design.md`.
- Production baseline: `1b94973`.
- Implementation status: No Release 1 product code changed during this phase.
- Safety: Unrelated local Paddington commits and the untracked `output/` directory are outside Release 1 and must not be included in its branch or deployment.
- Owner gate: Written design review is required before the implementation plan and agent execution begin.
- External dependency: Production scheduled notifications require owner-approved Firebase Blaze billing and server-side secrets. Neither is authorized or configured by this entry.

### 2026-07-17 — Written design approval and implementation plan

- Role: Product orchestrator.
- Owner decision: Approved the written Release 1 design.
- Work: Mapped the approved design into eight testable implementation tasks with a fresh implementation agent and independent reviewer gates for each task.
- Result: `docs/superpowers/plans/2026-07-17-release-1.md` defines exact files, interfaces, tests, commits, privacy boundaries, preview checks, billing/secret gates, real-device checks, and production sign-off.
- Evidence: Current codebase inspection, existing tests and interfaces, and official Vercel analytics documentation current on 2026-07-17.
- Compatibility decision: Use manual Vercel funnel pageviews because Vercel Hobby supports pageviews but not custom events; no new analytics vendor or user identifier is introduced.
- Safety: Implementation will start from production baseline `1b94973` in an isolated worktree and will cherry-pick only Release 1 documentation.
- External gate unchanged: No Firebase Blaze billing, production secrets, Firebase deployment, preview deployment, or production promotion has been authorized by this entry.

### 2026-07-17 — Task 1: metric and imperial onboarding measurements

- Role: Implementation agent.
- Bounded task: Add metric/imperial onboarding measurement conversion, validation, and accessible unit-specific inputs while preserving the `spotterai_onboarding` saved-data key, legacy `units: "kg" | "lb"`, and kilogram nutrition inputs.
- Result: Added `measurements.js` with the specified conversion constants and pure interfaces. Metric uses cm/kg; imperial uses ft/in/lb. Height and weight remain optional, but any supplied value must be in the declared range. Nutrition receives kilograms in both systems.
- Conversion boundaries: metric height is 100–250 cm and weight is 30–350 kg; imperial total height is 3 ft 3 in–8 ft 2 in, inches are 0–11, and weight is 66–772 lb. Switching converts 178 cm/75 kg to 5 ft 10 in/~165.3 lb and back within the tested rounding tolerance.
- Accessibility: measurement inputs have explicit aria-labels, decimal/numeric input modes, live `aria-invalid` state, and error text via `aria-describedby`; visible unit labels are cm, kg, ft, in, and lb. Invalid optional values disable both Next and Skip so they cannot seed nutrition targets.
- Files: `measurements.js`, `onboarding.js`, `onboarding-ui.js`, `style.css`, `test/measurements.test.js`, `test/onboarding.test.js`, `test/ui-copy.test.js`.
- TDD evidence: initial `node --test test/measurements.test.js test/onboarding.test.js` failed with expected `ERR_MODULE_NOT_FOUND` for `measurements.js`; regression test for invalid-value Skip behavior then failed before its UI guard was added. Both GREEN runs passed.
- Verification: `node --test test/measurements.test.js test/onboarding.test.js test/ui-copy.test.js` — 22/22 passed. `npm test` — 204/204 passed.
- Independent review: found a P1 Skip bypass for invalid optional values and a missing worklog entry. Resolved P1 by disabling Skip whenever `canAdvance()` is false and added a regression test; this entry resolves the documentation finding. No outstanding review findings.
- Commit: `feat: clarify onboarding measurements`.

### 2026-07-17 — Task 2: Hobby-compatible funnel analytics and first-workout activation

- Role: Implementation agent.
- Bounded task and acceptance criteria: Add privacy-safe activation-funnel analytics compatible with Vercel Hobby, make the plan's first workout immediately actionable, and preserve existing Today and Dashboard quick-start behavior.
- Result: Added `analytics.js` with an immutable allow-list schema and `trackFunnel(name, properties?)`. It uses only sanitized manual virtual pageviews (`window.va("pageview", { route, path })`): no user IDs, intake values, prompts, measurements, photos, health notes, or arbitrary properties can become telemetry. The plan results now have one primary "Start my first workout" action for day one. Workout sessions retain an in-memory source, record their start once, and record completion only after `addWorkout` returns a workout.
- Outcome boundaries: Generation records success only after a plan is published and rendered, records a fallback only after its saved plan is displayed, and records failure only after both live generation and fallback are unavailable. Onboarding, landing CTAs, and meal-photo result paths are instrumented without intake or image data.
- Compatibility decision: Sanitized virtual pageviews were selected because current official Vercel documentation limits custom events to Pro/Enterprise while pageviews remain available on Hobby. The existing first-party Vercel Analytics loader remains unchanged.
- Files: `analytics.js`, `index.html`, `app.js`, `onboarding-ui.js`, `workout-ui.js`, `nutrition-ui.js`, `style.css`, `test/analytics.test.js`, `docs/release-1-worklog.md`.
- TDD evidence: `node --test test/analytics.test.js test/ui-copy.test.js test/ui-layout.test.js` initially failed as expected with `ERR_MODULE_NOT_FOUND` for `analytics.js`. Follow-up RED/GREEN tests independently proved nested schema mutation was blocked, editing a historical workout does not emit an activation start, and a null generation response is classified as `invalid_response`.
- Verification: `node --test test/analytics.test.js test/ui-copy.test.js test/ui-layout.test.js test/today.test.js` passed 34/34. `npm test` passed 210/210. `git diff --check` passed with no whitespace errors.
- Independent review: Found and resolved two important issues before commit: shallow freezing allowed runtime mutation of enum values, and historical workout edits emitted unpaired start events. Also hardened null JSON response classification. The final re-review approved the diff with no blockers; the remaining caveat is that lifecycle coverage is source-shape rather than browser interaction coverage.
- Commit: `feat: instrument the Release 1 activation funnel`.

### 2026-07-17 — Task 3: actionable AI timeout, fallback, and retry states

- Role: Implementation agent.
- Bounded task and acceptance criteria: Add client-side 65-second plan and 35-second nutrition/photo request deadlines; map failures only to the approved safe enum; preserve saved-plan audit and editable manual nutrition fallback; make plan and photo recovery actionable without exposing provider errors.
- Result: Added `ai-errors.js` with abort-signal composition, timeout translation, safe classification, and provider-neutral copy. Plan generation keeps `lastInputs`, renders/audits its saved-plan fallback, shows the classified safe reason, and offers “Try live generation again.” Food/manual entry remains editable. A failed meal photo retains only the current `File` object in page memory for “Try this photo again,” and clears it after success, replacement, or closing the detail. Stale photo requests cannot overwrite a newer selection.
- Boundaries preserved: No provider-routing, Gemini/Groq server, Firebase, notification, deployment, or user-data persistence changes. Funnel events retain only the existing classified `failure_class` enum.
- Files: `ai-errors.js`, `ai.js`, `app.js`, `index.html`, `nutrition-ui.js`, `style.css`, `test/ai-errors.test.js`, `test/ui-copy.test.js`, `docs/release-1-worklog.md`.
- TDD evidence: RED 1: `node --test test/ai-errors.test.js test/ui-copy.test.js` failed as expected with `ERR_MODULE_NOT_FOUND` for `ai-errors.js` (and the missing recovery UI assertion). GREEN 1: the required focused suite passed 31/31 after timeout/classification/retry wiring. RED 2: `node --test test/ai-errors.test.js` failed with “Missing expected rejection” for a string-shaped food response. GREEN 2: the same focused suite passed 32/32 after treating non-object estimate shapes as `invalid_response`.
- Verification: `node --test test/ai-errors.test.js test/ui-copy.test.js test/estimate.test.js test/gemini-groq.test.js` — 32/32 passed. `npm test` — 215/215 passed. `git diff --check` passed.
- Self-review: Verified external aborts remain `AbortError`, only the helper’s own timer becomes `TimeoutError`, all displayed recovery text is provider-neutral, fallback is still audited, and a superseded photo request cannot clear or replace the latest retry file.
- Commit: `feat: add recoverable AI failure states`.

### 2026-07-17 — Task 4: notification schedule and preference domain

- Role: Implementation agent.
- Bounded task and acceptance criteria: Add only the pure notification schedule preset, normalization, and validation interfaces. Use exact safe preference fields; validate IANA zones and `HH:mm` times; cap schedules at seven unique ISO weekdays; and retain no profile, plan, nutrition, measurement, injury, or free-text data.
- Result: Added a capability-independent `notifications.js` domain module. It prefills the specified two-to-six-day schedules with local 18:00 reminders, defaults quiet hours to 22:00–08:00, enables all four categories, and leaves notifications unpaused. Normalization returns a fresh allow-listed payload and removes all unknown nested and top-level data. Validation returns a normalized value plus field errors for malformed zones, schedules, quiet hours, categories, or pause state.
- Files: `notifications.js`, `test/notifications.test.js`, `docs/release-1-worklog.md`.
- TDD evidence: `node --test test/notifications.test.js` first failed with the expected `ERR_MODULE_NOT_FOUND` for `notifications.js`. After the minimal implementation, the same focused suite passed 7/7.
- Verification: `npm test` passed 224/224. `git diff --check` passed with no whitespace errors.
- Self-review: The module is pure and imports no platform/client code. Its output contains only timezone, schedule, quiet hours, the four boolean category controls, and paused state; it neither reads nor forwards health, profile, free-text, subscription, or endpoint data. No service worker, Firebase, API, deployment, or UI files changed.
- Initial commit: `b57a1b9` — `feat: define notification schedules and preferences`.
- Formal review findings: The reviewer blocked the initial implementation because `Intl.DateTimeFormat` accepts raw offset identifiers such as `+05:30` and `-04:00`, while this contract requires named IANA zones. The reviewer also required a stable invalid-zone fallback rather than the runtime local zone. Minor hardening identified prototype-supplied nested fields and explicit non-mutation/reference-isolation coverage.
- Resolution: `6c7aabe` — `fix: harden notification timezone validation` rejects raw positive and negative offset identifiers before platform zone validation, uses `UTC` for missing or invalid zones, requires own schedule/category/quiet-hour properties, and preserves fresh nested normalized output.
- Review-fix verification: `node --test test/notifications.test.js` passed 10/10; `npm test` passed 227/227; `git diff --check` passed.
- Re-review: Approved. No blocking findings remain for Task 4.
- Remaining scope: Notification client controls, anonymous API/storage, dispatcher, real-device verification, Firebase configuration, and deployment remain separate tasks and owner-gated where applicable.

### 2026-07-17 — Task 5: anonymous notification API and server-only Firestore adapter

- Role: Implementation agent.
- Bounded task and acceptance criteria: Add only the anonymous Vercel notification registration/update/delete API, HMAC per-device authorization, strict subscription/preference validation, lazy Firebase Admin initialization, and the fixed `notificationDevices` adapter. Client UI, service worker, dispatcher/functions, production deployment, billing, and real secrets remained out of scope.
- Result: Added a 32 KB, no-store, same-origin API with safe GET configuration; server-generated 32-byte device IDs; versioned HMAC-SHA256 tokens with 180-day expiry, five-minute future skew, minimum 32-character secrets, and timing-safe signature comparison; HTTPS Web Push validation; exact normalized preference storage; PATCH recalculation sentinels; per-device DELETE; and generic responses. Structured logs contain only route, method, request ID, status, duration, and safe failure class.
- Storage/privacy boundary: The API reconstructs records and patches from allow-listed values before the mock or Firestore adapter is called. Stored fields contain subscription encryption material, scheduling controls, the minimal completion date/scheduler state, and operational timestamps only—never profile, plan, measurements, nutrition, injuries, free text, or client-selected document IDs. Firebase Admin is initialized lazily from server-side JSON with escaped-newline normalization and existing-app reuse; no browser Firebase configuration is imported.
- Dependency decision: Declared `firebase-admin@^13.4.0`, resolving to `13.10.0`, whose installed package declares Node `>=18`, matching this repository. The dependency is server-only. `npm audit --omit=dev` reports eight moderate transitive findings through `uuid@9.0.1`; npm's only offered complete remediation is a forced breaking downgrade to `firebase-admin@10.3.0`, so no unsafe automated fix was applied.
- Files: `lib/firebase-admin.js`, `lib/notification-auth.js`, `lib/notification-validation.js`, `lib/notification-store.js`, `api/notifications.js`, `package.json`, `package-lock.json`, `.env.example`, `vercel.json`, `test/notification-auth.test.js`, `test/notification-api.test.js`, and `docs/release-1-worklog.md`.
- TDD evidence: Initial focused RED failed 0/2 at module load with the expected `ERR_MODULE_NOT_FOUND` for `lib/notification-auth.js`, both before and after dependency installation. The first implementation GREEN passed 21/21. A configuration test then failed 21/22 because npm had saved `^13.10.0` instead of the approved compatibility floor; after normalizing the manifest/configuration, GREEN passed 22/22. A further hardening RED failed 21/22 because a noncanonical P-256 key reached storage; canonical 65-byte uncompressed P-256 and 16-byte auth validation restored 22/22 GREEN.
- Verification: Focused `node --test test/notification-auth.test.js test/notification-api.test.js` passed 22/22. Full `npm test` passed 249/249. Module syntax checks and `git diff --check` passed. Dependency tree inspection confirmed `firebase-admin@13.10.0` with the audited `uuid@9.0.1` transitive path.
- Security/privacy self-review: No authentication bypass was found; PATCH/DELETE derive the record only from a verified bearer token, so body overposting cannot select another device. Validators rebuild exact stored shapes. GET exposes only the public VAPID key. Client responses and logs exclude secrets, endpoint/key/token/document-ID/date/body values. Token timing, tampering, expiry, and future skew are covered by tests. The adapter imports Admin SDK modules only and hard-codes `notificationDevices`.
- Remaining gates/concerns: Task 6 must add and deploy Firestore rules that deny direct browser access before this collection can be called server-only in production, and must assess arbitrary-HTTPS endpoint abuse/SSRF and anonymous registration rate limiting before dispatch is enabled. No live Firestore call, real push, production secret, billing change, preview deployment, or production deployment occurred. Independent Task 5 review remains pending.
- Commit: `feat: add anonymous notification subscription API`.

### 2026-07-17 — Task 5 formal review fixes

- Role: Implementation agent responding to an independent security review. Scope remained the anonymous notification API and Admin storage adapter; no Task 6 dispatcher, client UI, deployment, billing, production secrets, or live push work was performed.
- Review result: The initial `1330fcb` implementation was rejected. Blocking findings covered default-on/incomplete readiness, no durable global cap or endpoint idempotency, incomplete same-origin enforcement, framework-parsed body reliance, a legacy default export instead of Vercel's Web Handler, weak Firebase/VAPID/token validation, and an unpinned runtime.
- Resolution: Registration now defaults off and can become ready only with canonical 32-byte token/dedup secrets, an on-curve VAPID public key, an exact HTTPS allowed origin, a bounded daily cap, a non-placeholder WAF rule identifier, and a parseable matching Firebase service account with a real RSA private key. All writes require JSON and the exact origin, reject cross-site Fetch Metadata, emit no CORS headers, and enforce 32 KB while streaming the raw Fetch body before JSON parsing. The production export follows Vercel's documented Node.js Web Handler `{ fetch(request) }` contract; the dependency-injected core remains available for tests.
- Durable abuse/idempotency boundary: `notificationDevices`, `notificationEndpointIndex`, and `notificationRegistrationCounters` are updated in Firestore transactions. A keyed HMAC-SHA256 endpoint fingerprint enables active-device reuse. Every accepted registration write, including refresh, atomically consumes the UTC-day global cap and returns 429 once full. Stored device/index records carry `authorizationExpiresAt`; DELETE removes a matching helper index transactionally.
- Runtime/Admin hardening: Node is pinned to `22.x`. Firebase Admin uses only the dedicated `spotterai-notifications` app and fails if its project identity differs from the configured service account. P-256 subscription and VAPID values must be real points on `prime256v1`. Device IDs, signatures, and both HMAC secrets must be exact canonical unpadded base64url encodings of 32 bytes, including rejection of unused-bit malleability.
- TDD evidence: The review-fix focused RED failed 0/3 on missing fingerprint/cap/fetch-handler interfaces. The implemented focused suite passed 35/35. Full `npm test` passed 262/262 on Node 22.17.0. Module syntax checks and `git diff --check` passed.
- Dependency audit: `npm audit --omit=dev` still reports eight moderate transitive `uuid@9.0.1` findings through Firebase Admin's Google Cloud clients. npm offers only a forced breaking Firebase Admin major change; no forced remediation was applied.
- Remaining gates: `NOTIFICATION_REGISTRATION_ENABLED` must remain `false` until Task 8/production ownership publishes a fixed-window per-IP WAF rule for `POST`, `PATCH`, and `DELETE /api/notifications`, records its real rule ID, and preview verification demonstrates 429 behavior for excess registration and authenticated PATCH traffic. The environment rule ID is only a fail-closed readiness input; it does not prove the edge rule exists. Task 6 must deny direct client access to all three notification collections, handle expiry cleanup for devices and matching endpoint indexes, and complete dispatcher endpoint/SSRF controls. Expired dedup entries intentionally hand off old-record cleanup to Task 6. Production secrets, Firebase billing, preview/live Firestore checks, physical-device checks, and promotion remain owner-gated.
- Re-review: Pending. No production deployment or external state change occurred.

### 2026-07-17 — Task 5 second security re-review fixes

- Role and scope: Implementation agent responding to the second Task 5 security review. Work remained limited to notification registration/API hardening; Task 6 was not started.
- Review result: `56c3b32` was rejected because active endpoint refresh returned before the daily counter read and merged a complete new-registration record into the existing device. Repeated POSTs could bypass the durable bound and overwrite completion, delivery, sent-category, lease, creation, revocation, and future dispatcher-owned state. Additional findings required fragment rejection, WAF coverage for every mutating method, and HMAC key separation.
- Resolution: Every accepted new, expired, or active registration now reads/checks and increments the same UTC-day transaction counter. Cap exhaustion happens before any device/index/counter mutation. Active refresh updates only endpoint/key/expiration material, normalized preferences, authorization expiry, the recalculation sentinel, and update timestamps; all dispatcher-owned and unknown existing fields are preserved. Indexed records whose `enabled` state is not exactly `true` fail closed with a generic 409 and cannot be replaced or re-enabled; DELETE remains the clean re-registration path.
- Validation/edge hardening: Raw `#` fragments are rejected before URL normalization or endpoint fingerprinting, so `#one`/`#two` aliases cannot create separate registrations. Enabled readiness rejects identical token/dedup secrets. The required owner-controlled fixed-window per-IP WAF rule now covers `POST`, `PATCH`, and `DELETE /api/notifications`; preview must demonstrate 429 for excess registration and authenticated PATCH before the code gate is enabled. Merely configuring a rule ID is not publication evidence.
- TDD evidence: The second-review focused RED passed 33/40 and failed the seven intended assertions: identical-secret readiness, generic revoked response, fragment alias rejection, refresh field preservation, active-refresh cap enforcement, repeated-refresh bounding, and disabled-record fail-closed behavior. Focused GREEN passed 40/40.
- Verification and audit: Focused notification tests passed 40/40; full `npm test` passed 267/267 on Node 22.17.0; syntax checks and `git diff --check` passed. `npm audit --omit=dev` remains at eight moderate transitive `uuid@9.0.1` findings; the offered complete remediation is a forced breaking Firebase Admin change, so none was applied.
- Commit/re-review: Commit message `fix: bound notification registration refreshes`; independent re-review remains pending. No deployment, billing, secret, or external edge change occurred.

## Required worklog entry format

Each implementation, review, verification, or deployment entry must record:

- Date and agent role.
- Bounded task and acceptance criteria.
- Result and material decisions.
- Files and commit identifiers.
- Automated tests and their outcomes.
- Manual or preview evidence when relevant.
- Review findings and their resolution.
- Blockers, owner approvals, and exact next action.

## Release sign-off

Release sign-off remains empty until all gates pass. Final sign-off must include the release commit, Vercel deployment identifier, Firebase function deployment identifier when enabled, complete automated test results, real-device notification evidence, unresolved known limitations, and the owner's production-promotion approval.
