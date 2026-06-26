/**
 * SpotterAI — streak reminders (local, honest)
 * ============================================================================
 * Opt-in nudge to protect your streak. When enabled, on app open (or tab focus)
 * — if you haven't logged today, have an active streak, and it's afternoon — it
 * shows ONE local notification via the service worker.
 *
 * Honest framing: this is a LOCAL reminder shown when you open the app. True
 * push-while-closed needs a server, which this $0, backend-free project avoids.
 */

import { deriveStats, getState } from "./tracker-store.js";

const PREF = "spotterai.reminders";
const SHOWN = "spotterai.reminders.lastShown";

const toggle = document.getElementById("reminders-toggle");
const note = document.getElementById("reminders-note");

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const enabled = () => localStorage.getItem(PREF) === "on";
const loggedToday = () => getState().workouts.some((w) => w.date === todayStr());
const setNote = (msg) => {
  if (note) note.textContent = msg;
};

async function enable() {
  if (!("Notification" in window)) {
    setNote("This browser doesn't support notifications.");
    return false;
  }
  let perm = Notification.permission;
  if (perm === "default") perm = await Notification.requestPermission();
  if (perm !== "granted") {
    setNote("Notifications are blocked — allow them in your browser settings to use reminders.");
    return false;
  }
  localStorage.setItem(PREF, "on");
  return true;
}

async function notify(title, body) {
  const opts = { body, icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: "spotterai-streak" };
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg?.showNotification) {
      reg.showNotification(title, opts);
      return;
    }
  } catch {
    /* fall through */
  }
  try {
    new Notification(title, opts);
  } catch {
    /* ignore */
  }
}

function maybeRemind() {
  if (!enabled() || !("Notification" in window) || Notification.permission !== "granted") return;
  if (localStorage.getItem(SHOWN) === todayStr()) return; // once a day
  if (loggedToday()) return;
  const s = deriveStats();
  if (s.streakDays < 1) return; // only nudge when there's a streak to protect
  if (new Date().getHours() < 16) return; // afternoon onward
  localStorage.setItem(SHOWN, todayStr());
  notify("Keep your streak alive 🔥", `You're on a ${s.streakDays}-day streak — log a workout today to keep it going.`);
}

if (toggle) {
  toggle.checked = enabled() && window.Notification?.permission === "granted";
  toggle.addEventListener("change", async () => {
    if (toggle.checked) {
      const ok = await enable();
      toggle.checked = ok;
      if (ok) setNote("On — you'll get a nudge when you open the app and haven't logged today.");
    } else {
      localStorage.setItem(PREF, "off");
      setNote("Off.");
    }
  });
}

window.addEventListener("load", () => setTimeout(maybeRemind, 1500));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") maybeRemind();
});
