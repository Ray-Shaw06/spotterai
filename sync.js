/**
 * SpotterAI — Cloud sync (Firebase Auth + Firestore, per-record)
 * ============================================================================
 * Optional cross-device sync layered on top of the local-first tracker. When a
 * user signs in with Google their data syncs to Firestore and back, so it
 * follows them across devices.
 *
 * WHAT CHANGED AND WHY
 * --------------------
 * This used to write the ENTIRE application state to one document
 * (`users/<uid>`) with last-write-wins on a single top-level `updatedAt`. That
 * was not slow, it was lossy: two devices active inside the same window meant
 * the later write silently erased everything the other had done, including
 * whole logged sessions. Making it faster would have widened that window.
 *
 * Layout now:
 *
 *   users/<uid>                        meta: targets, water, unit, ...
 *   users/<uid>/workouts/<id>          one document per record
 *   users/<uid>/nutrition/<id>
 *   users/<uid>/bodyweight/<id>
 *   users/<uid>/painReports/<id>
 *   users/<uid>/routines/<id>          small, user-authored
 *   users/<uid>/mealTemplates/<id>
 *   users/<uid>/customExercises/<id>
 *   users/<uid>/customFoods/<id>
 *
 * Two devices editing different records never collide. "Instant" then falls out
 * for free, so the push debounce is 300ms rather than 1200ms.
 *
 * THREE THINGS THAT ARE LOAD-BEARING
 * ----------------------------------
 * 1. `firestore.rules` needs a NESTED recursive wildcard. `match /users/{uid}`
 *    does NOT cascade into subcollections, so without it every write here comes
 *    back permission-denied. Covered by integration/firebase-emulator.mjs.
 *
 * 2. Remote batches go through `mergeRemoteRecords`, NEVER `importData`.
 *    importData replaces whole state, which is right for a backup file and
 *    catastrophic for a partial batch: it would delete every local record
 *    outside the sync window.
 *
 * 3. Deletes are real `deleteDoc` calls. Under per-record merge, simply not
 *    writing a deleted record leaves the remote copy intact and the next
 *    snapshot resurrects it.
 *
 * The live listener is bounded to a recent window for dated collections, so a
 * cold load costs reads proportional to that window rather than to lifetime
 * history. Full history is pulled once, only when a device has none.
 *
 * Emits "spotter:sync" events: { status: "unconfigured" | "signed-out" |
 *   "syncing" | "synced" | "error", user, error }.
 */

import { firebaseConfig, SYNC_CONFIGURED } from "./firebase-config.js";
import {
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
} from "./tracker-store.js";
import { upsertProfile, signOut as profileSignOut } from "./profile-store.js";

export { SYNC_CONFIGURED };

const SDK = "https://www.gstatic.com/firebasejs/10.12.2";

/** Per-record writes no longer collide, so this can be short enough to feel live. */
const PUSH_DEBOUNCE_MS = 300;

/** How much dated history the live listener subscribes to. Older data is kept
 *  locally and pulled once on a device that has none. */
const SYNC_WINDOW_DAYS = 180;

/** Firestore caps a batch at 500 operations. */
const BATCH_LIMIT = 400;

let fb = null; // { auth, db, A (auth module), F (firestore module) }
let currentUser = null;
let unsubs = [];
let pushTimer = null;

// Last state we know the cloud has, as kind -> Map<id, json>. Diffing against
// this is what turns "something changed" into "these three records changed",
// without the tracker store needing to know sync exists.
let shadow = new Map();
let shadowMeta = "";

function emit(status, extra = {}) {
  window.dispatchEvent(new CustomEvent("spotter:sync", { detail: { status, user: currentUser, ...extra } }));
}

const clone = (o) => (typeof structuredClone === "function" ? structuredClone(o) : JSON.parse(JSON.stringify(o)));
const isEmpty = (s) => !s || (!s.workouts?.length && !s.nutrition?.length && !s.bodyweight?.length);

