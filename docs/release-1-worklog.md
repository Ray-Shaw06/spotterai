# SpotterAI Release 1 Worklog

This document is the version-controlled source of truth for Release 1 progress, decisions, verification evidence, deployment state, blockers, and remaining work. It must not contain secrets, push endpoints, personal data, submitted health information, photographs, or raw AI content.

## Release baseline

| Item | Value |
| --- | --- |
| Production baseline | `1b94973` (`origin/main`) |
| Existing deployment | Vercel |
| Existing sync | Firebase Auth and Firestore |
| Release branch | To be created from `1b94973` after design approval |
| Design | `docs/superpowers/specs/2026-07-17-release-1-design.md` |
| Current phase | Owner review of written design |

## Gate status

| Gate | Status | Evidence or next action |
| --- | --- | --- |
| Product scope approved in conversation | Complete | Scope and constraints captured in the Release 1 design |
| Written design approved | Pending | Owner must review the written design |
| Implementation plan approved | Pending | Create after written-design approval |
| Clean release worktree | Pending | Base on `1b94973`; exclude unrelated local work |
| Measurements and conversions | Pending | Implementation and tests not started |
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
