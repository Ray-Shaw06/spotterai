/**
 * tracker-store — the per-record cloud-sync surface.
 *
 * tracker-store.js holds every byte of user data and had ZERO test coverage
 * before this file: no test imported it. That mattered most for the sync
 * rewrite, because the dangerous path is not "did the record arrive" but "did
 * applying a partial batch quietly delete everything else".
 *
 * The specific failure these guard against: `applyRemote` used to call
 * `importData`, which REPLACES whole state. Once the live listener is bounded to
 * a recent window the incoming batch only holds recent records, so that path
 * would delete all older local history with no error shown.
 *
 * tracker-store is a browser module, so localStorage and window are stubbed
 * before it is imported.
 */
import test from "node:test";
import assert from "node:assert/strict";

// --- browser stubs (must exist before the module graph is imported) ---------
class MemoryStorage {
  #map = new Map();
  getItem(k) {
    return this.#map.has(k) ? this.#map.get(k) : null;
  }
  setItem(k, v) {
    this.#map.set(k, String(v));
  }
  removeItem(k) {
    this.#map.delete(k);
  }
  clear() {
    this.#map.clear();
  }
}
globalThis.localStorage = new MemoryStorage();
globalThis.window = {
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {
    return true;
  },
};
globalThis.CustomEvent = class CustomEvent {
  constructor(type, init) {
    this.type = type;
    this.detail = init?.detail;
  }
};

const store = await import("../tracker-store.js");
const {
  getState,
  importData,
  mergeRemoteRecords,
  removeRemoteRecords,
  mergeRemoteMeta,
  metaSnapshot,
  recordId,
  isApplyingRemote,
  SYNCED_RECORD_KINDS,
  DATED_RECORD_KINDS,
} = store;

/** Put local state into a known shape without going through the mutators. */
function seed(patch) {
  importData({
    workouts: [],
    nutrition: [],
    bodyweight: [],
    painReports: [],
    routines: [],
    mealTemplates: [],
    customExercises: [],
    customFoods: [],
    ...patch,
  });
}

const workout = (id, date) => ({ id, date, name: `w-${id}`, exercises: [], volume: 0 });

// ---------------------------------------------------------------------------
// The data-loss guard. This is the one that matters.
// ---------------------------------------------------------------------------
test("CRITICAL: merging a windowed batch leaves older history untouched", () => {
  seed({
    workouts: [workout("old-1", "2024-01-05"), workout("old-2", "2024-02-11"), workout("recent-1", "2026-08-01")],
  });

  // Exactly what a bounded listener delivers: only recent records.
  mergeRemoteRecords("workouts", [workout("recent-1", "2026-08-01"), workout("recent-2", "2026-08-10")]);

  const ids = getState().workouts.map((w) => w.id).sort();
  assert.deepEqual(ids, ["old-1", "old-2", "recent-1", "recent-2"], "records outside the window must survive");
});

test("CRITICAL: importData still replaces, which is why sync must not use it", () => {
  seed({ workouts: [workout("old-1", "2024-01-05"), workout("recent-1", "2026-08-01")] });

  // Same partial batch through the backup-restore path, to document the
  // difference rather than to endorse it.
  importData({ workouts: [workout("recent-1", "2026-08-01")], nutrition: [] });

  assert.deepEqual(getState().workouts.map((w) => w.id), ["recent-1"]);
  assert.equal(getState().workouts.length, 1, "importData replaces; this is the trap sync avoids");
});

test("a local-only record is not clobbered by a remote batch that lacks it", () => {
  seed({ workouts: [workout("local-only", "2026-08-12")] });
  mergeRemoteRecords("workouts", [workout("from-phone", "2026-08-12")]);
  const ids = getState().workouts.map((w) => w.id).sort();
  assert.deepEqual(ids, ["from-phone", "local-only"]);
});

// ---------------------------------------------------------------------------
// Upsert semantics
// ---------------------------------------------------------------------------
test("merging by id updates in place rather than duplicating", () => {
  seed({ workouts: [workout("w1", "2026-08-01")] });
  mergeRemoteRecords("workouts", [{ ...workout("w1", "2026-08-01"), name: "renamed" }]);
  assert.equal(getState().workouts.length, 1);
  assert.equal(getState().workouts[0].name, "renamed");
});

test("merging an identical record reports no change", () => {
  seed({ workouts: [workout("w1", "2026-08-01")] });
  assert.equal(mergeRemoteRecords("workouts", [workout("w1", "2026-08-01")]), 0);
});

test("an empty batch is a no-op, not a wipe", () => {
  seed({ workouts: [workout("w1", "2026-08-01")] });
  assert.equal(mergeRemoteRecords("workouts", []), 0);
  assert.equal(getState().workouts.length, 1);
});

test("an unknown collection is refused rather than creating one", () => {
  seed({ workouts: [] });
  assert.equal(mergeRemoteRecords("notAKind", [{ id: "x" }]), 0);
  assert.equal(getState().notAKind, undefined);
});

// ---------------------------------------------------------------------------
// Deletes
// ---------------------------------------------------------------------------
test("a record deleted on another device is removed here", () => {
  seed({ workouts: [workout("w1", "2026-08-01"), workout("w2", "2026-08-02")] });
  assert.equal(removeRemoteRecords("workouts", ["w1"]), 1);
  assert.deepEqual(getState().workouts.map((w) => w.id), ["w2"]);
});

