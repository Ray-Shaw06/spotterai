/**
 * SpotterAI — keeps this device's booked reminders in line with what it wants
 * ============================================================================
 * reminder-plan.js says which reminders the device wants right now. This file
 * compares that with what it has booked on /api/reminders, cancels what is no
 * longer wanted (lunch got logged), books what is missing, and remembers the
 * cancel tokens. It also owns the Account "Reminders" settings.
 *
 * Runs on app start, when the app comes back to the foreground, a couple of
 * seconds after any tracker change, and after any settings change. One sync
 * at a time: a trigger that lands mid-sync runs once more after it.
 *
 * Everything is per device and lives in localStorage under REMINDERS_KEY.
 * What leaves the phone: the push subscription (as rest push already sends it)
 * and each reminder's kind and time. Nothing that was logged.
 */

import { plannedReminders, DEFAULT_MEAL_TIMES, MEAL_SLOTS, ymd } from "./reminder-plan.js";
import { restAlertCapability, subscribeRestPush } from "./workout-alerts.js";

export const REMINDERS_KEY = "spotterai.reminders";
export const REMINDERS_ENDPOINT = "/api/reminders";
/** A first sync wants ~22; the cap keeps one sync from bursting past the rate limit. */
export const MAX_BOOKINGS_PER_SYNC = 30;

const KINDS = Object.freeze(["workout", "meals", "water"]);
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const REQUEST_TIMEOUT_MS = 8000;

function safeLocalStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function timeoutSignal() {
  try {
    return AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  } catch {
    return undefined;
  }
}

export function defaultState() {
  return {
    enabled: { workout: false, meals: false, water: false },
    mealTimes: { ...DEFAULT_MEAL_TIMES },
    enabledAt: null,
    lastWaterAt: null,
    waterSeen: null,
    bookings: [],
    pausedUntilDay: null,
    endpoint: null,
  };
}

/** Settings and bookings, with defaults for anything missing or malformed. */
export function loadState(store = safeLocalStorage()) {
  const base = defaultState();
  let raw = null;
  try {
    raw = JSON.parse(store?.getItem(REMINDERS_KEY) || "null");
  } catch {
    raw = null;
  }
  if (!raw || typeof raw !== "object") return base;
  const enabled = {};
  for (const k of KINDS) enabled[k] = raw.enabled?.[k] === true;
  const mealTimes = { ...base.mealTimes };
  for (const slot of MEAL_SLOTS) if (TIME.test(raw.mealTimes?.[slot] || "")) mealTimes[slot] = raw.mealTimes[slot];
  const bookings = Array.isArray(raw.bookings)
    ? raw.bookings.filter((b) => b && typeof b.key === "string" && typeof b.token === "string" && Number.isFinite(b.at))
    : [];
  return {
    enabled,
    mealTimes,
    enabledAt: Number.isFinite(raw.enabledAt) ? raw.enabledAt : null,
    lastWaterAt: Number.isFinite(raw.lastWaterAt) ? raw.lastWaterAt : null,
    waterSeen: raw.waterSeen && typeof raw.waterSeen.date === "string" ? { date: raw.waterSeen.date, ml: Number(raw.waterSeen.ml) || 0 } : null,
    bookings,
    pausedUntilDay: typeof raw.pausedUntilDay === "string" ? raw.pausedUntilDay : null,
    endpoint: typeof raw.endpoint === "string" ? raw.endpoint : null,
  };
}

export function saveState(state, store = safeLocalStorage()) {
  try {
    store?.setItem(REMINDERS_KEY, JSON.stringify(state));
  } catch {
    /* storage disabled: reminders simply do not persist */
  }
}

/** What to keep, cancel and book. Bookings whose time has passed have fired and drop out. */
export function diffBookings(booked, desired, now) {
  const wanted = new Set(desired.map((r) => r.key));
  const live = booked.filter((b) => b.at > now);
  const have = new Set(live.map((b) => b.key));
  return {
    keep: live.filter((b) => wanted.has(b.key)),
    cancel: live.filter((b) => !wanted.has(b.key)),
    book: desired.filter((r) => !have.has(r.key)).slice(0, MAX_BOOKINGS_PER_SYNC),
  };
}

/**
 * The tracker keeps one water total per day, with no times, so this is where
 * "when did they last drink" comes from: whenever today's total is higher than
 * the last time we looked, that is a log, now.
 */
export function noteWater(state, waterTodayMl, today, now) {
  const before = state.waterSeen?.date === today ? Number(state.waterSeen.ml) || 0 : 0;
  const rose = waterTodayMl > before;
  return { ...state, lastWaterAt: rose ? now : state.lastWaterAt, waterSeen: { date: today, ml: waterTodayMl } };
}

// --- Talking to /api/reminders ----------------------------------------------

