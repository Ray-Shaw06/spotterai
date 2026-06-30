/**
 * SpotterAI — Cloud sync (Firebase Auth + Firestore)
 * ============================================================================
 * Optional cross-device sync layered on top of the local-first tracker. When a
 * user signs in with Google, their tracked data syncs to a single Firestore
 * document (users/<uid>) and back, so it follows them across devices.
 *
 * Design:
 *   • Local-first: signed out, the app is unchanged (pure localStorage).
 *   • Last-write-wins by an `updatedAt` timestamp on the whole document — simple
 *     and adequate for one person across their own devices.
 *   • The Firebase SDK is lazy-loaded from Google's CDN only if sync is
 *     configured AND used — it never affects the signed-out experience.
 *
 * Emits "spotter:sync" events: { status: "unconfigured" | "signed-out" |
 *   "syncing" | "synced" | "error", user, error }.
 */

import { firebaseConfig, SYNC_CONFIGURED } from "./firebase-config.js";
import { getState, importData } from "./tracker-store.js";
import { upsertProfile, signOut as profileSignOut } from "./profile-store.js";

export { SYNC_CONFIGURED };

const SDK = "https://www.gstatic.com/firebasejs/10.12.2";
const PUSH_DEBOUNCE_MS = 1200;

let fb = null; // { auth, db, A (auth module), F (firestore module) }
let currentUser = null;
let unsubSnapshot = null;
let applyingRemote = false; // guard against echo loops while importing remote
let pushTimer = null;

function emit(status, extra = {}) {
  window.dispatchEvent(new CustomEvent("spotter:sync", { detail: { status, user: currentUser, ...extra } }));
}

const isEmpty = (s) => !s || (!s.workouts?.length && !s.nutrition?.length && !s.bodyweight?.length);
const clone = (o) => (typeof structuredClone === "function" ? structuredClone(o) : JSON.parse(JSON.stringify(o)));

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
  fb = { auth: authMod.getAuth(app), db: fsMod.getFirestore(app), A: authMod, F: fsMod };
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
    return "Network error — check your connection and try again.";
  if (code === "auth/popup-blocked")
    return "Your browser blocked the sign-in popup — allow popups for this site and try again.";
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request")
    return "Sign-in cancelled.";
  if (/api-key-not-valid/i.test(code + msg) || code === "auth/configuration-not-found")
    return "The Firebase config looks invalid — double-check firebase-config.js against your project's web-app settings.";
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

  const localNow = getState();
  const { db, F } = fb;
  const ref = F.doc(db, "users", user.uid);

  let snap;
  try {
    snap = await F.getDoc(ref);
  } catch (e) {
    emit("error", { error: e?.message || "Couldn't read cloud data." });
    return;
  }

  if (snap.exists()) {
    const remote = snap.data();
    if ((remote.updatedAt || 0) >= (localNow.updatedAt || 0)) applyRemote(remote.data);
    else await pushRemote(localNow);
  } else {
    // No cloud doc yet: seed it from prior local data if this account is empty.
    if (isEmpty(localNow) && !isEmpty(prev)) applyRemote(prev);
    await pushRemote(getState());
  }

  // Live updates from other devices.
  unsubSnapshot = F.onSnapshot(ref, (s) => {
    if (!s.exists() || s.metadata.hasPendingWrites) return; // ignore our own writes
    const remote = s.data();
    if ((remote.updatedAt || 0) > (getState().updatedAt || 0)) applyRemote(remote.data);
  });

  // Push local changes (debounced).
  window.addEventListener("spotter:tracker", schedulePush);
  emit("synced");
}

function onSignedOut() {
  const wasSignedIn = !!currentUser;
  currentUser = null;
  if (unsubSnapshot) {
    unsubSnapshot();
    unsubSnapshot = null;
  }
  window.removeEventListener("spotter:tracker", schedulePush);
  if (wasSignedIn) profileSignOut(); // back to local Guest profile
  emit("signed-out");
}

// ----------------------------------------------------------------------------
// Sync helpers
// ----------------------------------------------------------------------------
function schedulePush() {
  if (applyingRemote) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => pushRemote(getState()), PUSH_DEBOUNCE_MS);
}

async function pushRemote(state) {
  if (!fb || !currentUser) return;
  const { db, F } = fb;
  emit("syncing");
  try {
    await F.setDoc(F.doc(db, "users", currentUser.uid), {
      data: state,
      updatedAt: state.updatedAt || Date.now(),
      name: currentUser.name,
      email: currentUser.email,
    });
    emit("synced");
  } catch (e) {
    emit("error", { error: e?.message || "Couldn't save to cloud." });
  }
}

/** Import remote data without triggering an echo push (preserves its updatedAt). */
function applyRemote(data) {
  applyingRemote = true;
  importData(data);
  applyingRemote = false;
}
