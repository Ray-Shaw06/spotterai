/**
 * SpotterAI — Account UI (local profiles)
 * ============================================================================
 * Header profile button + an account modal: create a profile (optional PIN),
 * switch between profiles, sign out (back to Guest), delete profiles, and
 * export / import a JSON backup of the active profile's tracked data.
 *
 * All local — see profile-store.js for the (no-backend) data model.
 */

import { createProfile, deleteProfile, getActive, listProfiles, signIn, signOut, subscribe } from "./profile-store.js";
import { clearAllData, exportData, importData } from "./tracker-store.js";
import { SYNC_CONFIGURED, initSync, signInWithGoogle, signOutGoogle } from "./sync.js";
import { seedDemo } from "./demo-data.js";

const $ = (id) => document.getElementById(id);
const els = {
  btn: $("profile-btn"),
  name: $("profile-name"),
  avatar: $("profile-avatar"),
  clear: $("account-clear"),
  modal: $("account-modal"),
  close: $("account-close"),
  current: $("account-current"),
  list: $("account-list"),
  createForm: $("create-profile-form"),
  signout: $("account-signout"),
  exportBtn: $("account-export"),
  importInput: $("account-import"),
  syncBody: $("sync-body"),
  demo: $("account-demo"),
  heroDemo: $("hero-demo"),
  ctaDemo: $("cta-demo"),
  welcomeDemo: $("welcome-demo"),
};

function esc(t) {
  const d = document.createElement("div");
  d.textContent = t == null ? "" : String(t);
  return d.innerHTML;
}
function initial(name) {
  return (String(name || "?").trim()[0] || "?").toUpperCase();
}

// ----------------------------------------------------------------------------
// Cloud sync (Firebase / Google) section
// ----------------------------------------------------------------------------
const GOOGLE_G =
  '<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">' +
  '<path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62z"/>' +
  '<path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/>' +
  '<path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.05l3.01-2.33z"/>' +
  '<path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/>' +
  "</svg>";

let syncState = { status: SYNC_CONFIGURED ? "signed-out" : "unconfigured", user: null, error: "" };

function renderSync() {
  if (!els.syncBody) return;
  const s = syncState;

  if (s.status === "unconfigured") {
    els.syncBody.innerHTML = `<p class="account-note">Cross-device sync isn't set up. Add a free Firebase config to enable "Sign in with Google" — see the README → <em>Cross-device sync</em>.</p>`;
    return;
  }

  if (s.user) {
    const statusText = s.status === "syncing" ? "Syncing…" : s.status === "error" ? s.error || "Sync error" : "Synced";
    els.syncBody.innerHTML = `
      <div class="sync-user">
        ${s.user.photo
          ? `<img class="sync-user__photo" src="${esc(s.user.photo)}" alt="" referrerpolicy="no-referrer" />`
          : `<span class="account-avatar account-avatar--sm">${esc(initial(s.user.name))}</span>`}
        <div class="sync-user__meta"><strong>${esc(s.user.name)}</strong><br><span class="muted">${esc(s.user.email)}</span></div>
        <span class="sync-status sync-status--${esc(s.status)}">${esc(statusText)}</span>
      </div>
      <button type="button" id="google-signout" class="btn-link-danger">Sign out of Google</button>`;
  } else {
    els.syncBody.innerHTML = `
      <button type="button" id="google-signin" class="google-btn">${GOOGLE_G}<span>Sign in with Google</span></button>
      ${s.status === "error" && s.error ? `<p class="account-flash">${esc(s.error)}</p>` : ""}
      <p class="account-note">Sync your workouts, nutrition and progress across devices with your Google account.</p>`;
  }
}

// ----------------------------------------------------------------------------
// Header button
// ----------------------------------------------------------------------------
function renderHeader() {
  const p = getActive();
  if (els.name) els.name.textContent = p.name;
  if (els.avatar) els.avatar.textContent = initial(p.name);
}

// ----------------------------------------------------------------------------
// Modal
// ----------------------------------------------------------------------------
let lastFocus = null;

function openModal() {
  renderModal();
  renderSync();
  els.modal.classList.add("is-open");
  els.modal.setAttribute("aria-hidden", "false");
  els.btn.setAttribute("aria-expanded", "true");
  lastFocus = document.activeElement;
  setTimeout(() => els.modal.querySelector("input, button")?.focus(), 50);
}
function closeModal() {
  els.modal.classList.remove("is-open");
  els.modal.setAttribute("aria-hidden", "true");
  els.btn.setAttribute("aria-expanded", "false");
  lastFocus?.focus?.();
}

function renderModal() {
  const active = getActive();
  if (els.current) {
    els.current.innerHTML = `<span class="account-avatar">${esc(initial(active.name))}</span>
      <div><strong>${esc(active.name)}</strong><br><span class="muted">Active profile</span></div>`;
  }

  // Other profiles (switchable)
  const others = listProfiles().filter((p) => p.id !== active.id);
  if (els.list) {
    els.list.innerHTML = others.length
      ? others
          .map(
            (p) => `<li class="account-row" data-id="${p.id}">
              <span class="account-avatar account-avatar--sm">${esc(initial(p.name))}</span>
              <span class="account-row__name">${esc(p.name)} ${p.hasPin ? '<span class="account-lock" title="PIN protected" aria-label="PIN protected"><svg viewBox="0 0 24 24" width="13" height="13"><path d="M6 11V8a6 6 0 0 1 12 0v3M5 11h14v9H5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' : ""}</span>
              ${p.hasPin ? '<input type="password" class="input input--sm account-pin" placeholder="PIN" inputmode="numeric" aria-label="PIN" />' : ""}
              <button type="button" class="btn btn--ghost btn--sm account-switch">Switch</button>
              <button type="button" class="account-del" aria-label="Delete profile">×</button>
            </li>`
          )
          .join("")
      : `<li class="muted account-empty">No other profiles yet.</li>`;
  }
}

