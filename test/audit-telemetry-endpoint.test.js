import test from "node:test";
import assert from "node:assert/strict";
import handler, {
  DAILY_AUDIT_CAP, IP_HOURLY_CAP, dayKey, counterUpdates, parseBody, readAggregate, recordAudit,
  __setFirestoreForTests,
} from "../api/audit-telemetry.js";

/** Minimal res double matching what the handler uses. */
function makeRes() {
  const res = { statusCode: null, body: null, ended: false, headers: {} };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; res.ended = true; return res; };
  res.end = () => { res.ended = true; return res; };
  res.setHeader = (key, value) => { res.headers[key] = value; return res; };
  return res;
}

const validBody = {
  v: 1,
  evaluatorVersion: "v1.3.0",
  source: "generate",
  scoreBucket: "85-100",
  daysCount: 4,
  exerciseCount: 22,
  goal: "Hypertrophy",
  experience: "Intermediate",
  checks: [{ id: "rest_days", status: "pass" }, { id: "muscle_balance", status: "warn" }],
};

/**
 * A small in-memory Firestore double: just enough surface for readAggregate
 * and recordAudit to run against without a live project — collection().doc(),
 * get(), set() with merge semantics (including FieldValue.increment), and
 * getAll(). Call tracking (`_calls`) lets tests assert HOW MANY reads/writes
 * happened, which is the whole point of the read-fan-out and cap-ordering
 * fixes below.
 *
 * set()'s merge here does a recursive deep-merge of nested plain objects and
 * resolves increment sentinels into real numbers. That is the real Firestore
 * Admin SDK behavior this double stands in for (nested map fields merge
 * under set(..., {merge:true}) rather than being replaced wholesale), but it
 * is an ASSUMPTION that could not be verified against real Firestore here:
 * the repo's emulator harness (`npm run test:firebase-emulator`) needs Java,
 * and Java is not installed on this machine, so `emulators:exec` exits
 * before starting.
 */
function makeFakeStore(seed = {}) {
  const state = structuredClone(seed);
  const calls = { gets: [], sets: [] };
  const isIncrement = (v) => v && typeof v === "object" && "__increment" in v;
  const isPlainObject = (v) => v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) && !isIncrement(v);
  function deepMerge(existing, incoming) {
    const out = { ...existing };
    for (const [k, v] of Object.entries(incoming)) {
      if (isIncrement(v)) out[k] = (typeof existing[k] === "number" ? existing[k] : 0) + v.__increment;
      else if (isPlainObject(v)) out[k] = deepMerge(isPlainObject(existing[k]) ? existing[k] : {}, v);
      else out[k] = v;
    }
    return out;
  }
  function doc(collection, id) {
    return {
      id,
      async get() {
        calls.gets.push(`${collection}/${id}`);
        const data = state[collection]?.[id];
        return { exists: data !== undefined, id, data: () => data };
      },
      async set(data, opts) {
        calls.sets.push({ collection, id, data });
        state[collection] = state[collection] || {};
        const existing = state[collection][id] || {};
        state[collection][id] = opts?.merge ? deepMerge(existing, data) : data;
      },
    };
  }
  return {
    collection: (name) => ({ doc: (id) => doc(name, id) }),
    getAll: (...refs) => Promise.all(refs.map((r) => r.get())),
    _state: state,
    _calls: calls,
  };
}

const fakeFieldValue = { increment: (n) => ({ __increment: n }) };

test("a day key is the UTC date", () => {
  assert.equal(dayKey(new Date("2026-08-18T23:59:59Z")), "2026-08-18");
  assert.equal(dayKey(new Date("2026-08-19T00:00:01Z")), "2026-08-19");
});

test("the caps are set to the values the spec commits to", () => {
  assert.equal(DAILY_AUDIT_CAP, 5000);
  assert.equal(IP_HOURLY_CAP, 60);
});

