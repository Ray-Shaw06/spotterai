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

## PULLED 2026-08-16. The wall is plan -> first workout

30-day window, Jul 17 to Aug 16, read off Vercel Web Analytics.

| stage | visitors | of previous |
|---|---|---|
| landed on `/` | 170 | |
| clicked a CTA | 18 | 11% |
| started onboarding | 18 | 100% |
| **completed onboarding** | **14** | **78%** |
| got a plan | 15 | (14 real + 1 fallback) |
| **started a first workout** | **3** | **21%** |
| completed it | 3 | **100%** |

Also: `meal_photo_succeeded` 8 visitors / 16 views. `plan_imported` 3 total
(2 without progression, 1 with). Referrers: linkedin 5, instagram 3, facebook 2.
Countries: US 59%, Thailand 22%, India 6%.

**`first_workout_completed` is 3.** It was zero from June through 2026-08-02.
The activation metric the whole project was stuck on is no longer zero.

**What this decides.** Onboarding is NOT the wall: 78% of starters finish it,
which is a good rate for five steps. Logging is not the wall either: everyone
who starts a workout finishes it, 3 of 3. The wall is the 79% drop between
holding a plan and training once. Fourteen people accepted a program and eleven
never did a session.

**The nutrition signal held and grew.** 8 visitors against 3 who started a
workout, and 16 views on 8 visitors means people come back to it. It needs no
onboarding, no plan and no profile, and it out-converts the entire path the
product is organized around. At 2026-08-02 it was 4 against 3; the ratio got
better, not worse, at 2x the sample.

**Caveats, stated plainly.** n is small; 3 against 8 is a direction, not a
proof. Thailand at 22% of 170 is ~37 visitors and is plausibly friends and
family rather than cold traffic, so the real stranger funnel is narrower than
the top line.

**What it does NOT support:** more work on onboarding, the logging UI, or the
exercise library. None of those sit where the drop is.

**How to re-pull:** `browse` cannot use the Vercel CLI token for analytics (no
working REST route). Import cookies instead:
`browse cookie-import-browser chrome --domain vercel.com`, approve the macOS
Keychain prompt for "Chrome Safe Storage" (the first attempt returns only 6
anonymous cookies; after approval it returns 11 with auth), then open
`https://vercel.com/rshaw06/spotterai/analytics`, set the range, and click
**View All** on the Pages panel. Funnel events are virtual pageviews at
`/funnel/<event>/<segments>`.

**Priority:** DONE. The follow-on question is below.

---

## Close the plan -> first workout gap. This is where the users are lost

