/**
 * Does this browser have a persisted Firebase session?
 * ----------------------------------------------------------------------------
 * `auth-ui.js` runs at page load on every route, including the landing page, and
 * used to call `initSync()` straight into the Firebase SDK: three cross-origin
 * modules from gstatic, ~100KB, tailing ~768ms on the 2026-08-16 benchmark — to
 * answer "is anyone signed in?" for a visitor who has never signed in.
 *
 * The answer is already on disk. Firebase Auth persists to the
 * `firebaseLocalStorageDb` IndexedDB database under keys prefixed
 * `firebase:authUser:`, and reading that costs nothing.
 *
 * FAIL-SAFE BY CONSTRUCTION: every uncertain answer is `true`, which loads the
 * SDK exactly as before this existed. The ONLY path returning false is positive
 * evidence that Firebase has never stored a user here. Worst case is therefore
 * the old behaviour, never a signed-in user who is shown as signed out — the
 * same shape as the IntersectionObserver fail-safe in the 2026-08-16
 * activation-doors work, and for the same reason: a refinement must degrade to
 * the status quo, never to a broken state.
 *
 * Globals are read off `scope` rather than closed over, so the branches can be
 * driven in a test without a browser.
 */

const AUTH_DB = "firebaseLocalStorageDb";
const AUTH_STORE = "firebaseLocalStorage";
const USER_PREFIX = "firebase:authUser:";

export async function hasPersistedSession(scope = globalThis) {
  try {
    // A redirect sign-in in flight must complete, and it parks its state in
    // sessionStorage BEFORE any IndexedDB record exists. Check that first, or a
    // popup-blocked fallback would be dropped on the return trip.
    const ss = scope.sessionStorage;
    for (let i = 0; i < ss.length; i++) {
      if (String(ss.key(i)).startsWith("firebase:")) return true;
    }

    const idb = scope.indexedDB;
    if (typeof idb?.databases !== "function") return true; // Cannot ask. Assume yes.
    const dbs = await idb.databases();
    if (!dbs.some((d) => d.name === AUTH_DB)) return false; // Nobody ever signed in.

    // The database SURVIVES sign-out, so its existence is not the answer. Open
    // it read-only and look for an actual user record.
    return await new Promise((resolve) => {
      const open = idb.open(AUTH_DB);
      open.onerror = () => resolve(true);
      // Reaching an upgrade means the database was not there after all, so
      // something raced us. Unknown, not "signed out".
      open.onupgradeneeded = () => resolve(true);
      open.onsuccess = () => {
        const db = open.result;
        try {
          const keys = db.transaction(AUTH_STORE).objectStore(AUTH_STORE).getAllKeys();
          keys.onerror = () => {
            db.close();
            resolve(true);
          };
          keys.onsuccess = () => {
            db.close();
            resolve(keys.result.some((k) => String(k).startsWith(USER_PREFIX)));
          };
        } catch {
          db.close();
          resolve(true); // Store missing or renamed by an SDK upgrade.
        }
      };
    });
  } catch {
    return true;
  }
}
