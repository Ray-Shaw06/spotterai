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

**What:** Work out why 11 of 14 people who got a plan never trained once, and
fix it.

**Why:** It is the only large drop in the funnel as of 2026-08-16. Everything
above it converts (78% through onboarding), everything below it converts
perfectly (3 of 3 finish what they start).

**Unknown, and worth answering first:** whether they bounced at the plan itself
(did not trust it, did not like it, could not tell what to do on day one) or
between the plan and the gym (came back later and the app did not bring them
back). Those want opposite fixes. The `notification_offer_shown` events
(3 unsupported, 1 ios_pwa) suggest the re-engagement path barely reaches anyone.

**Effort:** M
**Priority:** P1
**Depends on:** nothing.

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

**Why:** It held and grew on the 2026-08-16 re-pull. 30 days:
`meal_photo_succeeded` 8 visitors / 16 views, against 3 who started a workout
and 3 who imported a plan. Photo food logging (`nutrition-ui.js:498`) needs no
plan, no onboarding and no profile, and it out-converts the entire path the
product is organized around. 16 views on 8 visitors means people come BACK to
it, which nothing else in the funnel does.

At 2026-08-02 it was 4 against 3. At 2x the sample the ratio got better, not
worse. That is the opposite of what noise does.

**Pros:** Already built. Sidesteps onboarding entirely. The only thing in the
funnel with repeat use.

**Cons:** n=8, some fraction the owner's own traffic. Photo estimation is the
most expensive path per use (image tokens through Gemini), so a wedge built on
it costs more per user than any other entry point.

**Context:** The 2026-08-02 session concluded the wedge was a verdict-first plan
importer. Plan import has since measured 3 visitors in 30 days against photo's
8. That conclusion was reached without data and the data does not support it.

**Effort:** M (human) / S (with CC)
**Priority:** P1. Promoted 2026-08-16 — it is now the best-evidenced signal in
the product, and it sidesteps the exact wall the funnel identified.
**Depends on:** nothing.

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
