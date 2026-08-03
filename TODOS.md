# TODOS

Deferred work with enough context to pick up cold. Added from the CEO review on
2026-08-02. Active scope lives in
`~/.gstack/projects/Ray-Shaw06-spotterai/ceo-plans/2026-08-02-plan-import-and-evaluator-gap.md`.

---

## Investigate the nutrition-photo signal

**What:** Work out whether zero-setup photo food logging is a better entry point
than the plan funnel, and if so, what the smallest version of that looks like.

**Why:** In the 7-day window ending 2026-08-02, Vercel Analytics recorded
`meal_photo_succeeded` at 4 visitors against `onboarding_completed` at 3. Photo
food logging (`nutrition-ui.js:498`) requires no plan, no onboarding, and no
profile, and it out-converts the flow the entire product is organized around.
This is the only positive conversion signal in the funnel. Over the same window,
82 visitors produced 5 CTA clicks, 5 onboarding starts, 4 real AI plans, and 1
completed workout, which are the same absolute counts as the 36-visitor window
eleven days earlier.

**Pros:** It is already built. It needs no plan, so it sidesteps the five-step
onboarding wall entirely. It is the only thing in the funnel that behaves
differently from everything else.

**Cons:** n=4, and an unknown fraction of that is the owner's own traffic. Photo
estimation is also the most expensive path per use (image tokens through Gemini),
so a wedge built on it costs more per user than any other entry point.

**Context:** The 2026-08-02 office-hours session concluded the wedge was a
verdict-first plan importer. That conclusion was reached before this funnel data
was pulled. The nutrition signal is not strong enough to overturn it but is the
best candidate to overturn it if it holds at higher n. Before acting, resolve the
`first_workout_completed` measurement bug (see below) so the comparison baseline
is trustworthy.

**Effort:** M (human) → S (with CC)
**Priority:** P2
**Depends on:** more traffic, and the funnel-event gating fix.

---

## Retrospective audit: judge logged history, not prescribed plans

**What:** Point the evaluator at what the user actually did rather than at what a
plan claims it will do. "You have benched 3x10 at 95 for five weeks and it has not
moved. Here is why."

**Why:** The core conversion problem found on 2026-08-02 is that a beginner cannot
tell a good plan from a bad one, so an audit of a plan is an abstract claim they
cannot evaluate. An audit of their own logged numbers is a fact about them, which
needs no expertise to feel. It sidesteps the push-versus-pull problem entirely:
nobody argues with their own data.

**Pros:** Strongest long-term position identified in the session. Reuses
`tracker-store.js`, evaluator thresholds, `charts.js`, and `adapt-engine.js`.
Turns the evaluator from a critic into a witness.

**Cons:** Requires weeks of logged data from users who do not exist yet. The
experiment cannot be started today at any price.

**Context:** Surfaced independently by an adversarial reviewer during the
2026-08-02 office-hours session, which called it the evaluator's highest-value
form. Blocked strictly on having external users who log workouts. Revisit once
any stranger has logged three or more sessions.

**Effort:** L (human) → M (with CC)
**Priority:** P3
**Depends on:** external users who log. Hard blocker.

---

## Fix `first_workout_*` funnel event gating

**What:** `first_workout_completed` (`workout-ui.js:386`) fires on every successful
`addWorkout`, not on the first ever. `first_workout_started` (`workout-ui.js:327`)
is gated only on per-session draft state, so it fires once per session forever.

**Why:** This is the project's primary success metric. Because the owner trains and
logs in the app, it fires in every window regardless of external usage, so it cannot
distinguish him from a stranger. Both the 2026-07-22 and 2026-08-02 traffic
snapshots were misread as a result.

**Context:** Consider adding a separate always-fires `workout_completed` event if
ongoing volume is still worth tracking, since the current event is the only source
of that data today. Note `trackFunnel` silently returns `false` for any name not in
`FUNNEL_EVENTS` (`analytics.js:14`) and silently drops unregistered property values
while returning `true` (`analytics.js:39-41`).

**Effort:** S (human) → S (with CC)
**Priority:** P1
**Depends on:** nothing.

---

## "Safe plans incorrectly flagged" counts expectation failures, not flags

**What:** `eval.mjs:36` computes the headline counter as
`safe.filter((x) => !x.r.passed).length` — the number of good/guard cases whose own
`expect` list failed. It does not look at `flagged` at all, so a known-good fixture
can light up with flags and the counter still reads 0 as long as its declared
expectations happen to pass.

**Why:** This is the same masking shape as the `eval-suite.js:237` bug found on
2026-08-02, where the Node summary read clean while the browser showed
`Equipment fit` in the flagged list. The counter's name makes a stronger claim than
the code behind it, and it is the number the Safety Lab leads with.

