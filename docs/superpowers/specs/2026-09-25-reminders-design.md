# Reminders: workout, meal and water notifications

**Date:** 2026-09-25
**Status:** approved by Rehaan in chat, 2026-09-25

## Goal

Real lock-screen notifications that nudge people to train, to eat and log meals,
and to drink and log water, even when SpotterAI is closed. A reminder that no
longer applies (lunch already logged, water just logged) does not fire.

## Decisions (from the brainstorm)

| Question | Choice |
|---|---|
| Delivery | Real push notifications, reusing the rest-timer push path (QStash + Web Push). Not in-app only, not calendar. |
| Already logged? | Skip. Logging cancels or moves the pending reminder. |
| Workout nudge timing | From the plan's training frequency; 3 days with no plan. |
| Water | Every 3 hours awake with no water logged; stops once the day's target is met. |

This widens the 2026-09-19 exception (rest push) to the 2026-07-22 "no
notification after the app is closed" rule. It stays $0 and database-free.

## Architecture

```
phone (knows the logs)                       server (knows nothing)
 plannedReminders()  ─ desired set ─┐
 booked set (local) ────────────────┴─ diff ─▶ POST /api/reminders   (book, returns cancel token)
                                            ─▶ DELETE /api/reminders (cancel)
 QStash holds each message until its time ──▶ POST /api/reminders (signed callback) ──▶ Web Push ──▶ SW shows it
```

- **The phone decides.** Logs only live on the device, so the device computes
  the reminders it wants and books them. The server only schedules and sends.
- **Same subscription and keys as rest push.** One push subscription per device
  (`subscribeRestPush`), the same VAPID keys and QStash token (`restPushEnv`).
  The subscription is sealed inside the QStash message exactly as rest push does.
- **Separate route, separate budget.** `/api/reminders` accepts bookings up to
  7 days ahead (QStash free-tier max delay, confirmed on upstash.com/pricing) and
  has its own daily publish cap of **300**, so reminders can never spend the rest
  timer's 600. 600 + 300 stays under the free tier's 1,000/day.
- **Payload carries only the kind.** `{ kind: "workout" | "meal" | "water", detail, at }`
  where `detail` is the meal slot for meals. The service worker writes the text.
  No calories, weights or other numbers leave the device.
- **Per device.** Settings and bookings live in this device's localStorage, like
  rest alerts.

## Timing rules (all times device-local)

A **horizon** bounds what is booked: meal and water reminders are booked for
today plus the next 2 days; workout nudges up to 7 days ahead. If someone never
opens the app, meal and water reminders run out after 3 days, and the workout
nudges keep reaching them for up to a week.

### Workout nudge
- `gap` days = `min(7, max(2, ceil(7 / daysPerWeek)))`, where `daysPerWeek`
  comes from the plan (`days_per_week`, else `days.length`). No plan: `gap = 3`.
  Examples: 4 days/week -> 2, 3 -> 3, 2 -> 4, 1 -> 7.
- Base date = the latest logged workout's date, or the day reminders were turned
  on if there is none.
