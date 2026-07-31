# Nutrition Targets From Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Calculate calorie and macro targets from a user's real stats, driven by an explicit cut/recomp/bulk intent, replacing the bodyweight-only seeding that leaves carbs and fat inconsistent with the calorie target.

**Architecture:** A new pure module `lib/nutrition-targets.js` computes BMR (Mifflin-St Jeor), an activity multiplier split into lifestyle and training components, then calories and macros per intent. It PRESCRIBES; the existing `nutrition-safety.js` AUDITS. A sweep test proves every prescription passes the audit cleanly. UI layers (a new onboarding step, a Nutrition page block, a returning-user card) read and write a new `bodyStats` object in `tracker-store.js`.

**Tech Stack:** Vanilla ES modules, no build step. Tests run under `node --test`. Browser-side state in `localStorage` via `tracker-store.js`.

**Spec:** `docs/superpowers/specs/2026-07-28-nutrition-targets-from-stats-design.md`

## Global Constraints

- **No em dashes in user-facing copy.** Use periods, commas, or colons. Matches commit `8a4a72c`. Code comments in this repo do use them; match surrounding comment style.
- **ES modules only.** No build step, no bundler, no new dependencies.
- **`AGE_RANGES` strings use en dashes** (`"18–29"`, not `"18-29"`). Copy them exactly from `onboarding.js:25`.
- **Pure modules stay pure.** `lib/*.js` must import no DOM and no network. `nutrition-safety.js` must stay importable under plain Node.
- **`tracker-store.js` cannot be unit tested.** It references `window` at module load and throws `window is not defined` under `node --test`. Changes there are verified in the browser preview, not by a test file.
- **Safety change control applies.** `nutrition-safety.js` is change-controlled. Task 6 is the only task permitted to touch it, its scope is one optional parameter, and its regression tests are written first.
- **Before the final commit:** `npm test`, `npm run eval`, `npm run eval:nutrition`, and the in-browser Safety Lab red-team suite must all pass.

## File Structure

| File | Responsibility |
|---|---|
| `lib/nutrition-targets.js` (new) | All target math. Constants, BMR, multiplier, TDEE, macro split, intent mapping, drift detection. Pure. |
| `test/nutrition-targets.test.js` (new) | Unit tests plus the cross-system sweep against `evaluateNutrition`. |
| `nutrition-safety.js` (modify) | Gains one optional `maintenance` parameter. Nothing else changes. |
| `test/nutrition-safety.test.js` (modify) | Regression cases for that parameter. |
| `tracker-store.js` (modify) | `bodyStats` persistence and accessors. |
| `onboarding.js` (modify) | New step label, re-exports for the UI. |
| `onboarding-ui.js` (modify) | The Nutrition step, its live preview, and `finish()` wiring. Privacy copy fix. |
| `nutrition-ui.js` (modify) | "From your stats" block and the drift nudge banner. |
| `nutrition-prompt-ui.js` (new) | The returning-user card and its setup sheet. Own file so `nutrition-ui.js` does not grow further; it is already 37 KB. |
| `index.html` (modify) | Mount div, targets form additions, script tag. |
| `style.css` (modify) | Styles for the new step, block, card, and banner. |

---

### Task 1: Core math (BMR, activity multiplier, TDEE)

**Files:**
- Create: `lib/nutrition-targets.js`
- Test: `test/nutrition-targets.test.js`

**Interfaces:**
- Consumes: `NUTRITION_THRESHOLDS` from `../nutrition-safety.js` (verified importable under plain Node).
- Produces: `NUTRITION_INTENTS`, `DAILY_ACTIVITY`, `AGE_MIDPOINTS`, `MINOR_NOTICE`, `DRIFT_KCAL`, `estimateBmr({kg, cm, age, sex}) -> number|null`, `activityMultiplier({dailyActivity, daysPerWeek, sessionLength}) -> number`, `estimateTdee(stats) -> number|null`.

- [ ] **Step 1: Write the failing test**

Create `test/nutrition-targets.test.js`:

```js
/**
 * Tests for stats-based nutrition targets — Mifflin-St Jeor, a split
 * lifestyle/training activity factor, and macros that stay inside the
 * boundaries nutrition-safety.js enforces.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  estimateBmr,
  activityMultiplier,
  estimateTdee,
  AGE_MIDPOINTS,
  DAILY_ACTIVITY,
} from "../lib/nutrition-targets.js";

test("BMR follows Mifflin-St Jeor for a known male case", () => {
  // 10(80) + 6.25(178) - 5(24) + 5 = 1797.5
  assert.equal(estimateBmr({ kg: 80, cm: 178, age: 24, sex: "Male" }), 1797.5);
});

test("BMR follows Mifflin-St Jeor for a known female case", () => {
  // 10(65) + 6.25(165) - 5(37) - 161 = 1335.25
  assert.equal(estimateBmr({ kg: 65, cm: 165, age: 37, sex: "Female" }), 1335.25);
});

test("unknown sex lands exactly between the male and female results", () => {
  const male = estimateBmr({ kg: 80, cm: 178, age: 24, sex: "Male" });
  const female = estimateBmr({ kg: 80, cm: 178, age: 24, sex: "Female" });
  const unknown = estimateBmr({ kg: 80, cm: 178, age: 24, sex: "Prefer not to say" });
  assert.equal(unknown, (male + female) / 2);
  assert.equal(estimateBmr({ kg: 80, cm: 178, age: 24 }), unknown);
});

test("BMR is null without height, weight, or age", () => {
  assert.equal(estimateBmr({ cm: 178, age: 24, sex: "Male" }), null);
  assert.equal(estimateBmr({ kg: 80, age: 24, sex: "Male" }), null);
  assert.equal(estimateBmr({ kg: 80, cm: 178, sex: "Male" }), null);
  assert.equal(estimateBmr({}), null);
});

test("the activity multiplier is a lifestyle base plus a capped training add-on", () => {
  // desk job, 4 x 60 min = 4 h -> 1.20 + 0.06*4 = 1.44
  assert.equal(activityMultiplier({ dailyActivity: "sitting", daysPerWeek: 4, sessionLength: 60 }), 1.44);
  // on feet all day, no training -> the bare base
  assert.equal(activityMultiplier({ dailyActivity: "onfeet", daysPerWeek: 0, sessionLength: 0 }), 1.5);
});

test("the training add-on caps at 0.35 so huge volume cannot run away", () => {
  const capped = activityMultiplier({ dailyActivity: "sitting", daysPerWeek: 7, sessionLength: 180 });
  assert.equal(capped, 1.2 + 0.35);
});

test("the multiplier clamps to the 1.2 to 1.9 band", () => {
  const max = activityMultiplier({ dailyActivity: "onfeet", daysPerWeek: 7, sessionLength: 240 });
  assert.ok(max <= 1.9, `expected <= 1.9, got ${max}`);
  const min = activityMultiplier({});
  assert.ok(min >= 1.2, `expected >= 1.2, got ${min}`);
});

test("TDEE is BMR times the multiplier, and null when BMR is unavailable", () => {
  const stats = { kg: 80, cm: 178, age: 24, sex: "Male", dailyActivity: "sitting", daysPerWeek: 4, sessionLength: 60 };
  assert.equal(estimateTdee(stats), 1797.5 * 1.44);
  assert.equal(estimateTdee({ cm: 178, age: 24 }), null);
});

test("age midpoints cover every AGE_RANGES chip, using en dashes", () => {
  assert.deepEqual(Object.keys(AGE_MIDPOINTS), ["Under 18", "18–29", "30–44", "45–59", "60+"]);
  assert.equal(AGE_MIDPOINTS["18–29"], 24);
});

test("the three daily-activity options ascend", () => {
  const bases = DAILY_ACTIVITY.map((d) => d.base);
  assert.deepEqual(bases, [1.2, 1.35, 1.5]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/spotterai && node --test test/nutrition-targets.test.js`
Expected: FAIL, `Cannot find module .../lib/nutrition-targets.js`

- [ ] **Step 3: Write the implementation**

Create `lib/nutrition-targets.js`:

