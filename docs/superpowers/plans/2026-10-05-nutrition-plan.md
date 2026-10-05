# Nutrition Plan and Weekly Check-in Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give anyone who logs food an explained, stats-based calorie and macro plan, and a weekly check-in that proposes one small, safe calorie change when their weight trend is confidently outside their goal's pace band.

**Architecture:** Three sequential PRs, each shippable alone. Phase 0 salvages the pure calculator and the auditor's accurate-maintenance argument from an unmerged branch and applies the BMI-based deficit cap. Phase 1 adds persisted body stats, a pure plan builder, and a plan card on the Food diary. Phase 2 adds a pure check-in module (28-day least-squares trend with a confidence limit) and its card. Pure modules hold all decisions; UI modules only render and call them.

**Tech Stack:** Vanilla ES modules, no build step, Node 22 built-in test runner, no new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-05-nutrition-plan-design.md`. Evidence for every number: `docs/rubric-sources.md`, section "Nutrition pace". Read both first.

## Global Constraints

- No new runtime dependencies (the repo has 3). No build step. ES modules only.
- Never auto-apply any calorie change. The app proposes, the user approves.
- No shaming copy and no food judgements: no "clean", "junk", "bad", "cheat", "failed", "missed", "behind", "lost", "broke". A banned-word test guards every new user-facing string.
- No em dashes in any user-facing or doc prose (Rehaan reads them as an AI tell). Use commas, colons, periods.
- User-facing copy never claims research backing for a band and never converts a calorie change into a weight prediction ("100 fewer calories will cost you X kg").
- Constants from the spec, verbatim: window **28 days**, extend to at most **42**; at least **12 weigh-ins** in 28 days (**24** in 42), on at least **4 weekdays**; at least **20 of 28 days logged**; at least **28 days** since targets changed and between proposals; step **5% of the calorie target rounded to 25 kcal**; one-sided **95%** limit (z = 1.645); bands: cut fast limit **1.0%/wk** (**0.5%** when BMI < 25), cut slow edge **0.25%/wk**; bulk fast limit **0.5%/wk** (novice/intermediate) or **0.25%/wk** (advanced), slow edge **0.1%/wk**; recomp **+/-0.25%/wk**; cut deficit capped at **500 kcal/day when BMI < 30**, flat **20%** at BMI 30 and over.
- Calorie floor `max(LOW_KCAL, BMR)` always applies. Under-18 is never offered a deficit.
- Every proposal must pass `evaluateNutrition` with no critical or warning flags using the accurate `maintenance`; otherwise no proposal.
- Every date computation uses pure calendar arithmetic (`Date.UTC` and UTC getters), never `new Date("YYYY-MM-DD")` or local-noon rounding. Date tests run under `TZ=UTC` and `TZ=Asia/Bangkok` before every push (the streak module failed CI once for this).
- Each phase PR: cache bump to the next free `spotterai-vNN`, README and `index.html` test counts updated (`npm run check:readme`), a decision note in `~/life-brain/spotterai/brain/decisions/` plus INDEX line (brain is never committed to the repo). Gates before every PR: `npm test`, `npm run eval` (18/18 caught, 0 false flags), `npx eslint` on changed files.
- Do NOT cherry-pick the old branch's UI commits (onboarding step, drift nudge, setup sheet).

## Review Focus

Input classes the spec implies but no obvious task test would exercise. Each has its test in the owning task.

1. **Timezone and DST** in every day computation: weigh-ins near a DST change, UTC and UTC+7 and UTC+13 runs. (Task 8)
2. **Unit switch mid-history:** the user flips kg/lb after logging weights; stored weights are converted by `setUnit`, so the trend percent must be identical in either unit. (Task 9)
3. **Messy weigh-ins:** several entries on one date, a typo (8.0 instead of 80), an entry dated in the future, all on one weekday. (Task 9)
4. **Stale proposal:** the user edits targets or stats after the card was computed; applying must re-validate against current state, not the old proposal. (Task 11)
5. **Under-18 and skipped fields:** sex skipped (Medium confidence, not an error), height missing (no plan, graceful fallback), age "Under 18" on every surface including a saved deficit target. (Tasks 2, 4, 10)

---

# Phase 0: salvage the pure core (PR 1, branch `feat/nutrition-targets-core` off `main`)

### Task 1: Bring over the calculator and the auditor's `maintenance` argument

**Files:**
- Create: `lib/nutrition-targets.js`, `test/nutrition-targets.test.js` (copied unchanged from `origin/nutrition-targets-from-stats`)
- Modify: `nutrition-safety.js` (the `maintenance` argument), `test/nutrition-safety.test.js` (the 4 added tests)

**Interfaces:**
- Produces: `calculateTargets({ kg, cm, ageRange, sex, dailyActivity, daysPerWeek, sessionLength, intent }) -> object|null`, `estimateBmr`, `estimateTdee`, `activityMultiplier`, `completeMacros`, `intentForGoal`, `targetsDrift`, constants `NUTRITION_INTENTS`, `DAILY_ACTIVITY`, `AGE_MIDPOINTS`, `MINOR_NOTICE`; and `evaluateNutrition({ targets, bodyweight, unit, goal, maintenance = null })`.

- [ ] **Step 1:** `git checkout -b feat/nutrition-targets-core main`, then `git checkout origin/nutrition-targets-from-stats -- lib/nutrition-targets.js test/nutrition-targets.test.js`.
- [ ] **Step 2:** Re-apply only the `nutrition-safety.js` diff (`git diff main origin/nutrition-targets-from-stats -- nutrition-safety.js`): add `maintenance = null` to the `evaluateNutrition` signature and use `Number(maintenance) > 0 ? Number(maintenance) : kg * MAINTENANCE_KCAL_PER_KG` for the deficit check. Do not take any other hunk.
- [ ] **Step 3:** Append the four tests from `git diff main origin/nutrition-targets-from-stats -- test/nutrition-safety.test.js` to `test/nutrition-safety.test.js`.
- [ ] **Step 4:** Run `node --test test/nutrition-targets.test.js test/nutrition-safety.test.js`. Expected: all pass, including the 48,600-combination sweep. If the branch test imports anything missing on main, fix the import, not the logic.
- [ ] **Step 5:** `npm test` (expect all pass) and `npm run eval` (expect 18/18 caught, 0 false flags, and byte-identical default behaviour). Commit: `feat: stats-based nutrition targets and an accurate-maintenance auditor argument`.

### Task 2: Cap the cut deficit by BMI

**Files:**
- Modify: `lib/nutrition-targets.js`, `test/nutrition-targets.test.js`

**Interfaces:**
- Produces: exported constants `CUT_DEFICIT_PCT = 0.2`, `CUT_DEFICIT_CAP_KCAL = 500`, `CUT_CAP_BELOW_BMI = 30`; `bmiOf(kg, cm) -> number|null`; `cutDeficitKcal({ tdee, bmi }) -> number`; `calculateTargets` result gains `bmi` and `deficitKcal`.

- [ ] **Step 1: Write failing tests** in `test/nutrition-targets.test.js`:
  - `bmiOf(80, 180)` is within 0.01 of 24.69; `bmiOf(0, 180)` and `bmiOf(80, 0)` are `null`.
  - `cutDeficitKcal({ tdee: 3200, bmi: 24 })` is `500`; `({ tdee: 2400, bmi: 24 })` is `480` (20% is under the cap); `({ tdee: 3200, bmi: 29.99 })` is `500`; `({ tdee: 3200, bmi: 30 })` is `640`.
  - A cut for a 90 kg, 185 cm, 24-year-old male at BMI under 30 with TDEE above 2,500 has `deficitKcal <= 500` and `kcal` within 25 of `tdee - 500`.
  - A cut at BMI 32 gets `deficitKcal` equal to 20% of TDEE (not capped).
  - Recomp and bulk results are unchanged from before the cap (assert exact `kcal` equals the pre-change value for one fixed input each).
  - The floor still wins: a small body whose capped target is under `max(LOW_KCAL, BMR)` returns exactly that floor.
  - Under-18 with intent cut still returns the recomp (maintenance) target and the minor notice.
  - The `basis` line for a capped cut contains "500 kcal under" and for an uncapped one contains "20%".
- [ ] **Step 2:** Run `node --test test/nutrition-targets.test.js`. Expected: FAIL on the new assertions.
- [ ] **Step 3:** Implement the three exports in `lib/nutrition-targets.js`. In `calculateTargets`, for the applied intent `cut` replace `tdee * kcalFactor` with `tdee - cutDeficitKcal({ tdee, bmi })`; keep `round25(Math.max(LOW_KCAL, bmr, ...))`. Update `basisLine` to state the real figure. Label the BMI split in a code comment as a design choice (a proxy) citing `docs/rubric-sources.md`.
- [ ] **Step 4:** Update any existing test that pinned the old flat-20% cut value. Run the sweep test: every output must still pass `evaluateNutrition` with zero flags.
- [ ] **Step 5:** `npm test`, `npm run eval`. Commit: `feat: cap the cut deficit at 500 kcal/day under BMI 30`.

### Task 3: Ship Phase 0

**Files:** `README.md`, `index.html` (test counts), `docs/features.md` (one sentence only if user-visible; Phase 0 has none, so skip), brain note.

- [ ] **Step 1:** Update test counts in `README.md` and `index.html`; run `npm run check:readme` (expect OK). No cache bump: nothing user-visible changes.
- [ ] **Step 2:** Run `TZ=UTC npm test` and `TZ=Asia/Bangkok npm test`. Expected: pass.
- [ ] **Step 3:** Write the brain decision note including the standing-rule-6 sign-off: default `evaluateNutrition` behaviour is byte-identical, so Phase 0 changes nothing in production until callers pass `maintenance` (Phase 1). Correct `2026-07-28_nutrition-targets-from-stats.md` status to "salvaged in PR N".
- [ ] **Step 4:** Push, open PR "feat: stats-based nutrition targets (salvaged) with a BMI-aware deficit cap". Body states what was and was not taken from the old branch. Merge only after CI is green.

---

# Phase 1: stats and the plan card (PR 2, branch `feat/nutrition-plan-card` off updated `main`)

### Task 4: Persist body stats and when targets last changed

**Files:**
- Modify: `tracker-store.js` (`DEFAULTS`, `SYNCED_META_KEYS`, `setTargets`, `importData`, new exports), `test/tracker-bodystats.test.js` (create)
- Create: `nutrition-plan.js` (only `validateBodyStats` in this task)

**Interfaces:**
- Produces: `validateBodyStats(input) -> { ok: boolean, errors: string[], value: BodyStats|null }` in `nutrition-plan.js`; in `tracker-store.js`: `getBodyStats() -> BodyStats|null`, `setBodyStats(input) -> { ok, errors }`, `getTargetsChangedOn() -> 'YYYY-MM-DD'|null`, `bodyweightSeries() -> Array<{ date: string, kg: number }>` (current unit converted to kg, oldest first).
- `BodyStats = { heightCm: number, ageRange: string, sex: "Male"|"Female"|"", dailyActivity: string, daysPerWeek: number, sessionLength: number, intent: "cut"|"recomp"|"bulk" }`.

- [ ] **Step 1: Write failing tests.** `validateBodyStats`: rejects height outside 100 to 250 cm, `ageRange` not in `AGE_RANGES`, `dailyActivity` not in `DAILY_ACTIVITY` values, `daysPerWeek` outside 0 to 7, `sessionLength` outside 15 to 180, unknown intent; accepts `sex: ""`; trims and coerces numeric strings. Store: `setBodyStats` persists and `getBodyStats` returns it; invalid input returns `{ ok: false }` and changes nothing; `setTargets` sets `getTargetsChangedOn()` to today; stats and `targetsChangedOn` appear in `metaSnapshot()` and `mergeRemoteMeta({ bodyStats })` applies them; `exportData`/`importData` round-trips both; an import with no `bodyStats` yields `null`, not undefined; `bodyweightSeries()` in a `lb` state returns kg values (`220.5 lb` is within 0.05 of `100.0 kg`) and is sorted by date.
- [ ] **Step 2:** Run `node --test test/tracker-bodystats.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement. `DEFAULTS` gains `bodyStats: null, targetsChangedOn: null`. Add both keys to `SYNCED_META_KEYS` (older clients ignore unknown meta keys, verified: `mergeRemoteMeta` only iterates its own key list). `setTargets` sets `state.targetsChangedOn = today()`. `importData` defaults both. `tracker-store.js` imports `validateBodyStats` from `nutrition-plan.js` (pure, no cycle).
- [ ] **Step 4:** `npm test`. Commit: `feat: persist body stats and the date targets last changed`.

