# Nutrition plan: explained targets and a weekly check-in

**Date:** 2026-10-05
**Status:** Draft for review. Nothing in this spec is built. Pace bands researched and graded 2026-10-05 (see Phase 2).
**Owner:** Rehaan. Decisions below were made with Rehaan in the 2026-10-05 brainstorm.

## One sentence

Give anyone who logs food a calorie and macro plan they can understand, built from
their own stats and goal, and a weekly check-in that proposes one small change when
their weight trend says the plan is off, which they approve.

## Why

- Targets are a bare number today. Nothing says where it came from, and nothing
  revisits it. The product loop is Plan, Train, Log, Adapt, Re-audit for training;
  nutrition has Plan (once) and Log, and no Adapt.
- Nutrition logging is the best-converting feature (2026-08-16 pull: 8 visitors vs 3
  who started a workout) and needs no plan or signup. The plan must work for someone
  who only logs food.
- Core values apply directly: every number is deterministic and auditable (1),
  limitations are stated (2), data stays on device (3), deficits are one-directional
  and never aggressive (4), no invented figures (5).

## Ground truth about the codebase (verified 2026-10-05)

- Main has **no** stats-based calculator. Targets come from `saferTargets()` in
  `nutrition-safety.js`: `bodyweight x 31` kcal as maintenance, then a goal factor.
- The calculator exists on unmerged branch `nutrition-targets-from-stats`
  (16 commits, last 2026-07-31, no PR): `lib/nutrition-targets.js` (222 lines,
  Mifflin-St Jeor, split activity multiplier, cut/recomp/bulk, under-18 guard,
  `completeMacros`, `targetsDrift`) and `test/nutrition-targets.test.js` (296 lines,
  includes a 48,600-combination sweep against the auditor). An earlier brain note
  described it as shipped. It was not.
