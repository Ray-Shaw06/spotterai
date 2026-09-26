# Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock-screen workout, meal and water reminders that cancel themselves when the thing is already logged.

**Architecture:** The device computes the reminders it wants (`reminder-plan.js`, pure), diffs them against what it has booked (`reminders-sync.js`), and books or cancels each one through a new `/api/reminders` route. That route reuses rest push's QStash + Web Push machinery (`lib/rest-push.js`) and HTTP helpers extracted to `lib/push-route.js`. The service worker turns `{ kind, detail }` into fixed text.

**Tech Stack:** Vanilla ES modules, Vercel Node functions, Upstash QStash, `web-push`, `node:test`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-25-reminders-design.md`.
- No em dashes in any user-facing copy, commit message or comment written for this feature.
- No database. Nothing about the person leaves the device except the push subscription and reminder times.
- Push payload is exactly `{ kind, detail, at }`; `kind` in `workout | meal | water`; `detail` in `breakfast | lunch | dinner` for meals, `""` otherwise.
- `/api/reminders`: bookings at most 7 days ahead; daily publish cap 300; callbacks more than 30 minutes late are dropped; push TTL 3600s; topic `spotterai-<kind>`.
- Every new browser module is added to the service worker precache list (`test/precache-coverage.test.js` enforces it).
- Every new `api/*.js` gets a `maxDuration` in `vercel.json` and is added to the list in `test/chat-transport.test.js`.
- Run `npm test` and `npx eslint .` before every commit; both must be clean.

---

### Task 1: Shared push-route helpers, and configurable lead and lateness

**Files:**
- Create: `lib/push-route.js`
- Modify: `lib/rest-push.js` (`deadlineFor`, `isStale`)
- Modify: `api/rest-push.js` (import helpers instead of defining them)
- Test: `test/push-route.test.js`

**Interfaces:**
- Produces: `callbackUrl(path, env)`, `rawBody(raw)`, `parseJson(raw)`, `queryParam(req, name)`, `header(req, name)`, `dailyCap(limit) -> { claim(nowMs): boolean, reset(): void }` from `lib/push-route.js`.
- Produces: `deadlineFor(endsAtMs, clientNowMs, nowMs = Date.now(), maxLeadSec = MAX_LEAD_SEC)` and `isStale(endsAtMs, nowMs = Date.now(), maxLateSec = MAX_LATE_SEC)`.

- [ ] **Step 1: Write the failing test** `test/push-route.test.js`

```js
import test from "node:test";
import assert from "node:assert/strict";

import { callbackUrl, rawBody, parseJson, queryParam, header, dailyCap } from "../lib/push-route.js";
import { deadlineFor, isStale } from "../lib/rest-push.js";

test("callbackUrl names the given route on the server's own origin", () => {
  assert.equal(callbackUrl("/api/reminders", { VERCEL_PROJECT_PRODUCTION_URL: "spotterai.example" }), "https://spotterai.example/api/reminders");
  assert.equal(callbackUrl("/api/rest-push", { REST_PUSH_ORIGIN: "https://custom.example/x" }), "https://custom.example/api/rest-push");
  assert.equal(callbackUrl("/api/reminders", {}), null);
  assert.equal(callbackUrl("/api/reminders", { REST_PUSH_ORIGIN: "http://insecure.example" }), null);
});

test("body and header helpers read what Vercel hands a function", () => {
  assert.equal(rawBody(Buffer.from("hi")), "hi");
  assert.equal(rawBody({ a: 1 }), '{"a":1}');
  assert.deepEqual(parseJson('{"a":1}'), { a: 1 });
  assert.equal(parseJson("nope"), null);
  assert.equal(queryParam({ url: "/api/reminders?token=abc" }, "token"), "abc");
  assert.equal(header({ headers: { "upstash-signature": ["x", "y"] } }, "upstash-signature"), "x");
});

test("dailyCap counts per UTC day and resets", () => {
  const cap = dailyCap(2);
  const day1 = Date.UTC(2026, 8, 25, 12);
  assert.equal(cap.claim(day1), true);
  assert.equal(cap.claim(day1), true);
  assert.equal(cap.claim(day1), false);
  assert.equal(cap.claim(day1 + 24 * 3600 * 1000), true, "a new UTC day starts a new count");
  cap.reset();
  assert.equal(cap.claim(day1), true);
});

test("deadlineFor and isStale take a route's own limits", () => {
  const now = Date.UTC(2026, 8, 25, 12);
  const threeDays = now + 3 * 24 * 3600 * 1000;
  assert.equal(deadlineFor(threeDays, now, now), null, "rest push still stops at an hour");
  assert.equal(deadlineFor(threeDays, now, now, 7 * 24 * 3600).endsAt, threeDays);
  assert.equal(isStale(now - 10 * 60 * 1000, now), true, "rest push: ten minutes late is stale");
  assert.equal(isStale(now - 10 * 60 * 1000, now, 30 * 60), false, "reminders: ten minutes late is fine");
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `node --test test/push-route.test.js`
Expected: FAIL, cannot find module `../lib/push-route.js`.

- [ ] **Step 3: Create `lib/push-route.js`** by moving `callbackUrl` (with its security comment), `rawBody`, `parseJson`, `queryParam` and `header` out of `api/rest-push.js` unchanged, except that `callbackUrl` takes the route path first and ends with `` return `${url.origin}${path}`; ``. Add:

```js
/**
 * Publishes allowed per UTC day, per serverless instance. See DAILY_PUBLISH_CAP
 * in api/rest-push.js for why a per-instance count is still worth having.
 */