test("counter updates increment exactly the documented paths, as nested objects", () => {
  // Nested objects, not dotted-path keys: set(..., { merge: true }) only
  // documents dot-path expansion for update(), so a dotted key would have
  // written a literal field named "byCheck.rest_days.pass" instead of the
  // nested shape readAggregate() reads back.
  const increment = (n) => ({ __increment: n });
  const updates = counterUpdates(validBody, { increment });
  assert.deepEqual(updates.audits, { __increment: 1 });
  assert.deepEqual(updates.byCheck.rest_days.pass, { __increment: 1 });
  assert.deepEqual(updates.byCheck.muscle_balance.warn, { __increment: 1 });
  assert.deepEqual(updates.byScoreBucket["85-100"], { __increment: 1 });
  assert.deepEqual(updates.byGoal.Hypertrophy, { __increment: 1 });
  assert.deepEqual(updates.byExperience.Intermediate, { __increment: 1 });
  assert.deepEqual(updates.byDaysCount["4"], { __increment: 1 });
  assert.deepEqual(updates.bySource.generate, { __increment: 1 });
  assert.equal(Object.keys(updates).some((k) => k.includes(".")), false, "no key may contain a literal dot");
});

test("two different checks in one audit both survive into a single byCheck object", () => {
  const updates = counterUpdates(validBody, { increment: (n) => n });
  assert.deepEqual(Object.keys(updates.byCheck).sort(), ["muscle_balance", "rest_days"]);
  assert.deepEqual(updates.byCheck.rest_days, { pass: 1 });
  assert.deepEqual(updates.byCheck.muscle_balance, { warn: 1 });
});

test("two different statuses for the same check id both survive under that id", () => {
  // This is the case the `if (!byCheck[check.id])` guard in counterUpdates
  // exists for: without it, the second status would either overwrite the
  // first or throw setting a property on undefined.
  const body = { ...validBody, checks: [{ id: "rest_days", status: "pass" }, { id: "rest_days", status: "warn" }] };
  const updates = counterUpdates(body, { increment: (n) => n });
  assert.deepEqual(updates.byCheck.rest_days, { pass: 1, warn: 1 });
});

test("counter updates never contain free text or a raw score", () => {
  const updates = counterUpdates(validBody, { increment: (n) => n });
  const serialized = JSON.stringify(updates);
  assert.doesNotMatch(serialized, /exerciseName|notes|programName/);
  assert.equal("byScore" in updates, false, "only the bucketed field may exist, never a raw score");
  assert.deepEqual(
    Object.keys(updates).sort(),
    ["audits", "byCheck", "byDaysCount", "byExperience", "byGoal", "byScoreBucket", "bySource"]
  );
});

test("parseBody accepts a Buffer, a JSON string, and an already-parsed object alike", () => {
  // navigator.sendBeacon(Blob) can arrive as an unparsed Buffer when Vercel's
  // body parser does not recognize the content type as JSON. Before this,
  // such a body silently failed sanitizeTelemetry (a Buffer has no `.v`) and
  // the client never learns, which is exactly why this needs a direct test
  // rather than relying on the handler's response code to prove it.
  const asString = JSON.stringify(validBody);
  assert.deepEqual(parseBody(Buffer.from(asString, "utf8")), validBody);
  assert.deepEqual(parseBody(asString), validBody);
  assert.deepEqual(parseBody(validBody), validBody);
});

test("parseBody returns null, never throws, on unparseable input", () => {
  assert.equal(parseBody("not json"), null);
  assert.equal(parseBody(Buffer.from("not json", "utf8")), null);
  assert.equal(parseBody(null), null);
  assert.equal(parseBody(undefined), null);
});