- The `x31` maintenance heuristic overestimates by up to ~41% for heavier bodies
  (the branch's sweep: 130 kg, 170 cm, 60+, sedentary reads 4030 vs 2364 kcal), so
  production flags sane targets as aggressive deficits for roughly 8% of plausible
  bodies. **This is live today.**
- `evaluateNutrition` on the branch gains an optional `maintenance` argument. With no
  argument its behaviour is byte-identical. The bug is therefore fixed for a user only
  when a caller passes a real maintenance figure, which needs stats we do not store.
- Onboarding collects height and sex but keeps height only "while you complete setup".
  No body stats persist.
- Targets sync through the `users/<uid>` meta doc (`sync.js`), only for users who opted
  into sync. Bodyweight entries are per-record and dated.
- `nutritionGoalsMet` (protein at or above target, calories within 10%) and
  `nutrition-streaks.js` (shipped 2026-10-05, PR #50) already define "a day that met
  its targets".

## Scope

### Phase 0: salvage the pure core (its own PR, ships first)

Cherry-pick from `origin/nutrition-targets-from-stats`, no UI, **plus one change the
research requires** (the cut-deficit cap in the decision below):

- `lib/nutrition-targets.js`
- `test/nutrition-targets.test.js`
- the `maintenance` argument on `evaluateNutrition` and its added tests

Gate: this touches the safety auditor, so `directives/safety_evaluator_change.md`
applies. `npm run eval` must stay 18/18 caught, 0 false flags. Default behaviour is
unchanged, so Phase 0 alone changes nothing in production. Record the standing-rule
sign-off now: once callers pass `maintenance`, some previously flagged targets stop
flagging, and that is the intended fix.

Re-verify the cherry-picked files against current main (the branch is ~40 cache
versions old) before opening the PR. Do not cherry-pick the branch's UI commits
(onboarding step, drift nudge, setup sheet): they were written against a much older
UI and Phase 1 redesigns them.

### Phase 1: stats, and the plan card

**Stats.** A "Get my targets" setup sheet on the Food diary, on demand:
height, age range, sex (optional, "prefer not to say" allowed), daily activity,
training days per week and session minutes, and eating intent (cut, recomp, bulk).
Intent is pre-picked from the training goal by `intentForGoal` and always
changeable. Training days and minutes prefill from plan inputs when a plan exists
and are asked directly when it does not. Current weight comes from the latest
bodyweight entry; if there is none the sheet asks for one and logs it.

**Storage.** `state.bodyStats` in the tracker store, namespaced per profile like the
rest of tracker state, included in export and import. It syncs inside the existing
`users/<uid>` meta doc next to `targets`, so it is covered by the same opt-in and
nothing new leaves the device for anyone who did not already choose sync. Verify the
meta-doc write path and the export schema in the implementation plan before coding.

**Plan card** ("Your nutrition plan", Food diary):

- calories and protein, carbs, fat from `calculateTargets`
- the calculator's own `basis` line ("around 2,450 kcal maintenance, minus 20%
  for a cut") and protein in g per kg
- confidence (High with sex given, Medium without) and a plain limitations line:
  these are estimates, and the weekly check-in adjusts from your own trend
- the under-18 notice when the guard held targets at maintenance
- "Use these targets" writes `setTargets`; the existing safety verdict card stays
- every call site of `evaluateNutrition` passes the calculator's `tdee` as
  `maintenance` once stats exist (this is the moment the live over-flagging bug is
  actually fixed for that user)

### Phase 2: weekly check-in

Every number in this phase is sourced and graded in
[`docs/rubric-sources.md`, "Nutrition pace"](../../rubric-sources.md#nutrition-pace-the-weekly-check-in),
researched 2026-10-05 from primary records. Read that section before changing any
constant. Where a number is a design choice rather than a finding, it is labelled
one there and must be labelled one in the code, tests and any user-facing text.

Pure module `nutrition-adjust.js`:

```
checkIn({ bodyweights, days, targets, bodyStats, intent, trainingAge, unit, today, lastChangedOn })
  -> { status: "not_ready" | "inconclusive" | "on_track" | "propose", ... }
```

**Evidence gate** (all required, else `not_ready` and no card):

1. At least **28 days** since the targets last changed. The body's response to an
   intake change is slow and decelerating (Hall 2011), so one step is made and then
   given time.
2. At least **12 weigh-ins in the last 28 days**, on at least four different weekdays,
   because weight has a weekday rhythm of about 0.35% (Turicchi 2020, Orsama 2014)
   and weigh-ins bunched on one weekday would read the rhythm as a trend.
3. At least 20 of the last 28 days logged. If the user has been logging and the scale
   and the log disagree (logged intake well below target while weight is not
   falling) the status is `inconclusive` with a distinct, non-accusing message: the
   log may be missing some food. Food logs can be badly wrong (Lichtman 1992), so the
   scale is the measurement and the log is not.

**Signal.** A least-squares line through the window's weigh-ins gives a trend in
percent of bodyweight per week and a one-sided 95% confidence limit on it.
**The check-in speaks only when the whole interval lies outside the user's pace band.**
If the 28-day interval straddles a band edge, extend the window to as much as 42
days (24 weigh-ins) before settling on `inconclusive`. Simulation
(`scripts/simulate-weight-trend.mjs`, results in rubric-sources.md) shows this
flags a genuinely on-pace user at most 0.4% of the time with a 28-day window, versus
1.0% to 13.3% for the earlier "two weekly means agree" rule, which is dropped. The
price is sensitivity: it catches about 60% of true stalls at typical scale noise and
about 27% at pessimistic noise. That is accepted. Silence is the safe failure.

**Pace bands** (percent of bodyweight per week; grade from rubric-sources.md):

| Intent | Too fast | On pace | Grade |
|---|---|---|---|
| Cut | faster than **1.0%** (**0.5%** for lean users) | losing **0.25% to 1.0%** | fast limit Directional (Garthe, Helms, Roberts, ISSN, CDC); lean cut-off and 0.25% slow edge are Practical |
| Bulk | faster than **0.5%** (novice/intermediate), **0.25%** (advanced) | gaining **0.1% to the limit** | fast limit Directional and weaker (Iraki, Helms 2023, Slater says the optimum is unknown); 0.1% slow edge is Practical |
| Recomp | beyond +/-0.25% in either direction counts as moving | within **+/-0.25%** | Practical, noise-derived |

"Lean" is `BMI < 25` from the stats the user gave. That is a proxy: the app has no
body-fat measure and BMI misreads muscular people, so the copy never calls anyone
lean. It only changes which limit applies. Advanced is `trainingAge` from onboarding.

**Proposal rules.**

- One step of **5% of the calorie target, rounded to 25 kcal**. A design choice, not
  a finding: it sits under the 500 kcal/day deficit ceiling (Murphy & Koehler 2022),
  is no finer than the log can be trusted (Lichtman 1992), and is followed by at
  least 28 days before another proposal.
- Direction: too fast on a cut proposes **more** food; a confident stall on a cut
  proposes slightly less **only if** that does not deepen the deficit beyond the
  starting plan. Never chase a plateau downward: adaptation slows a long cut
  (Trexler 2014, Egan & Collins 2022), so a late flat trend is not non-adherence and
  is shown as information, not answered with a deeper cut. Bulks mirror the cut.
- New calories stay at or above `max(LOW_KCAL, BMR)` and below the deficit ceiling in
  the open decision below.
- Macros are re-derived by the calculator (`completeMacros`, protein held at its
  per-kg value).
- The proposal must pass `evaluateNutrition` with no critical or warning flags,
  using the accurate `maintenance`. If it does not, there is no proposal.
- Under-18: never a deficit. A minor can only be proposed maintenance or more.
  This is product policy consistent with, not prescribed by, the AAP's 2023
  guideline (professional, family-based treatment).
- Never auto-applied.
- **Copy never converts a calorie change into a weight prediction** ("100 fewer
  calories is X kg"). The 3,500 kcal rule over-predicts and the dynamic response is
  slow (Hall 2011, Egan & Collins 2022). It reports the observed trend and offers a
  step.

**Surfaces.** A "Weekly check-in" card on the Food diary when `status` is `propose`
or just after the user applies one; a single line on Today only when a proposal is
waiting. Apply or "Not now". Both are remembered per device, keyed by the latest
weigh-in date, so the same evidence is not offered twice (same pattern as the
welcome-back card's handled flag). `on_track` shows once as a quiet positive line, not
a recurring card. `not_ready` shows nothing, except a prompt to weigh in when the
only thing missing is weigh-ins.

**Tone.** Says what was observed and what is on offer, never that the user failed.
A pinned test guards the copy, as with catch-up, welcome-back and the streak card.

### Shared pieces

- Extract `dayNumber` and `ymdFromNumber` from `nutrition-streaks.js` into
  `lib/calendar-days.js` (pure calendar arithmetic through `Date.UTC`). The streak
  module's first draft passed only west of UTC and failed in CI; the check-in does a lot
  more date arithmetic and must not repeat it. All date-touching tests run under
  `TZ=UTC` and at least one far-east zone before any push.
- Weight in lb or kg: store as entered (existing behaviour), convert to kg for the
  calculator and compare percent changes unit-free.

## Testing

- Phase 0: the branch's existing sweep, run on main, plus `npm run eval`.
- Calculator contract: every `calculateTargets` output passes `evaluateNutrition`
  with zero flags across the realistic stat space (already in the branch).
- **Cross-system sweep for Phase 2:** stats x weight trends through `checkIn`, then each
  proposal through `evaluateNutrition`, asserting no proposal is ever flagged and none
  goes below the floor. Prove non-vacuous first (assert that a meaningful share of the
  sweep actually produces proposals).
- **Statistical guarantee as a test:** a seeded simulation using the documented noise
  levels (0.4%, 0.5%, 1.0% per weigh-in, plus the 0.35% weekday rhythm) asserts the rule
  flags a truly on-pace user at most 1% of the time with the 28-day gate satisfied. If
  someone loosens the gate or the confidence level, that test fails.
- Gate edges, band edges, the "log and scale disagree" branch, one-step-per-28-days,
  kg and lb, minors, weigh-ins bunched on one weekday, a window with no weigh-in,
  plateau-chasing refused.
- Tone: banned-word test over every string, including the minor notice.
- Timezones: the date suite under UTC, America/Los_Angeles, Asia/Bangkok,
  Pacific/Auckland.
- UI: browser-verified in light, dark and at 375px, run through the impeccable craft
  floor (real heading, no eyebrow, list not a card grid), plus a real-phone check.

## Out of scope

- Meal or food suggestions, "healthy" or "unhealthy" food judgements, junk-food flags
  (ruled out 2026-10-05, see brain note on consistency streaks).
- Estimating a user's real maintenance from intake and weight change.
- Per-meal macro distribution, target dates, medical conditions, supplements.
- Auto-applying any change.
- The branch's onboarding step and drift nudge as written.

## Decision: the cut deficit cap (decided 2026-10-05, Rehaan chose option 2)

**The salvaged calculator cut calories by a flat 20% of maintenance. Murphy & Koehler's
meta-regression (2022) found a deficit of about 500 kcal/day prevented lean-mass gains
in resistance training and advise staying under it when the aim is to preserve muscle.**
At maintenance above 2,500 kcal (common for men who lift) 20% is more than 500 kcal. The
ISSN position stand says people with more body fat can take a larger deficit.

**Chosen: cap the cut deficit at 500 kcal/day for BMI under 30; keep the flat 20% at
BMI 30 and over.** The BMI split is a proxy and a design choice, labelled as one in the
code and in rubric-sources.md. It follows both sources.

Consequences for the plan:

- Phase 0 is therefore not a pure cherry-pick: `calculateTargets` changes
  (`deficit = bmi < 30 ? min(0.20 x TDEE, 500) : 0.20 x TDEE`, cut intent only; BMI from
  the same `kg` and `cm` it already receives). Bulk and recomp are unchanged.
- Its 48,600-combination sweep must still pass: every output through `evaluateNutrition`
  with zero flags. A smaller cut only moves targets toward maintenance, so it should, but
  the sweep is the proof, not this sentence.
- The calorie floor `max(LOW_KCAL, BMR)` still applies after the cap.
- The Phase 2 proposer may not deepen a cut past this starting deficit (already a rule).
- `basis` copy ("maintenance minus 20% for a cut") must state the real figure for
  the user's case, for example "about 500 kcal under maintenance".
- Add a calculator test pinning the cap at both sides of BMI 30 and at the 2,500 kcal
  crossover.

## Risks and open items

- **The evidence is thinner than the numbers look.** Almost every rate figure comes from
  lean athletes in short trials of 17 to 24 people; none tests these bands on recreational
  lifters. The bulk optimum is explicitly unknown (Slater 2019). The graded section says so;
  user-facing copy must never claim research backing for a band, only describe it as a
  conventional range.
- **Sensitivity is low by design.** The rule misses most true stalls at pessimistic scale
  noise. The copy for `inconclusive` and `not_ready` must not imply the user is doing
  something wrong, and must not promise a check-in will arrive.
- **Half-logged days** read as under-eating and cannot be told apart. The adherence
  gate reduces the harm but cannot eliminate it. State it in the card's limitations.
- **Stats in sync.** Adding `bodyStats` to the meta doc must not break older clients
  reading that doc. Verify before coding.
- **Disordered-eating risk.** A weekly calorie-adjusting card is the feature most
  likely to be misused. The one-directional rules, the floor, no auto-apply, the
  under-18 guard, and no streak or reward for hitting a lower number are all
  load-bearing. Any future change that loosens one needs the safety directive.
- **Auditor behaviour change.** Passing `maintenance` removes false flags for ~8% of
  bodies. Record the rule 6 sign-off in the Phase 0 PR.

## Delivery

Three PRs, in order: Phase 0 salvage, Phase 1 stats and plan card, Phase 2 check-in.
Each gets its own branch, cache bump, README count update, and brain note. Phase 0 is
independently shippable and low risk.