**Context:** Found during `/review` of evaluator v1.3.0. Not a regression from that
change; it predates it. Fixing it needs a decision first: some guard fixtures raise
legitimate flags (the new "Novice 5x5 linear progression (rep-shape guard)" case
correctly flags push/pull and quad/hamstring balance), so the counter should probably
compare against a per-case allowlist of expected flags rather than requiring zero.

**Effort:** S (human) → S (with CC)
**Priority:** P2
**Depends on:** nothing.

---

## ~~README says "11 checks"~~ — SETTLED 2026-08-03

The number is now defined as **checks that run on every plan = 11**, with injury
checks additional and conditional. `README.md:8` already said 11 and is correct
under that definition. `index.html` said 6 and was fixed by `/qa` (`66ad5bf`),
and `test/ui-copy.test.js` now asserts the advertised count equals
`evaluatePlan(...).checks.length` for a no-injury audit, so the definition is
pinned by a test rather than by prose.

Still drifting but still true: `index.html:482` says "340+ tests"; the suite is
at 370.

---

## Skipped onboarding steps become asserted facts in the audit

**What:** `onboarding.js:61-67` fills `experience: "Beginner"` and
`equipment: ["Bodyweight"]` for steps the user skipped, before the evaluator sees
anything. The audit then reports those defaults as assessed findings.

**Why:** Walked the funnel on 2026-08-03 skipping the two optional steps. The
resulting audit showed `Beginner load sanity` as a **warning** ("14 exercises
exceed RPE 8, which is aggressive for a beginner") and `Equipment fit` as a
suggestion ("21 exercises need equipment you didn't list"). I never said I was a
beginner and never declined to list equipment — I skipped the questions. Both
flags are artifacts of manufactured answers, not properties of the plan. The
Equipment fit copy even says "equipment you didn't list" while running against a
default.

This is the same false-precision the `not_assessed` tier removes. v1.3.0 fixed
the import path (`if (!experience)`, `if (!caps)`) and left the **primary** path,
because the defaulting happens upstream and the evaluator never sees a blank.

**Context:** The fix has to separate two consumers that currently share one
object. `buildPrompt` genuinely needs a conservative default (a generator with no
experience level should assume beginner). The evaluator must not. Options: pass
the raw onboarding answers to `evaluatePlan` alongside the generator-facing
mapped inputs, or have `mapOnboardingToInputs` return `{ forGenerator, forAudit }`.
Governed by `safety_evaluator_change.md` — direction is a tightening, not a
loosening, but the regression case goes in first.

**Effort:** M (human) → S (with CC)
**Priority:** P1
**Depends on:** nothing.

---

## `plan_generation_succeeded` fires when generation failed

**What:** The event fires on the fallback path too, discriminated by
`fallback_used`. So `/funnel/plan_generation_succeeded/true` means the canned
example plan (failure) and `/false` means a real AI plan (success).

**Why:** Confirmed on 2026-08-03 by walking the funnel against a server with no
API route: the app emitted `plan_generation_succeeded/true` plus
`plan_fallback_shown/unknown` after showing the saved example. The funnel table
currently reads it correctly (`/false` = 4 = real plans), but an event whose name
says success and whose `true` means failure inverts the first time someone reads
it quickly, including you in three months.

**Context:** Same class as the `first_workout_*` gating bug above. Renaming
breaks continuity with existing Vercel dashboard data, which keys on the path, so
decide deliberately: either rename and accept the discontinuity, or keep the name
and add a note wherever the funnel is read. `plan_fallback_shown` already
captures the failure case cleanly, so the simplest fix may be to stop firing
`plan_generation_succeeded` at all when `fallback_used` is true.

**Effort:** S (human) → S (with CC)
**Priority:** P2
**Depends on:** nothing.

---

## No security headers beyond HSTS

**What:** `curl -sI https://spotterai.xyz/` returns only
`strict-transport-security: max-age=63072000`. No `Content-Security-Policy`,
`X-Frame-Options` / `frame-ancestors`, `X-Content-Type-Options: nosniff`, or
`Referrer-Policy`.

**Why:** Low for a local-first app with no destructive authenticated action, but
there is Google sign-in and Firebase sync, and the site can currently be framed.
A `headers` block in `vercel.json` covers all of it.

**Context:** Found by `/qa` on 2026-08-03. CSP is the fiddly one because the app
loads Google Fonts, MediaPipe, and Firebase from CDNs, so start with the three
cheap headers and treat CSP as its own task.

**Effort:** S (human) → S (with CC)
**Priority:** P3
**Depends on:** nothing.