### Task 5: The plan builder

**Files:** Modify `nutrition-plan.js`, create `test/nutrition-plan.test.js`.

**Interfaces:**
- Consumes: `calculateTargets`, `intentForGoal`, `AGE_RANGES` from `onboarding.js`.
- Produces: `buildPlan({ bodyStats, kg }) -> null | { targets: {kcal, protein, carbs, fat}, tdee, bmr, bmi, deficitKcal, intent, requestedIntent, confidence: "High"|"Medium", basis, notice, proteinPerKg, limitations }`; `maintenanceFor(bodyStats, kg) -> number|null` (the calculator's `tdee`); `prefillFromInputs(inputs) -> { daysPerWeek, sessionLength, intent }` (reads `store.inputs` shape: `daysPerWeek`, `sessionLength`, `goal`; maps goal text to a `GOAL_OPTIONS` value, then `intentForGoal`).

- [ ] **Step 1: Write failing tests.** `buildPlan` returns null without `kg` or `heightCm`; `proteinPerKg` equals `targets.protein / kg` within 0.05; `confidence` is "Medium" when sex is `""`, "High" otherwise; `limitations` is non-empty, says estimates, and contains no banned word; under-18 returns the notice and `intent: "recomp"` with `requestedIntent` preserved; `maintenanceFor` equals `buildPlan(...).tdee`; `prefillFromInputs({ goal: "Fat loss", daysPerWeek: 4, sessionLength: 60 })` returns intent `cut`, `{ goal: "Hypertrophy" }` returns `bulk`, `{}` returns intent `recomp` and days 3, length 45 (never guess into a deficit); a banned-word sweep over every string field for 12 stat combinations; no em dash anywhere.
- [ ] **Step 2:** Run, expect FAIL. **Step 3:** Implement the three functions; `limitations` copy: "These are estimates, not measurements. Your own weight trend over several weeks is a better guide, and the weekly check-in adjusts from it." **Step 4:** Run, expect PASS. **Step 5:** Commit: `feat: a pure nutrition plan builder`.

### Task 6: Pass accurate maintenance to every auditor call

**Files:** Modify `nutrition-streaks.js` (`streaksFor`), `nutrition-ui.js` (`renderNutritionSafety`), `today-ui.js` (the `evaluateNutrition` call); tests in `test/nutrition-streaks.test.js` and `test/nutrition-plan.test.js`.

**Interfaces:**
- Consumes: `maintenanceFor`, `getBodyStats`, `bodyweightSeries`.
- Produces: `streaksFor({ ..., maintenance })` forwards `maintenance` to `evaluateNutrition`.

- [ ] **Step 1: Failing tests.** `streaksFor` with a 130 kg body and a 1,900 kcal target and `maintenance: 2364` keeps the calorie run (no critical flag); the same call with no `maintenance` still behaves as today (regression pin). A plan-level test: for the spec's heavy-body case, `evaluateNutrition({ ..., maintenance: maintenanceFor(stats, kg) })` has zero flags while the call without it flags a deficit (this is the live over-flagging bug, now fixed for that user).
- [ ] **Step 2:** Run, expect FAIL. **Step 3:** Thread `maintenance` through the three call sites; when `getBodyStats()` is null pass nothing, preserving today's behaviour exactly. **Step 4:** `npm test`, `npm run eval`. **Step 5:** Commit: `fix: pass accurate maintenance to the nutrition auditor when stats exist`.

### Task 7: The Food diary plan card and inline setup

**Files:**
- Create: `nutrition-plan-ui.js`, `plan-card.js` (pure view model + markup, same shape as `consistency-card.js`), `test/plan-card.test.js`
- Modify: `index.html` (a `#nut-plan-card` container above "Goals & targets"), `nutrition-ui.js` (import and call render), `style.css`, `service-worker.js` (add the two new modules to the module list; bump the cache), `README.md`/`index.html` counts.

**Interfaces:**
- Consumes: `buildPlan`, `validateBodyStats`, `prefillFromInputs`, `getBodyStats`, `setBodyStats`, `setTargets`, `bodyweightSeries`, `addBodyweight`.
- Produces: `planCardModel({ bodyStats, plan, current }) -> { state: "setup"|"plan", ... }` and `planCardHTML(model) -> string`.

- [ ] **Step 1: Failing tests** for `planCardModel`/`planCardHTML`: no stats gives the `setup` state with a "Get my targets" button and no numbers; stats give a `plan` state showing kcal and the three macros, the `basis` line, protein per kg, confidence, `limitations`, and the minor notice when present; a "Use these targets" button is shown only when the plan differs from the saved targets by 25 kcal or more; a real `<h2>` heading and no eyebrow element; tone and banned-word sweep; no research claim wording ("studies show", "science").
- [ ] **Step 2:** Run, expect FAIL. **Step 3:** Implement the pure model and markup, then `nutrition-plan-ui.js` wiring: an **inline** form inside the card (not a modal; the craft floor forbids a modal for a task that needs no interruption) with chips for age range, sex (optional), daily activity, training days and minutes (prefilled via `prefillFromInputs`), a height field honouring the current unit (cm, or ft and in), and the three intents; current weight asks only when `bodyweightSeries()` is empty and logs it via `addBodyweight`. "Use these targets" calls `setTargets`. Re-render on the `spotter:tracker` event, guarding against clobbering a field the user is typing in (the repo's render-on-persist lesson: skip re-render while an input is focused).
- [ ] **Step 4:** Run `npm test`. Browser-verify with `spotterai-nocache` (port 4231): no stats shows the setup state; saving stats shows the plan; "Use these targets" writes targets and hides the button; light, dark, and 375px; clear the service worker and caches before measuring. Run the impeccable detector in full mode on changed UI files. **Step 5:** Commit: `feat: an explained nutrition plan on the Food diary`.

### Task 8: Ship Phase 1

- [ ] **Step 1:** `docs/features.md` paragraph, brain decision note and INDEX line, README counts, cache bump. **Step 2:** `TZ=UTC npm test`, `TZ=Asia/Bangkok npm test`, `npm run eval`, `npm run check:readme`, eslint on changed files. **Step 3:** Push, open PR, wait for all CI checks (not just Vercel), merge on explicit approval.

---

# Phase 2: the weekly check-in (PR 3, branch `feat/nutrition-checkin` off updated `main`)

### Task 9: Shared calendar maths and the trend

**Files:**
- Create: `lib/calendar-days.js`, `test/calendar-days.test.js`, `nutrition-adjust.js`, `test/nutrition-adjust.test.js`
- Modify: `nutrition-streaks.js` (import the shared maths instead of its private copies)

**Interfaces:**
- Produces: `dayNumber(ymd) -> number`, `ymdFromNumber(n) -> string`, `addDays(ymd, n) -> string`, `weekdayOf(ymd) -> 0..6` (0 = Sunday), all timezone-independent. In `nutrition-adjust.js`: `trendOf(points: Array<{ day: number, kg: number }>) -> { slopePctPerWeek: number, upper: number, lower: number, n: number } | null` (least-squares slope as percent of mean weight per week, with one-sided 95% limits `slope +/- 1.645 * se`; `null` when fewer than 3 distinct days), and `prepareWeighIns(series, today, windowDays) -> Array<{ day, kg }>` (collapses same-date entries to their mean, drops future dates, drops values outside 25 to 400 kg or more than 15% from the window median).

- [ ] **Step 1: Failing tests.** Calendar: round trips for 2026-03-07 to 2026-03-10 (US DST) and 2026-10-25 (EU DST) and 2026-12-31 to 2027-01-01; `weekdayOf("2026-10-05")` is 1 (Monday); identical results under `TZ=UTC`, `Asia/Bangkok`, `Pacific/Auckland`, `America/Los_Angeles` (spawn `node --test` children with `TZ` set, as the existing TZ-sensitive tests do, or run the file under each in the verification step). Streaks: the existing 15 tests still pass unchanged. Trend: a perfect line `-0.5%/wk` over 28 days returns `slopePctPerWeek` within 0.001 of -0.5 and `upper < lower` ordering correct; flat data returns about 0; two entries on one date are averaged (assert `n`); a typo (8.0 among 80s) and a future date are dropped; fewer than 3 distinct days returns `null`; the same series entered in lb gives the same percent slope as in kg (Review Focus 2); weigh-ins all on one weekday are still computed (weekday spread is a gate in Task 10, not here).
- [ ] **Step 2:** Run, expect FAIL. **Step 3:** Implement; extract `dayNumber` and `ymdFromNumber` from `nutrition-streaks.js` verbatim (`Date.UTC` and UTC getters), add the other two. **Step 4:** `TZ=UTC npm test`, `TZ=Asia/Bangkok npm test`. **Step 5:** Commit: `feat: shared calendar maths and a weight trend with confidence limits`.

### Task 10: The pace bands, the gate, and the check-in decision

**Files:** Modify `nutrition-adjust.js`, `test/nutrition-adjust.test.js`; create `test/nutrition-adjust-sweep.test.js`.

**Interfaces:**
- Consumes: `trendOf`, `prepareWeighIns`, `buildPlan`/`calculateTargets`, `completeMacros`, `evaluateNutrition`, `estimateBmr`, `NUTRITION_THRESHOLDS`.
- Produces: exported constants (every one from Global Constraints, each with a comment marking it Directional, Practical or Derived per `rubric-sources.md`); `paceBandFor({ intent, bmi, trainingAge }) -> { slowEdge: number, fastLimit: number }` (percent per week, losses expressed as negatives for a cut); and
  `checkIn({ series, days, targets, bodyStats, trainingAge, unit, today, targetsChangedOn, lastProposalOn }) -> Result`, where `Result` is one of `{ status: "not_ready", reason: "too_soon"|"few_weighins"|"few_weekdays"|"few_logs" }`, `{ status: "inconclusive", reason: "straddles_band"|"log_scale_disagree" }`, `{ status: "on_track", slopePctPerWeek }`, `{ status: "propose", reason: "too_fast"|"stalled", fromKcal, toKcal, targets: {kcal,protein,carbs,fat}, slopePctPerWeek }`.

- [ ] **Step 1: Failing tests.** Bands: `paceBandFor` returns cut `{ slowEdge: -0.25, fastLimit: -1.0 }`, `-0.5` fast limit when `bmi < 25`; bulk `0.5` and `0.25` for novice/intermediate vs advanced; recomp +/-0.25. Gate: each of `too_soon` (27 days since change), `few_weighins` (11 in 28 days), `few_weekdays` (12 on 3 weekdays), `few_logs` (19 logged days) returns not_ready; the boundary values (28, 12, 4 weekdays, 20) pass. Decisions: a clean -0.6%/wk cut is `on_track`; a clean -1.5%/wk cut is `propose` with `reason: "too_fast"`, `toKcal = fromKcal + 5% rounded to 25`; a clean stall on a cut proposes lowering only when that stays within the starting deficit, otherwise returns `on_track`-style information, never a deeper cut (plateau-chasing refused); a bulk gaining too fast lowers, a stalled bulk raises; a CI that straddles an edge at 28 days with enough data extends to 42 days before returning `inconclusive`; logged intake far below target with a flat scale returns `inconclusive`/`log_scale_disagree`; under-18 is never `toKcal < fromKcal`; `toKcal` never below `max(LOW_KCAL, BMR)`; a proposal that `evaluateNutrition` would flag returns no proposal (build the case with a target one step above the aggressive-deficit threshold); `lastProposalOn` within 28 days returns not_ready; `targetsChangedOn: null` is treated as eligible.
- [ ] **Step 2:** `nutrition-adjust-sweep.test.js`: (a) cross-system sweep: stats x weight trends through `checkIn`, every `propose` result through `evaluateNutrition({ ..., maintenance })` asserts zero critical/warning flags and `toKcal >= floor`; first assert at least 5% of the sweep produces proposals so it is not vacuous; (b) statistical guarantee: a seeded generator (copy `mulberry32` and Box-Muller from `scripts/simulate-weight-trend.mjs`) at noise 0.4%, 0.5% and 1.0% per weigh-in plus the 0.35% weekday rhythm, truly on pace at -0.6%/wk with 12 weigh-ins over 28 days, 2,000 trials each, asserts the share returning `propose` is at most 1%.
- [ ] **Step 3:** Run, expect FAIL. **Step 4:** Implement `checkIn`: `prepareWeighIns` over 28 days, gate, `trendOf`, compare `upper`/`lower` with the band, extend to 42 days when inconclusive, build the proposal with `round25(target * 0.05)` step and `completeMacros` holding protein per kg, validate with `evaluateNutrition`. **Step 5:** `TZ=UTC npm test`, `TZ=Asia/Bangkok npm test`. **Step 6:** Commit: `feat: the weekly check-in decision, with sourced pace bands`.

### Task 11: Check-in card, handled state, and a safe apply

**Files:**
- Create: `checkin-card.js` (pure model, markup, handled-flag helpers), `test/checkin-card.test.js`
- Modify: `nutrition-ui.js` (render the card), `today-ui.js` (one line when a proposal waits), `style.css`, `service-worker.js` (modules, cache bump), counts.

**Interfaces:**
- Consumes: `checkIn`, `setTargets`, `getBodyStats`, `getTargetsChangedOn`, `bodyweightSeries`, `nutritionDaySummaries`.
- Produces: `checkInCardModel(result) -> { kind, title, body, cta?, dismiss? } | null`; `handledCheckIn(env) -> string|null`, `markCheckInHandled(latestWeighDate, env)` (key `spotterai.checkIn.handled`); `applyProposal(proposal) -> { ok: boolean, reason?: "stale" }`.

- [ ] **Step 1: Failing tests.** `propose` model names the observed trend ("your weight has moved about X% a week over N weeks") and the one step offered, shows "Apply" and "Not now", and never contains a weight prediction, a research claim, or a banned word; `on_track` is a single quiet line with no buttons; `not_ready` returns `null` except when only weigh-ins are missing (a short prompt to weigh in); `inconclusive` copy for `log_scale_disagree` says the log may be missing some food and never accuses; handled state is keyed by the latest weigh-in date and survives throwing storage; **stale proposal (Review Focus 4):** `applyProposal` re-runs `checkIn` against current state and returns `{ ok: false, reason: "stale" }` when targets or stats changed since the card was built, leaving targets untouched; applying a valid proposal calls `setTargets` once and resets `getTargetsChangedOn()`.
- [ ] **Step 2:** Run, expect FAIL. **Step 3:** Implement. **Step 4:** Browser-verify with seeded 5 weeks of weigh-ins (propose, on_track, not_ready, and the stale path by editing targets between render and apply); light, dark, 375px; impeccable detector in full mode. **Step 5:** `npm test`, `npm run eval`. Commit: `feat: a weekly nutrition check-in card that proposes and never applies on its own`.

### Task 12: Ship Phase 2

- [ ] **Step 1:** `docs/features.md` paragraph; update the "Nutrition pace" section of `docs/rubric-sources.md` from "planned, not yet in code" to shipped and add the constants' file locations; brain note, INDEX line; counts; cache bump. **Step 2:** `TZ=UTC npm test`, `TZ=Asia/Bangkok npm test`, `npm run eval`, `npm run check:readme`, eslint. **Step 3:** Real-phone check is an owner gate (the simulator does not boot here); say so in the PR. Push, open PR, wait for every check, merge on explicit approval, then verify production serves the new cache version.
