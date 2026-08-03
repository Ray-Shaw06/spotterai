# TODOS

Deferred work with enough context to pick up cold. Active scope lives in
`~/.gstack/projects/Ray-Shaw06-spotterai/ceo-plans/2026-08-02-plan-import-and-evaluator-gap.md`.

Everything code-fixable from the 2026-08-02 review and the 2026-08-03 `/qa` pass
has shipped. What remains here are the two items that are not code tasks: both
are blocked on having external users, not on engineering time.

**Cleared 2026-08-03:** the `first_workout_*` gating bug, the
"Safe plans incorrectly flagged" counter, the skipped-onboarding defaults, the
`plan_generation_succeeded` naming inversion, the missing security headers, and
the check-count claim.

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
best candidate to overturn it if it holds at higher n.

The measurement blocker is now gone: `first_workout_*` fires once per profile as
of 2026-08-03, so the next window's numbers are readable. **Nothing can be
decided until fresh data accumulates under the corrected events** — every number
in this entry was recorded under the broken ones, so treat the comparison above
as unusable and re-pull before acting.

**Effort:** M (human) → S (with CC)
**Priority:** P2
**Depends on:** a fresh 7-day window of post-2026-08-03 traffic. Not code.

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
any stranger has logged three or more sessions. No amount of engineering moves
this forward today.

**Effort:** L (human) → M (with CC)
**Priority:** P3
**Depends on:** external users who log. Hard blocker.

---