- Nudges at **18:00** on base + gap, base + 2*gap, ... up to 7 days minus one
  hour from now (margin under QStash's 7-day limit for clock drift). Any time
  already past is skipped.
- Logging a workout moves the base, so every pending nudge is replaced.

### Meal reminders
- Slots and default times: breakfast **08:30**, lunch **12:30**, dinner
  **18:30**. Each time is editable on this device. No snack reminder.
- One reminder per slot per day, for today and the next 2 days.
- Skipped when the time has passed, or when that date already has a nutrition
  entry in that slot.

### Water reminders
- Awake window **09:00 to 21:00**.
- Today: first reminder at `max(lastWaterAt + 3h, 10:00)`, then every 3 hours,
  while the time is at or before 21:00 and after now. None today once today's
  water is at or above the target (`targets.waterMl`).
- Next 2 days: 10:00, 13:00, 16:00, 19:00.
- `lastWaterAt` is recorded by the reminders code: when a tracker change shows
  today's water total went up, it stores the current time. The tracker store is
  not changed.

## Components

| Unit | Purpose | Depends on |
|---|---|---|
| `reminder-plan.js` | Pure: `plannedReminders(input)` -> `[{ key, kind, detail, at }]`. The rules above. | nothing (plain data in) |
| `reminders-sync.js` | Diff desired vs booked, book/cancel via `/api/reminders`, keep local state, sync triggers, settings UI. | `reminder-plan.js`, `workout-alerts.js` (subscription), tracker store, plan store |
| `api/reminders.js` | POST book, DELETE cancel, signed QStash callback -> Web Push. | `lib/rest-push.js`, `lib/push-route.js` |
| `lib/push-route.js` | Handler helpers now private to `api/rest-push.js` (body parsing, headers, callback URL, web-push loader, daily cap counter), shared by both routes. | nothing |
| `service-worker.js` | Text for the three kinds; tap opens a fixed route per kind. | nothing |
| `index.html` Account | "Reminders" section under "Workout alerts". | - |

### Keys and diff
- Key = `kind:detail:YYYY-MM-DDTHH:MM`, e.g. `meal:lunch:2026-09-26T12:30`,
  `water::2026-09-26T13:00`, `workout::2026-09-27T18:00`.
- Sync: drop booked entries whose time has passed; cancel booked keys that are no
  longer desired; book desired keys that are not booked. At most 30 bookings per
  sync.
- Triggers: app start, the page becoming visible, tracker changes (debounced
  2s), and any settings change. Turning a kind off cancels its bookings.

### Settings UI (Account, per device)
- Three switches, all **off** by default: Workout nudges, Meal reminders, Water
  reminders. Three time inputs for meal times, shown when meal reminders are on.
- Turning the first one on asks for notification permission and subscribes,
  the same way rest alerts do. Same "add to home screen first" / "blocked" /
  "unsupported" states as rest alerts.
- Status line says what leaves the phone: this device's push address and the
  reminder times. Nothing else.

### Notification copy (no numbers, no em dashes)
- Workout: **Time to train**, "You haven't logged a workout in a few days. Even a short session counts."
- Meal: **Log your lunch** (breakfast/dinner), "Tap to add what you ate so your targets stay accurate."
- Water: **Drink some water**, "Have a glass, then tap to log it."
- Tap: workout -> `/#/today`, meal and water -> `/#/nutrition`. Routes come from a
  fixed map in the service worker, never from the payload.

## Server rules (`/api/reminders`)

- Book: `POST { subscription, kind, detail, at, now }`. `kind` must be one of the
  three; `detail` must be breakfast/lunch/dinner for meals and empty otherwise;
  `at` must be in the future and within 7 days (client clock skew corrected with
  `now`, as rest push does). Returns `{ token }`.
- Rate limit `reminders`: 40/min, 300/hour per caller (a first sync books ~22),
  outside the shared AI instance budget.
- Daily cap 300 publishes; over it: `503 { configured: true }`, and the client
  stops booking until the next UTC day.
- Not configured (no push env): `503 { configured: false }`; the client shows
  reminders as unavailable.
- Callback: same signature check as rest push. Sent more than 30 minutes late:
  dropped as stale. Push `TTL` 1 hour, `urgency: normal`, `topic` per kind so a
  newer undelivered reminder of the same kind replaces an older one.

## Failure handling

- A booking that fails stays unbooked and is retried on the next sync.
- A cancel that fails is dropped from the local list anyway. Worst case: a stale
  reminder fires, bounded by the 3-day horizon (7 for workout).
- Cleared site data loses the cancel tokens, so already-booked reminders can
  still fire for up to the horizon.
- Two devices with reminders on both get them.

## Limits, stated honestly

- About 10 publishes per active person per day, so the free tier covers roughly
  30 people using reminders daily. Past that, QStash pay-as-you-go needs a card.
- iPhone: installed-to-home-screen PWA only (iOS 16.4+), same as rest push.
- The QStash free tier's handling of cancelled messages is not documented; the
  cap assumes they count.

## Testing

- `reminder-plan.js`: gap per days/week and no plan; base with and without
  workouts; skipping past times; meal skip when logged; editable meal times;
  water chain from `lastWaterAt`, 10:00 floor, 21:00 ceiling, target met; horizon
  3 days / 7 days; keys stable across calls.
- `reminders-sync.js`: diff books missing, cancels removed, drops fired, caps at
  30, stops after a 503 budget answer, keeps going after a failed cancel,
  `lastWaterAt` set when today's water rises.
- `api/reminders.js`: validation (kind, detail, `at` window), cap, not
  configured, cancel token round trip, callback signature, stale drop, push
  payload has only kind/detail/at, topic per kind.
- `lib/push-route.js` extraction: the existing rest-push tests pass unchanged.
- Service worker: source guard for the three kinds' copy and the fixed tap routes.
- Browser: Account section states at phone width.
- Real device (owner gate): install PWA, turn on water reminders, log nothing,
  lock the phone, confirm a banner at the booked time.
