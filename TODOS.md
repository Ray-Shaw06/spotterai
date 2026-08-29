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

## CLOSED 2026-08-29. Consistency, cardio, and a rest alarm that fires

Three problems in one release. Spec:
`docs/superpowers/specs/2026-08-29-consistency-cardio-and-alarms-design.md`.

**The rest timer did not fire with the screen off.** Two independent bugs.
`workout-ui.js` counted down with `restRemaining -= 1` on a one-second
interval, and mobile browsers freeze background timers on screen lock, so the
countdown stopped with the screen and resumed on unlock. Then `beep()` built a
BRAND NEW AudioContext at fire time, outside any user gesture, which iOS starts
suspended, so even a timely fire was silent.

`rest-alarm.js` holds a wall-clock deadline and books the tone on the AUDIO
timeline inside the set-done tap, the only moment the context can be unlocked.
Audio scheduling runs on the audio thread and is not subject to timer
throttling, which is the part that makes the sound land on time. A near-silent
looping source plus a silent `<audio>` element keep the page in a playing-media
state, because iOS suspends a context with nothing playing through it, and
`reconcile()` on visibilitychange fires anything the throttled backstop owed.

**The limit it cannot beat, stated in the module header:** a force-quit app
fires nothing. This is a page-alive alarm, not a scheduled push, and the
2026-07-22 decision to retire Web Push is not reopened.

**Logging depended on remembering.** Since the app cannot reach you when it is
closed, forgetting had to stop costing anything. `catch-up.js` reports what is
unlogged today and yesterday, hour-gated so nothing is "missed" at 9am, capped
at three rows, silent on a clean day, with a test pinning the copy against
shaming language. Backfill logs against any of the last 14 days, with a
banner so a past-dated save is never a surprise at Finish, and a one-tap repeat
of the last session. The catch-up card PROPOSES yesterday's date and never
writes it: the app proposes, the user approves.

**The app could not program cardio.** The logging layer had known about cardio
for a while; nothing upstream of it did. `evaluator.js`, `repair.js`,
`adapt-engine.js` and `api/generate.js` had no cardio logic at all, and
`mapOnboardingToInputs` collected `CARDIO_PREFS` and dropped it on the floor.
Cardio is now in the schema (inferred from the catalog when absent, so saved
plans upgrade on read with no migration), in the audit as two zero-weight
conditionally-emitted checks, in the repair engine (move the session before
softening it), and in the adapt engine, which reads logged runs and eases leg
accessories without touching the day's opening lift.

**Free findings.** `addRoutine` rebuilt every set as `{ weight, reps }`, so
saving a run or a plank as a routine dropped `durationMin` / `distance` /
`durationSec` and `setHasWork` then filtered the whole routine away as empty.
And the README claimed 11 evaluator checks against a table of 12; it is 14 now
and the table lists all of them.

Benchmark 21 -> 23 cases, 30 -> 34 expectations, still zero false positives with
every pre-existing case unmoved. Evaluator v1.3.0 -> v1.4.0. Cache v65 -> v66.
Tests 736 -> 813.

---

## CLOSED 2026-08-23. The AI routes are rate limited

`test/generate-guard.test.js` recorded this threat on 2026-08-02 and closed only
half of it: the gate stopped an EMPTY body from buying a Gemini call, but a
VALID body could still be looped without limit against the one free-tier key
that generate, import, chat, estimate and parse all share. Draining it takes
plan generation down for every real user.

`lib/rate-limit.js` now runs in front of all five, before the key lookup and
before the body is read, so a refused call costs nothing. Two tiers per caller
(a minute for bursts, an hour for pacing under it) plus a per-instance ceiling,
which is the only tier an IP rotation cannot walk around. Caps are per route,
sized to the route: chat is conversational and estimate is the photo path the
2026-08-16 pull showed out-converting everything else, so neither is strangled
to protect generate.

**The limit it cannot enforce, on purpose:** counters are module scope, so they
are per serverless INSTANCE, and N warm instances means N x the numbers. Same
trade-off `api/audit-telemetry.js` already makes for its daily cap, for the same
reason: a backend-free architecture has nowhere exact to keep a count, and the
Firestore-backed version would spend the shared read quota user sync depends on,
on every AI call. It stops a loop from one client dead and blunts a distributed
one. It is not an accounting boundary.

Landing it broke 5 existing gate tests, which is how it proved it works: they
all posted as the same anonymous caller and blew the 5/min generate cap. They
post as distinct callers now, since the gate does not care who is asking.

Reverting `checkRateLimit` to `return null` fails 10 of the 13 new tests.