async function bookOne(reminder, subscription, now, d) {
  try {
    const res = await d.fetch(REMINDERS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription, kind: reminder.kind, detail: reminder.detail, at: reminder.at, now }),
      signal: timeoutSignal(),
    });
    if (res.status === 503) {
      const json = await res.json().catch(() => null);
      if (json?.configured === true) return { stop: "budget" };
      if (json?.configured === false) return { stop: "unconfigured" };
      return {};
    }
    if (!res.ok) return {};
    const json = await res.json();
    return typeof json?.token === "string" ? { token: json.token } : {};
  } catch {
    return {};
  }
}

async function cancelOne(token, d) {
  try {
    const res = await d.fetch(`${REMINDERS_ENDPOINT}?token=${encodeURIComponent(token)}`, {
      method: "DELETE",
      keepalive: true,
      signal: timeoutSignal(),
    });
    return res.ok;
  } catch {
    // Dropped either way: a reminder that still fires is bounded by the horizon.
    return false;
  }
}

// --- Sync ---------------------------------------------------------------------

/** Data sources, set by initReminders() in the app and passed in by tests. */
let wired = {};

function depsWith(over = {}) {
  return {
    store: safeLocalStorage(),
    now: () => Date.now(),
    getTracker: () => null,
    getPlan: () => null,
    subscribe: () => subscribeRestPush(),
    fetch: (...args) => globalThis.fetch(...args),
    ...wired,
    ...over,
  };
}

async function syncOnce(d) {
  const store = d.store;
  const now = d.now();
  const today = ymd(new Date(now));
  const tracker = d.getTracker() || {};
  let state = loadState(store);
  state = noteWater(state, Number(tracker.water?.[today]) || 0, today, now);

  const anyOn = KINDS.some((k) => state.enabled[k]);
  const desired = anyOn
    ? plannedReminders({
        now,
        enabled: state.enabled,
        mealTimes: state.mealTimes,
        plan: d.getPlan(),
        workouts: tracker.workouts,
        nutrition: tracker.nutrition,
        water: tracker.water,
        waterTargetMl: tracker.targets?.waterMl,
        lastWaterAt: state.lastWaterAt,
        enabledAt: state.enabledAt,
      })
    : [];

  let status = anyOn ? "on" : "off";
  const subscription = anyOn ? await d.subscribe().catch(() => null) : null;
  if (anyOn && !subscription) status = "unavailable";

  // A new push address (rotated key, reinstalled app) orphans every booking
  // made with the old one: cancel them all and book afresh.
  let booked = state.bookings;
  let orphaned = [];
  if (subscription && state.endpoint && subscription.endpoint !== state.endpoint) {
    orphaned = booked.filter((b) => b.at > now);
    booked = [];
  }
  const { keep, cancel, book } = diffBookings(booked, desired, now);
  const results = await Promise.all([...orphaned, ...cancel].map((b) => cancelOne(b.token, d)));
  const cancelled = results.filter(Boolean).length;

  const kept = [...keep];
  let bookedCount = 0;
  const utcDay = new Date(now).toISOString().slice(0, 10);
  let pausedUntilDay = state.pausedUntilDay === utcDay ? utcDay : null;
  if (subscription && !pausedUntilDay) {
    for (const reminder of book) {
      const outcome = await bookOne(reminder, subscription, now, d);
      if (outcome.token) {
        kept.push({ key: reminder.key, at: reminder.at, token: outcome.token });
        bookedCount += 1;
      } else if (outcome.stop === "budget") {
        pausedUntilDay = utcDay;
        break;
      } else if (outcome.stop === "unconfigured") {
        status = "unavailable";
        break;
      }
    }
  }
  if (anyOn && pausedUntilDay) status = "paused";

  // Re-read before writing, so a settings change made while this sync was out
  // on the network is not overwritten by the copy it started with.
  const latest = loadState(store);
  saveState({
    ...latest,
    bookings: kept,
    lastWaterAt: state.lastWaterAt,
    waterSeen: state.waterSeen,
    pausedUntilDay,
    endpoint: subscription ? subscription.endpoint : anyOn ? state.endpoint : null,
  }, store);
  return { status, booked: bookedCount, cancelled, total: kept.length };
}

let inFlight = null;
let again = false;

