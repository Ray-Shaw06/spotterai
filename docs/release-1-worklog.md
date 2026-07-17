# SpotterAI Release 1 Worklog

This document is the version-controlled source of truth for Release 1 progress, decisions, verification evidence, deployment state, blockers, and remaining work. It must not contain secrets, push endpoints, personal data, submitted health information, photographs, or raw AI content.

## Release baseline

| Item | Value |
| --- | --- |
| Production baseline | `1b94973` (`origin/main`) |
| Existing deployment | Vercel |
| Existing sync | Firebase Auth and Firestore |
| Release branch | To be created from `1b94973` before implementation |
| Design | `docs/superpowers/specs/2026-07-17-release-1-design.md` |
| Implementation plan | `docs/superpowers/plans/2026-07-17-release-1.md` |
| Current phase | Implementation plan and clean-worktree setup |

## Gate status

| Gate | Status | Evidence or next action |
| --- | --- | --- |
| Product scope approved in conversation | Complete | Scope and constraints captured in the Release 1 design |
| Written design approved | Complete | Owner approved the written specification on 2026-07-17 |
| Implementation plan approved | Complete | Plan derives directly from the approved design and the owner selected autonomous agent execution |
| Clean release worktree | Pending | Base on `1b94973`; exclude unrelated local work |
| Measurements and conversions | Complete | Task 1 committed: metric/imperial onboarding conversions, validation, and accessibility checks |
| First-workout activation | Pending | Implementation and tests not started |
| Funnel analytics | Pending | Implementation and tests not started |
| AI retry and recovery states | Pending | Implementation and tests not started |
| Web Push client and preferences | Pending | Implementation and tests not started |
| Notification API and dispatcher | Pending | Implementation and tests not started |
| Independent reviews resolved | Pending | Run after each implementation slice and final integration |
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