**Shipped 2026-08-16 (PR #22). Now waiting on data, not on work.**

Two halves went out. One needed no sample, one needs 30 days.

**The half that needed no sample.** The primary action was measured at 375x812
with a four-day, six-lift plan: the audit runs 1450px, the plan runs 3048px, and
"Start my first workout" lands **4499px down, 5.5 screens**. `.plan-bar` fixes
the button to the bottom of the screen instead of reordering anything, so the
flags-first ordering survives. That is a defect you find with a ruler, and it is
fixed.

**The half that needs 30 days.** The funnel had NO event between "got a plan"
and "started training", so bouncing at the plan screen and bouncing three days
later were the same data. Two events split them:

| event | fires | answers |
|---|---|---|
| `plan_scrolled_to_end` | once/profile, inline CTA on screen | did they read past the audit |
| `returned_with_plan` `{trained}` | once/profile, on a LATER day still holding a plan | did they come back, had they trained |

**How to read it on the next pull, written down now so the answer is not
invented afterwards:**

- **low `plan_scrolled_to_end`** -> the audit wall lost them before the plan.
  Fix is the plan screen: shorten it, or lead with day one.
- **`plan_scrolled_to_end` high, `returned_with_plan` near zero** -> they read
  the whole thing and never came back. Fix is re-engagement, and note the
  `notification_offer_shown` events (3 unsupported, 1 ios_pwa) say that path
  barely reaches anyone today.
- **`returned_with_plan/false` material** -> they came back holding a plan and
  still did not start. Fix is day-one friction, not the plan and not reminders.

**Caveat that will apply:** the sample that produced the question was 14 people.
Splitting the next one three ways gives numbers too small to be conclusive on
their own. Treat the branches as direction, and prefer the branch that agrees
with `first_workout_started` moving.

**Effort:** S (re-pull), then M (whichever branch it names)
**Priority:** P2 until the next pull has 30 days of the new events, i.e. not
before **2026-09-15**. Re-pulling sooner reads noise.
**Depends on:** time.

---

## Verify the two-device sync round trip with a real human

**The only open P1 as of 2026-08-16, and the only one no amount of code closes.**

**Why:** Per-record sync is the fix for devices silently erasing each other's
sessions, and it is currently proven only by unit tests, an emulator rules gate,
and a status pill reading "Synced". None of that exercises two real devices, two
real clocks, or a real network.

**Context:** Deletes are the case to watch. Under per-record merge a delete that
does not issue a real `deleteDoc` leaves the remote copy alive and the next
snapshot resurrects it. There is a test for it; there is no human confirmation.

### The script

Both devices signed into the same Google account on the deployed app, both on
the same profile. Wait for "Synced" before each step. **Any step that fails: stop
and record which one.** Which step breaks names the bug.

| # | Do this | Expect | If it fails |
|---|---|---|---|
| 1 | Phone: log a workout, 3 sets | Laptop shows it without a manual refresh | Push or the snapshot listener is dead |
| 2 | Laptop: log a different workout | Phone shows BOTH | Last-write-wins came back; one device is overwriting the other's whole document |
| 3 | Phone: delete the laptop's workout | Laptop drops it, and it is still gone after a laptop reload | The delete is local only. `deleteDoc` never fired, the snapshot resurrects it |
| 4 | Laptop: airplane mode. Log a workout on each device | Nothing crosses, both keep their own | |
| 5 | Laptop back online | Both devices end with BOTH workouts, neither deleted | The offline queue drops writes, or reconnect replays a stale full-state snapshot |
| 6 | Phone: delete a set from inside a workout, not the whole workout | Laptop shows the workout with one fewer set | Sub-record edits sync as a whole-record replace and race |

Step 3 and step 5 are the ones worth the time. 1, 2, 4 are almost certainly fine.

**Effort:** S (human, ~15 min)
**Priority:** P1
**Depends on:** two devices signed into the same Google account.

---

## Investigate the nutrition-photo signal

**Answered and shipped 2026-08-16 (PR #22). Waiting on data.**

**What the investigation found.** Photo logging drew 8 visitors / 16 views over
30 days against 3 for plan import and 3 who started a workout, and it did that
**from four clicks down a nav menu with no landing-page presence whatsoever**:
open Nutrition, pick a meal, open that meal's food picker, then find "Snap a
meal" among the search results. The landing page had exactly two CTAs and both
were plan-shaped. The best-converting thing in the product had no front door.

That reframes the question. It was never "is photo logging a better entry
point?" It has been outperforming the plan funnel from a standing start. The
open question is how much of the 8 was the feature and how much was the four
people determined enough to find it.

**What shipped:** a hero door and a visible button on the Food diary, plus
`meal_photo_started` carrying `source` (landing / nutrition / picker). `started`
also makes abandonment visible for the first time. Before it, a photo opened and
given up on was indistinguishable from one never opened, so 8 was a floor with
no ceiling attached.

**How to read the next pull:**

- **`landing` a large share of `meal_photo_started`** -> the door was the
  constraint. That is a real wedge and worth building around.
- **`landing` small, total flat** -> discovery was not the constraint, and the 8
  was 8 motivated people. Do not build a product on it.
- **`started` well above `succeeded`** -> the estimate quality or the wait is
  losing people after they commit, which is a different fix from either.

**Cons that survive whatever the data says:** photo estimation is the most
expensive path per use (image tokens through Gemini), so a wedge built on it
costs more per user than any other entry point.

**Context:** The 2026-08-02 session concluded the wedge was a verdict-first plan
importer. Plan import has since measured 3 visitors in 30 days against photo's
8. That conclusion was reached without data and the data does not support it.

**Effort:** S (re-pull)
**Priority:** P2 until ~**2026-09-15**, same 30-day clock as the plan gap. Both
re-pull in the same sitting.
**Depends on:** time.

---

## CLOSED 2026-08-16. Safety metadata is done

362 of 383 catalog lifts are curated. The remaining 21 are cardio, excluded
because the metadata shape describes lifting.

Drafted with `npm run draft-metadata` (offline, nothing imports it) and
adjudicated before import: checked against an already-curated twin, the drafts
disagreed on contraindications 19 times out of 28, so where a twin exists the
twin wins. See the 2026-08-15 brain note.

The evaluator now sees every liftable exercise. A plan of Meadows Row / Cuban
Press / Lu Raise / Behind-the-Neck Press reports 4/4 recognized and warns a
shoulder-injured user about all three; it recognized none of them before.

---

## Grow the exercise table past 383

**What:** Continue toward 800+ with muscle, equipment and safety metadata.

**Why:** 383 covers every muscle group for every equipment option and is enough
to program any of them. It is still short of what a big library looks like.

**Deprioritized 2026-08-16, deliberately.** The funnel says nobody is lost for
want of exercises: 3 of 3 people who start a workout finish it. Depth beat
breadth and depth is now done. Growing the NAME list again without metadata
would reopen the gap that was just closed.

**Free input when it is time:** the 2026-08-15 drafting run dropped 156
substitution names that resolve to nothing. Many are real lifts ("Pogo Jumps",
"Double Unders", "Bodyweight Calf Raise") and that list is a ready-made
candidate set.

**Effort:** L (human) / S (with CC)
**Priority:** P3
**Depends on:** a reason. Do not do this because it is easy.

## CLOSED 2026-08-16. The style.css audit is not worth doing

The `/benchmark` baseline this was gated on now exists
(`.gstack/benchmark-reports/2026-08-16-benchmark.md`) and it says no.

    style.css                  ends 245ms
    fonts.googleapis.com/css2  ends 325ms   <- last render blocker
    FCP                            432ms

`style.css` is 51KB on the wire, ~42ms, and finishes 80ms BEFORE the
cross-origin Google Fonts stylesheet. Trimming it cannot move FCP because it is
not what FCP waits on. 255KB of parsed CSS is real weight sitting off the
critical path, and the audit would be tidying sold as optimization. The
2026-08-13 review was right to cut it.

Cold boot is FCP 432ms / full load 802ms. Warm boot is 172ms / 382ms with zero
bytes transferred. Neither is a problem.

---

## Take Google Fonts off the critical path

**What:** Self-host Inter, Literata and JetBrains Mono, or inline the
`@font-face` rules with `font-display: swap`, so `index.html` stops
render-blocking on `fonts.googleapis.com`.

**Why:** It is the LAST render-blocking resource on cold boot, ending ~325ms
against an FCP of 432ms. It costs a cross-origin DNS lookup, TLS handshake and
fetch that a self-hosted file does not. Best available first-paint win, and it
has a natural finish line, which the CSS audit never did.

**Also worth doing while in there:** the Firebase SDK (3 files from gstatic,
tail ends ~768ms, ~100KB) loads on the landing page, where nobody is signed in.
Defer it until auth is actually needed.

**Honest sizing of the prize:** maybe 100-150ms off a 432ms cold FCP, and
nothing at all on warm boot, which is already 172ms. Worth doing when the
critical path is what you are working on. Not worth doing instead of the
plan -> first workout gap.

**Effort:** S
**Priority:** P3
**Depends on:** nothing.

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
