# TODOS

Deferred work with enough context to pick up cold. Active scope lives in
`~/.gstack/projects/Ray-Shaw06-spotterai/ceo-plans/2026-08-02-plan-import-and-evaluator-gap.md`.

Two kinds of item live here. The first two are blocked on having external users,
not on engineering time. The last three were deferred by the 2026-08-13
eng review, which cut scope to the log-a-session vertical slice; they are
unblocked work with a stated return order.

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

## Consistency calendar + honest streak definition

**What:** A month grid marking days a lift was hit and days every nutrition
target was met. Plus a redefinition of `computeStreak`.

**Why:** The only one of the four 2026-08-13 defects that builds a habit rather
than removing an obstacle. Deferred to keep the vertical slice narrow, not
because it is hard.

**Pros:** The data already exists. `tracker-store.js:725` aggregates nutrition
per date into `byDay`, `:734` computes `proteinTargetDays`, `:703` computes the
streak. This is a render plus a predicate, no new data model.

**Cons:** None structural. It is deferred purely on sequencing.

**Context:** The trap is the streak. `computeStreak` (`tracker-store.js:703`)
counts consecutive calendar days containing any workout, so **rest days break
it**. Ship the grid on top of that and a correct 4-day split renders as
failure, which demotivates exactly the user it is meant to encourage. The
streak redefinition is part of this work, not a follow-up. Second gap: the
goals-met predicate currently checks protein only and ignores kcal, carbs, fat,
and water, so "met all nutrition goals" would be a lie on the grid.

Open question inherited from the eng review: should the streak be
training-day-aware (only count scheduled days) or target-aware (count against
`targets.weeklyWorkouts`)? A 4-day and a 6-day split need different answers.

**Effort:** M (human) → S (with CC)
**Priority:** P2
**Depends on:** nothing technical. Deferred by scope choice.

---

## Grow the exercise table toward 800+

**What:** Expand the canonical exercise table from 184 entries with muscle,
equipment, movement pattern, and safety metadata on each.

**Why:** Even with recognition fixed, a lift that is not in the table cannot be
found. This was the original 2026-08-13 ask before the diagnosis moved.

**Pros:** After the matcher unification the table is one place, so growth is
additive data entry rather than keeping two files in sync.

**Cons:** Tedious at this scale. And it is not the fix for the reported
recognition failure, which was three divergent matchers.

**Context:** **Hard ordering constraint: this must not start before the matcher
unification lands.** SpotterAI resolved exercise names through three functions
with three different semantics (`findExercise` exact-match at
`exercises.js:242`, `searchExercises` token-AND at `:308`, `lookupExercise`
substring scan at `exercise-data.js:132`), across two unsynchronized tables
(`EXERCISES` 184 entries, `EXERCISE_DATA` 84). Growing the table before
unifying the matcher multiplies near-miss collisions and makes recognition
worse, not better. Revisit once one canonical table with one matcher exists.

**Effort:** L (human) → S (with CC)
**Priority:** P2
**Depends on:** the canonical exercise table + single matcher. Hard blocker.

---

## Audit the weight of style.css

**What:** Reduce `style.css`, currently 250KB across 6,320 lines, which parses
in full on every cold boot.

**Why:** Real contributor to how heavy the PWA feels. Not the largest one, and
that is the point of the gate below.

**Pros:** Cold boot is the first thing felt on every visit, and CSS parse is
pure overhead when most rules serve screens the user is not on.

**Cons:** A CSS audit has no natural finish line and expands to fill whatever
time it is given. This is exactly why the 2026-08-13 review cut it.

**Context:** Excluded from the PWA work deliberately. That work covers the
service-worker strategy, the smooth-scroll on route change, and parse
deferral, all of which have measurable stop conditions. This does not.

**Gate: do not start this until a `/benchmark` cold-boot baseline exists.**
The baseline names the actual bottleneck, which may well be parse-blocking
JavaScript rather than CSS. Without it this is tidying, not optimization. The
prior light-forest redesign scored well, so this is strictly about weight and
must not become an appearance change.

**Effort:** M (human) → S (with CC)
**Priority:** P3
**Depends on:** a `/benchmark` cold-boot baseline. Soft blocker, but real.

---