test("GET serves the aggregate, and serves an empty one when unconfigured", async () => {
  const saved = process.env.FIREBASE_SERVICE_ACCOUNT;
  delete process.env.FIREBASE_SERVICE_ACCOUNT;
  const res = makeRes();
  await handler({ method: "GET", body: null, headers: {}, query: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { audits: 0, byCheck: {}, since: null });
  if (saved !== undefined) process.env.FIREBASE_SERVICE_ACCOUNT = saved;
});

test("GET sets an edge cache header on a configured response, so repeat Safety Lab views don't fan out to Firestore", async () => {
  // A 30-day rolling aggregate tolerates five minutes of staleness easily;
  // without this header, every page view fans out to up to 30 Firestore
  // reads, exhausting the 50k/day project-wide read quota at ~1,666 views.
  //
  // This must be driven through a CONFIGURED response, not the unconfigured
  // fallback: the unconfigured path costs no Firestore reads at all, so
  // pinning the header there (as this test used to) proved nothing about the
  // response that actually needs caching, and let the header silently end up
  // on the wrong branch when it moved in the fix for the stale-zero bug.
  const store = makeFakeStore();
  __setFirestoreForTests({ store, FieldValue: fakeFieldValue });
  try {
    const res = makeRes();
    await handler({ method: "GET", body: null, headers: {}, query: {} }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["Cache-Control"], "s-maxage=300, stale-while-revalidate=3600");
  } finally {
    __setFirestoreForTests(null);
  }
});

test("GET sets no-store on the unconfigured fallback, so a misleading zero is never cached at the edge", async () => {
  const saved = process.env.FIREBASE_SERVICE_ACCOUNT;
  delete process.env.FIREBASE_SERVICE_ACCOUNT;
  const res = makeRes();
  await handler({ method: "GET", body: null, headers: {}, query: {} }, res);
  assert.equal(res.headers["Cache-Control"], "no-store");
  if (saved !== undefined) process.env.FIREBASE_SERVICE_ACCOUNT = saved;
});

test("GET sets no-store when a configured read fails, so a transient outage is never cached at the edge", async () => {
  // Before this fix, Cache-Control was set unconditionally at the top of the
  // GET branch, so a Firestore read that throws still shipped with
  // s-maxage=300 on the {audits: 0} fallback — pinning exactly the
  // misleading zero the production block's hidden-below-audits-<=-0 design
  // is supposed to prevent.
  const throwingStore = {
    collection: () => ({ doc: (id) => ({ id }) }),
    getAll: async () => { throw new Error("boom"); },
  };
  __setFirestoreForTests({ store: throwingStore, FieldValue: fakeFieldValue });
  try {
    const res = makeRes();
    await handler({ method: "GET", body: null, headers: {}, query: {} }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { audits: 0, byCheck: {}, since: null });
    assert.equal(res.headers["Cache-Control"], "no-store");
  } finally {
    __setFirestoreForTests(null);
  }
});

test("a method that is neither GET, HEAD nor POST is refused, and Allow names all three", async () => {
  const res = makeRes();
  await handler({ method: "PUT", body: null, headers: {}, query: {} }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers["Allow"], "GET, HEAD, POST");
});

test("HEAD is answered like GET, not refused", async () => {
  // Found live: `curl -I https://spotterai.xyz/api/audit-telemetry` returned 405
  // while the response advertised `Allow: GET, POST`. HEAD is GET without the
  // body (RFC 9110) and it is what uptime monitors send, so refusing it while
  // claiming to allow GET was a contradiction a monitor would read as an
  // outage. Node discards the body on a HEAD response; the status and the
  // cache headers are the part that has to be right.
  const store = makeFakeStore();
  __setFirestoreForTests({ store, FieldValue: fakeFieldValue });
  try {
    const res = makeRes();
    await handler({ method: "HEAD", body: null, headers: {}, query: {} }, res);
    assert.equal(res.statusCode, 200, "HEAD must not be refused");
    assert.equal(res.headers["Cache-Control"], "s-maxage=300, stale-while-revalidate=3600");
  } finally {
    __setFirestoreForTests(null);
  }
});

test("HEAD on an unconfigured deploy matches GET, including the no-store header", async () => {
  const saved = process.env.FIREBASE_SERVICE_ACCOUNT;
  delete process.env.FIREBASE_SERVICE_ACCOUNT;
  try {
    const get = makeRes();
    const head = makeRes();
    await handler({ method: "GET", body: null, headers: {}, query: {} }, get);
    await handler({ method: "HEAD", body: null, headers: {}, query: {} }, head);
    assert.equal(head.statusCode, get.statusCode);
    assert.equal(head.headers["Cache-Control"], get.headers["Cache-Control"]);
    assert.equal(head.headers["Cache-Control"], "no-store");
  } finally {
    if (saved !== undefined) process.env.FIREBASE_SERVICE_ACCOUNT = saved;
  }
});

test("with no service account configured the handler accepts and writes nothing", async () => {
  const saved = process.env.FIREBASE_SERVICE_ACCOUNT;
  delete process.env.FIREBASE_SERVICE_ACCOUNT;
  const res = makeRes();
  await handler({ method: "POST", body: validBody, headers: {}, query: {} }, res);
  assert.equal(res.statusCode, 204);
  if (saved !== undefined) process.env.FIREBASE_SERVICE_ACCOUNT = saved;
});

test("an invalid payload is accepted and dropped, never surfaced as an error", async () => {
  const saved = process.env.FIREBASE_SERVICE_ACCOUNT;
  delete process.env.FIREBASE_SERVICE_ACCOUNT;
  const res = makeRes();
  await handler({ method: "POST", body: { v: 1, checks: [{ id: "secret", status: "pass" }] }, headers: {}, query: {} }, res);
  assert.equal(res.statusCode, 204);
  if (saved !== undefined) process.env.FIREBASE_SERVICE_ACCOUNT = saved;
});

// --- Firestore round trip (fake store) --------------------------------------
// The writer/reader disagreement (dotted keys vs. the nested shape
// readAggregate expects) shipped once and was only caught by reading the
// code, because nothing exercised the actual write-then-read path. These
// drive that path directly.

test("readAggregate sums per status across days, overlapping and disjoint check ids alike", async () => {
  const store = makeFakeStore();
  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - 86400000));

  // Two audits land on today: the second overlaps rest_days/pass with the
  // first and adds a disjoint goal_fit/fail.
  await store.collection("audit_telemetry").doc(today).set(counterUpdates(validBody, fakeFieldValue), { merge: true });
  await store.collection("audit_telemetry").doc(today).set(
    counterUpdates({ ...validBody, checks: [{ id: "rest_days", status: "pass" }, { id: "goal_fit", status: "fail" }] }, fakeFieldValue),
    { merge: true }
  );
  // A third audit lands on a second, earlier day, hitting rest_days/pass
  // again, to prove the sum crosses documents rather than only merging
  // within one.
  await store.collection("audit_telemetry").doc(yesterday).set(
    counterUpdates({ ...validBody, checks: [{ id: "rest_days", status: "pass" }] }, fakeFieldValue),
    { merge: true }
  );

  const totals = await readAggregate(store);
  assert.equal(totals.audits, 3);
  assert.equal(totals.byCheck.rest_days.pass, 3);
  assert.equal(totals.byCheck.muscle_balance.warn, 1);
  assert.equal(totals.byCheck.goal_fit.fail, 1);
  assert.equal(totals.since, yesterday, "since tracks the earliest day with data in the scanned window");
});

