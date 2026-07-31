# Nutrition targets from user stats

**Date:** 2026-07-28
**Status:** Approved, ready for implementation planning

## Problem

Nutrition targets today are barely personalized and internally inconsistent.

On finishing onboarding, `onboarding-ui.js:179` calls `saferTargets()` from
`nutrition-safety.js`, which estimates maintenance as `bodyweight × 31 kcal/kg`
and nothing else. It sets `kcal` and `protein` only. Carbs and fat keep the
hardcoded defaults from `tracker-store.js:21` (250 g and 70 g), so a user's
macro targets do not add up to their own calorie target.

Height, age range, and sex are already collected during onboarding and then
thrown away. Activity level is never asked. And there is no concept of eating
intent: whether a user wants to cut, recomp, or bulk is inferred by regex on
the training goal (`/loss|lean|cut|deficit|shred/i`).

## Goals

1. Calculate calorie and macro targets from the user's actual stats.
2. Drive those targets from an explicit cut / recomp / bulk intent.
3. Keep targets current as bodyweight changes, without changing numbers behind
   the user's back.
4. Bring existing users into the new system without overwriting what they have.

## Non-goals

- Meal planning or food prescription. This sets targets, nothing more.
- Rewriting the audit layer. `nutrition-safety.js` gains one optional parameter
  (see "Auditor accuracy fix"); every check and threshold it owns is unchanged.
- Body-fat-percentage input and Katch-McArdle. Mifflin-St Jeor is accurate
  enough for this purpose and needs no extra measurement.

## Core principle: the calculator is audited, not trusted

Core value 1 says every generated output passes a deterministic check. The
calculator is a new thing that produces nutrition numbers, so its output runs
through the existing `evaluateNutrition()` before it is ever applied, and flags
surface in the UI exactly as they do for manually entered targets.

If the calculator is correct, that audit should always come back clean. A sweep
test asserts exactly that across the realistic stat space (see Testing). The two
systems then prove each other, and the test fails loudly if a future change to
either one breaks the agreement.

Writing that sweep is what surfaced the auditor bug below. Keep the sweep: it is
the highest-value test in this change.

## Auditor accuracy fix (signed off 2026-07-28)

Building the sweep exposed a bug that predates this feature. `evaluateNutrition`
estimates maintenance as `bodyweight × MAINTENANCE_KCAL_PER_KG` (31 kcal/kg).
That scales linearly with bodyweight, but fat mass is far less metabolically
active than lean mass, so real kcal/kg *falls* as weight rises. The heuristic
therefore overestimates maintenance badly for heavier bodies:

> 130 kg, 170 cm, 60+, female, sedentary: heuristic says **4030 kcal**,
> Mifflin-St Jeor says **2364 kcal**. A 41% overestimate.

The consequence is that the auditor treats any sensible target for a heavier
user as a starvation deficit. Against the initial sweep it spuriously flagged
**5182 of 48600** combinations (8.0% of plausible-BMI bodies), concentrated in
cuts (2659) and sedentary users (1843). This mis-flags hand-entered targets in
production today, independent of this feature.

**Fix.** `evaluateNutrition` gains one optional parameter:

```js
evaluateNutrition({ targets, bodyweight, unit, goal, maintenance = null })
```

When `maintenance` is a positive number it is used for the deficit check.
Otherwise the function falls back to `kg × MAINTENANCE_KCAL_PER_KG` exactly as
today. Callers with real stats (the new calculator, and the Nutrition page once
`bodyStats` exists) pass the Mifflin-derived TDEE.

**What this does not change.** Every absolute boundary stands untouched: the
1000 and 1200 kcal floors, the 1.2 g/kg protein floor, the 15% fat floor, and
the 30% `AGGRESSIVE_DEFICIT` ratio itself. Only the maintenance figure that
ratio is measured against gets more accurate.

**Verification already run:**

- 48600 calculator outputs against the patched auditor: **0 flags**.
- 6250 legacy calls with no `maintenance` argument: **0 behavioral differences**
  from the current implementation.

This project treats the safety and evaluator files as change-controlled: any
edit that causes previously-flagged cases to stop flagging needs explicit
sign-off before shipping. This change does that, and was signed off.

The new under-18 guard is a separate safety boundary and is treated under the
same directive on its own terms (see below).

## The math

New module `lib/nutrition-targets.js`, alongside the existing
`lib/nutrition-math.js`. Pure, no DOM, no network, fully unit-testable.

