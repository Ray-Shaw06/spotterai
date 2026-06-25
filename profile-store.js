/**
 * SpotterAI — Local profiles ("accounts" without a backend)
 * ============================================================================
 * Lets a user create named profiles in the browser, optionally protected by a
 * PIN, and switch between them. Each profile gets its own namespaced storage key
 * so tracker data is kept separate. There is no server: this is local-only, with
 * export/import for moving data between devices manually.
 *
 * Honest framing: a PIN is light protection on a shared browser, not real auth —
 * the data still lives in localStorage. Real cross-device accounts would need a
 * backend, which this $0 project avoids.
 *
 * Emits a "spotter:profile" window event when the active profile changes.
 */

const META_KEY = "spotterai.profiles.v1";
const TRACKER_BASE = "spotterai.tracker.v1";

function loadMeta() {
  try {
    const m = JSON.parse(localStorage.getItem(META_KEY) || "{}");
    return { profiles: Array.isArray(m.profiles) ? m.profiles : [], activeId: m.activeId || null };
  } catch {
    return { profiles: [], activeId: null };
  }
}

let meta = loadMeta();

function saveMeta() {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch {
    /* storage disabled — keep working in-memory */
  }
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Always keep a default "Guest" profile so the app works before sign-up.
function ensureDefault() {
  if (!meta.profiles.length) {
    meta.profiles.push({ id: "guest", name: "Guest", pinHash: null, createdAt: Date.now() });
  }
  if (!meta.activeId || !meta.profiles.some((p) => p.id === meta.activeId)) {
    meta.activeId = meta.profiles[0].id;
  }
  saveMeta();
}
ensureDefault();

function emit() {
  window.dispatchEvent(new CustomEvent("spotter:profile"));
}

// ----------------------------------------------------------------------------
// PIN hashing (SHA-256 via SubtleCrypto; tiny fallback if unavailable)
// ----------------------------------------------------------------------------
async function hashPin(pin) {
  const text = String(pin);
  if (window.crypto?.subtle) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Fallback (non-secure context): simple non-cryptographic hash.
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return "f" + (h >>> 0).toString(16);
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------
export function trackerKey(id = getActiveId()) {
  return `${TRACKER_BASE}::${id}`;
}

export function listProfiles() {
  return meta.profiles.map((p) => ({ id: p.id, name: p.name, hasPin: !!p.pinHash }));
}

export function getActive() {
  return meta.profiles.find((p) => p.id === meta.activeId) || meta.profiles[0];
}

export function getActiveId() {
  return getActive().id;
}

/** Create a new profile (optionally PIN-protected) and switch to it. */
export async function createProfile(name, pin) {
  const clean = String(name || "").trim().slice(0, 30) || "Profile";
  const id = uid();
  const pinHash = pin ? await hashPin(pin) : null;
  meta.profiles.push({ id, name: clean, pinHash, createdAt: Date.now() });
  meta.activeId = id;
  saveMeta();
  emit();
  return { id, name: clean };
}

/** Create-or-update a profile with an explicit id (used by Google sync) and activate it. */
export function upsertProfile({ id, name, google = false }) {
  let p = meta.profiles.find((x) => x.id === id);
  if (!p) {
    p = { id, name: name || "Account", pinHash: null, createdAt: Date.now(), google };
    meta.profiles.push(p);
  } else if (name) {
    p.name = name;
  }
  meta.activeId = id;
  saveMeta();
  emit();
  return p;
}

/** Switch to a profile, verifying the PIN if one is set. */
export async function signIn(id, pin) {
  const p = meta.profiles.find((x) => x.id === id);
  if (!p) return { ok: false, error: "Profile not found." };
  if (p.pinHash) {
    if (!pin) return { ok: false, error: "PIN required." };
    if ((await hashPin(pin)) !== p.pinHash) return { ok: false, error: "Incorrect PIN." };
  }
  meta.activeId = id;
  saveMeta();
  emit();
  return { ok: true };
}

/** Switch back to the Guest profile. */
export function signOut() {
  let guest = meta.profiles.find((p) => p.id === "guest");
  if (!guest) {
    guest = { id: "guest", name: "Guest", pinHash: null, createdAt: Date.now() };
    meta.profiles.push(guest);
  }
  meta.activeId = "guest";
  saveMeta();
  emit();
}

/** Delete a profile and its tracked data (cannot delete the active one). */
export function deleteProfile(id) {
  if (id === meta.activeId) return { ok: false, error: "Switch away before deleting this profile." };
  meta.profiles = meta.profiles.filter((p) => p.id !== id);
  try {
    localStorage.removeItem(trackerKey(id));
  } catch {
    /* ignore */
  }
  ensureDefault();
  saveMeta();
  emit();
  return { ok: true };
}

export function subscribe(cb) {
  window.addEventListener("spotter:profile", cb);
  return () => window.removeEventListener("spotter:profile", cb);
}
