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
import { exportData, importData } from "./tracker-store.js";

const $ = (id) => document.getElementById(id);
const els = {
  btn: $("profile-btn"),
  name: $("profile-name"),
  avatar: $("profile-avatar"),
  modal: $("account-modal"),
  close: $("account-close"),
  current: $("account-current"),
  list: $("account-list"),
  createForm: $("create-profile-form"),
  signout: $("account-signout"),
  exportBtn: $("account-export"),
  importInput: $("account-import"),
};

if (els.btn && els.modal) init();

function esc(t) {
  const d = document.createElement("div");
  d.textContent = t == null ? "" : String(t);
  return d.innerHTML;
}
function initial(name) {
  return (String(name || "?").trim()[0] || "?").toUpperCase();
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
              <span class="account-row__name">${esc(p.name)} ${p.hasPin ? '<span class="account-lock" title="PIN protected">🔒</span>' : ""}</span>
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

  els.exportBtn?.addEventListener("click", downloadBackup);
  els.importInput?.addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (f) importBackup(f);
    e.target.value = "";
  });

  // Keep header + modal in sync when the profile changes.
  subscribe(() => {
    renderHeader();
    if (els.modal.classList.contains("is-open")) renderModal();
  });
}