test("deleting an id we never held changes nothing", () => {
  seed({ workouts: [workout("w1", "2026-08-01")] });
  assert.equal(removeRemoteRecords("workouts", ["never-existed"]), 0);
  assert.equal(getState().workouts.length, 1);
});

// ---------------------------------------------------------------------------
// Record identity
// ---------------------------------------------------------------------------
test("records without an id key off a stable normalized name", () => {
  const a = recordId({ name: "Hammer Strength Iso Row" });
  const b = recordId({ name: "hammer strength iso row" });
  assert.equal(a, b, "the same custom exercise must not sync as two documents");
  assert.match(a, /^name:/);
});

test("a record with neither id nor name is skipped, not given a random id", () => {
  assert.equal(recordId({ muscle: "Chest" }), null);
  seed({ customExercises: [] });
  assert.equal(mergeRemoteRecords("customExercises", [{ muscle: "Chest" }]), 0);
});

test("name-keyed collections round-trip through merge", () => {
  seed({ customExercises: [] });
  mergeRemoteRecords("customExercises", [{ name: "Hammer Strength Iso Row", muscle: "Back", cardio: false }]);
  assert.equal(getState().customExercises.length, 1);
  // Same exercise again must update, not duplicate.
  mergeRemoteRecords("customExercises", [{ name: "Hammer Strength Iso Row", muscle: "Chest", cardio: false }]);
  assert.equal(getState().customExercises.length, 1);
  assert.equal(getState().customExercises[0].muscle, "Chest");
});

// ---------------------------------------------------------------------------
// Remote records are untrusted input
//
// Found in a live browser: a synced workout without an `exercises` array crashed
// the stats computation on the next render ("w.exercises is not iterable"). It
// could not happen before, because addWorkout always writes an array. Sync
// delivering a record from a device on an older build is exactly what breaks
// that assumption.
// ---------------------------------------------------------------------------
test("a remote workout missing its exercises array does not crash stats", () => {
  seed({ workouts: [] });
  mergeRemoteRecords("workouts", [{ id: "malformed", date: "2026-08-13", name: "from an older build" }]);
  const stored = getState().workouts.find((w) => w.id === "malformed");
  assert.ok(Array.isArray(stored.exercises), "exercises must be normalized to an array on the way in");
  assert.doesNotThrow(() => store.deriveStats(), "stats must survive a record another device wrote");
});

test("a remote routine or meal template missing its list is normalized too", () => {
  seed({ routines: [], mealTemplates: [] });
  mergeRemoteRecords("routines", [{ id: "r1", name: "Push" }]);
  mergeRemoteRecords("mealTemplates", [{ id: "m1", name: "Breakfast" }]);
  assert.ok(Array.isArray(getState().routines[0].exercises));
  assert.ok(Array.isArray(getState().mealTemplates[0].entries));
});

test("a non-object in a remote batch is skipped, not stored", () => {
  seed({ workouts: [] });
  mergeRemoteRecords("workouts", [null, "nonsense", 42, { id: "good", date: "2026-08-13" }]);
  assert.deepEqual(getState().workouts.map((w) => w.id), ["good"]);
});

// ---------------------------------------------------------------------------
// Meta (scalar/singleton) half
// ---------------------------------------------------------------------------
test("meta merges known keys and ignores everything else", () => {
  seed({});
  const before = getState().workouts.length;
  mergeRemoteMeta({ unit: "lb", targets: { protein: 200 }, workouts: [workout("sneaky", "2026-01-01")] });
  assert.equal(getState().unit, "lb");
  assert.equal(getState().targets.protein, 200);
  assert.equal(getState().workouts.length, before, "meta must never carry record collections");
});

test("meta targets merge onto defaults rather than replacing them", () => {
  seed({});
  mergeRemoteMeta({ targets: { protein: 200 } });
  assert.equal(getState().targets.protein, 200);
  assert.ok(getState().targets.kcal > 0, "untouched targets must keep their defaults");
});

test("metaSnapshot carries only the scalar half", () => {
  seed({ workouts: [workout("w1", "2026-08-01")] });
  const snap = metaSnapshot();
  assert.ok("targets" in snap && "unit" in snap);
  assert.ok(!("workouts" in snap), "records sync per document, not inside meta");
});

// ---------------------------------------------------------------------------
// Echo guard
// ---------------------------------------------------------------------------
test("isApplyingRemote is true only while remote data is being applied", () => {
  seed({ workouts: [] });
  assert.equal(isApplyingRemote(), false);
  let observed = null;
  const original = globalThis.window.dispatchEvent;
  globalThis.window.dispatchEvent = () => {
    observed = isApplyingRemote();
    return true;
  };
  mergeRemoteRecords("workouts", [workout("w1", "2026-08-01")]);
  globalThis.window.dispatchEvent = original;
  assert.equal(observed, true, "the change event fired during a remote apply must be suppressible");
  assert.equal(isApplyingRemote(), false, "and must be cleared afterwards");
});

// ---------------------------------------------------------------------------
// Shape invariants the sync layer depends on
// ---------------------------------------------------------------------------
test("every dated kind is also a synced kind", () => {
  for (const kind of DATED_RECORD_KINDS) {
    assert.ok(SYNCED_RECORD_KINDS.includes(kind), `${kind} is windowed but not synced`);
  }
});

test("every synced kind exists on a default state", () => {
  seed({});
  for (const kind of SYNCED_RECORD_KINDS) {
    assert.ok(Array.isArray(getState()[kind]), `${kind} must be an array on the store`);
  }
});
