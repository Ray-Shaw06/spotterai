/**
 * SpotterAI — Food diary "Weekly check-in" (DOM wiring)
 * ============================================================================
 * Draws checkin-card.js into #nut-checkin and handles its two buttons. The decision
 * is in nutrition-adjust.js; applying goes through nutrition-checkin.js, which
 * re-checks against current data first. Nothing here changes a target on its own.
 */

import { currentCheckIn, applyProposal, dismissProposal } from "./nutrition-checkin.js";
import { checkInCardModel, checkInCardHTML, checkInAppliedModel } from "./checkin-card.js";

const host = document.getElementById("nut-checkin");
const card = document.getElementById("nut-checkin-card");

let shown = null; // the proposal currently on screen
let staleNote = false;
let applied = null; // { kcal, focus } from Apply until the user leaves the page

export function renderCheckInCard() {
  if (!host) return;
  if (applied) {
    // Right after Apply the card confirms what changed and when the next check-in is.
    host.innerHTML = checkInCardHTML(checkInAppliedModel(applied.kcal));
    if (card) card.hidden = false;
    if (applied.focus) host.querySelector("[data-checkin-heading]")?.focus?.();
    applied.focus = false;
    return;
  }
  const result = currentCheckIn();
  shown = result.status === "propose" ? result : null;
  let html = checkInCardHTML(checkInCardModel(result));
  if (html && staleNote) html += '<p class="checkin__body">Your numbers changed since this was shown, so it has been refreshed.</p>';
  staleNote = false;
  host.innerHTML = html;
  if (card) card.hidden = !html;
}

host?.addEventListener("click", (e) => {
  const act = e.target.closest("[data-checkin-act]")?.dataset.checkinAct;
  if (act === "apply") {
    // Read the new target BEFORE applying: writing the targets re-renders this card and clears `shown`.
    const toKcal = shown?.toKcal;
    const r = applyProposal(shown);
    if (!r.ok) {
      staleNote = true;
      renderCheckInCard();
    } else {
      applied = { kcal: toKcal, focus: true };
      renderCheckInCard();
    }
  } else if (act === "dismiss") {
    dismissProposal();
    renderCheckInCard();
  }
});

// Leaving the page (or switching profile) ends the confirmation; the next visit shows the real state.
for (const type of ["spotter:route", "spotter:profile"]) {
  window.addEventListener(type, () => {
    if (!applied) return;
    applied = null;
    renderCheckInCard();
  });
}