test("recordAudit writes a nested shape a real set({merge:true}) can merge, not dotted keys", async () => {
  const store = makeFakeStore();
  const req = { headers: { "x-real-ip": "203.0.113.20" } };
  const wrote = await recordAudit(store, fakeFieldValue, validBody, req);
  assert.equal(wrote, true);

  const dayCall = store._calls.sets.find((c) => c.collection === "audit_telemetry");
  assert.ok(dayCall, "a set() must have been issued against audit_telemetry");
  assert.deepEqual(
    Object.keys(dayCall.data).sort(),
    ["audits", "byCheck", "byDaysCount", "byExperience", "byGoal", "byScoreBucket", "bySource"]
  );
  assert.deepEqual(dayCall.data.byCheck.rest_days, { pass: { __increment: 1 } });
  assert.deepEqual(dayCall.data.byCheck.muscle_balance, { warn: { __increment: 1 } });
  assert.deepEqual(dayCall.data.bySource, { generate: { __increment: 1 } });
  assert.equal(Object.keys(dayCall.data).some((k) => k.includes(".")), false, "no literal dot in any field name");

  // And the round trip actually works through the fake store's merge, which
  // resolves the increments into real numbers.
  const totals = await readAggregate(store);
  assert.equal(totals.audits, 1);
  assert.equal(totals.byCheck.rest_days.pass, 1);
});

test("recordAudit: a saturated day is dropped without ever reading the IP throttle doc", async () => {
  const today = dayKey();
  const store = makeFakeStore({ audit_telemetry: { [today]: { audits: DAILY_AUDIT_CAP } } });
  const req = { headers: { "x-real-ip": "203.0.113.5" } };

  const wrote = await recordAudit(store, fakeFieldValue, validBody, req);

  assert.equal(wrote, false);
  assert.equal(store._calls.gets.length, 1, "only the one read that discovered the day is saturated");
  assert.equal(
    store._calls.gets.some((k) => k.startsWith("audit_telemetry_throttle/")),
    false,
    "the IP throttle doc must never be read once the day is saturated"
  );
  assert.equal(store._calls.sets.length, 0, "nothing should be written once the day is saturated");
});