/** 'YYYY-MM-DD' cutoff for the live window. Dates are stored as sortable strings. */
function windowCutoff() {
  const d = new Date();
  d.setDate(d.getDate() - SYNC_WINDOW_DAYS);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ----------------------------------------------------------------------------
// Lazy SDK load
// ----------------------------------------------------------------------------
async function ensureFirebase() {
  if (fb) return fb;
  const [appMod, authMod, fsMod] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);
  const app = appMod.initializeApp(firebaseConfig);

  // Persistent local cache gives us the offline write queue: a set logged in a
  // gym basement is queued and replayed on reconnect, including deletes. Falls
  // back to the memory cache where IndexedDB is unavailable (private windows,
  // some embedded browsers) rather than failing sign-in outright.
  let db;
  try {
    db = fsMod.initializeFirestore(app, {
      localCache: fsMod.persistentLocalCache({ tabManager: fsMod.persistentMultipleTabManager() }),
    });
  } catch {
    db = fsMod.getFirestore(app);
  }

  fb = { auth: authMod.getAuth(app), db, A: authMod, F: fsMod };
  return fb;
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/** Initialize auth listener (restores an existing session). Safe to call once. */
export async function initSync() {
  if (!SYNC_CONFIGURED) {
    emit("unconfigured");
    return;
  }
  try {
    const { auth, A } = await ensureFirebase();
    A.onAuthStateChanged(auth, (user) => (user ? onSignedIn(user) : onSignedOut()));
    // Surface errors from a redirect-based sign-in (the popup fallback).
    A.getRedirectResult?.(auth).catch((e) => emit("error", { error: friendlyAuthError(e) }));
  } catch (e) {
    emit("error", { error: e?.message || "Failed to init sync" });
  }
}

/** Map raw Firebase auth errors to a clear, actionable message. */
function friendlyAuthError(e) {
  const code = e?.code || "";
  const msg = e?.message || "";
  if (/requests-from-referer/i.test(code) || /are[- ]blocked|referer/i.test(msg))
    return "Sign-in is blocked by this Firebase project's API-key restrictions. In Google Cloud Console → APIs & Services → Credentials, open the API key and either add this site to the HTTP-referrer allow-list or set Application restrictions to “None”.";
  if (code === "auth/unauthorized-domain")
    return "This domain isn't authorised for sign-in. Add it under Firebase → Authentication → Settings → Authorized domains.";
  if (code === "auth/operation-not-allowed")
    return "Google sign-in isn't enabled for this project. Turn it on under Firebase → Authentication → Sign-in method → Google.";
  if (code === "auth/network-request-failed")
    return "Network error, check your connection and try again.";
  if (code === "auth/popup-blocked")
    return "Your browser blocked the sign-in popup, allow popups for this site and try again.";
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request")
    return "Sign-in cancelled.";
  if (/api-key-not-valid/i.test(code + msg) || code === "auth/configuration-not-found")
    return "The Firebase config looks invalid, double-check firebase-config.js against your project's web-app settings.";
  return msg || "Sign-in failed.";
}

export async function signInWithGoogle() {
  if (!SYNC_CONFIGURED) return;
  try {
    const { auth, A } = await ensureFirebase();
    await A.signInWithPopup(auth, new A.GoogleAuthProvider());
  } catch (e) {
    // A blocked popup is recoverable — fall back to a full-page redirect.
    if (e?.code === "auth/popup-blocked") {
      try {
        const { auth, A } = await ensureFirebase();
        return await A.signInWithRedirect(auth, new A.GoogleAuthProvider());
      } catch (e2) {
        return emit("error", { error: friendlyAuthError(e2) });
      }
    }
    emit("error", { error: friendlyAuthError(e) });
  }
}

export async function signOutGoogle() {
  if (!fb) return;
  try {
    await fb.A.signOut(fb.auth);
  } catch {
    /* ignore */
  }
}

// ----------------------------------------------------------------------------
// Auth state handlers
// ----------------------------------------------------------------------------
async function onSignedIn(user) {
  currentUser = { uid: user.uid, name: user.displayName || "Me", email: user.email || "", photo: user.photoURL || "" };
  emit("syncing");

  // Carry the currently-active (e.g. Guest) data up on a first-ever sign-in.
  const prev = clone(getState());

  // Switch to this account's local mirror profile (fires profile/tracker events).
  upsertProfile({ id: "g:" + user.uid, name: currentUser.name, google: true });
  await new Promise((r) => setTimeout(r, 0)); // let the profile switch settle

  try {
    await migrateLegacyDocument(user.uid);

    const localNow = getState();
    // Nothing local for this account: seed from whatever was on screen before
    // sign-in, then pull the full history once so an older device is complete.
    if (isEmpty(localNow) && !isEmpty(prev)) seedFromLocal(prev);

    await pullFullHistoryIfEmpty(user.uid);
    await subscribe(user.uid);

    // Establish the shadow from what we now hold, then push anything the cloud
    // is missing (first sign-in, or records made offline while signed out).
    resetShadow();
    await pushChanges(user.uid);

    window.addEventListener("spotter:tracker", schedulePush);
    emit("synced");
  } catch (e) {
    emit("error", { error: e?.message || "Couldn't sync with the cloud." });
  }
}

function onSignedOut() {
  const wasSignedIn = !!currentUser;
  currentUser = null;
  for (const off of unsubs) {
    try {
      off();
    } catch {
      /* already torn down */
    }
  }
  unsubs = [];
  clearTimeout(pushTimer);
  shadow = new Map();
  shadowMeta = "";
  window.removeEventListener("spotter:tracker", schedulePush);
  if (wasSignedIn) profileSignOut(); // back to local Guest profile
  emit("signed-out");
}

// ----------------------------------------------------------------------------
// Migration off the single whole-state document
// ----------------------------------------------------------------------------
/**
 * The old layout stored everything under a `data` field on `users/<uid>`. Fan it
 * out into per-record documents once, then drop the field so this never runs
 * again. Runs before any subscription so the fan-out is not echoed back.
 */
async function migrateLegacyDocument(uid) {
  const { db, F } = fb;
  const ref = F.doc(db, "users", uid);
  const snap = await F.getDoc(ref);
  if (!snap.exists()) return;

  const remote = snap.data();
  if (!remote || !remote.data || typeof remote.data !== "object") return;

  const legacy = remote.data;

  // Land it locally first, so nothing is lost if the fan-out is interrupted.
  for (const kind of SYNCED_RECORD_KINDS) {
    if (Array.isArray(legacy[kind]) && legacy[kind].length) mergeRemoteRecords(kind, legacy[kind]);
  }
  mergeRemoteMeta(legacy);

  // Then write it out per record.
  const ops = [];
  for (const kind of SYNCED_RECORD_KINDS) {
    for (const record of legacy[kind] || []) {
      const id = recordId(record);
      if (id) ops.push({ ref: F.doc(db, "users", uid, kind, id), data: withStamp(record) });
    }
  }
  await commitInChunks(ops);

  await F.setDoc(ref, { meta: metaSnapshot(), updatedAt: Date.now(), name: currentUser.name, email: currentUser.email, data: F.deleteField() }, { merge: true });
}

/** Adopt pre-sign-in local data as this account's starting point. */
function seedFromLocal(prev) {
  for (const kind of SYNCED_RECORD_KINDS) {
    if (Array.isArray(prev[kind]) && prev[kind].length) mergeRemoteRecords(kind, prev[kind]);
  }
  mergeRemoteMeta(prev);
}

// ----------------------------------------------------------------------------
// Pull
// ----------------------------------------------------------------------------
/**
 * A device with no local records for a dated kind pulls that kind's full
 * history once. Devices that already hold data rely on the bounded live window,
 * which is what keeps a cold load from re-reading lifetime history every time.
 */
async function pullFullHistoryIfEmpty(uid) {
  const { db, F } = fb;
  for (const kind of DATED_RECORD_KINDS) {
    if ((getState()[kind] || []).length) continue;
    const snap = await F.getDocs(F.collection(db, "users", uid, kind));
    const records = snap.docs.map((d) => stripStamp(d.data()));
    if (records.length) mergeRemoteRecords(kind, records);
  }
}

/** Live listeners: bounded window for dated kinds, whole collection otherwise. */
async function subscribe(uid) {
  const { db, F } = fb;
  const cutoff = windowCutoff();

  for (const kind of SYNCED_RECORD_KINDS) {
    const col = F.collection(db, "users", uid, kind);
    const q = DATED_RECORD_KINDS.includes(kind) ? F.query(col, F.where("date", ">=", cutoff)) : col;

    unsubs.push(
      F.onSnapshot(
        q,
        (snap) => {
          if (snap.metadata.hasPendingWrites) return; // our own write echoing back
          const upserts = [];
          const deletes = [];
          for (const change of snap.docChanges()) {
            if (change.type === "removed") deletes.push(change.doc.id);
            else upserts.push(stripStamp(change.doc.data()));
          }
          if (upserts.length) mergeRemoteRecords(kind, upserts);
          if (deletes.length) removeRemoteRecords(kind, deletes);
          if (upserts.length || deletes.length) syncShadowFor(kind);
        },
        (e) => emit("error", { error: readError(e, kind) })
      )
    );
  }

  // Meta document.
  unsubs.push(
    F.onSnapshot(
      F.doc(db, "users", uid),
      (snap) => {
        if (!snap.exists() || snap.metadata.hasPendingWrites) return;
        const meta = snap.data()?.meta;
        if (meta && mergeRemoteMeta(meta)) shadowMeta = JSON.stringify(metaSnapshot());
      },
      (e) => emit("error", { error: readError(e, "settings") })
    )
  );
}

function readError(e, kind) {
  if (e?.code === "permission-denied") {
    return `Sync was denied for ${kind}. The Firestore rules need a nested recursive wildcard under /users/{uid} so per-record documents are covered.`;
  }
  return e?.message || `Couldn't read ${kind} from the cloud.`;
}

// ----------------------------------------------------------------------------
// Push (diff against the shadow)
// ----------------------------------------------------------------------------
function schedulePush() {
  // Applying remote data fires the same tracker event; pushing it straight back
  // would be an echo loop.
  if (isApplyingRemote() || !currentUser) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushChanges(currentUser.uid).catch((e) => emit("error", { error: e?.message || "Couldn't save to the cloud." }));
  }, PUSH_DEBOUNCE_MS);
}

