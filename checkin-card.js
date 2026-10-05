/**
 * SpotterAI — weekly check-in card (pure view model + markup)
 * ============================================================================
 * Turns a nutrition-adjust.js result into what the Food diary and Today say.
 * No DOM access, so every string can be pinned by a test.
 *
 * TONE IS A REQUIREMENT. It reports what the scale did and what is on offer. It
 * never says a user failed, never predicts an outcome ("this will cost you X kg":
 * the dynamic response to a calorie change is slow and varies, Hall 2011), and
 * never claims research backing for the pace range: it calls it the usual range.
 * The app proposes; only the user's tap changes anything.
 */

const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fmt = (n) => Number(n).toLocaleString("en-US");

function trendText(slope) {
  if (Math.abs(slope) < 0.15) return "stayed about level";
  return `${slope < 0 ? "gone down" : "gone up"} about ${Math.abs(slope).toFixed(1)}% a week`;
}

/** @returns {{ kind: "propose"|"on_track"|"prompt"|"info", ... } | null} */
export function checkInCardModel(result) {
  if (!result) return null;
  if (result.status === "propose") {
    const weeks = Math.round((result.windowDays || 28) / 7);
    const pace = result.reason === "stalled" ? "slower than the usual range for this goal" : "faster than the usual range for this goal";
    return {
      kind: "propose",
      body: `Over the last ${weeks} weeks your weight has ${trendText(result.slopePctPerWeek)}. That is ${pace}. Want to change your daily calories from ${fmt(result.fromKcal)} to ${fmt(result.toKcal)}? Protein stays the same, and carbs and fat adjust to fit.`,
      cta: "Change my targets",
      dismiss: "Not now",
    };
  }
  if (result.status === "on_track") {
    return { kind: "on_track", body: "Your weight trend over recent weeks fits your goal. No change needed." };
  }
  if (result.status === "not_ready" && (result.reason === "few_weighins" || result.reason === "few_weekdays")) {
    return { kind: "prompt", body: "Log your weight a few times a week, on different days, and your weekly check-in can start." };
  }
  if (result.status === "inconclusive" && result.reason === "log_scale_disagree") {
    return { kind: "info", body: "Your food log and your scale are telling different stories, so there is nothing to suggest yet. The log may be missing some food. A few fully logged days will make the next check-in clearer." };
  }
  if (result.status === "inconclusive" && result.reason === "target_unsafe") {
    return { kind: "info", body: "Your current calorie target is lower than SpotterAI would set on its own, so there is no check-in to offer. The safety check on this page has the details, and Your nutrition plan shows a target built from your numbers." };
  }
  return null;
}

export function checkInCardHTML(model) {
  if (!model) return "";
  const buttons =
    model.kind === "propose"
      ? `<div class="today-card__actions">
          <button type="button" class="btn btn--primary btn--sm" data-checkin-act="apply">${esc(model.cta)}</button>
          <button type="button" class="btn btn--ghost btn--sm" data-checkin-act="dismiss">${esc(model.dismiss)}</button>
        </div>`
      : "";
  return `<h2 class="card-title">Weekly check-in</h2><p class="checkin__body">${esc(model.body)}</p>${buttons}`;
}

/** One line for Today, only when a proposal is waiting. Names no number and makes no prediction. */
export function checkInTodayLine(result) {
  return result?.status === "propose" ? "Your weekly check-in has a suggestion." : null;
}