test("recordAudit: a successful write bumps the same-instance cap cache, so the cap trips without a fresh read", async () => {
  // Regression: dayCountCache used to be set only from a read. An instance
  // that read, say, 4,990 kept writing against that stale figure for a full
  // DAY_CACHE_TTL_MS (60s), overshooting DAILY_AUDIT_CAP. Seeding the store
  // at DAILY_AUDIT_CAP - 1 and writing once through recordAudit must be
  // enough for the VERY NEXT call, made immediately after (well inside the
  // 60s window, no clock manipulation needed), to see the cap tripped —
  // and it must see that without a second read of the day document, proving
  // the cache itself was bumped rather than happening to still be fresh.
  const today = dayKey();
  const store = makeFakeStore({ audit_telemetry: { [today]: { audits: DAILY_AUDIT_CAP - 1 } } });
  const req = { headers: { "x-real-ip": "203.0.113.30" } };
  const dayReads = () => store._calls.gets.filter((k) => k.startsWith("audit_telemetry/")).length;

  const first = await recordAudit(store, fakeFieldValue, validBody, req);
  assert.equal(first, true, "the last slot under the cap should still write");
  const readsAfterFirst = dayReads();

  const second = await recordAudit(store, fakeFieldValue, validBody, req);
  assert.equal(second, false, "the cap must now be tripped, from the write-bumped cache");
  assert.equal(dayReads(), readsAfterFirst, "no additional day-doc read should have been needed to see the cap tripped");
});

test("recordAudit: the per-IP hourly cap trips after IP_HOURLY_CAP writes from one caller", async () => {
  const store = makeFakeStore();
  const req = { headers: { "x-real-ip": "203.0.113.9" } };
  for (let i = 0; i < IP_HOURLY_CAP; i++) {
    const wrote = await recordAudit(store, fakeFieldValue, validBody, req);
    assert.equal(wrote, true, `write ${i} should still be under the cap`);
  }
  const overCap = await recordAudit(store, fakeFieldValue, validBody, req);
  assert.equal(overCap, false, "the cap should now be tripped");
});

test("recordAudit: x-real-ip is preferred over x-forwarded-for when both are present", async () => {
  const store = makeFakeStore();
  const sameCaller = { headers: { "x-real-ip": "203.0.113.77", "x-forwarded-for": "1.1.1.1, 2.2.2.2" } };
  for (let i = 0; i < IP_HOURLY_CAP; i++) {
    await recordAudit(store, fakeFieldValue, validBody, sameCaller);
  }
  // Same x-real-ip, a totally different x-forwarded-for — must still be
  // recognized as the same caller and hit the same cap.
  const stillSameCaller = { headers: { "x-real-ip": "203.0.113.77", "x-forwarded-for": "9.9.9.9, 8.8.8.8" } };
  const overCap = await recordAudit(store, fakeFieldValue, validBody, stillSameCaller);
  assert.equal(overCap, false, "same x-real-ip must hit the same cap regardless of x-forwarded-for");
});

test("recordAudit: a forged, rotating leading x-forwarded-for entry does not evade the IP cap", async () => {
  // Where a proxy APPENDS to an existing XFF rather than replacing it, the
  // leftmost entries are whatever the caller sent. Trusting the leftmost
  // entry would let a caller defeat IP_HOURLY_CAP just by rotating it; the
  // rightmost entry is the one the trusted proxy itself appended.
  const store = makeFakeStore();
  for (let i = 0; i < IP_HOURLY_CAP; i++) {
    const req = { headers: { "x-forwarded-for": `1.2.3.${i}, 203.0.113.50` } };
    const wrote = await recordAudit(store, fakeFieldValue, validBody, req);
    assert.equal(wrote, true, `write ${i} should still be under the cap`);
  }
  const req = { headers: { "x-forwarded-for": "9.9.9.9, 203.0.113.50" } };
  const overCap = await recordAudit(store, fakeFieldValue, validBody, req);
  assert.equal(overCap, false, "rotating the forged leading entry must not reset the cap");
});
