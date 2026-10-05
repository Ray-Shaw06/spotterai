# Nutrition plan: explained targets and a weekly check-in

**Date:** 2026-10-05
**Status:** Draft for review. Nothing in this spec is built.
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

Cherry-pick from `origin/nutrition-targets-from-stats`, no UI:

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

Pure module `nutrition-adjust.js`:

```
checkIn({ bodyweights, days, targets, bodyStats, intent, unit, today, lastChangedOn })
  -> { status: "not_ready" | "on_track" | "propose", ... }
```

**Evidence gate** (all required, else `not_ready` and no card):

1. At least 21 days since targets last changed.
2. Weigh-ins in each of the last three 7-day windows.
3. At least 10 of the last 14 days logged, and the average logged calories within
   15% of the target. If the user has not been eating to the target the right answer is
   "log a bit more", never "change the target". This is a distinct `not_ready` reason
   with its own copy.

**Signal.** Mean weight per 7-day window gives two consecutive weekly changes
(week 1 to 2, week 2 to 3), each as a percent of bodyweight. A proposal needs both
changes to agree on direction relative to the intent's band. One noisy week, or
water weight, cannot trigger it.

**Pace bands. DEFAULTS, NOT SOURCED.** Cut about -0.25% to -1.0% of bodyweight per
week, bulk about +0.1% to +0.5%, recomp about +/-0.25%. These are conventional
figures from my own knowledge of coaching practice and are not in
`docs/rubric-sources.md`. They live as named constants with a comment saying so,
exactly as the return-ramp thresholds do. Before this ships, either source them
(add to `rubric-sources.md` with the citation) or keep the "defaults" label in the
code, tests and docs. Do not cite them as evidence in any user-facing copy.

**Proposal rules.**

- One step of about 100 kcal, rounded to 25, at most one proposal per 14 days.
- Direction: a stalled or reversing cut proposes slightly fewer calories; a bulk gaining
  too fast or a cut losing too fast proposes more; a stalled bulk proposes more.
  Anything losing faster than the band only ever proposes **more** food.
- New calories must stay at or above `max(LOW_KCAL, BMR)`, the same floor the
  calculator uses.
- Macros are re-derived by the calculator (`completeMacros` with protein held at its
  per-kg value), never hand-adjusted.
- The proposed targets must pass `evaluateNutrition` with no critical or warning flags,
  evaluated with the accurate `maintenance`. If they do not, there is no proposal.
- Under-18: never a deficit. A minor can only be proposed maintenance or more.
- Never auto-applied.

**Surfaces.** A "Weekly check-in" card on the Food diary when `status` is `propose`
or just after the user applies one; a single line on Today only when a proposal is
waiting. Apply or "Not now". Both are remembered per device, keyed by the latest
weigh-in date, so the same evidence is not offered twice (same pattern as the
welcome-back card's handled flag). `on_track` shows once as a quiet positive line, not
a recurring card.

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
- Gate edges, band edges, the "log more" branch, one-step-per-14-days, kg and lb, minors,
  weigh-in gaps, a week with no weigh-in.
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

## Risks and open items

- **Pace bands are unsourced.** Decide before Phase 2 ships: source them or keep the
  defaults label everywhere. Never claim research backing without a citation.
- **Weigh-in noise.** Three weekly means and a two-week agreement rule cut noise but
  do not remove it. The copy must say "your trend over three weeks", not a diagnosis.
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