### BMR: Mifflin-St Jeor

```
BMR = 10 × kg + 6.25 × cm − 5 × age + s
```

`s` is `+5` for male, `−161` for female, and `−78` (the midpoint) when sex is
unset or "Prefer not to say". The midpoint costs about 83 kcal of precision,
which is reported honestly rather than hidden (see Confidence).

Age comes from the existing `AGE_RANGES` chips via midpoints. Note the strings
use en dashes, matching `onboarding.js:25`:

| Range | Age used |
|---|---|
| `Under 18` | 17 |
| `18–29` | 24 |
| `30–44` | 37 |
| `45–59` | 52 |
| `60+` | 65 |

A ten-year window is worth about 25 kcal in Mifflin-St Jeor, far inside the
error bar of the estimate as a whole. Not worth adding a numeric age field for.

### Activity multiplier

Split into lifestyle and training so training volume is not double-counted.
Onboarding already knows days per week and session length, so only lifestyle is
a new question.

```
multiplier = lifestyleBase + min(0.35, 0.06 × weeklyTrainingHours)
```

clamped to `[1.2, 1.9]`.

| Daily activity | Base |
|---|---|
| Mostly sitting | 1.20 |
| On my feet some | 1.35 |
| On my feet all day | 1.50 |

Calibration check against the conventional single-axis multipliers:

| Person | Result | Conventional equivalent |
|---|---|---|
| Desk job, 3×45 min | 1.335 | Lightly active (1.375) |
| Desk job, 4×60 min | 1.44 | Between light and moderate |
| Desk job, 6×90 min | 1.55 | Moderately active (1.55) |
| On feet all day, 6×90 min | 1.85 | Extra active (1.9) |

### Intent to calories

| Intent | Factor | Protein |
|---|---|---|
| Cut | 0.80 | 1.8 g/kg |
| Recomp | 1.00 | 1.8 g/kg |
| Bulk | 1.10 | 1.6 g/kg |

A 20% cut sits inside the existing `AGGRESSIVE_DEFICIT` threshold of 30%, so the
calculator can never produce a target that its own auditor flags. A 10% surplus
is a lean bulk, roughly a quarter to half a pound per week.

Result is floored at `max(NUTRITION_THRESHOLDS.LOW_KCAL, BMR)`, reusing the
existing constant so there is one source of truth for the floor. Calories are
rounded to the nearest 25.

### Macros

```
proteinG   = round(proteinPerKg × kg)
fatKcal    = kcal × 0.25
carbKcal   = kcal − proteinG × 4 − fatKcal
```

Fat at 25% has real headroom over the existing `FAT_PCT_VERY_LOW` guard of 15%.
Protein at 1.6 to 1.8 g/kg sits inside the 1.6 to 2.2 g/kg range that
`nutrition-safety.js` already recommends and well above its 1.2 g/kg floor.

Two guards for the tails:

1. If carbs would fall below 10% of calories, walk fat down toward 20% (not
   below) to make room before shrinking carbs further.
2. Cap protein at 40% of calories as a final backstop. This is unreachable for
   any real body given the BMR floor, but it means carbs can never go negative.
   At the cap a 150 kg person still gets about 1.6 g/kg, above the safety floor.

Macros are rounded to the nearest gram, then asserted in tests to reconstruct
the calorie total within 2% via `macroKcal()` from `lib/nutrition-math.js`.

### Worked example

Male in the `18–29` range (so age 24 is used), 178 cm, 80 kg, desk job, 4
sessions of 60 minutes.

```
BMR        = 10(80) + 6.25(178) − 5(24) + 5   = 1797.5
multiplier = 1.20 + min(0.35, 0.06 × 4)       = 1.44
TDEE       = 1797.5 × 1.44                    = 2588.4
```

| | Cut | Recomp | Bulk |
|---|---|---|---|
| kcal | 2075 | 2600 | 2850 |
| protein | 144 g | 144 g | 128 g |
| carbs | 245 g | 344 g | 406 g |
| fat | 58 g | 72 g | 79 g |

Carbs are derived from unrounded protein and fat energy, then rounded once, so
they do not inherit the fat rounding error.

Every one of these passes `evaluateNutrition()` with zero flags.

### Under-18 guard (new safety boundary)

`AGE_RANGES` includes "Under 18" and nothing in the codebase currently treats
minors differently. This change introduces a system that prescribes calorie
deficits, so it also introduces the guard.

