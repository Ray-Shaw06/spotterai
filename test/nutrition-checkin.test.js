/**
 * The check-in wired to the real store: gathering its inputs, a safe apply, and
 * the quiet period after a proposal is handled.
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

const { currentCheckIn, applyProposal, dismissProposal } = await import("../nutrition-checkin.js");
const { importData, setBodyStats, setTargets, getState, getTargetsChangedOn, getCheckInHandledOn, dateDaysAgo } = await import("../tracker-store.js");
const { buildPlan } = await import("../nutrition-plan.js");
const { addDays } = await import("../lib/calendar-days.js");

const STATS = { heightCm: 178, ageRange: "18–29", sex: "Male", dailyActivity: "some", daysPerWeek: 4, sessionLength: 60, intent: "cut" };

/** Five weeks of a cut that is too fast (about -1.5%/wk), every day logged at target. */
function seed({ ratePct = -1.5, stats = STATS } = {}) {
  localStorage.clear();
  const today = dateDaysAgo(0);
  const plan = buildPlan({ bodyStats: stats || STATS, kg: 90 });
  const bodyweight = [];
  const nutrition = [];
  for (let i = 0; i < 45; i++) {
    const date = addDays(today, -(44 - i));
    bodyweight.push({ id: `w${i}`, date, value: Math.round(90 * (1 + (ratePct / 100) * ((i - 17) / 7)) * 10) / 10 });
    nutrition.push({ id: `n${i}`, date, name: "Day", kcal: plan.targets.kcal, protein: plan.targets.protein, carbs: plan.targets.carbs, fat: plan.targets.fat });
  }
  importData({ workouts: [], nutrition, bodyweight, targets: plan.targets, unit: "kg" });
  if (stats) setBodyStats(stats);
  return { today, plan };
}

test("with stats, weigh-ins and a log, the real store yields a proposal", () => {
  const { plan } = seed();
  const r = currentCheckIn();
  assert.equal(r.status, "propose", JSON.stringify(r));
  assert.equal(r.reason, "too_fast");
  assert.equal(r.fromKcal, plan.targets.kcal);
  assert.ok(r.toKcal > r.fromKcal);
});

test("no stats means not ready, not an error", () => {
  seed({ stats: null });
  assert.deepEqual(currentCheckIn(), { status: "not_ready", reason: "no_stats" });
});

test("applying writes the targets once, restarts the clock, and goes quiet", () => {
  const { today } = seed();
  const proposal = currentCheckIn();
  assert.deepEqual(applyProposal(proposal), { ok: true });
  assert.deepEqual({ ...getState().targets, waterMl: undefined, weeklyWorkouts: undefined }, { ...proposal.targets, waterMl: undefined, weeklyWorkouts: undefined });
  assert.equal(getTargetsChangedOn(), today);
  assert.equal(getCheckInHandledOn(), today);
  assert.deepEqual(currentCheckIn(), { status: "not_ready", reason: "too_soon" });
});

test("a stale proposal is refused and leaves the user's own edit alone", () => {
  seed();
  const proposal = currentCheckIn();
  setTargets({ kcal: proposal.fromKcal + 100 }); // the user edits targets after the card was built
  const before = getState().targets.kcal;
  assert.deepEqual(applyProposal(proposal), { ok: false, reason: "stale" });
  assert.equal(getState().targets.kcal, before);
  assert.equal(getCheckInHandledOn(), null);
});

test("changing the stats after the card was built also makes it stale", () => {
  seed();
  const proposal = currentCheckIn();
  // A much shorter body has a much lower maintenance: the old raise no longer fits this person.
  setBodyStats({ ...STATS, heightCm: 140 });
  assert.deepEqual(applyProposal(proposal), { ok: false, reason: "stale" });
});

test("not now starts the same quiet period without changing any target", () => {
  const { today } = seed();
  const kcal = getState().targets.kcal;
  dismissProposal();
  assert.equal(getCheckInHandledOn(), today);
  assert.equal(getState().targets.kcal, kcal);
  assert.deepEqual(currentCheckIn(), { status: "not_ready", reason: "too_soon" });
});

test("a result that is not a proposal cannot be applied", () => {
  seed();
  assert.equal(applyProposal({ status: "on_track" }).ok, false);
  assert.equal(applyProposal(null).ok, false);
});
