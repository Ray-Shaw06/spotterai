/**
 * SpotterAI — Food diary "Weekly check-in" (DOM wiring)
 * ============================================================================
 * Draws checkin-card.js into #nut-checkin and handles its two buttons. The decision
 * is in nutrition-adjust.js; applying goes through nutrition-checkin.js, which
 * re-checks against current data first. Nothing here changes a target on its own.
 */

import { currentCheckIn, applyProposal, dismissProposal } from "./nutrition-checkin.js";
import { checkInCardModel, checkInCardHTML } from "./checkin-card.js";

const host = document.getElementById("nut-checkin");
const card = document.getElementById("nut-checkin-card");

let shown = null; // the proposal currently on screen
let staleNote = false;

export function renderCheckInCard() {
  if (!host) return;
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
    const r = applyProposal(shown);
    if (!r.ok) {
      staleNote = true;
      renderCheckInCard();
    }
    // On success the store's persist event re-renders this card.
  } else if (act === "dismiss") {
    dismissProposal();
    renderCheckInCard();
  }
});
