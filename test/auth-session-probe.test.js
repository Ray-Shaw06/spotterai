/**
 * The landing-page Firebase deferral.
 *
 * `auth-ui.js` boots on every route and called `initSync()` straight into the
 * Firebase SDK — three cross-origin modules, ~100KB, tailing ~768ms on the
 * 2026-08-16 benchmark — to ask whether anyone is signed in, on a landing page
 * where nobody is. `hasPersistedSession` answers from local storage instead.
 *
 * The property that MUST hold is the fail-safe: only positive evidence of "no
 * user was ever stored here" returns false. Every other branch returns true and
 * loads the SDK exactly as before, so the worst outcome of a wrong guess is the
 * old behaviour rather than a signed-in user rendered as signed out. Most of the
 * cases below exist to pin that, one failure mode each.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { hasPersistedSession } from "../auth-session-probe.js";

const AUTH_DB = "firebaseLocalStorageDb";
const USER_KEY = "firebase:authUser:AIzaFake:[DEFAULT]";

/** Records whether the connection was closed, so a leak is visible to a test. */
function fakeDb(keys, fail, log) {
  return {
    close: () => (log.closed = true),
    transaction() {
      if (fail === "transaction") throw new Error("object store not found");
      return {
        objectStore: () => ({
          getAllKeys() {
            const req = { onerror: null, onsuccess: null, result: null };
            queueMicrotask(() => {
              if (fail === "getAllKeys") return req.onerror?.();
              req.result = keys;
              req.onsuccess?.();
            });
            return req;
          },
        }),
      };
    },
  };
}

function fakeScope({ session = [], dbs = [], keys = [], fail = null } = {}) {
  const log = { closed: false };
  const scope = {
    log,
    sessionStorage: { length: session.length, key: (i) => session[i] },
    indexedDB: {
      databases: dbs === "unsupported" ? undefined : async () => {
        if (fail === "databases") throw new Error("blocked");
        return dbs.map((name) => ({ name }));
      },
      open() {
        const req = { onerror: null, onsuccess: null, onupgradeneeded: null, result: null };
        queueMicrotask(() => {
          if (fail === "open") return req.onerror?.();
          if (fail === "upgrade") return req.onupgradeneeded?.();
          req.result = fakeDb(keys, fail, log);
          req.onsuccess?.();
        });
        return req;
      },
    },
  };
  return scope;
}

test("THE WIN: no Firebase database means the SDK is never fetched", async () => {
  assert.equal(await hasPersistedSession(fakeScope({ dbs: [] })), false);
  assert.equal(await hasPersistedSession(fakeScope({ dbs: ["some-other-app-db"] })), false);
});

test("a stored user is found, so a signed-in visitor still restores", async () => {
  const scope = fakeScope({ dbs: [AUTH_DB], keys: [USER_KEY] });
  assert.equal(await hasPersistedSession(scope), true);
  assert.equal(scope.log.closed, true, "the connection must not be left open");
});

test("the database outliving a sign-out is not mistaken for a session", async () => {
  // Firebase does not delete firebaseLocalStorageDb on sign-out, so existence
  // alone would answer true forever after one sign-in and never skip again.
  const scope = fakeScope({ dbs: [AUTH_DB], keys: ["firebase:persistence:AIzaFake:[DEFAULT]"] });
  assert.equal(await hasPersistedSession(scope), false);
  assert.equal(scope.log.closed, true);
});

test("a redirect sign-in in flight wins before IndexedDB is even consulted", async () => {
  // The popup-blocked fallback parks state in sessionStorage BEFORE any user
  // record exists. Missing this would silently drop the return trip.
  const scope = fakeScope({ session: ["firebase:pendingRedirect:AIzaFake:[DEFAULT]"], dbs: [] });
  assert.equal(await hasPersistedSession(scope), true);
});

test("unrelated sessionStorage keys do not force a load", async () => {
  assert.equal(await hasPersistedSession(fakeScope({ session: ["theme", "spotter:x"], dbs: [] })), false);
});

test("FAIL-SAFE: every way of not knowing loads the SDK, as before", async () => {
  const cases = {
    "databases() unsupported (Firefox < 126)": fakeScope({ dbs: "unsupported" }),
    "databases() throws": fakeScope({ dbs: [AUTH_DB], fail: "databases" }),
    "open() errors": fakeScope({ dbs: [AUTH_DB], fail: "open" }),
    "open() upgrades, so the db was not there after all": fakeScope({ dbs: [AUTH_DB], fail: "upgrade" }),
    "the object store is missing or renamed": fakeScope({ dbs: [AUTH_DB], fail: "transaction" }),
    "getAllKeys errors": fakeScope({ dbs: [AUTH_DB], fail: "getAllKeys" }),
  };
  for (const [why, scope] of Object.entries(cases)) {
    assert.equal(await hasPersistedSession(scope), true, `must fail safe: ${why}`);
  }
});

test("FAIL-SAFE: a scope with no browser APIs at all loads the SDK", async () => {
  assert.equal(await hasPersistedSession({}), true);
  assert.equal(await hasPersistedSession({ sessionStorage: null }), true);
});

test("the connection is closed even when reading the store fails", async () => {
  for (const fail of ["transaction", "getAllKeys"]) {
    const scope = fakeScope({ dbs: [AUTH_DB], fail });
    await hasPersistedSession(scope);
    assert.equal(scope.log.closed, true, `connection leaked on: ${fail}`);
  }
});
