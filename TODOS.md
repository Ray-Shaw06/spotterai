# TODOS

Deferred work with enough context to pick up cold. Active scope lives in
`~/.gstack/projects/Ray-Shaw06-spotterai/ceo-plans/2026-08-02-plan-import-and-evaluator-gap.md`.

**Cleared 2026-08-14:** the four daily-use requirements all shipped. One
canonical exercise catalog and matcher, per-record Firestore sync, the
consistency calendar with an honest weekly streak, and the PWA speed work
(stale-while-revalidate, route-gated modules, instant nav). Plus three
pre-existing bugs found along the way: a timezone fault that put every Monday
workout in the previous week, a coach prescribing planks for 8-12 reps, and a
fourth hand-rolled exercise matcher hiding in the Library page.

**Cleared 2026-08-03:** the `first_workout_*` gating bug, the
"Safe plans incorrectly flagged" counter, the skipped-onboarding defaults, the
`plan_generation_succeeded` naming inversion, the missing security headers, and
the check-count claim.

---

## Pull the funnel numbers. Nothing else is decidable without them

**What:** Read the last 7 to 14 days of Vercel Analytics and decide what the
funnel is actually doing.

**Why:** This is the highest-value open item in the project and it is not code.
Every number the 2026-08-02 session reasoned from was recorded under the broken
`first_workout_*` events. That bug was fixed 2026-08-03, so as of 2026-08-14
there are eleven days of readable data that nobody has looked at.

**What it decides:** whether the plan-import wedge is working; whether the
nutrition-photo signal (4 `meal_photo_succeeded` against 3
`onboarding_completed`, the only positive conversion signal ever recorded) holds
at higher n; and whether any of the 2026-08-14 daily-use work moved anything.

**Context:** 82 visitors/week as of 2026-08-02 with **zero strangers who have
ever completed a workout**. That number has not moved since June and no feature
shipped since then was aimed at it. Read before building.

**Effort:** S (human) / not a CC task
**Priority:** P1
**Depends on:** nothing. Unblocked since 2026-08-03.

---

## Verify the two-device sync round trip with a real human

**What:** Log a set on the phone, confirm it appears on the laptop, log on the
laptop, confirm the phone still holds both. Then delete on one device and
confirm it stays deleted. Then repeat with one device in airplane mode.

**Why:** Per-record sync is the fix for devices silently erasing each other's
sessions, and it is currently proven only by unit tests, an emulator rules gate,
and a status pill reading "Synced". None of that exercises two real devices.

**Context:** Deletes are the case to watch. Under per-record merge a delete that
does not issue a real `deleteDoc` leaves the remote copy alive and the next
snapshot resurrects it. There is a test for it; there is no human confirmation.

**Effort:** S (human)
**Priority:** P1
**Depends on:** two devices signed into the same Google account.

---

## Investigate the nutrition-photo signal

**What:** Work out whether zero-setup photo food logging is a better entry point
than the plan funnel, and if so, what the smallest version of that looks like.

**Why:** In the 7-day window ending 2026-08-02, `meal_photo_succeeded` ran at 4
visitors against `onboarding_completed` at 3. Photo food logging
(`nutrition-ui.js:498`) requires no plan, no onboarding, and no profile, and it
out-converted the flow the entire product is organized around.

**Pros:** Already built. Sidesteps the five-step onboarding wall entirely. The
only thing in the funnel that behaves differently from everything else.

**Cons:** n=4, an unknown fraction of it the owner's own traffic. Photo
estimation is also the most expensive path per use (image tokens through
Gemini), so a wedge built on it costs more per user than any other entry point.

**Context:** The 2026-08-02 session concluded the wedge was a verdict-first plan
importer, before this funnel data was pulled. The nutrition signal is not strong
enough to overturn that but is the best candidate to. Every number above came
from the broken events, so re-pull first (see the funnel item above).

**Effort:** M (human) / S (with CC)
**Priority:** P2
**Depends on:** the funnel re-pull. No longer blocked on time.

---

## Close the safety-metadata gap — now a review job, not a writing job

**What:** Run `npm run draft-metadata`, read the drafts, move the good ones into
`exercise-metadata.js`.