/** Sync now. Returns { status: "on" | "off" | "paused" | "unavailable", booked, cancelled, total }. */
export function syncReminders(over = {}) {
  if (inFlight) {
    again = true;
    return inFlight;
  }
  inFlight = (async () => {
    let result;
    do {
      again = false;
      result = await syncOnce(depsWith(over));
    } while (again);
    return result;
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Turn one kind ("workout" | "meals" | "water") on or off, then sync. */
export function setReminderEnabled(kind, on, over = {}) {
  const d = depsWith(over);
  const state = loadState(d.store);
  if (KINDS.includes(kind)) {
    state.enabled[kind] = !!on;
    if (on && !state.enabledAt) state.enabledAt = d.now();
    saveState(state, d.store);
  }
  return syncReminders(over);
}

/** Change one meal's time ("HH:MM"), then sync. Invalid input is ignored. */
export function setMealTime(slot, hhmm, over = {}) {
  const d = depsWith(over);
  const state = loadState(d.store);
  if (MEAL_SLOTS.includes(slot) && TIME.test(String(hhmm))) {
    state.mealTimes[slot] = String(hhmm);
    saveState(state, d.store);
  }
  return syncReminders(over);
}

// --- Account UI -----------------------------------------------------------------

const TOGGLES = Object.freeze({ workout: "reminder-workout", meals: "reminder-meals", water: "reminder-water" });

async function ensurePermission(env = globalThis) {
  const cap = restAlertCapability(env);
  if (cap !== "needs-permission") return cap;
  try {
    return (await env.Notification.requestPermission()) === "granted" ? "ready" : "denied";
  } catch {
    return "denied";
  }
}

function statusText(cap, state, result) {
  if (cap === "needs-install") return "Add SpotterAI to your home screen first: Share, then Add to Home Screen. iOS only gives notifications to installed apps, not to a Safari tab.";
  if (cap === "unsupported") return "This device can't show notifications.";
  if (cap === "denied") return "Notifications are blocked in your device settings. Allow them for SpotterAI, then turn reminders on here.";
  if (!KINDS.some((k) => state.enabled[k])) {
    return "Off. Turning one on sends this device's push address and the reminder times to book them. Nothing you log leaves your phone.";
  }
  if (result?.status === "unavailable") return "Reminders need the notification server, which isn't reachable right now. They'll book the next time it is.";
  if (result?.status === "paused") return "Today's free notification budget is used up, so new reminders wait until tomorrow. Ones already booked still arrive.";
  const n = state.bookings.length;
  return `On. ${n} reminder${n === 1 ? "" : "s"} booked for the next few days. Only this device's push address and the reminder times leave your phone.`;
}

/** Wire the Account "Reminders" section. Returns { render } or null when it is not on the page. */
export function initRemindersUI(doc = globalThis.document) {
  const section = doc?.getElementById?.("account-reminders");
  if (!section) return null;
  const status = doc.getElementById("reminders-status");
  const timesBox = doc.getElementById("reminder-meal-times");
  let lastResult = null;

  function render(result = lastResult) {
    lastResult = result;
    const cap = restAlertCapability();
    const state = loadState();
    const blocked = cap === "unsupported" || cap === "denied" || cap === "needs-install";
    for (const [kind, id] of Object.entries(TOGGLES)) {
      const el = doc.getElementById(id);
      if (!el) continue;
      el.checked = state.enabled[kind] && !blocked;
      el.disabled = blocked;
      el.setAttribute("aria-checked", String(el.checked));
    }
    if (timesBox) timesBox.hidden = !state.enabled.meals || blocked;
    for (const slot of MEAL_SLOTS) {
      const input = doc.getElementById(`reminder-time-${slot}`);
      if (input && doc.activeElement !== input) input.value = state.mealTimes[slot];
    }
    if (status) status.textContent = statusText(cap, state, lastResult);
    section.removeAttribute("aria-busy");
  }

  for (const [kind, id] of Object.entries(TOGGLES)) {
    doc.getElementById(id)?.addEventListener("change", async (e) => {
      const on = e.target.checked;
      if (on && (await ensurePermission()) !== "ready") {
        render();
        return;
      }
      render(await setReminderEnabled(kind, on).catch(() => null));
    });
  }
  for (const slot of MEAL_SLOTS) {
    doc.getElementById(`reminder-time-${slot}`)?.addEventListener("change", async (e) => {
      render(await setMealTime(slot, e.target.value).catch(() => null));
    });
  }
  render();
  return { render };
}

/**
 * App entry: remember where the logs and the plan come from, wire the UI, and
 * sync on start, on return to the foreground, and shortly after any log.
 */
export function initReminders({ doc = globalThis.document, getTracker, getPlan, onTrackerChange } = {}) {
  wired = {};
  if (getTracker) wired.getTracker = getTracker;
  if (getPlan) wired.getPlan = getPlan;
  const ui = initRemindersUI(doc);
  const run = () => syncReminders().then((r) => ui?.render(r)).catch(() => {});
  let timer = null;
  onTrackerChange?.(() => {
    clearTimeout(timer);
    timer = setTimeout(run, 2000);
  });
  doc?.addEventListener?.("visibilitychange", () => {
    if (doc.visibilityState === "visible") run();
  });
  run();
}
