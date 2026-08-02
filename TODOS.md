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

## README says "11 checks"; the evaluator now runs 11 plus injuries

**What:** `README.md:8` claims "audits every AI-generated plan against 11 checks".
As of v1.3.0 a zero-injury audit returns 11 rows (`checkInjuries` is spread in and
contributes 0 when no injuries are declared), so the real count is 11 + injuries.
The same line was accurate at v1.2.0, when a zero-injury audit returned 10.

**Why:** Small, but it is a public accuracy claim on the artifact most likely to be
read by a recruiter or an HN visitor, in a project whose entire pitch is that its
numbers are checkable.

**Context:** Found during `/review` of v1.3.0. `rule-explanations.js` has 13 entries,
but two of those (`injury`, `substitution`) are not one-per-check, so pick the number
deliberately rather than reading it off that array. `index.html:482` says "340+ tests"
and the suite is now at 361, which is still true but drifting.

**Effort:** S (human) → S (with CC)
**Priority:** P3
**Depends on:** nothing.