```js
/**
 * SpotterAI — nutrition targets from user stats (pure, deterministic, testable)
 * ============================================================================
 * Turns a user's stats (height, weight, age band, sex) plus how active their
 * day is and how much they train into calorie and macro targets for an explicit
 * eating intent: cut, recomp, or bulk.
 *
 * This module PRESCRIBES; nutrition-safety.js AUDITS. Keeping the two apart is
 * the point — every target produced here is expected to pass evaluateNutrition
 * with zero flags, and test/nutrition-targets.test.js sweeps the realistic stat
 * space to prove it. If that sweep ever fails, one of the two files has drifted.
 *
 * Runtime: Node 18+ / browser. ES module, no DOM, no network.
 */

import { NUTRITION_THRESHOLDS } from "../nutrition-safety.js";

/** Eating intent. kcalFactor scales TDEE; proteinPerKg sets the protein target. */
export const NUTRITION_INTENTS = [
  { value: "cut", label: "Cut", blurb: "Lose fat at a steady pace while holding onto muscle.", kcalFactor: 0.8, proteinPerKg: 1.8 },
  { value: "recomp", label: "Recomp", blurb: "Eat around maintenance, building muscle and losing fat slowly.", kcalFactor: 1.0, proteinPerKg: 1.8 },
  { value: "bulk", label: "Bulk", blurb: "Gain muscle on a small surplus, keeping fat gain low.", kcalFactor: 1.1, proteinPerKg: 1.6 },
];

/** Life outside training. Combined with training volume for the activity factor. */
export const DAILY_ACTIVITY = [
  { value: "sitting", label: "Mostly sitting", base: 1.2 },
  { value: "some", label: "On my feet some", base: 1.35 },
  { value: "onfeet", label: "On my feet all day", base: 1.5 },
];

/** Midpoints of the AGE_RANGES chips in onboarding.js. Note the en dashes. */
export const AGE_MIDPOINTS = {
  "Under 18": 17,
  "18–29": 24,
  "30–44": 37,
  "45–59": 52,
  "60+": 65,
};

const MINOR_RANGE = "Under 18";
const DEFAULT_RANGE = "30–44";

/** Shown whenever the under-18 guard holds targets at maintenance. */
export const MINOR_NOTICE =
  "During growth years SpotterAI won't set a calorie deficit. These are maintenance targets. For weight goals at your age, please talk to a doctor or a registered dietitian who knows your history.";

// Mifflin-St Jeor sex constants. The unknown case is the midpoint of the two,
// which costs about 83 kcal of precision and is reported as Medium confidence.
const SEX_CONSTANT = { male: 5, female: -161 };
const SEX_UNKNOWN = (SEX_CONSTANT.male + SEX_CONSTANT.female) / 2; // -78

const TRAINING_PER_HOUR = 0.06;
const TRAINING_CAP = 0.35;
const MULTIPLIER_MIN = 1.2;
const MULTIPLIER_MAX = 1.9;

/** Calories at which the drift nudge offers updated targets. */
export const DRIFT_KCAL = 100;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function sexConstant(sex) {
  const s = String(sex || "").toLowerCase();
  if (s === "male") return SEX_CONSTANT.male;
  if (s === "female") return SEX_CONSTANT.female;
  return SEX_UNKNOWN;
}

/** Mifflin-St Jeor resting energy. Null unless height, weight, and age are all usable. */
export function estimateBmr({ kg, cm, age, sex } = {}) {
  const w = num(kg);
  const h = num(cm);
  const a = num(age);
  if (!w || !h || !a || w <= 0 || h <= 0 || a <= 0) return null;
  return 10 * w + 6.25 * h - 5 * a + sexConstant(sex);
}

/**
 * Lifestyle base plus a training add-on, kept separate so training volume is
 * not double-counted the way a single "how active are you" question does.
 */
export function activityMultiplier({ dailyActivity, daysPerWeek, sessionLength } = {}) {
  const entry = DAILY_ACTIVITY.find((d) => d.value === dailyActivity);
  const base = entry ? entry.base : DAILY_ACTIVITY[0].base;
  const hours = ((num(daysPerWeek) || 0) * (num(sessionLength) || 0)) / 60;
  const add = Math.min(TRAINING_CAP, TRAINING_PER_HOUR * Math.max(0, hours));
  return clamp(base + add, MULTIPLIER_MIN, MULTIPLIER_MAX);
}

/** Total daily energy expenditure. Null when BMR is unavailable. */
export function estimateTdee(stats = {}) {
  const bmr = estimateBmr(stats);
  if (bmr == null) return null;
  return bmr * activityMultiplier(stats);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/spotterai && node --test test/nutrition-targets.test.js`
Expected: PASS, 10 tests, `# fail 0`

- [ ] **Step 5: Commit**

```bash
cd ~/spotterai
git add lib/nutrition-targets.js test/nutrition-targets.test.js
git commit -m "feat(nutrition): Mifflin-St Jeor BMR and a split activity multiplier"
```

---

### Task 2: `calculateTargets`, macros, and the under-18 guard

**Files:**
- Modify: `lib/nutrition-targets.js`
- Test: `test/nutrition-targets.test.js`

**Interfaces:**
- Consumes: `estimateBmr`, `activityMultiplier`, `AGE_MIDPOINTS`, `NUTRITION_INTENTS`, `MINOR_NOTICE`, `NUTRITION_THRESHOLDS` from Task 1.
- Produces: `calculateTargets(stats) -> null | { kcal, protein, carbs, fat, bmr, tdee, multiplier, intent, requestedIntent, confidence, basis, notice }`.

The under-18 regression case is written first, per the safety-change checklist.

- [ ] **Step 1: Write the failing tests**

Append to `test/nutrition-targets.test.js`:

```js
import { calculateTargets, MINOR_NOTICE } from "../lib/nutrition-targets.js";
import { macroKcal } from "../lib/nutrition-math.js";
import { NUTRITION_THRESHOLDS } from "../nutrition-safety.js";

const BASE = { kg: 80, cm: 178, ageRange: "18–29", sex: "Male", dailyActivity: "sitting", daysPerWeek: 4, sessionLength: 60 };

test("SAFETY: under 18 never gets a deficit, whatever intent was asked for", () => {
  const t = calculateTargets({ ...BASE, ageRange: "Under 18", intent: "cut" });
  assert.equal(t.intent, "recomp", "the applied intent is forced to maintenance");
  assert.equal(t.requestedIntent, "cut", "what the user asked for is still reported");
  assert.equal(t.notice, MINOR_NOTICE);
  const maintenance = calculateTargets({ ...BASE, ageRange: "Under 18", intent: "recomp" });
  assert.equal(t.kcal, maintenance.kcal, "a requested cut yields maintenance calories");
});

test("adults get no minor notice", () => {
  assert.equal(calculateTargets({ ...BASE, intent: "cut" }).notice, null);
});

test("the worked example from the spec reproduces exactly", () => {
  const cut = calculateTargets({ ...BASE, intent: "cut" });
  assert.deepEqual(
    { kcal: cut.kcal, protein: cut.protein, carbs: cut.carbs, fat: cut.fat },
    { kcal: 2075, protein: 144, carbs: 245, fat: 58 }
  );
  const recomp = calculateTargets({ ...BASE, intent: "recomp" });
  assert.deepEqual(
    { kcal: recomp.kcal, protein: recomp.protein, carbs: recomp.carbs, fat: recomp.fat },
    { kcal: 2600, protein: 144, carbs: 344, fat: 72 }
  );
  const bulk = calculateTargets({ ...BASE, intent: "bulk" });
  assert.deepEqual(
    { kcal: bulk.kcal, protein: bulk.protein, carbs: bulk.carbs, fat: bulk.fat },
    { kcal: 2850, protein: 128, carbs: 406, fat: 79 }
  );
});

test("cut is below recomp is below bulk for identical stats", () => {
  const k = (intent) => calculateTargets({ ...BASE, intent }).kcal;
  assert.ok(k("cut") < k("recomp"), "cut under recomp");
  assert.ok(k("recomp") < k("bulk"), "recomp under bulk");
});

test("calories never fall below the greater of the safety floor and BMR", () => {
  const t = calculateTargets({ ...BASE, kg: 45, cm: 150, ageRange: "60+", sex: "Female", intent: "cut" });
  assert.ok(t.kcal >= NUTRITION_THRESHOLDS.LOW_KCAL, `${t.kcal} >= ${NUTRITION_THRESHOLDS.LOW_KCAL}`);
  assert.ok(t.kcal >= t.bmr - 25, `${t.kcal} not below BMR ${t.bmr} beyond rounding`);
});

test("macros reconstruct the calorie total within 2%", () => {
  for (const intent of ["cut", "recomp", "bulk"]) {
    const t = calculateTargets({ ...BASE, intent });
    const drift = Math.abs(macroKcal(t) / t.kcal - 1);
    assert.ok(drift < 0.02, `${intent} drifted ${(drift * 100).toFixed(2)}%`);
  }
});

test("an unstated sex is reported as Medium confidence, a stated one as High", () => {
  assert.equal(calculateTargets({ ...BASE, intent: "cut" }).confidence, "High");
  assert.equal(calculateTargets({ ...BASE, sex: "Prefer not to say", intent: "cut" }).confidence, "Medium");
  assert.equal(calculateTargets({ ...BASE, sex: null, intent: "cut" }).confidence, "Medium");
});

test("null without height or weight, so callers can fall back", () => {
  assert.equal(calculateTargets({ ...BASE, cm: null, intent: "cut" }), null);
  assert.equal(calculateTargets({ ...BASE, kg: null, intent: "cut" }), null);
});

test("an unknown or missing intent falls back to recomp", () => {
  assert.equal(calculateTargets({ ...BASE, intent: "nonsense" }).intent, "recomp");
  assert.equal(calculateTargets({ ...BASE }).intent, "recomp");
});

test("the basis line explains the number without an em dash", () => {
  const t = calculateTargets({ ...BASE, intent: "cut" });
  assert.match(t.basis, /maintenance/i);
  assert.match(t.basis, /20%/);
  assert.ok(!t.basis.includes("—"), "no em dashes in user-facing copy");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ~/spotterai && node --test test/nutrition-targets.test.js`