When the age range is "Under 18", the calculator returns **maintenance targets
regardless of the selected intent**, along with an explanation the UI must show:

> During growth years SpotterAI won't set a calorie deficit. These are
> maintenance targets. For weight goals at your age, please talk to a doctor or
> a registered dietitian who knows your history.

This is a tightening, not a loosening, so it needs no sign-off. It still gets
its regression test written first, and the red-team suite runs before shipping.

### Confidence

Reported honestly per core value 2.

| Confidence | When |
|---|---|
| High | Height, weight, age range, and a stated sex all present |
| Medium | Sex is unset or "Prefer not to say" (±83 kcal) |

The calculator returns `null` when height or weight is missing, since
Mifflin-St Jeor cannot run without both. Callers fall back to today's
`saferTargets()` behavior.

## Module API

```js
// lib/nutrition-targets.js
export const NUTRITION_INTENTS;   // [{ value, label, blurb, kcalFactor, proteinPerKg }]
export const DAILY_ACTIVITY;      // [{ value, label, base }]
export const AGE_MIDPOINTS;       // { "Under 18": 17, ... }

export function estimateBmr({ kg, cm, age, sex });
export function activityMultiplier({ dailyActivity, daysPerWeek, sessionLength });
export function estimateTdee({ kg, cm, age, sex, dailyActivity, daysPerWeek, sessionLength });
export function calculateTargets({ kg, cm, ageRange, sex, dailyActivity, daysPerWeek, sessionLength, intent });
export function intentForGoal(goalValue);
export function targetsDrift(currentTargets, calculatedTargets);
```

`calculateTargets` returns `null`, or:

```js
{
  kcal, protein, carbs, fat,   // the targets
  bmr, tdee, multiplier,       // the working, for the basis line
  intent,
  confidence,                  // "High" | "Medium"
  basis,                       // plain-English sentence for the UI
  notice,                      // the under-18 message, or null
}
```

## Data model

New `bodyStats` object in the `tracker-store.js` state, persisted per profile
and included in export/import:

```js
bodyStats: {
  heightCm: null,
  ageRange: null,       // one of AGE_RANGES
  sex: null,            // "Male" | "Female" | "Prefer not to say"
  dailyActivity: null,  // "sitting" | "some" | "onfeet"
  intent: null,         // "cut" | "recomp" | "bulk"
  daysPerWeek: null,
  sessionLength: null,
}
```

Bodyweight is not duplicated here. It comes from the existing `bodyweight[]`
log, falling back to the weight entered during onboarding.

New accessors `getBodyStats()` and `setBodyStats(partial)` follow the existing
`getTargets`/`setTargets` shape.

### Privacy consequence

Onboarding currently deletes its localStorage on finish, and
`onboarding-ui.js:89` tells the user *"height is saved only while you complete
setup."* Recalculation is impossible without persisting height, so that copy
becomes false and must change to say height is saved on this device to keep
targets current. Data stays local-only, so core value 3 holds, but the sentence
has to stop lying (core value 5).

## Onboarding: new Nutrition step

`ONBOARDING_STEPS` becomes:

```
Goal · About you · Schedule · Nutrition · Safety · Preferences
```

It goes after Schedule because the activity multiplier needs days per week and
session length.

**Fields:**

- Cut / recomp / bulk chips, pre-selected from the training goal, changeable.
- Daily activity chips (the three options above).

**Live preview.** Below the fields, the resulting calories and macros render and
update as chips are tapped, with the basis line underneath. This is what makes
the step feel like a payoff rather than another form.

**Goal to intent mapping:**

| Training goal | Default intent |
|---|---|
| Lose fat | Cut |
| Build muscle | Bulk |
| Get stronger | Recomp |
| General fitness | Recomp |
| Return to consistency | Recomp |

**Skipped stats.** The step is skippable (`isOptionalStep()`). If height or
weight were skipped on the About you step, the preview is replaced with a line
explaining that height and weight are needed for calorie and macro targets, and
`finish()` falls back to today's `saferTargets()` seeding.

**On finish.** `finish()` persists `bodyStats`, computes targets, runs them
through `evaluateNutrition()`, and applies them via `setTargets()` including
carbs and fat, which fixes the inconsistent-defaults bug.

## Nutrition page

The targets form gains a "From your stats" block showing:

- Current intent and daily activity, both editable in place.
- The calculated targets and the plain-English basis line, for example:
  *"Around 2,590 kcal maintenance, minus 20% for a cut."*
