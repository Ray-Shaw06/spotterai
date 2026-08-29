# Design: consistency, cardio programming, and rest alarms that actually fire

**Date:** 2026-08-29
**Status:** approved, building

Three problems, one release. They share a theme: the app is only useful on the
days you are busy, and today it quietly fails on exactly those days.

---

## Problem 1. Logging depends on remembering

Every write is manual and every write assumes you are in the app at the moment
the thing happened. Miss the moment and the day is gone: `addWorkout` stamps
`today()`, the workout UI has no date control, and nothing on any screen tells
you what is still unlogged.

**Not solvable with reminders.** `2026-07-22_web-push-retired-for-zero-cost-notifications`
retired the whole push path and set a hard rule: no promise of any notification
after the app is closed. That decision holds. So the fix is not to nag harder,
it is to make forgetting cost nothing.

### Design

**`catch-up.js` (new, pure).** `openItems({ now, plan, stats, water, targets })`
returns `[{ id, label, act, date, tone }]`, the things today (and yesterday)
are still missing. Pure and DOM-free so it unit-tests like `today.js` does.

Rules, deliberately quiet:

| item | appears when |
|---|---|
| `workout` | a training day is due, none logged today, and the local hour is >= 17 |
| `nutrition` | zero nutrition rows today and hour >= 13 |
| `weight` | no bodyweight in 7 days and hour >= 9 |
| `yesterday` | yesterday has zero workouts AND zero nutrition rows |

Never shaming. Copy is "still open", never "you missed". The card does not
render at all when the list is empty, so a fully logged day sees nothing.

**Backfill.** `addWorkout` already accepts `date`; the UI never passes one. Add
a date control to the workout save flow (matching the one nutrition already has
at `nutrition-ui.js:172`) so a session can be logged against a past day. Bounded
to the last 14 days, so a typo cannot land a workout in 2019.

**One-tap repeat.** `repeatLastWorkout(date)` in `tracker-store.js` clones the
most recent logged workout, sets, reps and weights intact, onto `date`. Nutrition
already has "⟳ Yesterday"; workouts get the same affordance.

**`addRoutine` cardio bug (found here, fixed here).** It rebuilds sets as
`{ weight, reps }` only, dropping `durationMin`, `distance` and `durationSec`.
Save a run as a routine today and it comes back as an empty set. It must use the
same field set `cleanExercises` does.

---

## Problem 2. The app cannot program cardio

The logging layer already knows about cardio: `workout-ui.js:512` branches on it,
sets carry `durationMin` and `distance`, and the catalog has 20 cardio entries.
Everything upstream of logging is blind to it. `evaluator.js`, `repair.js`,
`adapt-engine.js` and `api/generate.js` contain no cardio logic at all, and
`CARDIO_PREFS` is collected in onboarding then dropped on the floor:
`mapOnboardingToInputs` never reads `d.cardio`.

The practical failure is the one that prompted this: run hard on Tuesday, and
Wednesday's plan still prescribes the same squat volume, because nothing
connects the two.

### Design

**Schema (`lib/plan.js`).** One schema, extended, not a second one. An exercise
entry gains three optional fields:

```
{ name, sets, reps, rpe, notes,
  type: "lift" | "cardio",       // inferred when absent
  durationMin: number | null,     // cardio only
  intensity: "easy" | "moderate" | "hard" | null }
```

`normalizePlan` infers `type` from `isCardioExercise(name)` when the model does
not send it, so every plan already saved upgrades itself on read and no
migration is needed.

**Evaluator (`evaluator.js`), two new checks.**

- `cardio_load`: total weekly cardio minutes against experience and goal. Also
  fires when the user asked for cardio and the plan contains none.
- `cardio_conflict`: hard cardio (`intensity: "hard"`, or a sprint/HIIT/run name)
  on the same day as heavy lower-body work, or on the day immediately before a
  leg day. This is the actual complaint, encoded as a rule.

Both follow the house discipline for new checks: **zero-weight penalties**
(`PENALTY.cardio_load`, `PENALTY.cardio_conflict` = `{ warn: 0, fail: 0 }`), the
same treatment `muscle_frequency`, `equipment_fit` and `progressive_overload`
got on introduction, so adding them cannot move any existing case's score.

