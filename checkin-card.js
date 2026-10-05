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

/** The scale is moving against the goal's direction (a cut that is gaining, a bulk that is losing). */
function wrongWay(intent, slope) {
  return (intent === "cut" && slope > 0.15) || (intent === "bulk" && slope < -0.15);
}

function trendText(slope) {
  if (Math.abs(slope) < 0.15) return "stayed about level";
  return `${slope < 0 ? "gone down" : "gone up"} about ${Math.abs(slope).toFixed(1)}% a week`;
}

/** @returns {{ kind: "propose"|"on_track"|"prompt"|"info", ... } | null} */
export function checkInCardModel(result) {
  if (!result) return null;
  if (result.status === "propose") {
    const weeks = Math.round((result.windowDays || 28) / 7);
    const pace = wrongWay(result.intent, result.slopePctPerWeek)
      ? "the opposite direction from your goal"
      : result.reason === "stalled"
        ? "slower than the usual range for this goal"
        : "faster than the usual range for this goal";
    const protein = result.proteinHeld === false ? "Protein is kept as close as the split allows" : "Protein stays the same";
    return {
      kind: "propose",
      body: `Over the last ${weeks} weeks your weight has ${trendText(result.slopePctPerWeek)}. That is ${pace}. Want to change your daily calories from ${fmt(result.fromKcal)} to ${fmt(result.toKcal)}? ${protein}, and carbs and fat adjust to fit.`,
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
  if (result.status === "inconclusive" && result.reason === "at_limit") {
    return { kind: "info", body: "Your targets are already at the edge of what SpotterAI will change on its own, so no change is suggested right now." };
  }
  if (result.status === "inconclusive" && result.reason === "target_unsafe") {
    return { kind: "info", body: "Your current calorie target is lower than SpotterAI would set on its own, so there is no check-in to offer. The safety check on this page has the details, and Your nutrition plan shows a target built from your numbers." };
  }
  return null;
}

/** What the card says right after Apply: the new target and when the next check-in can happen. */
export function checkInAppliedModel(toKcal) {
  return { kind: "applied", body: `Your calorie target is now ${fmt(toKcal)}. Your next check-in will be in about four weeks.` };
}

export function checkInCardHTML(model) {
  if (!model) return "";
  // The heading of an applied confirmation can take focus, so a keyboard user lands on it.
  const heading = model.kind === "applied" ? '<h2 class="card-title" tabindex="-1" data-checkin-heading>Weekly check-in</h2>' : '<h2 class="card-title">Weekly check-in</h2>';
  const buttons =
    model.kind === "propose"
      ? `<div class="today-card__actions">
          <button type="button" class="btn btn--primary btn--sm" data-checkin-act="apply">${esc(model.cta)}</button>
          <button type="button" class="btn btn--ghost btn--sm" data-checkin-act="dismiss">${esc(model.dismiss)}</button>
        </div>`
      : "";
  return `${heading}<p class="checkin__body">${esc(model.body)}</p>${buttons}`;
}

/** One line for Today, only when a proposal is waiting. Names no number and makes no prediction. */
export function checkInTodayLine(result) {
  return result?.status === "propose" ? "Your weekly check-in has a suggestion." : null;
}