**Free finding:** `ipKey` in `api/audit-telemetry.js` had its own copy of the IP
extraction. Both now share `clientIp`, rather than this becoming the second
place that logic lives.

---

## CLOSED 2026-08-23. Firebase no longer loads on the landing page

`auth-ui.js` boots on every route and called `initSync()` straight into the
Firebase SDK: three cross-origin modules from gstatic, ~100KB, tailing ~768ms on
the 2026-08-16 benchmark, to ask "is anyone signed in?" on a page where nobody
is and no sign-in has ever happened.

The answer was already on disk. `auth-session-probe.js` reads Firebase's own
`firebaseLocalStorageDb` for a `firebase:authUser:` key and skips the SDK when
there is none.

**FAIL-SAFE BY CONSTRUCTION,** the pattern the 2026-08-16 observer work landed
on: every uncertain answer is `true` and loads the SDK exactly as before. The
only path returning false is positive evidence Firebase never stored a user
here, so a wrong guess costs the old behaviour, never a signed-in user rendered
as signed out.

Three traps that had to be handled: the database SURVIVES sign-out, so its
existence is not the answer and the store has to be read; a redirect sign-in
parks state in sessionStorage BEFORE any IndexedDB record exists, so that is
checked first; and `initSync` no longer attaches the auth listener for a
first-time signer-in, so `signInWithGoogle` attaches it itself or a successful
popup would sign someone in with nothing watching.

Verified in a real browser, both directions: no stored session gives zero
gstatic requests and no IndexedDB created at all; a real Firebase-shaped user
record gives all three SDK modules exactly as before; and the sign-in button
still drives a live redirect to accounts.google.com. Reverting the probe to
`return true` fails 5 of the 8 new tests.

**Note for whoever measures this:** the first reading was wrong. A stale service
worker was serving the old `sync.js`, so the SDK appeared to load anyway.
Unregister the worker and clear caches before trusting a number here.

Cache v62 -> v63. Tests 690 -> 711.

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

**How to re-pull (updated 2026-08-23, no UI scraping):** the Vercel CLI token
still has no working analytics route, but the AUTHENTICATED BROWSER SESSION can
call the same REST endpoint the dashboard itself uses, which returns complete
JSON and needs no clicking:

    browse cookie-import-browser chrome --domain vercel.com
    browse goto https://vercel.com/rshaw06/spotterai/analytics
    browse js "fetch('https://vercel.com/api/web-analytics/v2/stats?\
      environment=production&filter=%7B%7D&limit=250&projectId=spotterai&\
      teamId=team_u10LovYoInSWjI9bMMeVdIXs&tz=America%2FLos_Angeles&type=path&\
      from=<ISO>&to=<ISO>',{credentials:'include'}).then(r=>r.text())" \
      --out /tmp/paths.json --raw

`limit=250` means the list is complete rather than the top-N the Pages panel
shows, so **View All is no longer needed and neither is reading the rendered
table**. Swap `type=path` for `referrer`, `country`, `device_type`, `os_name`.
Rows are `{key, total (views), devices (visitors)}`. Funnel events are virtual
pageviews at `/funnel/<event>/<segments>`.

Two gotchas: `browse eval` with an `async () => {}` IIFE returned empty, while
`browse js` with a plain promise chain worked — use `js` plus `--out`. And the
first cookie import may return only anonymous cookies until the macOS Keychain
prompt for "Chrome Safe Storage" is approved.

---

## INSTRUMENTATION CHECKED 2026-08-23. Two of three new events confirmed live

**This was NOT the funnel re-pull.** The events shipped 2026-08-16, so this
window is 7 days, not 30, and the sample (22 visitors, ONE person reaching a plan
screen) cannot answer anything the reading key asks. Pulled only to check the new
events fire at all, because a mis-instrumented event discovered on 2026-09-15
costs the whole 30 days.

| event | status |
|---|---|
| `returned_with_plan{trained}` | **FIRING**, both branches: `true` 2, `false` 2 |
| `meal_photo_started{source}` | **FIRING**, `source=landing` 1, so the new hero door is used |
| `plan_scrolled_to_end` | **zero fires — but not broken, see below** |

**The zero was made unambiguous rather than left as a maybe.** It is wired at
`app.js:151`, pinned by `test/activation-doors.test.js`, and the
`IntersectionObserver` behind it had NEVER been observed firing anywhere: the
preview pane does not fire IO at all (2026-08-16), so ship-time verification could
only demonstrate the fail-safe. Re-tested in real Chromium via `browse` with the
exact production `threshold: 0.4` and `rootMargin: "0px 0px -140px 0px"`: **1
callback, ratio 1.0.** The mechanism works. Only one person reached a plan screen
in seven days, so zero fires is the expected count, not a defect.

