/**
 * SpotterAI — weekly check-in, wired to the store
 * ============================================================================
 * Gathers the inputs nutrition-adjust.js needs, and applies or turns down what it
 * proposes. The decision is pure and lives there; this file only reads state and
 * writes the one thing the user approved.
 */

import { store } from "./store.js";
import { bodyweightSeries, dateDaysAgo, getBodyStats, getState, getTargetsChangedOn, nutritionDaySummaries, setTargets } from "./tracker-store.js";
import { checkIn } from "./nutrition-adjust.js";
import { handledCheckIn, markCheckInHandled } from "./checkin-card.js";

/** The check-in for right now, from the real stored data. */
export function currentCheckIn(today = dateDaysAgo(0)) {
  const state = getState();
  return checkIn({
    series: bodyweightSeries(),
    days: nutritionDaySummaries(),
    targets: state.targets,
    bodyStats: getBodyStats(),
    trainingAge: store.inputs?.experience || "",
    unit: state.unit,
    today,
    targetsChangedOn: getTargetsChangedOn(),
    lastProposalOn: handledCheckIn(),
  });
}

/**
 * Apply a proposal the user approved. The check-in is run again against the data as
 * it is NOW: if the targets, stats or weigh-ins moved since the card was drawn, the
 * old proposal no longer describes this person and nothing is written.
 */
export function applyProposal(proposal, today = dateDaysAgo(0)) {
  if (!proposal || proposal.status !== "propose") return { ok: false, reason: "stale" };
  const now = currentCheckIn(today);
  if (now.status !== "propose" || now.fromKcal !== proposal.fromKcal || now.toKcal !== proposal.toKcal) return { ok: false, reason: "stale" };
  setTargets(now.targets);
  markCheckInHandled(today);
  return { ok: true };
}

/** "Not now": the same 28-day quiet period, no target changed. */
export function dismissProposal(today = dateDaysAgo(0)) {
  markCheckInHandled(today);
}
