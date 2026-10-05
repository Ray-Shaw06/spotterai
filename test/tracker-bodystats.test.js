/**
 * Body stats (for the nutrition plan) and the date targets last changed.
 * Stored beside targets, per profile, synced only through the existing meta doc.
 */
import test from "node:test";
import assert from "node:assert/strict";

class MemoryStorage {
  #map = new Map();
  getItem(k) { return this.#map.has(k) ? this.#map.get(k) : null; }
  setItem(k, v) { this.#map.set(k, String(v)); }
  removeItem(k) { this.#map.delete(k); }
  clear() { this.#map.clear(); }
}
globalThis.localStorage = new MemoryStorage();
globalThis.window = { addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true };
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };

const { validateBodyStats } = await import("../nutrition-plan.js");
const {
  getBodyStats,
  setBodyStats,
  setTargets,
  getTargetsChangedOn,
  bodyweightSeries,
  currentMaintenance,
  getCheckInHandledOn,
  setCheckInHandledOn,
  getWelcomeHandledFor,
  setWelcomeHandledFor,
  buildAdaptContext,
  metaSnapshot,
  mergeRemoteMeta,
  exportData,
  importData,
  dateDaysAgo,
  SYNCED_META_KEYS,
} = await import("../tracker-store.js");

const GOOD = { heightCm: 178, ageRange: "18–29", sex: "Male", dailyActivity: "some", daysPerWeek: 4, sessionLength: 60, intent: "cut" };
const blank = (extra = {}) => importData({ workouts: [], nutrition: [], bodyweight: [], ...extra });

test("validateBodyStats accepts a complete, sensible set and coerces numeric strings", () => {
  const r = validateBodyStats({ ...GOOD, heightCm: "178", daysPerWeek: "4", sessionLength: "60" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.value, GOOD);
});

test("validateBodyStats accepts a skipped sex and maps 'Prefer not to say' to blank", () => {
  assert.equal(validateBodyStats({ ...GOOD, sex: "" }).value.sex, "");
  assert.equal(validateBodyStats({ ...GOOD, sex: "Prefer not to say" }).value.sex, "");
  assert.equal(validateBodyStats({ ...GOOD, sex: undefined }).ok, true);
});

test("validateBodyStats names each thing that is wrong and returns no value", () => {
  for (const [patch, field] of [
    [{ heightCm: 99 }, "heightCm"],
    [{ heightCm: 251 }, "heightCm"],
    [{ heightCm: "tall" }, "heightCm"],
    [{ ageRange: "teen" }, "ageRange"],
    [{ dailyActivity: "athlete" }, "dailyActivity"],
    [{ daysPerWeek: 8 }, "daysPerWeek"],
    [{ daysPerWeek: -1 }, "daysPerWeek"],
    [{ sessionLength: 14 }, "sessionLength"],
    [{ sessionLength: 181 }, "sessionLength"],
    [{ intent: "shred" }, "intent"],
  ]) {
    const r = validateBodyStats({ ...GOOD, ...patch });
    assert.equal(r.ok, false, field);
    assert.equal(r.value, null);
    assert.ok(r.errors.some((e) => e.includes(field)), `${field}: ${r.errors.join("|")}`);
  }
});

test("no training days means no session length is needed", () => {
  const r = validateBodyStats({ ...GOOD, daysPerWeek: 0, sessionLength: 0 });
  assert.equal(r.ok, true);
});

test("setBodyStats persists and getBodyStats returns it", () => {
  blank();
  assert.equal(getBodyStats(), null);
  assert.deepEqual(setBodyStats(GOOD), { ok: true, errors: [] });
  assert.deepEqual(getBodyStats(), GOOD);
});

test("an invalid setBodyStats changes nothing", () => {
  blank();
  setBodyStats(GOOD);
  const r = setBodyStats({ ...GOOD, heightCm: 5 });
  assert.equal(r.ok, false);
  assert.deepEqual(getBodyStats(), GOOD);
});

test("setTargets records the day targets last changed", () => {
  blank();
  assert.equal(getTargetsChangedOn(), null);
  setTargets({ kcal: 2300 });
  assert.equal(getTargetsChangedOn(), dateDaysAgo(0));
});

test("stats and the changed date travel in the synced meta, and older keys are untouched", () => {
  assert.ok(SYNCED_META_KEYS.includes("bodyStats"));
  assert.ok(SYNCED_META_KEYS.includes("targetsChangedOn"));
  for (const k of ["targets", "water", "achievements", "exercisePrefs", "unit"]) assert.ok(SYNCED_META_KEYS.includes(k), k);
  blank();
  setBodyStats(GOOD);
  setTargets({ kcal: 2300 });
  const snap = metaSnapshot();
  assert.deepEqual(snap.bodyStats, GOOD);
  assert.equal(snap.targetsChangedOn, dateDaysAgo(0));
  blank();
  assert.equal(mergeRemoteMeta({ bodyStats: GOOD, targetsChangedOn: "2026-09-01" }), true);
  assert.deepEqual(getBodyStats(), GOOD);
  assert.equal(getTargetsChangedOn(), "2026-09-01");
});

test("export and import round-trip the stats, and an old backup yields null not undefined", () => {
  blank();
  setBodyStats(GOOD);
  setTargets({ kcal: 2300 });
  const backup = JSON.parse(exportData());
  blank();
  assert.equal(importData(backup), true);
  assert.deepEqual(getBodyStats(), GOOD);
  assert.equal(getTargetsChangedOn(), dateDaysAgo(0));
  blank();
  assert.strictEqual(getBodyStats(), null);
  assert.strictEqual(getTargetsChangedOn(), null);
});

test("bodyweightSeries is in kg, sorted by date, and skips junk", () => {
  blank({
    unit: "lb",
    bodyweight: [
      { id: "b", date: "2026-10-03", value: 219 },
      { id: "a", date: "2026-10-01", value: 220.5 },
      { id: "x", date: "2026-10-02", value: 0 },
      { id: "y", date: "", value: 200 },
    ],
  });
  const s = bodyweightSeries();
  assert.deepEqual(s.map((p) => p.date), ["2026-10-01", "2026-10-03"]);
  assert.ok(Math.abs(s[0].kg - 100.02) < 0.05);
  blank({ unit: "kg", bodyweight: [{ id: "a", date: "2026-10-01", value: 80 }] });
  assert.deepEqual(bodyweightSeries(), [{ date: "2026-10-01", kg: 80 }]);
});

test("currentMaintenance is the plan's maintenance for the latest weight, or null without stats or weight", () => {
  blank({ bodyweight: [{ id: "a", date: "2026-10-01", value: 80 }] });
  assert.equal(currentMaintenance(), null, "no stats yet");
  setBodyStats(GOOD);
  const m = currentMaintenance();
  assert.equal(typeof m, "number");
  assert.ok(m > 1500 && m < 4500);
  blank();
  setBodyStats(GOOD);
  assert.equal(currentMaintenance(), null, "no weight yet");
  blank({ unit: "lb", bodyweight: [{ id: "a", date: "2026-10-01", value: 176.4 }] });
  setBodyStats(GOOD);
  assert.ok(Math.abs(currentMaintenance() - m) <= 15, "lb entry reads as the same 80 kg body");
});

test("only a change to calories or macros restarts the clock, not the water goal or workouts per week", () => {
  blank();
  mergeRemoteMeta({ targetsChangedOn: "2026-01-01" });
  setTargets({ waterMl: 3000, weeklyWorkouts: 5 });
  assert.equal(getTargetsChangedOn(), "2026-01-01", "water and workouts are not the targets the check-in judges");
  setTargets({ kcal: 2200, protein: 140, carbs: 250, fat: 70 });
  assert.equal(getTargetsChangedOn(), "2026-01-01", "re-saving identical values changes nothing");
  setTargets({ kcal: 2301 });
  assert.equal(getTargetsChangedOn(), dateDaysAgo(0));
  mergeRemoteMeta({ targetsChangedOn: "2026-01-01" });
  setTargets({ fat: 71 });
  assert.equal(getTargetsChangedOn(), dateDaysAgo(0), "a macro change counts too");
});

test("stats that arrive malformed from a backup or sync read as none, never as a different person", () => {
  blank();
  for (const bad of [{ ...GOOD, ageRange: "Under 18 " }, { ...GOOD, ageRange: "18-29" }, { heightCm: 170 }, { ...GOOD, heightCm: 1e308 }, "text", 42, [], { ...GOOD, intent: "shred" }]) {
    mergeRemoteMeta({ bodyStats: bad });
    assert.strictEqual(getBodyStats(), null, JSON.stringify(bad));
  }
  assert.equal(importData({ workouts: [], nutrition: [], bodyStats: { heightCm: 170 } }), true);
  assert.strictEqual(getBodyStats(), null);
  assert.equal(importData({ workouts: [], nutrition: [], bodyStats: GOOD }), true);
  assert.deepEqual(getBodyStats(), GOOD);
});

test("the check-in quiet period lives in per-profile tracker state, syncs, and exports", () => {
  assert.ok(SYNCED_META_KEYS.includes("checkInHandledOn"));
  blank();
  assert.strictEqual(getCheckInHandledOn(), null);
  setCheckInHandledOn("2026-10-05");
  assert.equal(getCheckInHandledOn(), "2026-10-05");
  assert.equal(metaSnapshot().checkInHandledOn, "2026-10-05");
  const backup = JSON.parse(exportData());
  blank();
  assert.strictEqual(getCheckInHandledOn(), null, "another profile or a fresh state starts clear");
  importData(backup);
  assert.equal(getCheckInHandledOn(), "2026-10-05");
  blank();
  mergeRemoteMeta({ checkInHandledOn: "2026-09-01" });
  assert.equal(getCheckInHandledOn(), "2026-09-01");
  setCheckInHandledOn(null);
  assert.equal(getCheckInHandledOn(), "2026-09-01", "an empty date is never stored");
  setCheckInHandledOn("not a date");
  assert.equal(getCheckInHandledOn(), "2026-09-01", "only a real date is stored");
});

test("handling a proposal does not touch the targets or their changed date", () => {
  blank();
  mergeRemoteMeta({ targetsChangedOn: "2026-01-01" });
  setCheckInHandledOn("2026-10-05");
  assert.equal(getTargetsChangedOn(), "2026-01-01");
});

test("the welcome-back flag is per-profile tracker state: it syncs, exports, and one profile cannot silence another", () => {
  assert.ok(SYNCED_META_KEYS.includes("welcomeHandledFor"));
  blank();
  assert.strictEqual(getWelcomeHandledFor(), null);
  setWelcomeHandledFor("2026-08-31");
  assert.equal(getWelcomeHandledFor(), "2026-08-31");
  assert.equal(metaSnapshot().welcomeHandledFor, "2026-08-31");
  const backup = JSON.parse(exportData());
  blank(); // a different profile's state starts clear
  assert.strictEqual(getWelcomeHandledFor(), null);
  importData(backup);
  assert.equal(getWelcomeHandledFor(), "2026-08-31");
  blank();
  mergeRemoteMeta({ welcomeHandledFor: "2026-07-01" });
  assert.equal(getWelcomeHandledFor(), "2026-07-01");
  setWelcomeHandledFor(null);
  setWelcomeHandledFor("not a date");
  assert.equal(getWelcomeHandledFor(), "2026-07-01", "only a real date is stored");
});

test("an ease-back already handled for this gap reaches the adapt engine as gapHandled", () => {
  const w = (id, date) => ({ id, date, name: "S", exercises: [], volume: 100 });
  blank({ workouts: [w("a", dateDaysAgo(60)), w("b", dateDaysAgo(50)), w("c", dateDaysAgo(40))] });
  const plan = { days: [{ day: "Mon", focus: "Push", exercises: [{ name: "Bench Press", sets: 3, reps: "8" }] }] };
  assert.equal(buildAdaptContext(plan).gapHandled, false);
  setWelcomeHandledFor(dateDaysAgo(40));
  assert.equal(buildAdaptContext(plan).gapHandled, true);
  setWelcomeHandledFor(dateDaysAgo(41));
  assert.equal(buildAdaptContext(plan).gapHandled, false, "handled for an older gap does not cover this one");
});