export function dailyCap(limit) {
  let day = "";
  let count = 0;
  return {
    claim(nowMs) {
      const today = new Date(nowMs).toISOString().slice(0, 10);
      if (today !== day) {
        day = today;
        count = 0;
      }
      if (count >= limit) return false;
      count += 1;
      return true;
    },
    reset() {
      day = "";
      count = 0;
    },
  };
}
```

- [ ] **Step 4: Point `api/rest-push.js` at the helpers.** Delete the moved functions and the `publishDay`/`publishCount`/`claimDailyPublish` block. Add:

```js
import { callbackUrl as callbackUrlFor, rawBody, parseJson, queryParam, header, dailyCap } from "../lib/push-route.js";

const publishCap = dailyCap(DAILY_PUBLISH_CAP);
export function __resetDailyCapForTests() {
  publishCap.reset();
}
export { rawBody };

export function callbackUrl(env = deps.env || process.env) {
  return callbackUrlFor("/api/rest-push", env);
}
```

and replace `claimDailyPublish(now)` with `publishCap.claim(now)`.

- [ ] **Step 5: Add the optional limits in `lib/rest-push.js`**

```js
export function deadlineFor(endsAtMs, clientNowMs, nowMs = Date.now(), maxLeadSec = MAX_LEAD_SEC) {
  // ...unchanged, except:
  if (lead < -5 || lead > maxLeadSec) return null;
```

```js
export function isStale(endsAtMs, nowMs = Date.now(), maxLateSec = MAX_LATE_SEC) {
  const ends = Number(endsAtMs);
  return !Number.isFinite(ends) || nowMs - ends > maxLateSec * 1000;
}
```

- [ ] **Step 6: Run the new test and every existing rest-push test**

Run: `node --test test/push-route.test.js test/rest-push.test.js test/rest-push-endpoint.test.js`
Expected: all PASS, rest-push tests unchanged.

- [ ] **Step 7: Commit** `refactor: share the push route helpers, and let a route set its own lead and lateness`

---

### Task 2: `/api/reminders`

**Files:**
- Create: `api/reminders.js`
- Modify: `lib/rate-limit.js` (`LIMITS.reminders`, `OFF_INSTANCE_BUDGET`, `identityFor`)
- Modify: `vercel.json` (`"api/reminders.js": { "maxDuration": 10 }`)
- Modify: `test/chat-transport.test.js` (route list)
- Test: `test/reminders-endpoint.test.js`

**Interfaces:**
- Consumes: Task 1 helpers; `restPushEnv`, `validateSubscription`, `seal`, `open`, `signCancelToken`, `verifyCancelToken`, `verifyUpstashSignature`, `publishQstashMessage`, `cancelQstashMessage` from `lib/rest-push.js`.
- Produces: `POST /api/reminders { subscription, kind, detail, at, now } -> 200 { token, at } | 400 | 503 { configured } | 502`; `DELETE /api/reminders?token= -> 204 | 400`; exports `REMINDER_KINDS`, `MEAL_SLOTS`, `DAILY_REMINDER_CAP`, `MAX_REMINDER_LEAD_SEC`, `MAX_REMINDER_LATE_SEC`, `validReminder`, `callbackUrl`, `__setDepsForTests`, `__resetDailyCapForTests`.

- [ ] **Step 1: Write the failing test** `test/reminders-endpoint.test.js`, reusing the `ENV`/`SUB`/`makeReq`/`makeRes`/`wire` doubles from `test/rest-push-endpoint.test.js` with `CALLBACK = "https://spotterai.example/api/reminders"`, covering:
  - books a meal reminder 2 days out: 200 with a token that `verifyCancelToken` maps back to `msg_abc`; QStash body has `kind: "meal"`, `detail: "lunch"`, `at`, and does not contain the raw endpoint.
  - rejects `kind: "snack"`, `kind: "meal"` with `detail: "brunch"`, `kind: "water"` with `detail: "lunch"`, `at` in the past, `at` 8 days out, bad subscription: all 400, no QStash call.
  - unconfigured: 503 `{ configured: false }`.
  - daily cap: `DAILY_REMINDER_CAP` bookings succeed, the next is 503 `{ configured: true }`.
  - cancel: valid token -> 204 with a QStash DELETE for `msg_abc`; junk token -> 400.
  - callback with a good signature sends `{ kind, detail, at }` with `TTL: 3600`, `urgency: "normal"`, `topic: "spotterai-meal"`; 31 minutes late -> 200 `stale`, nothing sent; bad signature -> 401; a payload with `kind: "rest"` -> 200 `unsealable`.
  - rest push's budget is untouched by reminder bookings (book 5 reminders, then `api/rest-push` still books).

- [ ] **Step 2: Run it and see it fail**

Run: `node --test test/reminders-endpoint.test.js`
Expected: FAIL, cannot find module `../api/reminders.js`.

- [ ] **Step 3: Write `api/reminders.js`** (full file in the implementation commit), shaped exactly like `api/rest-push.js`: `deps` test seam, `config()`, `callbackUrl()` -> `/api/reminders`, `validReminder(kind, detail)`, `handleSchedule` (rate limit `reminders`, config, subscription, `validReminder`, `deadlineFor(at, now, serverNow, MAX_REMINDER_LEAD_SEC)` and `endsAt > serverNow`, callback URL, `cap.claim`, seal, publish), `handleCancel`, `handleFire` (signature, open, `validReminder`, `isStale(at, now, MAX_REMINDER_LATE_SEC)`, send), router for POST and DELETE only.

- [ ] **Step 4: Rate limit** in `lib/rate-limit.js`

```js
  // A first sync books ~22 reminders at once; after that a few per log.
  reminders: { perMinute: 40, perHour: 300 },
```

`OFF_INSTANCE_BUDGET = new Set(["restPush", "foodSearch", "reminders"])`, and `identityFor` keys `reminders` by subscription endpoint the same way as `restPush`.

- [ ] **Step 5: Config.** Add `"api/reminders.js": { "maxDuration": 10 }` to `vercel.json` and `"api/reminders.js"` to the sorted list in `test/chat-transport.test.js`.

- [ ] **Step 6: Run**

Run: `node --test test/reminders-endpoint.test.js test/rate-limit.test.js test/chat-transport.test.js`
Expected: PASS.

- [ ] **Step 7: Commit** `feat: /api/reminders books workout, meal and water pushes`

---

### Task 3: `reminder-plan.js`, which reminders a device wants

**Files:**
- Create: `reminder-plan.js`
- Test: `test/reminder-plan.test.js`

**Interfaces:**
- Produces: `plannedReminders(input) -> Array<{ key, kind, detail, at }>` sorted by `at`; `workoutGapDays(plan) -> number`; `DEFAULT_MEAL_TIMES`; `MEAL_SLOTS`; `ymd(date) -> "YYYY-MM-DD"`.
- `input`: `{ now, enabled: { workout, meals, water }, mealTimes, plan, workouts, nutrition, water, waterTargetMl, lastWaterAt, enabledAt }`.

- [ ] **Step 1: Write the failing test** `test/reminder-plan.test.js`. Build `now` with local `new Date(2026, 8, 25, H, M)` so the machine's time zone never matters. Cases:
  - `workoutGapDays`: no plan 3; `days_per_week` 4 -> 2, 3 -> 3, 2 -> 4, 1 -> 7, 6 -> 2; `days.length` used when `days_per_week` missing.
  - workout: last workout 2026-09-24, 4-day plan, now 09-25 09:00 -> nudges at 09-26 18:00, 09-28 18:00, 09-30 18:00, 10-02 18:00 (all within 7 days less an hour); no workouts -> base is `enabledAt`'s date; a past nudge time is skipped.
  - meals: now 09-25 13:00, lunch logged today -> today dinner 18:30, then breakfast/lunch/dinner on 09-26 and 09-27; breakfast today skipped (past), lunch today skipped (logged); custom `mealTimes.lunch = "13:15"` moves lunch; an invalid time falls back to the default.
  - water: now 09-25 08:00, nothing logged -> today 10:00, 13:00, 16:00, 19:00, then the same four on 09-26 and 09-27; `lastWaterAt` today 14:10 with now 14:11 -> today 17:10, 20:10; target met today -> none today, future days still booked; `lastWaterAt` from yesterday is ignored.
  - disabled kinds produce nothing; keys are stable between two calls with the same input; every `at` is at least a minute after `now`.

- [ ] **Step 2: Run it and see it fail**

Run: `node --test test/reminder-plan.test.js`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Write `reminder-plan.js`** implementing the spec's timing rules (full file in the implementation commit): local-date helpers `ymd`, `atLocal(date, "HH:MM")`, `addDays`; `MIN_LEAD_MS = 60_000`; workout horizon `7 days - 1 hour`; meal/water horizon today + 2 days; water chain rounded up to the minute; an iteration guard on the workout loop.

- [ ] **Step 4: Run**

Run: `node --test test/reminder-plan.test.js`
Expected: PASS.

- [ ] **Step 5: Commit** `feat: work out which reminders a device wants, from its own logs`

---

### Task 4: `reminders-sync.js`, booking, cancelling and settings

**Files:**
- Create: `reminders-sync.js`
- Modify: `workout-alerts.js` (`disableRestAlerts` keeps the subscription while reminders are on)
- Test: `test/reminders-sync.test.js`, `test/workout-alerts.test.js` (one new case)

**Interfaces:**
- Consumes: `plannedReminders`, `DEFAULT_MEAL_TIMES`, `ymd` (Task 3); `restAlertCapability`, `subscribeRestPush` from `workout-alerts.js`; `POST/DELETE /api/reminders` (Task 2).
- Produces: `REMINDERS_KEY = "spotterai.reminders"`, `loadState(store)`, `saveState(state, store)`, `diffBookings(booked, desired, now) -> { keep, cancel, book }`, `noteWater(state, waterTodayMl, today, now) -> state`, `syncReminders(deps) -> Promise<{ status, booked, cancelled, pending }>`, `setReminderEnabled(kind, on, deps)`, `setMealTime(slot, hhmm, deps)`, `initReminders({ doc, getTracker, getPlan, onTrackerChange })`.
- `deps` for `syncReminders`: `{ store, now, getTracker, getPlan, subscribe, fetch }`, each defaulting to the real thing.

- [ ] **Step 1: Write the failing tests** `test/reminders-sync.test.js`:
  - `diffBookings`: drops fired, cancels unwanted, books missing, keeps matching, caps `book` at 30.
  - `noteWater`: a rise today sets `lastWaterAt = now`; same total does not; a new day with water > 0 counts as a rise.
  - `syncReminders` with a fake store, fake tracker, fake subscribe and fake fetch: first sync books every planned reminder and stores tokens; logging lunch then syncing cancels exactly the lunch booking; a 503 `{ configured: true }` stops booking and sets `pausedUntilDay`, and the next sync the same UTC day books nothing; a failed cancel still drops the booking; a new subscription endpoint cancels and rebooks everything; turning every kind off cancels everything and never calls subscribe; a settings change made during a sync is not overwritten by it.
  - `workout-alerts.test.js`: `disableRestAlerts` with reminders on keeps `REST_PUSH_SUBSCRIPTION_KEY`; with reminders off it removes it.

- [ ] **Step 2: Run and see them fail**

Run: `node --test test/reminders-sync.test.js test/workout-alerts.test.js`
Expected: FAIL.

- [ ] **Step 3: Write `reminders-sync.js`** (full file in the implementation commit): state load/save with defaults and shape checks; pure `diffBookings` and `noteWater`; single-flight `syncReminders` that re-reads settings before saving; `setReminderEnabled` (records `enabledAt` the first time); `setMealTime`; `initRemindersUI` for the Account section; `initReminders` wiring start, `visibilitychange` and debounced (2s) tracker changes.

- [ ] **Step 4: Guard `disableRestAlerts`** in `workout-alerts.js`:

```js
/** Reminders (reminders-sync.js) book against this same subscription. */
function remindersOn(store) {
  try {
    const s = JSON.parse(store?.getItem("spotterai.reminders") || "null");
    return !!(s && s.enabled && (s.enabled.workout || s.enabled.meals || s.enabled.water));
  } catch {
    return false;
  }
}

export function disableRestAlerts(env = globalThis, store = safeLocalStorage()) {
  setRestAlertsEnabled(false, store);
  // Releasing the subscription while reminders are on would strand every
  // reminder already booked against it.
  if (!remindersOn(store)) forgetRestPushSubscription(env, store);
  return { state: "disabled", enabled: false };
}
```

- [ ] **Step 5: Run**

Run: `node --test test/reminders-sync.test.js test/workout-alerts.test.js`
Expected: PASS.

- [ ] **Step 6: Commit** `feat: keep booked reminders in line with what the device wants`

---

### Task 5: Service worker, Account section, wiring

**Files:**
- Modify: `service-worker.js` (reminder kinds, click routes, precache list, `CACHE` bump)
- Modify: `index.html` (Account "Reminders" section after "Workout alerts")
- Modify: `style.css` (`.reminder-times`)
- Modify: `reminders.js` (call `initReminders`)
- Test: `test/service-worker-behavior.test.js` (new cases)

**Interfaces:**
- Consumes: `initReminders` (Task 4); push payload `{ kind, detail, at }` (Task 2).

- [ ] **Step 1: Write the failing SW tests**
  - meal push `{ kind: "meal", detail: "lunch" }` -> title `Log your lunch`, body `Tap to add what you ate so your targets stay accurate.`, tag `spotterai-meal`, data `{ kind: "meal" }`.
  - water -> `Drink some water` / `Have a glass, then tap to log it.`; workout -> `Time to train` / `You haven't logged a workout in a few days. Even a short session counts.`
  - `{ kind: "meal", detail: "<script>" }` -> `Log your meal`, nothing from the payload rendered.
  - click with `data.kind` `meal` or `water` -> `/#/nutrition`; `workout` or `rest` -> `/#/today`; an unknown kind or a payload URL -> `/#/today`.

- [ ] **Step 2: Run and see them fail**

Run: `node --test test/service-worker-behavior.test.js`
Expected: FAIL on the new cases.

- [ ] **Step 3: Service worker.** Add the fixed copy table and routes:

```js
const REMINDER_NOTIFICATIONS = Object.freeze({
  workout: Object.freeze({ title: "Time to train", body: "You haven't logged a workout in a few days. Even a short session counts.", route: "/#/today" }),
  meal: Object.freeze({ title: "Log your meal", body: "Tap to add what you ate so your targets stay accurate.", route: "/#/nutrition" }),
  water: Object.freeze({ title: "Drink some water", body: "Have a glass, then tap to log it.", route: "/#/nutrition" }),
});
const MEAL_TITLES = Object.freeze({ breakfast: "Log your breakfast", lunch: "Log your lunch", dinner: "Log your dinner" });
```

In the push listener, before the rest branch: when `payload.kind` is an own key of `REMINDER_NOTIFICATIONS`, show `{ title (MEAL_TITLES[detail] for meals), body, icon, badge, tag: "spotterai-" + kind, renotify: true, data: { kind } }` with the same plain-banner fallback. In `notificationclick`, route by `REMINDER_NOTIFICATIONS[data.kind]?.route` (own keys only), else `NOTIFICATION_DESTINATION`. Add `"reminder-plan.js"` and `"reminders-sync.js"` to the precache list. Bump `CACHE`.

- [ ] **Step 4: Account section in `index.html`**, after the Workout alerts section:

```html
      <div class="account-section account-reminders" id="account-reminders" aria-busy="true">
        <h3 class="account-h">Reminders</h3>
        <p class="account-note">Notifications on this device to train, eat and log, and drink water. A reminder you no longer need is cancelled: logging lunch cancels the lunch reminder, and logging water moves the next one back 3 hours.</p>
        <label class="toggle-row">
          <input type="checkbox" id="reminder-workout" role="switch" aria-checked="false" disabled />
          <span>Workout nudges</span>
        </label>
        <label class="toggle-row">
          <input type="checkbox" id="reminder-meals" role="switch" aria-checked="false" disabled />
          <span>Meal reminders</span>
        </label>
        <div class="reminder-times" id="reminder-meal-times" hidden>
          <label>Breakfast <input type="time" class="input" id="reminder-time-breakfast" value="08:30" /></label>
          <label>Lunch <input type="time" class="input" id="reminder-time-lunch" value="12:30" /></label>
          <label>Dinner <input type="time" class="input" id="reminder-time-dinner" value="18:30" /></label>
        </div>
        <label class="toggle-row">
          <input type="checkbox" id="reminder-water" role="switch" aria-checked="false" disabled />
          <span>Water reminders</span>
        </label>
        <p class="notification-status" id="reminders-status" role="status">Checking notification availability…</p>
      </div>
```

- [ ] **Step 5: CSS** in `style.css` after `.notification-status`:

```css
.reminder-times { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-2); margin: 0 0 var(--space-3); }
.reminder-times label { display: flex; flex-direction: column; gap: 4px; font-size: var(--fs-small); color: var(--text-muted); }
```

- [ ] **Step 6: Wire it** in `reminders.js`:

```js
import { getState, subscribe } from "./tracker-store.js";
import { initReminders } from "./reminders-sync.js";

initReminders({ doc: document, getTracker: getState, getPlan: () => store.plan, onTrackerChange: subscribe });
```

- [ ] **Step 7: Run everything**

Run: `npm test && npx eslint .`
Expected: all PASS, lint clean.

- [ ] **Step 8: Browser check** at 375px: Account shows the Reminders section; switches are disabled with the "add to home screen" or "unsupported" message where push is unavailable; meal times appear only when meal reminders are on; no horizontal scroll.

- [ ] **Step 9: Commit** `feat: reminder notifications and their Account settings`

---

### Task 6: Ship

- [ ] Update the README test count (`npm run check:readme` prints the live number).
- [ ] `npm test`, `npx eslint .`, `npm run check:readme` all clean.
- [ ] Push `feat/reminders`, open the PR (evidence, limits, owner gate: real-device test), do not merge.