Expected: FAIL, `calculateTargets is not a function` or `SyntaxError` on the missing export

- [ ] **Step 3: Write the implementation**

Append to `lib/nutrition-targets.js`:

```js
const FAT_PCT = 0.25;
const FAT_PCT_MIN = 0.2;
const CARB_PCT_MIN = 0.1;
const PROTEIN_PCT_MAX = 0.4;

const round25 = (n) => Math.round(n / 25) * 25;

/**
 * Protein first (it protects muscle in a deficit), then fat at a fixed share,
 * with carbs taking the remainder. Two guards cover the tails: if carbs would
 * fall under CARB_PCT_MIN we walk fat down toward FAT_PCT_MIN to make room, and
 * protein is capped at PROTEIN_PCT_MAX so carbs can never go negative. The cap
 * is unreachable for a real body given the calorie floor, but it means the
 * arithmetic is total rather than merely usually right.
 */
function splitMacros(kcal, kg, proteinPerKg) {
  const proteinKcal = Math.min(proteinPerKg * kg * 4, kcal * PROTEIN_PCT_MAX);
  let fatKcal = kcal * FAT_PCT;
  let carbKcal = kcal - proteinKcal - fatKcal;
  const minCarbKcal = kcal * CARB_PCT_MIN;
  if (carbKcal < minCarbKcal) {
    fatKcal = Math.max(kcal * FAT_PCT_MIN, kcal - proteinKcal - minCarbKcal);
    carbKcal = kcal - proteinKcal - fatKcal;
  }
  return {
    protein: Math.round(proteinKcal / 4),
    carbs: Math.round(Math.max(0, carbKcal) / 4),
    fat: Math.round(fatKcal / 9),
  };
}

function basisLine(tdee, applied, isMinor) {
  const maint = `Around ${round25(tdee).toLocaleString("en-US")} kcal maintenance`;
  if (isMinor) return `${maint}, held level during growth years.`;
  if (applied.value === "cut") return `${maint}, minus 20% for a cut.`;
  if (applied.value === "bulk") return `${maint}, plus 10% for a lean bulk.`;
  return `${maint}, held level for a recomp.`;
}

/**
 * Calorie and macro targets for a set of stats and an eating intent.
 * Returns null when height or weight is missing, so callers can fall back to
 * the bodyweight-only saferTargets() suggestion.
 */
export function calculateTargets({ kg, cm, ageRange, sex, dailyActivity, daysPerWeek, sessionLength, intent } = {}) {
  const w = num(kg);
  const h = num(cm);
  if (!w || !h || w <= 0 || h <= 0) return null;

  const age = AGE_MIDPOINTS[ageRange] ?? AGE_MIDPOINTS[DEFAULT_RANGE];
  const bmr = estimateBmr({ kg: w, cm: h, age, sex });
  if (bmr == null) return null;

  const multiplier = activityMultiplier({ dailyActivity, daysPerWeek, sessionLength });
  const tdee = bmr * multiplier;

  // Growth years: never a deficit, whatever was asked for.
  const isMinor = ageRange === MINOR_RANGE;
  const asked = NUTRITION_INTENTS.find((i) => i.value === intent) || NUTRITION_INTENTS[1];
  const applied = isMinor ? NUTRITION_INTENTS.find((i) => i.value === "recomp") : asked;

  const kcal = round25(Math.max(NUTRITION_THRESHOLDS.LOW_KCAL, bmr, tdee * applied.kcalFactor));
  const { protein, carbs, fat } = splitMacros(kcal, w, applied.proteinPerKg);

  return {
    kcal, protein, carbs, fat,
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    multiplier: Math.round(multiplier * 100) / 100,
    intent: applied.value,
    requestedIntent: asked.value,
    confidence: /^(male|female)$/i.test(String(sex || "")) ? "High" : "Medium",
    basis: basisLine(tdee, applied, isMinor),
    notice: isMinor ? MINOR_NOTICE : null,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/spotterai && node --test test/nutrition-targets.test.js`
Expected: PASS, 20 tests, `# fail 0`

- [ ] **Step 5: Commit**

```bash
cd ~/spotterai
git add lib/nutrition-targets.js test/nutrition-targets.test.js
git commit -m "feat(nutrition): calorie and macro targets per intent, with an under-18 guard"
```

---

### Task 3: Intent mapping and drift detection

**Files:**
- Modify: `lib/nutrition-targets.js`
- Test: `test/nutrition-targets.test.js`

**Interfaces:**
- Consumes: `DRIFT_KCAL` from Task 1.
- Produces: `intentForGoal(goalValue) -> "cut"|"recomp"|"bulk"`, `targetsDrift(current, calculated) -> { drifted: boolean, deltaKcal: number }`.

`goalValue` is the `value` field of `GOAL_OPTIONS` in `onboarding.js:10` (`muscle`, `strength`, `fatloss`, `general`, `consistency`).

- [ ] **Step 1: Write the failing tests**

Append to `test/nutrition-targets.test.js`:

```js
import { intentForGoal, targetsDrift, DRIFT_KCAL } from "../lib/nutrition-targets.js";

test("every training goal maps to a default eating intent", () => {
  assert.equal(intentForGoal("fatloss"), "cut");
  assert.equal(intentForGoal("muscle"), "bulk");
  assert.equal(intentForGoal("strength"), "recomp");
  assert.equal(intentForGoal("general"), "recomp");
  assert.equal(intentForGoal("consistency"), "recomp");
});

test("an unknown goal defaults to recomp rather than guessing a deficit", () => {
  assert.equal(intentForGoal("something-else"), "recomp");
  assert.equal(intentForGoal(undefined), "recomp");
});

test("drift fires at the threshold and not one calorie under it", () => {
  assert.equal(targetsDrift({ kcal: 2000 }, { kcal: 2000 + DRIFT_KCAL }).drifted, true);
  assert.equal(targetsDrift({ kcal: 2000 }, { kcal: 2000 + DRIFT_KCAL - 1 }).drifted, false);
  assert.equal(targetsDrift({ kcal: 2000 }, { kcal: 2000 - DRIFT_KCAL }).drifted, true, "drops count too");
});

test("drift reports a signed delta so the UI can say up or down", () => {
  assert.equal(targetsDrift({ kcal: 2000 }, { kcal: 2150 }).deltaKcal, 150);
  assert.equal(targetsDrift({ kcal: 2000 }, { kcal: 1850 }).deltaKcal, -150);
});

test("drift is inert when either side is missing", () => {
  assert.deepEqual(targetsDrift(null, { kcal: 2000 }), { drifted: false, deltaKcal: 0 });
  assert.deepEqual(targetsDrift({ kcal: 2000 }, null), { drifted: false, deltaKcal: 0 });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ~/spotterai && node --test test/nutrition-targets.test.js`
Expected: FAIL, `intentForGoal is not a function`

- [ ] **Step 3: Write the implementation**

Append to `lib/nutrition-targets.js`:

```js
// Training goal (GOAL_OPTIONS in onboarding.js) to a default eating intent.
// Anything unrecognised lands on recomp: never guess someone into a deficit.
const GOAL_INTENT = { fatloss: "cut", muscle: "bulk", strength: "recomp", general: "recomp", consistency: "recomp" };

/** The eating intent to pre-select for a training goal. Always overridable. */
export function intentForGoal(goalValue) {
  return GOAL_INTENT[goalValue] || "recomp";
}

/**
 * Has the stats-derived target drifted far enough from the saved one to be
 * worth offering an update? Signed delta so the UI can say which way.
 */
export function targetsDrift(current, calculated) {
  const a = num(current?.kcal);
  const b = num(calculated?.kcal);
  if (!a || !b) return { drifted: false, deltaKcal: 0 };
  const deltaKcal = b - a;
  return { drifted: Math.abs(deltaKcal) >= DRIFT_KCAL, deltaKcal };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/spotterai && node --test test/nutrition-targets.test.js`
Expected: PASS, 25 tests, `# fail 0`

- [ ] **Step 5: Commit**

```bash
cd ~/spotterai
git add lib/nutrition-targets.js test/nutrition-targets.test.js
git commit -m "feat(nutrition): goal-to-intent mapping and target drift detection"
```

---

### Task 4: The auditor accuracy fix

**Files:**
- Modify: `nutrition-safety.js:24`, `nutrition-safety.js:45-50`
- Test: `test/nutrition-safety.test.js`

**Interfaces:**
- Produces: `evaluateNutrition({ targets, bodyweight, unit, goal, maintenance })`. `maintenance` is optional; when it is a positive number it replaces `kg × MAINTENANCE_KCAL_PER_KG` in the deficit check only.