// ----------------------------------------------------------------------------
// Actions
// ----------------------------------------------------------------------------
function downloadBackup() {
  const data = exportData();
  const name = getActive().name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "profile";
  const blob = new Blob([data], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `spotterai-${name}-backup.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function importBackup(file) {
  try {
    const text = await file.text();
    const obj = JSON.parse(text);
    const ok = importData(obj);
    flash(els.importInput, ok ? "Backup imported ✓" : "That file didn't look like a SpotterAI backup.");
  } catch {
    flash(els.importInput, "Couldn't read that file.");
  }
}

// Small inline message under an element.
function flash(near, msg) {
  const note = document.createElement("p");
  note.className = "account-flash";
  note.textContent = msg;
  near.parentElement.appendChild(note);
  setTimeout(() => note.remove(), 3000);
}

// Seed the isolated "Demo" profile, then jump to the dashboard.
async function runDemo(btn) {
  if (!btn) return;
  const prev = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Loading demo…";
  try {
    await seedDemo();
    closeModal();
    location.hash = "#/dashboard";
  } catch {
    flash(btn, "Couldn't load the demo. Please try again.");
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
}

// ----------------------------------------------------------------------------
// Wiring
// ----------------------------------------------------------------------------
function init() {
  renderHeader();

  els.btn.addEventListener("click", openModal);
  els.close?.addEventListener("click", closeModal);
  els.modal.addEventListener("click", (e) => {
    if (e.target === els.modal) closeModal(); // click backdrop
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && els.modal.classList.contains("is-open")) closeModal();
  });

  // Create profile
  els.createForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(els.createForm);
    await createProfile(fd.get("name"), String(fd.get("pin") || "").trim());
    els.createForm.reset();
    closeModal();
  });

  // Switch / delete (event delegation)
  els.list?.addEventListener("click", async (e) => {
    const row = e.target.closest(".account-row");
    if (!row) return;
    const id = row.dataset.id;
    if (e.target.closest(".account-switch")) {
      const pin = row.querySelector(".account-pin")?.value || "";
      const res = await signIn(id, pin);
      if (!res.ok) flash(row, res.error);
      else closeModal();
    } else if (e.target.closest(".account-del")) {
      if (confirm("Delete this profile and its tracked data? This can't be undone.")) {
        const res = deleteProfile(id);
        if (!res.ok) flash(row, res.error);
        else renderModal();
      }
    }
  });

  els.signout?.addEventListener("click", () => {
    signOut();
    closeModal();
  });

  // Clear ALL local data (every profile) + the offline cache, then hard-reload.
  els.clear?.addEventListener("click", async () => {
    const ok = confirm(
      "Clear ALL SpotterAI data in this browser?\n\nThis removes every profile and all workouts, nutrition, plans, settings and progress — permanently. It can't be undone.\n\nTip: cancel and use “Export backup” first if you might want it back."
    );
    if (!ok) return;
    els.clear.disabled = true;
    els.clear.textContent = "Clearing…";
    await clearAllData(); // wipes storage + PWA cache + service worker
    // Cache-busting navigation → guarantees a fresh load (no stale code/state).
    location.replace(location.pathname + "?fresh=" + Date.now() + "#/");
    location.reload();
  });

  els.exportBtn?.addEventListener("click", downloadBackup);
  els.importInput?.addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (f) importBackup(f);
    e.target.value = "";
  });

  // Load demo data into an isolated "Demo" profile, then jump to the dashboard.
  // Triggerable from the account modal AND the hero "Try the live demo" button.
  els.demo?.addEventListener("click", () => runDemo(els.demo));
  els.heroDemo?.addEventListener("click", () => runDemo(els.heroDemo));
  els.ctaDemo?.addEventListener("click", () => runDemo(els.ctaDemo));
  els.welcomeDemo?.addEventListener("click", () => runDemo(els.welcomeDemo));

  // Keep header + modal in sync when the profile changes.
  subscribe(() => {
    renderHeader();
    if (els.modal.classList.contains("is-open")) renderModal();
  });

  // Cloud sync (Google) — sign-in/out buttons + live status.
  els.syncBody?.addEventListener("click", (e) => {
    if (e.target.closest("#google-signin")) signInWithGoogle();
    else if (e.target.closest("#google-signout")) signOutGoogle();
  });
  window.addEventListener("spotter:sync", (e) => {
    const d = e.detail || {};
    syncState = { status: d.status, user: d.user || null, error: d.error || "" };
    renderHeader();
    renderSync();
  });

  // Restore an existing Google session (no-op if sync isn't configured).
  initSync();
}

// Start (after all module-level consts above are initialized).
if (els.btn && els.modal) init();