/** kind -> Map<id, json> for the current local state. */
function snapshotOf(kind) {
  const out = new Map();
  for (const record of getState()[kind] || []) {
    const id = recordId(record);
    if (id) out.set(id, JSON.stringify(record));
  }
  return out;
}

function resetShadow() {
  shadow = new Map();
  for (const kind of SYNCED_RECORD_KINDS) shadow.set(kind, new Map());
  shadowMeta = "";
}

/** Mark one kind as matching the cloud, after applying a remote change. */
function syncShadowFor(kind) {
  shadow.set(kind, snapshotOf(kind));
}

async function pushChanges(uid) {
  if (!fb || !currentUser) return;
  const { db, F } = fb;
  const ops = [];

  for (const kind of SYNCED_RECORD_KINDS) {
    const current = snapshotOf(kind);
    const previous = shadow.get(kind) || new Map();

    for (const [id, json] of current) {
      if (previous.get(id) === json) continue;
      ops.push({ ref: F.doc(db, "users", uid, kind, id), data: withStamp(JSON.parse(json)) });
    }
    // Anything we held last time and no longer hold was deleted here. Not
    // writing it is not enough: the remote copy would survive and the next
    // snapshot would hand it straight back.
    for (const id of previous.keys()) {
      if (!current.has(id)) ops.push({ ref: F.doc(db, "users", uid, kind, id), delete: true });
    }
    shadow.set(kind, current);
  }

  const meta = JSON.stringify(metaSnapshot());
  const metaChanged = meta !== shadowMeta;
  if (metaChanged) shadowMeta = meta;

  if (!ops.length && !metaChanged) return;

  emit("syncing");
  try {
    if (ops.length) await commitInChunks(ops);
    if (metaChanged) {
      await F.setDoc(
        F.doc(db, "users", uid),
        { meta: JSON.parse(meta), updatedAt: Date.now(), name: currentUser.name, email: currentUser.email },
        { merge: true }
      );
    }
    emit("synced");
  } catch (e) {
    // Roll the shadow back so the next attempt retries instead of assuming the
    // cloud already has this.
    resetShadow();
    throw e;
  }
}

/** Write ops in batches, since Firestore caps a batch at 500 operations. */
async function commitInChunks(ops) {
  const { db, F } = fb;
  for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
    const batch = F.writeBatch(db);
    for (const op of ops.slice(i, i + BATCH_LIMIT)) {
      if (op.delete) batch.delete(op.ref);
      else batch.set(op.ref, op.data);
    }
    await batch.commit();
  }
}

// ----------------------------------------------------------------------------
// Record stamping
// ----------------------------------------------------------------------------
/** Per-record timestamp, so conflict resolution is per record rather than global. */
function withStamp(record) {
  return { ...record, _syncedAt: Date.now() };
}

/** Drop sync bookkeeping before a record re-enters local state. */
function stripStamp(data) {
  if (!data || typeof data !== "object") return data;
  const { _syncedAt, ...rest } = data;
  return rest;
}

// Kept for the backup-restore path only. Sync never uses it: importData replaces
// whole state, which would delete every record outside the sync window.
export { importData as restoreFromBackup };