**This task touches a change-controlled safety file.** The change is signed off (see the spec's "Auditor accuracy fix" section). Scope is one optional parameter. Do not change any threshold, any flag text, or any other check.

- [ ] **Step 1: Write the failing tests**

Append to `test/nutrition-safety.test.js`:

```js
test("an accurate maintenance figure replaces the per-kg heuristic in the deficit check", () => {
  // 130 kg, 170 cm, 60+, sedentary female: the x31 heuristic claims 4030 kcal
  // maintenance, Mifflin-St Jeor says ~2364. A sane 1900 kcal target is a
  // fast cut against the heuristic and a moderate one against reality.
  const args = { targets: { kcal: 1900, protein: 160, fat: 53 }, bodyweight: 130, unit: "kg", goal: "Fat loss" };
  const heuristic = evaluateNutrition(args);
  assert.ok(heuristic.flags.some((f) => /deficit/i.test(f.label)), "heuristic flags it");

  const accurate = evaluateNutrition({ ...args, maintenance: 2364 });
  assert.equal(accurate.flags.length, 0, "accurate maintenance clears the spurious flag");
});

test("a genuine aggressive deficit still flags against accurate maintenance", () => {
  const { flags } = evaluateNutrition({
    targets: { kcal: 1400, protein: 160, fat: 40 }, bodyweight: 130, unit: "kg", goal: "Fat loss", maintenance: 2364,
  });
  assert.ok(flags.some((f) => /deficit/i.test(f.label)), "40% under real maintenance still flags");
});

test("omitting maintenance reproduces the per-kg behaviour exactly", () => {
  const args = { targets: { kcal: 1300, protein: 150, fat: 45 }, bodyweight: 90, unit: "kg", goal: "Fat loss" };
  assert.deepEqual(evaluateNutrition({ ...args, maintenance: null }), evaluateNutrition(args));
  assert.deepEqual(evaluateNutrition({ ...args, maintenance: 0 }), evaluateNutrition(args));
  assert.ok(evaluateNutrition(args).flags.some((f) => /deficit/i.test(f.label)), "still flags without the arg");
});

test("maintenance does not affect the absolute floors", () => {
  // A very low target is critical no matter how low real maintenance is.
  const { flags } = evaluateNutrition({
    targets: { kcal: 900, protein: 120, fat: 40 }, bodyweight: 50, unit: "kg", maintenance: 1300,
  });
  assert.ok(flags.some((f) => f.tier === "critical" && /calorie/i.test(f.label)));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ~/spotterai && node --test test/nutrition-safety.test.js`
Expected: FAIL on the first new test, `accurate maintenance clears the spurious flag` (the extra argument is ignored, so the flag is still present)

- [ ] **Step 3: Write the implementation**

In `nutrition-safety.js`, change the signature on line 24:

```js
export function evaluateNutrition({ targets = {}, bodyweight = null, unit = "kg", goal = "", maintenance = null } = {}) {
```

Then replace the maintenance line inside check 2 (currently line 46):

```js
  // 2. Aggressive deficit vs estimated maintenance (needs bodyweight).
  //    `maintenance` is the caller's accurate figure when it has the stats to
  //    compute one (Mifflin-St Jeor via lib/nutrition-targets.js). The per-kg
  //    heuristic is a linear fallback that overestimates badly for heavier
  //    bodies, since fat mass burns far less than lean mass, so prefer real
  //    numbers whenever they exist.
  if (kg && kcal) {
    const supplied = Number(maintenance);
    const maint = Math.round(supplied > 0 ? supplied : kg * T.MAINTENANCE_KCAL_PER_KG);
```

Leave the rest of that block, the flag text, and every threshold untouched.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/spotterai && node --test test/nutrition-safety.test.js`
Expected: PASS, all tests, `# fail 0`

- [ ] **Step 5: Run the whole suite and the eval suites**

```bash
cd ~/spotterai && npm test && npm run eval && npm run eval:nutrition
```

Expected: `# fail 0` and both eval suites passing. Per the safety directive, if any previously-flagged eval case stops flagging, stop and report it before continuing.

- [ ] **Step 6: Commit**

```bash
cd ~/spotterai
git add nutrition-safety.js test/nutrition-safety.test.js
git commit -m "fix(nutrition-safety): accept an accurate maintenance figure for the deficit check

The x31 kcal/kg heuristic scales linearly with bodyweight, but fat mass
burns far less than lean mass, so it overestimates maintenance by up to
41% for heavier bodies and flags sane targets as aggressive deficits.

Callers with real stats now pass a Mifflin-derived figure. With no
argument the behaviour is byte-identical to before. No threshold, floor,
or flag text changes. Signed off under the safety-change checklist."
```

---

### Task 5: The cross-system sweep

**Files:**
- Test: `test/nutrition-targets.test.js`

**Interfaces:**
- Consumes: `calculateTargets`, `estimateTdee`, `AGE_MIDPOINTS`, `DAILY_ACTIVITY`, `NUTRITION_INTENTS` (Tasks 1 to 3); `evaluateNutrition` with the `maintenance` parameter (Task 4).

This is the test that caught the auditor bug. It is the highest-value assertion in the change and must not be weakened to make a future change pass.

- [ ] **Step 1: Write the test**

Append to `test/nutrition-targets.test.js`:

```js
import { estimateTdee as tdeeOf, NUTRITION_INTENTS } from "../lib/nutrition-targets.js";
import { evaluateNutrition } from "../nutrition-safety.js";

test("SWEEP: no calculated target ever trips its own auditor", () => {
  const weights = [45, 55, 65, 75, 85, 95, 110, 130, 150];
  const heights = [150, 160, 170, 180, 190, 200];
  const ages = Object.keys(AGE_MIDPOINTS);
  const sexes = ["Male", "Female", "Prefer not to say", null];
  const activities = DAILY_ACTIVITY.map((d) => d.value);
  const volumes = [[2, 30], [3, 45], [4, 60], [5, 60], [6, 90]];
  const intents = NUTRITION_INTENTS.map((i) => i.value);
  const goalFor = { cut: "Fat loss", bulk: "Hypertrophy", recomp: "General" };

  let checked = 0;
  const failures = [];

  for (const kg of weights)
    for (const cm of heights)
      for (const ageRange of ages)
        for (const sex of sexes)
          for (const dailyActivity of activities)
            for (const [daysPerWeek, sessionLength] of volumes)
              for (const intent of intents) {
                const stats = { kg, cm, ageRange, sex, dailyActivity, daysPerWeek, sessionLength, intent };
                const t = calculateTargets(stats);
                assert.ok(t, `expected targets for ${JSON.stringify(stats)}`);
                checked++;

                const { flags } = evaluateNutrition({
                  targets: { kcal: t.kcal, protein: t.protein, fat: t.fat },
                  bodyweight: kg,
                  unit: "kg",
                  goal: goalFor[t.intent],
                  maintenance: tdeeOf({ kg, cm, age: AGE_MIDPOINTS[ageRange], sex, dailyActivity, daysPerWeek, sessionLength }),
                });

                if (flags.length && failures.length < 5) {
                  failures.push({ ...stats, kcal: t.kcal, protein: t.protein, fat: t.fat, flags: flags.map((f) => f.label) });
                }
              }

  assert.equal(checked, 48600, "the sweep covers the whole grid");
  assert.deepEqual(failures, [], `calculated targets were flagged:\n${JSON.stringify(failures, null, 2)}`);
});

test("SWEEP: every calculated target holds the per-kg and macro boundaries", () => {
  const T = NUTRITION_THRESHOLDS;
  for (const kg of [45, 65, 85, 110, 150])
    for (const cm of [150, 170, 190])
      for (const ageRange of Object.keys(AGE_MIDPOINTS))
        for (const intent of ["cut", "recomp", "bulk"]) {
          const t = calculateTargets({ kg, cm, ageRange, sex: "Female", dailyActivity: "sitting", daysPerWeek: 3, sessionLength: 45, intent });
          const label = `${kg}kg ${cm}cm ${ageRange} ${intent}`;
          assert.ok(t.protein / kg >= T.PROTEIN_PER_KG_LOW, `${label}: protein ${(t.protein / kg).toFixed(2)} g/kg under floor`);
          assert.ok((t.fat * 9) / t.kcal >= T.FAT_PCT_VERY_LOW, `${label}: fat too low`);
          assert.ok(t.kcal >= T.LOW_KCAL, `${label}: kcal under floor`);
          assert.ok(Math.abs(macroKcal(t) / t.kcal - 1) < 0.02, `${label}: macros do not reconstruct kcal`);
        }
});
```

- [ ] **Step 2: Run the tests to verify they pass**

Run: `cd ~/spotterai && node --test test/nutrition-targets.test.js`
Expected: PASS, 27 tests, `# fail 0`. The sweep takes a few seconds.

If the sweep fails, do NOT relax the assertion. A failure means the calculator and the auditor genuinely disagree, which is a real finding. Report it.

- [ ] **Step 3: Commit**

```bash
cd ~/spotterai
git add test/nutrition-targets.test.js
git commit -m "test(nutrition): sweep 48600 stat combinations against the safety auditor"
```

---

### Task 6: `bodyStats` persistence

**Files:**
- Modify: `tracker-store.js:17-32` (DEFAULTS), `tracker-store.js:38-45` (load), `tracker-store.js:102-124` (importData), `tracker-store.js:645-648` (near setTargets)

**Interfaces:**
- Produces: `getBodyStats() -> object`, `setBodyStats(partial) -> void`. Shape: `{ heightCm, ageRange, sex, dailyActivity, intent, daysPerWeek, sessionLength }`, all `null` by default.

`tracker-store.js` references `window` at module load, so it throws `window is not defined` under `node --test` and cannot be unit tested. Verification is in the browser (Step 4).

- [ ] **Step 1: Add the default shape**

In `tracker-store.js`, inside `DEFAULTS` (after the `targets` line, line 21):

```js
  // Stats behind the calculated nutrition targets (lib/nutrition-targets.js).
  // Bodyweight is NOT duplicated here: it comes from the bodyweight[] log.
  bodyStats: { heightCm: null, ageRange: null, sex: null, dailyActivity: null, intent: null, daysPerWeek: null, sessionLength: null },
```

- [ ] **Step 2: Merge it on load and import**

In `load()` (line 41), extend the merge so a stored partial gets the missing keys:

```js
    return {
      ...DEFAULTS,
      ...raw,
      targets: { ...DEFAULTS.targets, ...(raw.targets || {}) },
      bodyStats: { ...DEFAULTS.bodyStats, ...(raw.bodyStats || {}) },
    };
```

In `importData()` (line 110), alongside the existing `targets` line:

```js
    bodyStats: { ...DEFAULTS.bodyStats, ...(incoming.bodyStats || {}) },
```

`exportData()` serialises the whole of `state`, so it picks `bodyStats` up with no change.

- [ ] **Step 3: Add the accessors**

Directly after `setTargets` (line 648):

```js
/** The stats behind calculated nutrition targets. Always a full object. */
export function getBodyStats() {
  return { ...DEFAULTS.bodyStats, ...(state.bodyStats || {}) };
}

/** Merge in whatever stats the user just supplied. */
export function setBodyStats(patch) {
  state.bodyStats = { ...getBodyStats(), ...(patch || {}) };
  persist();
}
```

- [ ] **Step 4: Verify in the browser**

```bash
cd ~/spotterai && npx vercel dev
```

Open the app, then in the browser console:

```js
const m = await import("./tracker-store.js");
m.setBodyStats({ heightCm: 178, ageRange: "18–29" });
console.log(m.getBodyStats());
// expect { heightCm: 178, ageRange: "18–29", sex: null, dailyActivity: null, intent: null, daysPerWeek: null, sessionLength: null }
location.reload();
// after reload, re-import and confirm the values survived
```

Expected: the two set values persist across the reload and the remaining keys are `null`.

- [ ] **Step 5: Confirm nothing else broke**

Run: `cd ~/spotterai && npm test`
Expected: `# fail 0`

- [ ] **Step 6: Commit**

```bash
cd ~/spotterai
git add tracker-store.js
git commit -m "feat(tracker): persist the body stats behind calculated targets"
```

---

### Task 7: The onboarding Nutrition step

**Files:**
- Modify: `onboarding.js:44` (`ONBOARDING_STEPS`), end of `onboarding.js` (re-exports)
- Modify: `onboarding-ui.js` (imports, `stepNutrition`, `STEP_RENDER`, `canAdvance`, `isOptionalStep`, `finish`, chip handler, and the copy at line 89)

**Interfaces:**
- Consumes: `calculateTargets`, `intentForGoal`, `NUTRITION_INTENTS`, `DAILY_ACTIVITY` from `lib/nutrition-targets.js`; `setBodyStats` from `tracker-store.js`; `bodyweightKg` from `measurements.js`.
- Produces: onboarding writes `bodyStats` and applies calculated targets on finish.

The step goes at index 3, after Schedule, because the activity multiplier needs `days` and `sessionLength`.

- [ ] **Step 1: Add the step label**

In `onboarding.js`, replace line 44:

```js
export const ONBOARDING_STEPS = ["Goal", "About you", "Schedule", "Nutrition", "Safety", "Preferences"];
```

- [ ] **Step 2: Update the onboarding test for the new step count**

`test/onboarding.test.js` asserts on `ONBOARDING_STEPS`. Run it first to see what breaks:

Run: `cd ~/spotterai && node --test test/onboarding.test.js`

Update any length or index assertion to match the six-step flow, and add:

```js
test("a Nutrition step sits after Schedule so it can use training volume", () => {
  assert.equal(ONBOARDING_STEPS[3], "Nutrition");
  assert.ok(ONBOARDING_STEPS.indexOf("Nutrition") > ONBOARDING_STEPS.indexOf("Schedule"));
});
```

- [ ] **Step 3: Import the new module in the UI**

In `onboarding-ui.js`, add to the import block (after the `measurements.js` import on line 25):

```js
import { calculateTargets, intentForGoal, NUTRITION_INTENTS, DAILY_ACTIVITY } from "./lib/nutrition-targets.js";
```

and extend the `tracker-store.js` import on line 27:

```js
import { setBodyStats, setTargets, setUnit } from "./tracker-store.js";
```

- [ ] **Step 4: Add the step renderer**

In `onboarding-ui.js`, after `stepSchedule()` (line 106), add:

```js
/** Stats gathered so far, in the shape lib/nutrition-targets.js expects. */
function nutritionStats() {
  const cm = measurementSystem(data) === "imperial"
    ? ((Number(data.heightFt) || 0) * 12 + (Number(data.heightIn) || 0)) * 2.54
    : Number(data.height) || 0;
  return {
    kg: bodyweightKg(data),
    cm: cm > 0 ? cm : null,
    ageRange: data.ageRange || null,
    sex: data.sex || null,
    dailyActivity: data.dailyActivity || null,
    daysPerWeek: Number(data.days) || 0,
    sessionLength: Number(data.sessionLength) || 0,
    intent: data.intent || intentForGoal(data.goal),
  };
}

function nutritionPreview() {
  const t = calculateTargets(nutritionStats());
  if (!t) {
    return `<p class="onb-sub onb-nut-empty">Add your height and bodyweight on the previous step to get calorie and macro targets. You can always set them later on the Nutrition page.</p>`;
  }
  const macro = (label, grams) => `<div class="onb-nut-macro"><span class="onb-nut-mval">${grams}g</span><span class="onb-nut-mlabel">${esc(label)}</span></div>`;
  return `<div class="onb-nut-preview">
      <div class="onb-nut-kcal"><strong>${t.kcal.toLocaleString("en-US")}</strong> kcal a day</div>
      <div class="onb-nut-macros">${macro("Protein", t.protein)}${macro("Carbs", t.carbs)}${macro("Fat", t.fat)}</div>
      <p class="onb-nut-basis">${esc(t.basis)}</p>
      ${t.notice ? `<p class="onb-nut-notice">${esc(t.notice)}</p>` : ""}
    </div>`;
}

function stepNutrition() {
  if (!data.intent) data.intent = intentForGoal(data.goal);
  return `<h3 class="onb-title">Your nutrition goal</h3>
    <p class="onb-sub">Optional. This sets your starting calorie and macro targets, and you can change them any time.</p>
    ${field("Eating goal", chips("intent", NUTRITION_INTENTS))}
    ${field("Outside training, your day is", chips("dailyActivity", DAILY_ACTIVITY))}
    <div id="onb-nut-preview">${nutritionPreview()}</div>`;
}
```

- [ ] **Step 5: Register the step and keep it optional**

Replace `STEP_RENDER` (line 123):

```js
const STEP_RENDER = [stepGoal, stepBody, stepSchedule, stepNutrition, stepSafety, stepPrefs];
```

Update `canAdvance()` (line 126) so the safety-ack check follows the shifted index:

```js
function canAdvance() {
  if (step === 0) return !!data.goal; // need a goal
  if (step === 1) return validateMeasurements(data).valid;
  if (step === 4) return !!data.ack; // must acknowledge the disclaimer
  return true;
}
```

Update `isOptionalStep()` (line 142):

```js
function isOptionalStep() {
  return step !== 0 && step !== 4; // goal + safety-ack aren't skippable
}
```

- [ ] **Step 6: Make the preview live**

In the chip click handler, replace the final line (currently `else nextBtn.disabled = !canAdvance();`, line 216):

```js
    else nextBtn.disabled = !canAdvance();
    if (f === "intent" || f === "dailyActivity") {
      const preview = body.querySelector("#onb-nut-preview");
      if (preview) preview.innerHTML = nutritionPreview();
    }
```

- [ ] **Step 7: Fix the privacy copy**

In `stepBody()` (line 89), the current line promises height is discarded, which stops being true once `bodyStats` persists it. Replace it:

```js
    <p class="onb-sub">Optional. Height and weight are saved on this device so SpotterAI can keep your calorie and macro targets accurate. Nothing leaves your browser.</p>
```

- [ ] **Step 8: Persist and apply on finish**

In `finish()` (line 175), replace the seeding block (lines 179 to 184):

```js
  // Persist the stats behind nutrition targets, then seed the targets themselves.
  const stats = nutritionStats();
  setBodyStats({
    heightCm: stats.cm ? Math.round(stats.cm) : null,
    ageRange: stats.ageRange,
    sex: stats.sex,
    dailyActivity: stats.dailyActivity,
    intent: stats.intent,
    daysPerWeek: stats.daysPerWeek || null,
    sessionLength: stats.sessionLength || null,
  });
  const calculated = calculateTargets(stats);
  if (calculated) {
    setTargets({ kcal: calculated.kcal, protein: calculated.protein, carbs: calculated.carbs, fat: calculated.fat });
  } else if (stats.kg) {
    // No height, so fall back to the bodyweight-only suggestion.
    const s = saferTargets({ bodyweight: stats.kg, unit: "kg", goal: inputs.goal });
    if (s) setTargets({ kcal: Math.round((s.kcalLow + s.kcalHigh) / 2), protein: Math.round((s.proteinLow + s.proteinHigh) / 2) });
  }
```

- [ ] **Step 9: Verify in the browser**

```bash
cd ~/spotterai && npx vercel dev
```

Walk the flow: pick "Lose fat", enter 178 cm and 80 kg, sex Male, age 18-29, 4 days at 60 min. On the Nutrition step confirm Cut is pre-selected, the preview reads 2075 kcal with 144P/245C/58F, and tapping Bulk updates it to 2850 kcal without a page reload. Finish, open the Nutrition page, and confirm all four target fields match.

Then repeat with age "Under 18" and confirm the notice appears and the calories match the recomp figure.

- [ ] **Step 10: Run the suite**

Run: `cd ~/spotterai && npm test`
Expected: `# fail 0`

- [ ] **Step 11: Commit**

```bash
cd ~/spotterai
git add onboarding.js onboarding-ui.js test/onboarding.test.js
git commit -m "feat(onboarding): a Nutrition step with a live target preview"
```

---

### Task 8: Nutrition page block and drift nudge

**Files:**
- Modify: `index.html:754-769` (targets card), `nutrition-ui.js`
- Modify: `style.css` (append)

**Interfaces:**
- Consumes: `calculateTargets`, `targetsDrift`, `NUTRITION_INTENTS`, `DAILY_ACTIVITY`, `estimateTdee`, `AGE_MIDPOINTS` from `lib/nutrition-targets.js`; `getBodyStats`, `setBodyStats` from `tracker-store.js`.
- Produces: a `#nut-stats` block and a `#nut-drift` banner on the Nutrition page.

- [ ] **Step 1: Add the mount points**

In `index.html`, inside the "Goals & targets" card, immediately after `<h3 class="card-title">Goals &amp; targets</h3>` (line 755):

```html
              <div id="nut-drift"></div>
              <div id="nut-stats"></div>
```

- [ ] **Step 2: Wire the imports and element refs**

In `nutrition-ui.js`, add to the imports:

```js
import { calculateTargets, targetsDrift, estimateTdee, NUTRITION_INTENTS, DAILY_ACTIVITY, AGE_MIDPOINTS } from "./lib/nutrition-targets.js";
```

Extend the `tracker-store.js` import to include `getBodyStats` and `setBodyStats`.

Add to the `el` map (near line 32):

```js
  stats: $("nut-stats"),
  drift: $("nut-drift"),
```

- [ ] **Step 3: Feed accurate maintenance into the audit**

In `renderNutritionSafety()` (line 97), pass the stats-derived maintenance so the deficit check uses real numbers when they exist:

```js
  const bs = getBodyStats();
  const s = deriveStats();
  const bodyweight = s.bodyweight?.latest ?? null;
  const { flags, trust } = evaluateNutrition({
    targets: getState().targets,
    bodyweight,
    unit: s.unit,
    goal: store.inputs?.goal || "",
    maintenance: estimateTdee({
      kg: s.unit === "lb" && bodyweight ? bodyweight * 0.45359237 : bodyweight,
      cm: bs.heightCm,
      age: AGE_MIDPOINTS[bs.ageRange],
      sex: bs.sex,
      dailyActivity: bs.dailyActivity,
      daysPerWeek: bs.daysPerWeek,
      sessionLength: bs.sessionLength,
    }),
  });
```

`estimateTdee` returns `null` when the stats are incomplete, and `evaluateNutrition` falls back to the heuristic on `null`, so this is safe for users with no `bodyStats`.

- [ ] **Step 4: Render the stats block**

Add to `nutrition-ui.js`:

```js
const DRIFT_KEY = "spotterai_nut_drift_dismissed";

/** Current stats in calculator shape, or null if too little is known. */
function statsForTargets() {
  const bs = getBodyStats();
  const s = deriveStats();
  const raw = s.bodyweight?.latest ?? null;
  const kg = raw == null ? null : s.unit === "lb" ? raw * 0.45359237 : raw;
  return { kg, cm: bs.heightCm, ageRange: bs.ageRange, sex: bs.sex, dailyActivity: bs.dailyActivity, daysPerWeek: bs.daysPerWeek, sessionLength: bs.sessionLength, intent: bs.intent };
}

function renderTargetStats() {
  if (!el.stats) return;
  const calculated = calculateTargets(statsForTargets());
  if (!calculated) {
    el.stats.innerHTML = `<p class="dash-hint nut-stats__empty">Add your height, bodyweight, and eating goal to calculate targets from your stats. <button type="button" class="btn-link" data-act="nut-setup">Set this up</button></p>`;
    return;
  }
  const chip = (field, options, active) => `<div class="nut-stats__chips" data-field="${field}">${options
    .map((o) => `<button type="button" class="onb-chip${o.value === active ? " is-active" : ""}" data-value="${esc(o.value)}" aria-pressed="${o.value === active ? "true" : "false"}">${esc(o.label)}</button>`)
    .join("")}</div>`;

  el.stats.innerHTML = `<div class="nut-stats">
      <p class="nut-stats__basis">${esc(calculated.basis)}</p>
      ${chip("intent", NUTRITION_INTENTS, calculated.requestedIntent)}
      ${chip("dailyActivity", DAILY_ACTIVITY, getBodyStats().dailyActivity)}
      <p class="nut-stats__figures">${calculated.kcal.toLocaleString("en-US")} kcal · ${calculated.protein}P · ${calculated.carbs}C · ${calculated.fat}F</p>
      ${calculated.notice ? `<p class="nut-stats__notice">${esc(calculated.notice)}</p>` : ""}
      <button type="button" class="btn btn--ghost btn--sm" data-act="nut-apply">Use these targets</button>
      <p class="dash-hint">Confidence: ${esc(calculated.confidence)}. These are estimates, not a prescription.</p>
    </div>`;
}

function renderDrift() {
  if (!el.drift) return;
  const calculated = calculateTargets(statsForTargets());
  if (!calculated) { el.drift.innerHTML = ""; return; }
  const { drifted, deltaKcal } = targetsDrift(getState().targets, calculated);
  let dismissed = null;
  try { dismissed = JSON.parse(localStorage.getItem(DRIFT_KEY) || "null"); } catch {}
  // Re-offer only once the number has moved on from whatever was dismissed.
  if (!drifted || (dismissed && Math.abs(calculated.kcal - dismissed) < 100)) { el.drift.innerHTML = ""; return; }

  el.drift.innerHTML = `<div class="nut-drift">
      <p class="nut-drift__text">Your weight has changed, so your targets are out of date. Based on your stats now, ${calculated.kcal.toLocaleString("en-US")} kcal (${deltaKcal > 0 ? "+" : ""}${deltaKcal}) fits better.</p>
      <div class="nut-drift__actions">
        <button type="button" class="btn btn--ghost btn--sm" data-act="nut-apply">Update targets</button>
        <button type="button" class="btn-link" data-act="nut-drift-dismiss">Not now</button>
      </div>
    </div>`;
}
```

- [ ] **Step 5: Wire the actions**

Add a delegated handler in `nutrition-ui.js`, near the existing targets-form listener (line 771):

```js
document.addEventListener("click", (e) => {
  const chip = e.target.closest(".nut-stats__chips .onb-chip");
  if (chip) {
    setBodyStats({ [chip.closest(".nut-stats__chips").dataset.field]: chip.dataset.value });
    renderTargetStats();
    return;
  }
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (act === "nut-apply") {
    const c = calculateTargets(statsForTargets());
    if (c) {
      setTargets({ kcal: c.kcal, protein: c.protein, carbs: c.carbs, fat: c.fat });
      try { localStorage.removeItem(DRIFT_KEY); } catch {}
    }
  } else if (act === "nut-drift-dismiss") {
    const c = calculateTargets(statsForTargets());
    try { localStorage.setItem(DRIFT_KEY, JSON.stringify(c ? c.kcal : 0)); } catch {}
    renderDrift();
  } else if (act === "nut-setup") {
    window.dispatchEvent(new CustomEvent("spotter:nutrition-setup"));
  }
});
```

Call `renderTargetStats()` and `renderDrift()` from the same place `renderNutritionSafety()` is called (line 90), so they refresh together.

- [ ] **Step 6: Add the styles**

Append to `style.css`, matching the existing card and chip conventions:

```css
/* Nutrition targets calculated from stats */
.nut-stats { display: grid; gap: var(--space-2); }
.nut-stats__basis { color: var(--text-muted); font-size: 0.9rem; }
.nut-stats__chips { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.nut-stats__figures { font-weight: 600; }
.nut-stats__notice { border-left: 3px solid var(--warn); padding-left: var(--space-2); color: var(--text-muted); font-size: 0.9rem; }
.nut-drift { border: 1px solid var(--border); border-radius: var(--radius); padding: var(--space-2); margin-bottom: var(--space-2); }
.nut-drift__text { margin-bottom: var(--space-2); }
.nut-drift__actions { display: flex; gap: var(--space-2); align-items: center; }
```

Confirm the custom property names against the top of `style.css` before committing; substitute the repo's actual tokens if these differ.

- [ ] **Step 7: Verify in the browser**

```bash
cd ~/spotterai && npx vercel dev
```

On the Nutrition page: confirm the block renders with your stats, that switching Cut to Bulk updates the figures, and that "Use these targets" writes all four fields into the form. Then log a bodyweight 5 kg lower, reload, and confirm the drift banner appears. Tap "Not now" and confirm it stays gone across a reload.

- [ ] **Step 8: Run the suite**

Run: `cd ~/spotterai && npm test`
Expected: `# fail 0`

- [ ] **Step 9: Commit**

```bash
cd ~/spotterai
git add index.html nutrition-ui.js style.css
git commit -m "feat(nutrition): stats-based targets block and a drift nudge"
```

---

### Task 9: The returning-user prompt

**Files:**
- Create: `nutrition-prompt-ui.js`
- Modify: `index.html` (mount div near `first-week`, script tag near line 1264)
- Modify: `style.css` (append)
- Test: `test/ui-copy.test.js`

**Interfaces:**
- Consumes: `getBodyStats`, `setBodyStats`, `setTargets`, `getState`, `deriveStats` from `tracker-store.js`; `calculateTargets`, `NUTRITION_INTENTS`, `DAILY_ACTIVITY` from `lib/nutrition-targets.js`; `AGE_RANGES` from `onboarding.js`.
- Produces: a dismissible card that opens a setup sheet, plus a `spotter:nutrition-setup` listener so the Nutrition page link (Task 8, Step 5) opens the same sheet.

Modelled on `first-week-ui.js`: a mount div, a localStorage dismiss key, and render-on-event.

- [ ] **Step 1: Add the mount point and script tag**

In `index.html`, directly after `<div id="first-week"></div>` (line 530):

```html
        <div id="nutrition-prompt"></div>
```

and beside the other module scripts (line 1264):

```html
  <script type="module" src="nutrition-prompt-ui.js"></script>
```

- [ ] **Step 2: Write the module**

Create `nutrition-prompt-ui.js`:

```js
/**
 * SpotterAI — nutrition stats prompt for existing users
 * ============================================================================
 * Users who were already here before targets became stats-based have no
 * bodyStats, so they would silently keep the old bodyweight-only numbers. This
 * shows them a dismissible card on Today, and a short sheet to fill the gap.
 *
 * It never overwrites targets on its own: these users may have tuned theirs by
 * hand, so applying the calculated set is always an explicit tap. Dismissing is
 * permanent (the Nutrition page keeps a link back in) rather than a recurring
 * nag.
 */

import { calculateTargets, NUTRITION_INTENTS, DAILY_ACTIVITY } from "./lib/nutrition-targets.js";
import { AGE_RANGES } from "./onboarding.js";
import { deriveStats, getBodyStats, setBodyStats, setTargets } from "./tracker-store.js";

const mount = document.getElementById("nutrition-prompt");
const KEY = "spotterai_nutrition_prompt";

function esc(t) {
  const d = document.createElement("div");
  d.textContent = t == null ? "" : String(t);
  return d.innerHTML;
}
const dismissed = () => {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
};
const dismiss = () => {
  try { localStorage.setItem(KEY, "1"); } catch {}
};

/** Enough stats to calculate? Height and an eating goal are the usual gaps. */
function isComplete() {
  const b = getBodyStats();
  return !!(b.heightCm && b.ageRange && b.dailyActivity && b.intent);
}

/** Has this person actually used the app? New users get onboarding instead. */
function hasHistory() {
  const s = deriveStats();
  return (s.recentWorkouts?.length || 0) > 0 || (s.bodyweight?.series?.length || 0) > 0;
}

let sheetOpen = false;

function draft() {
  const b = getBodyStats();
  const s = deriveStats();
  const raw = s.bodyweight?.latest ?? null;
  return {
    kg: raw == null ? null : s.unit === "lb" ? raw * 0.45359237 : raw,
    cm: b.heightCm,
    ageRange: b.ageRange,
    sex: b.sex,
    dailyActivity: b.dailyActivity,
    daysPerWeek: b.daysPerWeek || 3,
    sessionLength: b.sessionLength || 45,
    intent: b.intent,
  };
}

function chips(field, options, active) {
  return `<div class="np-chips" data-field="${field}">${options
    .map((o) => {
      const value = typeof o === "object" ? o.value : o;
      const label = typeof o === "object" ? o.label : o;
      const on = value === active;
      return `<button type="button" class="onb-chip${on ? " is-active" : ""}" data-value="${esc(value)}" aria-pressed="${on ? "true" : "false"}">${esc(label)}</button>`;
    })
    .join("")}</div>`;
}

function sheet() {
  const d = draft();
  const t = calculateTargets(d);
  return `<div class="card np-sheet">
      <h3 class="card-title">Calculate your targets</h3>
      <p class="dash-hint">Saved on this device only. Nothing leaves your browser.</p>
      <label class="field-label-sm">Height (cm)<input id="np-height" class="input" type="number" min="100" max="250" inputmode="numeric" value="${d.cm || ""}" /></label>
      <span class="onb-flabel">Age range</span>${chips("ageRange", AGE_RANGES, d.ageRange)}
      <span class="onb-flabel">Sex (optional)</span>${chips("sex", ["Male", "Female", "Prefer not to say"], d.sex)}
      <span class="onb-flabel">Eating goal</span>${chips("intent", NUTRITION_INTENTS, d.intent)}
      <span class="onb-flabel">Outside training, your day is</span>${chips("dailyActivity", DAILY_ACTIVITY, d.dailyActivity)}
      <div id="np-preview">${t
        ? `<p class="np-figures">${t.kcal.toLocaleString("en-US")} kcal · ${t.protein}P · ${t.carbs}C · ${t.fat}F</p><p class="dash-hint">${esc(t.basis)}</p>${t.notice ? `<p class="nut-stats__notice">${esc(t.notice)}</p>` : ""}`
        : `<p class="dash-hint">Add your height and log a bodyweight to see calculated targets.</p>`}</div>
      <div class="np-actions">
        <button type="button" class="btn btn--ghost btn--sm" data-np="apply"${t ? "" : " disabled"}>Use these targets</button>
        <button type="button" class="btn-link" data-np="close">Cancel</button>
      </div>
    </div>`;
}

function card() {
  return `<div class="card np-card">
      <p class="np-card__text">SpotterAI can now set your calories and macros from your stats and whether you want to cut, recomp, or bulk. Your current targets stay as they are until you choose to update them.</p>
      <div class="np-actions">
        <button type="button" class="btn btn--ghost btn--sm" data-np="open">Set this up</button>
        <button type="button" class="btn-link" data-np="dismiss">No thanks</button>
      </div>
    </div>`;
}

function render() {
  if (!mount) return;
  if (sheetOpen) { mount.innerHTML = sheet(); return; }
  mount.innerHTML = !dismissed() && hasHistory() && !isComplete() ? card() : "";
}

if (mount) {
  mount.addEventListener("click", (e) => {
    const chip = e.target.closest(".np-chips .onb-chip");
    if (chip) {
      setBodyStats({ [chip.closest(".np-chips").dataset.field]: chip.dataset.value });
      render();
      return;
    }
    const act = e.target.closest("[data-np]")?.dataset.np;
    if (act === "open") { sheetOpen = true; render(); }
    else if (act === "close") { sheetOpen = false; render(); }
    else if (act === "dismiss") { dismiss(); render(); }
    else if (act === "apply") {
      const t = calculateTargets(draft());
      if (t) {
        setTargets({ kcal: t.kcal, protein: t.protein, carbs: t.carbs, fat: t.fat });
        dismiss();
        sheetOpen = false;
        render();
      }
    }
  });
  mount.addEventListener("input", (e) => {
    if (e.target.id !== "np-height") return;
    const cm = Number(e.target.value);
    setBodyStats({ heightCm: cm >= 100 && cm <= 250 ? cm : null });
    const preview = mount.querySelector("#np-preview");
    const t = calculateTargets(draft());
    if (preview) {
      preview.innerHTML = t
        ? `<p class="np-figures">${t.kcal.toLocaleString("en-US")} kcal · ${t.protein}P · ${t.carbs}C · ${t.fat}F</p><p class="dash-hint">${esc(t.basis)}</p>`
        : `<p class="dash-hint">Add your height and log a bodyweight to see calculated targets.</p>`;
    }
  });
  // The Nutrition page's "Set this up" link opens the same sheet.
  window.addEventListener("spotter:nutrition-setup", () => { sheetOpen = true; render(); location.hash = "#/today"; });
  window.addEventListener("spotter:tracker", render);
  window.addEventListener("spotter:profile", render);
  render();
}
```

- [ ] **Step 3: Add the styles**

Append to `style.css`:

```css
/* Nutrition stats prompt for existing users */
.np-card, .np-sheet { display: grid; gap: var(--space-2); margin-bottom: var(--space-3); }
.np-chips { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.np-actions { display: flex; gap: var(--space-2); align-items: center; }
.np-figures { font-weight: 600; }
```

- [ ] **Step 4: Add copy guards**

Append to `test/ui-copy.test.js`, alongside the existing `readFileSync` block:

```js
const nutritionPrompt = readFileSync(join(root, "nutrition-prompt-ui.js"), "utf8");
const nutritionTargets = readFileSync(join(root, "lib/nutrition-targets.js"), "utf8");

test("the onboarding no longer promises height is discarded after setup", () => {
  assert.ok(!/height is saved only while you complete setup/i.test(onboardingUi), "the stale privacy promise is gone");
  assert.ok(/saved on this device/i.test(onboardingUi), "the honest replacement is present");
});

test("a nutrition-stats prompt exists for existing users", () => {
  assert.ok(/id="nutrition-prompt"/.test(html), "mount div present");
  assert.ok(/nutrition-prompt-ui\.js/.test(html), "script tag present");
  assert.ok(/cut, recomp, or bulk/i.test(nutritionPrompt), "explains the new capability");
});

test("the under-18 notice never offers a deficit", () => {
  assert.ok(/won't set a calorie deficit/i.test(nutritionTargets));
  assert.ok(/doctor or a registered dietitian/i.test(nutritionTargets));
});
```

- [ ] **Step 5: Verify in the browser**

```bash
cd ~/spotterai && npx vercel dev
```

To simulate an existing user, open the console and run:

```js
const m = await import("./tracker-store.js");
m.setBodyStats({ heightCm: null, ageRange: null, dailyActivity: null, intent: null });
localStorage.removeItem("spotterai_nutrition_prompt");
location.reload();
```

Confirm the card appears on Today (it needs at least one logged workout or bodyweight), that "Set this up" opens the sheet, that filling it previews live numbers, that "Use these targets" writes them to the Nutrition page, and that "No thanks" hides the card permanently across a reload.

- [ ] **Step 6: Run the suite**

Run: `cd ~/spotterai && npm test`
Expected: `# fail 0`

- [ ] **Step 7: Commit**

```bash
cd ~/spotterai
git add nutrition-prompt-ui.js index.html style.css test/ui-copy.test.js
git commit -m "feat(nutrition): prompt existing users to calculate targets from stats"
```

---

### Task 10: Full verification

**Files:** none changed. This task is verification only.

- [ ] **Step 1: Run everything**

```bash
cd ~/spotterai && npm test && npm run eval && npm run eval:nutrition
```

Expected: `# fail 0` on the suite and both eval suites passing.

- [ ] **Step 2: Run the Safety Lab red-team suite**

```bash
cd ~/spotterai && npx vercel dev
```

Open the Safety Lab page and run the red-team suite in-browser. Confirm no
previously-flagged case stopped flagging other than the spurious deficit cases
this change deliberately fixes. If anything else changed, stop and report it.

- [ ] **Step 3: Final branch summary**

```bash
cd ~/spotterai
git status
git log --oneline main..HEAD
```

Expected: a clean tree and the feature commits on `nutrition-targets-from-stats`.

---

## Self-Review

**Spec coverage:** BMR and midpoints (Task 1), activity multiplier (Task 1), intent factors and macros with both tail guards (Task 2), under-18 guard (Task 2), confidence and basis (Task 2), intent mapping and drift (Task 3), auditor fix (Task 4), sweep (Task 5), `bodyStats` and the privacy consequence (Tasks 6 and 7), onboarding step with live preview and skipped-stats fallback (Task 7), Nutrition page block and drift nudge (Task 8), returning-user prompt with explicit-apply and permanent dismiss (Task 9), full verification (Task 10). No spec section is unimplemented.

**Known risk:** Tasks 7 to 9 edit files this plan quotes by line number. Those numbers shift as earlier tasks land. Locate the quoted code by its text, not by the line number, and re-read the file before editing.

**Style caveat:** the CSS custom properties in Tasks 8 and 9 (`--space-2`, `--border`, `--warn`, `--radius`) are assumed from the existing conventions. Verify them against the top of `style.css` and substitute the real tokens if they differ.