**Both checks are emitted conditionally**, only when the plan contains cardio or
the user asked for cardio. This is the `checkInjuries` pattern (it already
spreads a variable number of rows). It matters: an unconditional check would add
a row to all 21 benchmark cases and to `summary.total`, and would break
`test/evaluator.test.js:391` and `test/cross-path-sweep.test.js:144`, which both
assert a full-input audit has zero `not_assessed` rows. Conditional emission
means every existing case is byte-identical.

**Repair (`repair.js`).** `cardio_conflict` moves the cardio block to a
non-adjacent day, or downgrades it to `easy` when no day is free.
`cardio_load` trims or adds minutes toward the requested amount.

**Adapt (`adapt-engine.js`).** A new transform between adherence pullback and
deload: hard cardio logged in the last 48 hours ahead of a leg-dominant day
trims leg accessory sets and writes a load note. `buildAdaptContext` gains a
`cardio: { weeklyMinutes, recentHard: [{ date, name, durationMin }] }` block so
the engine reads real logs, not a guess. Every change bullet still cites a real
number, per the engine's existing contract.

**Generator (`api/generate.js`).** When `inputs.cardio` is "A little" or "Lots",
the prompt asks for cardio days with the conflict rule stated up front, and
`SCHEMA_HINT` carries the new fields. `mapOnboardingToInputs` finally passes
`cardio` through.

---

## Problem 3. The rest timer does not fire with the screen off

Two independent bugs, both in `workout-ui.js`.

**Bug 1, `workout-ui.js:227`.** The countdown is `restRemaining -= 1` on a 1s
`setInterval`. Mobile browsers clamp or freeze background timers on screen lock,
so the countdown stops with the screen and resumes when you unlock. The alert is
not late by a second, it is late by however long the phone was in your pocket.

**Bug 2, `workout-ui.js:266`.** `beep()` constructs a brand new `AudioContext`
at fire time, outside any user gesture. iOS starts such a context suspended, so
even when the timer does fire there is no sound.

### Design

**`rest-alarm.js` (new).** `createRestAlarm()` returns `{ arm, disarm, remaining }`.

1. **Wall-clock deadline.** `endsAt = Date.now() + sec * 1000`. Ticks recompute
   from the clock, so a frozen interval loses display frames and never loses
   time.
2. **Pre-scheduled tone.** `arm()` is called from the set-done tap, a real user
   gesture, so the AudioContext can be resumed there and the tone is scheduled
   on the audio timeline with `source.start(ctx.currentTime + remaining)`.
   Web Audio scheduling runs on the audio thread and is not subject to timer
   throttling, which is what makes the sound land on time.
3. **Silent keepalive.** An inaudible looping buffer holds the context in the
   `running` state while backgrounded; iOS suspends a context with no active
   source. `MediaSession` metadata is set alongside it so the session is visible
   on the lock screen rather than being an invisible background player.
4. **Catch-up on wake.** A `visibilitychange` handler fires the alert
   immediately if the deadline passed while hidden and nothing fired. Worst
   case degrades to today's behaviour, never worse.
5. **Cleanup.** `disarm()` stops the keepalive; ending the session disarms.
   Nothing keeps the audio thread alive outside an armed rest period.

**Honest limit, stated in the module header and the UI:** if the OS evicts the
tab or the user force-quits the app, nothing fires. This is a page-alive alarm,
not a scheduled push, and the hard rule from 2026-07-22 still stands.

---

## Testing

Node's built-in runner, matching the existing 73 files. New: `test/catch-up.test.js`,
`test/rest-alarm.test.js`, `test/cardio-evaluator.test.js`, `test/cardio-adapt.test.js`,
plus cases added to the existing plan-schema, repair and onboarding suites. Two
cardio cases join `eval-suite.js` (one conflict, one clean) so the benchmark
covers the new rules.

Gates: `npm test`, `npm run eval` (CI gates PRs on it), and the existing
21-case benchmark must come back unchanged for every pre-existing case.

## Not doing

Push notifications, Apple Health / Strava import, and GPS route tracking. The
first breaks the zero-cost rule; the other two need a native app or an OAuth
backend, and neither is reachable from a static PWA.
