/**
 * Keeping booked reminders in line with what the device wants: the diff, the
 * water clock, and a sync against a fake /api/reminders.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  REMINDERS_KEY,
  MAX_BOOKINGS_PER_SYNC,
  loadState,
  saveState,
  diffBookings,
  noteWater,
  syncReminders,
  setReminderEnabled,
  setMealTime,
} from "../reminders-sync.js";

const at = (month, day, h, m = 0) => new Date(2026, month - 1, day, h, m).getTime();
const NOW = at(9, 25, 9);
const SUB = { endpoint: "https://web.push.apple.com/device-one", keys: { p256dh: "p", auth: "a" } };

function fakeStore(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

function withSettings(enabled, extra = {}) {
  return fakeStore({ [REMINDERS_KEY]: JSON.stringify({ enabled, enabledAt: NOW, ...extra }) });
}

/** A fake /api/reminders. Every booking gets a token that names what it booked. */
function server() {
  const calls = { book: [], cancel: [] };
  let mode = "ok";
  let gate = null;
  const fetch = async (url, init) => {
    if (init.method === "DELETE") {
      calls.cancel.push(decodeURIComponent(String(url).split("token=")[1]));
      if (mode === "cancel-fails") throw new TypeError("Failed to fetch");
      return new Response(null, { status: 204 });
    }
    const body = JSON.parse(init.body);
    calls.book.push(body);
    if (gate) await gate;
    if (mode === "budget") return new Response(JSON.stringify({ configured: true }), { status: 503 });
    return new Response(JSON.stringify({ token: `${body.kind}:${body.detail}:${body.at}` }), { status: 200 });
  };
  return { calls, fetch, set: (m) => { mode = m; }, hold: (p) => { gate = p; } };
}

function deps(store, srv, { tracker = {}, subscription = SUB, now = NOW, plan = null } = {}) {
  let subscribeCalls = 0;
  const d = {
    store,
    now: () => now,
    getTracker: () => ({ workouts: [], nutrition: [], water: {}, targets: { waterMl: 2500 }, ...tracker }),
    getPlan: () => plan,
    subscribe: async () => { subscribeCalls += 1; return subscription; },
    fetch: srv.fetch,
  };
  return { d, subscribeCalls: () => subscribeCalls };
}

test("diffBookings drops fired ones, cancels unwanted, books missing, keeps the rest", () => {
  const booked = [
    { key: "a", at: NOW - 1000, token: "fired" },
    { key: "b", at: NOW + 1000, token: "keep" },
    { key: "c", at: NOW + 2000, token: "unwanted" },
  ];
  const desired = [{ key: "b", at: NOW + 1000 }, { key: "d", at: NOW + 3000 }];
  const { keep, cancel, book } = diffBookings(booked, desired, NOW);
  assert.deepEqual(keep.map((b) => b.token), ["keep"]);
  assert.deepEqual(cancel.map((b) => b.token), ["unwanted"]);
  assert.deepEqual(book.map((r) => r.key), ["d"]);

  const many = Array.from({ length: 50 }, (_, i) => ({ key: `k${i}`, at: NOW + i }));
  assert.equal(diffBookings([], many, NOW).book.length, MAX_BOOKINGS_PER_SYNC);
});

test("noteWater restarts the clock only when today's total goes up", () => {
  const s0 = { lastWaterAt: null, waterSeen: null };
  const s1 = noteWater(s0, 250, "2026-09-25", NOW);
  assert.equal(s1.lastWaterAt, NOW, "first water seen today counts as a log");
  const s2 = noteWater(s1, 250, "2026-09-25", NOW + 60_000);
  assert.equal(s2.lastWaterAt, NOW, "same total, same clock");
  const s3 = noteWater(s2, 500, "2026-09-25", NOW + 120_000);
  assert.equal(s3.lastWaterAt, NOW + 120_000);
  const s4 = noteWater(s3, 0, "2026-09-26", NOW + 86_400_000);
  assert.equal(s4.lastWaterAt, NOW + 120_000, "a new day with nothing logged changes nothing");
});

test("the first sync books every planned reminder and keeps the cancel tokens", async () => {
  const store = withSettings({ meals: true });
  const srv = server();
  const result = await syncReminders(deps(store, srv).d);
  assert.equal(result.status, "on");
  assert.equal(result.booked, 8, "lunch and dinner today, three meals on each of the next 2 days");
  assert.ok(srv.calls.book.every((b) => b.subscription.endpoint === SUB.endpoint && b.kind === "meal" && b.now === NOW));
  const state = loadState(store);
  assert.equal(state.bookings.length, 8);
  assert.ok(state.bookings.every((b) => typeof b.token === "string"));
  assert.equal(state.endpoint, SUB.endpoint);
});