**Why:** 229 of 383 catalog lifts have no curated entry. The evaluator falls
back to keyword matching for those, which is deliberate and load-bearing, but
weaker than curated data. The gap grew with every library expansion: 209 to 316
on 2026-08-14, then to 383 on 2026-08-15 with bands, kettlebells and the
floor-only additions.

**Context:** `scripts/draft-exercise-metadata.mjs` (added 2026-08-15) drafts
entries with an LLM **offline** and writes them to `scripts/out/` for review. It
is NOT part of the app and nothing imports it — the evaluator stays pure code,
because an auditor whose data came from a model would depend on that model not
hallucinating in order to catch a model hallucinating. There is a test asserting
no runtime module imports it.

Every structural invariant is enforced in code, so review is about judgement
rather than typos: enums are derived from the existing metadata, equipment comes
from the catalog (never the model), and substitutions that resolve to nothing are
dropped and reported. The run prints every proposed contraindication grouped by
key — that is the field to actually read, because a wrong one either scares
someone off a movement that would have helped or fails to warn them off one that
hurts.

Proven on the Calves group: 8/8 accepted, 7 hallucinated substitution names
dropped, 1 contraindication proposed (Donkey Calf Raise / lower_back, which is
correct — it is the only hip-hinged loaded position in the group).

Two things the run surfaces for free: dropped substitution names are often real
lifts worth ADDING to the catalog ("Pogo Jumps", "Double Unders"), and forced
enum choices expose vocabulary gaps (Tibialis Raise has to claim "calves"
because there is no shins group).

~208 non-cardio lifts remain, about 26 model calls at the default batch size.
Cardio is excluded by default: the metadata shape describes lifting.

**Effort:** M (human review) / S (with CC)
**Priority:** P2
**Depends on:** nothing. `GEMINI_API_KEY` in `.env`.

---

## Grow the exercise table past 316

**What:** Continue toward 800+ with muscle, equipment, and where possible safety
metadata.

**Why:** 209 to 316 on 2026-08-14 filled the thinnest groups (glutes 9 to 17,
calves 5 to 10), but it is still well short of what a lifter expects from a
library, and short of the 800+ originally asked for.

**Context:** Unblocked. The matcher unification landed first on purpose, because
growing the table while three matchers disagreed would have multiplied near-miss
collisions rather than improving recognition. Additions are BASE tuples in
`exercise-catalog.js`; a test fails on any equipment label that silently falls
back to bodyweight tags.

**Effort:** L (human) / S (with CC)
**Priority:** P3
**Depends on:** nothing.

---

## Audit the weight of style.css

**What:** Reduce `style.css`, currently ~315KB, which parses in full on every
cold boot.

**Why:** Real contributor to how heavy the PWA feels, though probably not the
largest one, which is the point of the gate below.

**Cons:** A CSS audit has no natural finish line and expands to fill whatever
time it is given. That is exactly why the 2026-08-13 review cut it.

**Gate: do not start until a `/benchmark` cold-boot baseline exists.** The
baseline names the actual bottleneck, which may still be parse-blocking
JavaScript rather than CSS even after the route-gating work. Without it this is
tidying, not optimization. The light-forest identity must not change; this is
strictly about weight.

**Effort:** M (human) / S (with CC)
**Priority:** P3
**Depends on:** a `/benchmark` cold-boot baseline. Soft blocker, but real.

---

## Retrospective audit: judge logged history, not prescribed plans

**What:** Point the evaluator at what the user actually did rather than at what a
plan claims it will do. "You have benched 3x10 at 95 for five weeks and it has
not moved. Here is why."

**Why:** A beginner cannot tell a good plan from a bad one, so an audit of a plan
is an abstract claim they cannot evaluate. An audit of their own logged numbers
is a fact about them, which needs no expertise to feel. Nobody argues with their
own data.

**Pros:** Strongest long-term position identified in the 2026-08-02 session.
Reuses `tracker-store.js`, evaluator thresholds, `charts.js`, and
`adapt-engine.js`. Turns the evaluator from a critic into a witness.

**Cons:** Requires weeks of logged data from users who do not exist yet.

**Effort:** L (human) / M (with CC)
**Priority:** P3
**Depends on:** external users who log. Hard blocker. Revisit once any stranger
has logged three or more sessions.