- A recalculate action.
- The under-18 notice when applicable.

Manual edits still win and are still audited exactly as they are today. For
users with no `bodyStats`, this block is the always-available entry point into
the setup sheet.

## Drift nudge

Targets recompute in the background from the latest logged bodyweight. When the
calculated calories differ from the saved target by 100 kcal or more, a
dismissible banner offers the new numbers with a one-tap Apply.

Nothing changes without that tap.

Dismissal stores the calorie value that was dismissed, following the
`first-week-ui.js` localStorage pattern. The banner returns only when the newly
calculated value drifts another 100 kcal from the dismissed one, so a user who
keeps losing weight is eventually re-offered, but is not nagged about the same
number twice.

## Returning-user prompt

Existing users have no `bodyStats` and would otherwise never see any of this.

**Component:** a dismissible card at the top of Today, mounted the same way
`first-week-ui.js` is (a mount div in `index.html`, a `*-ui.js` module,
localStorage dismiss state).

**Shown when:** the user has existing tracker data and `bodyStats` is missing or
incomplete. Users completing onboarding get `bodyStats` set at finish, so they
never see it.

**Action:** opens the same Nutrition step content as a standalone sheet, asking
only for what is missing. Bodyweight usually already exists in the log, so for
most users this is height, age range, sex, activity, and intent.

**It never overwrites silently.** These users may have hand-tuned targets. The
sheet shows the calculated numbers and requires an explicit "Use these targets"
tap. Same consent rule as the drift nudge.

**Dismiss is permanent, with no re-nagging.** The Nutrition page block is the
path back in. Users who never engage keep their current targets, which continue
to work.

## Testing

New `test/nutrition-targets.test.js`, run under the existing `node --test`:

- BMR matches published Mifflin-St Jeor values for reference cases.
- Unknown sex lands strictly between the male and female results.
- Multiplier clamps at 1.2 and 1.9 at the extremes.
- For identical stats, `cut < recomp < bulk` in calories.
- Calories never fall below `max(LOW_KCAL, BMR)`.
- Macros reconstruct the calorie total within 2% via `macroKcal()`.
- Protein is always at least 1.2 g/kg; fat is always at least 15% of calories.
- Returns `null` when height or weight is absent.
- **Under-18 regression case, written first:** intent "cut" with age range
  "Under 18" returns maintenance calories and a non-null `notice`.
- **Sweep:** the cartesian product of realistic stats (weights 45 to 150 kg,
  heights 150 to 200 cm, every age range, every sex, every activity level,
  every training volume) crossed with all three intents, which is 48600
  combinations. Each one is passed to `evaluateNutrition()` along with its
  stats-derived `maintenance`. Assert **zero flags** for every combination.
  This is the test that caught the auditor bug; it is the most valuable
  assertion in the change.

In `test/nutrition-safety.test.js`:

- A positive `maintenance` argument is used for the deficit check instead of
  the `× 31` heuristic.
- Omitting `maintenance` reproduces today's behavior exactly, including on a
  case that currently flags.
- A heavy-body case that flags spuriously under the heuristic does not flag
  when the accurate maintenance is supplied.
- `intentForGoal` mapping for all five goal values.
- `targetsDrift` fires at 100 kcal and not at 99.

Before shipping, per the safety-change checklist:

```
npm test
npm run eval
npm run eval:nutrition
```

plus the Safety Lab red-team suite in-browser.

## Files touched

**New**

- `lib/nutrition-targets.js`
- `test/nutrition-targets.test.js`
- `nutrition-prompt-ui.js` (returning-user card and setup sheet)

**Modified**

- `onboarding.js` — new step in `ONBOARDING_STEPS`, intent mapping, re-exports
- `onboarding-ui.js` — `stepNutrition()`, render list, validation, `finish()`,
  privacy copy fix at line 89
- `tracker-store.js` — `bodyStats` in defaults, merge, accessors, export/import
- `nutrition-ui.js` — "From your stats" block, drift nudge banner, pass
  `maintenance` into `evaluateNutrition` when `bodyStats` exists
- `nutrition-safety.js` — one optional `maintenance` parameter, nothing else
- `test/nutrition-safety.test.js` — cases for the new parameter and for
  backward compatibility when it is absent
- `index.html` — mount div, targets form additions, script tag
- `style.css` — styles for the new step, card, and banner

## Copy

All user-facing strings avoid em dashes, matching commit `8a4a72c`.