test("logging lunch cancels exactly the lunch reminder", async () => {
  const store = withSettings({ meals: true });
  const srv = server();
  await syncReminders(deps(store, srv).d);
  const result = await syncReminders(deps(store, srv, { tracker: { nutrition: [{ date: "2026-09-25", meal: "lunch" }] } }).d);
  assert.equal(srv.calls.cancel.length, 1);
  assert.match(srv.calls.cancel[0], /^meal:lunch:/);
  assert.equal(result.booked, 0);
  assert.equal(loadState(store).bookings.length, 7);
});

test("a spent daily budget pauses booking until the next UTC day", async () => {
  const store = withSettings({ water: true });
  const srv = server();
  srv.set("budget");
  const first = await syncReminders(deps(store, srv).d);
  assert.equal(first.status, "paused");
  assert.equal(srv.calls.book.length, 1, "stops at the first 503");
  assert.equal(loadState(store).pausedUntilDay, new Date(NOW).toISOString().slice(0, 10));

  await syncReminders(deps(store, srv, { now: NOW + 60_000 }).d);
  assert.equal(srv.calls.book.length, 1, "no more asking the same day");
});

test("a cancel that fails still drops the booking, and turning everything off never subscribes", async () => {
  const store = withSettings({ meals: true });
  const srv = server();
  await syncReminders(deps(store, srv).d);
  const state = loadState(store);
  saveState({ ...state, enabled: { workout: false, meals: false, water: false } }, store);
  srv.set("cancel-fails");
  const off = deps(store, srv);
  const result = await syncReminders(off.d);
  assert.equal(result.status, "off");
  assert.equal(srv.calls.cancel.length, 8);
  assert.equal(loadState(store).bookings.length, 0);
  assert.equal(off.subscribeCalls(), 0);
});

test("a new push address cancels and rebooks everything", async () => {
  const store = withSettings({ meals: true });
  const srv = server();
  await syncReminders(deps(store, srv).d);
  const rotated = { ...SUB, endpoint: "https://web.push.apple.com/device-one-rotated" };
  const result = await syncReminders(deps(store, srv, { subscription: rotated }).d);
  assert.equal(srv.calls.cancel.length, 8);
  assert.equal(result.booked, 8);
  assert.equal(loadState(store).endpoint, rotated.endpoint);
});

test("no push subscription means nothing is booked and the status says so", async () => {
  const store = withSettings({ water: true });
  const srv = server();
  const result = await syncReminders(deps(store, srv, { subscription: null }).d);
  assert.equal(result.status, "unavailable");
  assert.equal(srv.calls.book.length, 0);
});

test("a settings change made while a sync is on the network survives it", async () => {
  const store = withSettings({ meals: true });
  const srv = server();
  let release;
  srv.hold(new Promise((r) => { release = r; }));
  const running = syncReminders(deps(store, srv).d);
  await new Promise((r) => { setTimeout(r, 0); });
  const mid = loadState(store);
  saveState({ ...mid, mealTimes: { ...mid.mealTimes, lunch: "13:00" } }, store);
  release();
  await running;
  assert.equal(loadState(store).mealTimes.lunch, "13:00");
});

test("turning a kind on records when, once, and syncs", async () => {
  const store = fakeStore();
  const srv = server();
  const d = deps(store, srv, { now: NOW }).d;
  await setReminderEnabled("water", true, d);
  const first = loadState(store);
  assert.equal(first.enabled.water, true);
  assert.equal(first.enabledAt, NOW);
  assert.ok(srv.calls.book.length > 0);

  await setReminderEnabled("meals", true, { ...d, now: () => NOW + 5000 });
  assert.equal(loadState(store).enabledAt, NOW, "the first time sticks");

  await setMealTime("lunch", "25:00", d);
  assert.equal(loadState(store).mealTimes.lunch, "12:30", "an invalid time is ignored");
  await setMealTime("lunch", "13:15", d);
  assert.equal(loadState(store).mealTimes.lunch, "13:15");
});

test("loadState survives garbage", () => {
  const store = fakeStore({ [REMINDERS_KEY]: "{not json" });
  const state = loadState(store);
  assert.deepEqual(state.enabled, { workout: false, meals: false, water: false });
  assert.deepEqual(state.bookings, []);
  const odd = fakeStore({ [REMINDERS_KEY]: JSON.stringify({ enabled: { water: "yes" }, bookings: [{ key: 1 }, { key: "k", at: 5, token: "t" }] }) });
  assert.equal(loadState(odd).enabled.water, false);
  assert.equal(loadState(odd).bookings.length, 1);
});