**Do not read the funnel from this pull.** 7d shape, recorded only as a
sanity check: 22 landed, 2 clicked a CTA, 2 started onboarding, 1 completed, 1 got
a plan, 2 started a workout (returning users), 1 completed. Also worth one glance
and no conclusions: 30-day visitors are **159, down from 170** at the 2026-08-16
pull, and `meal_photo_succeeded` shows 0 in the last 7 days against 1
`meal_photo_started`. Both are n-of-1 noise. The real pull is still ~2026-09-15.

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

## CLOSED 2026-08-16. Two-device sync is confirmed by a human

Rehaan ran it on real hardware and reported it working. Per-record sync is no
longer proven only by unit tests, an emulator rules gate and a status pill
reading "Synced".

The cases that mattered were deletes (a delete that never issues a real
`deleteDoc` leaves the remote copy alive and the next snapshot resurrects it)
and offline reconnect (a queue that drops writes, or a replay of stale
full-state). Both were the reason this sat open; neither is a concern now.

Nothing to reopen unless a device actually loses a session in the wild.

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

## CLOSED 2026-08-23. Google Fonts is off the critical path

Self-hosted. `fonts/` holds six woff2 files, the `@font-face` rules sit at the
top of `style.css`, and `index.html` preloads only the two faces that paint
first: the hero headline is Literata and body text is Inter. JetBrains Mono is
data styling further down and does not earn a preload slot.

**Variable fonts, one file per family per subset.** The four Inter weights the
UI uses are now one download instead of four. `latin-ext` is a separate file
with its own `unicode-range`, so a browser only fetches it if the page actually
renders Polish or Czech characters. Plain `latin` already covers the accented
names the food log produces, since U+0000-00FF holds e-acute, n-tilde and
c-cedilla.

**Three things that came with it, none of which were the point:**

- The service worker never cached the Google fonts, so an offline launch had
  always been silently dropping to system faces. All six are precached now, and
  a test pins the worker's font list against the `@font-face` sources so the two
  cannot drift.
- The CSP no longer allows `fonts.googleapis.com` or `fonts.gstatic.com`. The
  old test REQUIRED those origins, correctly, because the app linked them. That
  assertion is inverted now, so a future edit cannot quietly reintroduce the
  render-blocking third-party request.
- `scripts/fetch-fonts.mjs` regenerates the files and prints the CSS
  (`npm run fonts`, or `npm run fonts:check` to verify what is on disk). It
  prints rather than splices, because `style.css` has three hand-maintained
  layers that a machine edit should not touch.

**Verified in a browser:** zero requests to Google, all six `@font-face` rules
parsed, `document.fonts.size` is 6, and Literata measures 809.88px against 699.36
for the generic serif and 835.3 for Georgia, so it is genuinely rendering rather
than falling back. Screenshot is pixel-identical to before.

**Read this before you measure fonts here.** The first reading said Literata was
NOT rendering and no `@font-face` rules existed at all. Both were false: a stale
`style.css` was being served from an earlier session's cache, while a
cache-busting `fetch()` saw the new file, so the two disagreed. Inter and
JetBrains Mono appeared to work only because they are installed on this Mac.
Measure on a fresh origin (`spotterai-clean`, port 4188) rather than trusting an
unregister-and-clear. This is the second time a stale worker has produced a wrong
font/SDK reading; see the 2026-08-23 Firebase note.

**Not done, deliberately:** the Firebase SDK deferral that was listed here as a
while-you-are-in-there item shipped separately on 2026-08-23.

---

## CLOSED 2026-08-23. The evaluator benchmark gates PRs

`ci.yml` ran `node --test` and nothing else. The evaluator benchmark ran only in
the Benchmark history job, which is push-to-main only, so it was a post-merge
report rather than a gate: a PR could regress a safety check, go green, and only
be noticed after landing. The evaluator is the product's whole claim, it needs no
key and no network, and `eval.mjs` already exits 1 on failure. There was no
reason it was not a gate.

Lint and typecheck are still absent. Neither is configured in this repo, and
adding a linter is a different decision from closing a gate that already existed.

---

## CLOSED 2026-08-23. HEAD is answered on the telemetry endpoint

`curl -I https://spotterai.xyz/api/audit-telemetry` returned 405 while the
response advertised `Allow: GET, POST`. HEAD is GET without a body (RFC 9110) and
it is what uptime monitors send, so refusing it while claiming to allow GET was a
contradiction a monitor would read as an outage. The GET path serves both now and
`Allow` names all three methods.

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
