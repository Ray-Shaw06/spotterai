/**
 * SpotterAI — first-week guided experience (pure)
 * ============================================================================
 * A gentle 7-day journey for new users: each day has a small focus + checklist,
 * and Day 7 is a Week 1 review with a conservative Week-2 suggestion. Positive
 * and realistic — it never shames a missed day. Pure + testable.
 */

// Day 0 → Day 6, then a review. `items` keys map to stat-derived booleans in the UI.
export const FIRST_WEEK_DAYS = [
  { title: "Welcome — your plan is audited", line: "Your plan passed a code-based safety audit. Take a look, then preview your first workout.", items: [{ text: "Review your plan + its safety audit", key: "hasPlan" }], cta: { label: "See today's workout", act: "today" } },
  { title: "Your first workout", line: "Keep it a touch conservative today — leave a rep or two in reserve and focus on clean form.", items: [{ text: "Complete workout 1", key: "workoutToday" }, { text: "Rate how it felt afterwards", key: "ratedToday" }], cta: { label: "Start workout", act: "workout" } },
  { title: "Recovery day", line: "Rest is part of the plan. A little easy movement, good food, and sleep are doing real work.", items: [{ text: "Log a meal or your bodyweight", key: "loggedToday" }], cta: { label: "Log nutrition", act: "nutrition" } },
  { title: "Workout 2", line: "Going well? Note your RPE, and report any niggles instead of pushing through them.", items: [{ text: "Complete workout 2", key: "workoutToday" }], cta: { label: "Start workout", act: "workout" } },
  { title: "Fuel &amp; hydrate", line: "Consistent protein and water make the training stick. No extremes — just steady habits.", items: [{ text: "Hit your protein target", key: "proteinToday" }, { text: "Drink your water", key: "waterToday" }], cta: { label: "Open nutrition", act: "nutrition" } },
  { title: "Workout 3", line: "Last session of the week. Same controlled effort — quality over heroics.", items: [{ text: "Complete this week's last workout", key: "workoutToday" }], cta: { label: "Start workout", act: "workout" } },
  { title: "Reflect", line: "Quick check-in: what felt too easy, just right, or too hard? It tunes next week.", items: [{ text: "Rate a recent workout's difficulty", key: "ratedRecently" }], cta: { label: "See progress", act: "progress" } },
];

export function dayContent(dayIndex) {
  return FIRST_WEEK_DAYS[Math.max(0, Math.min(FIRST_WEEK_DAYS.length - 1, dayIndex))];
}

/** Conservative Week-2 suggestion from this week's adherence. Never shames. */
export function weekTwoSuggestion({ sessions = 0, target = 0, painReports = 0 } = {}) {
  if (painReports > 0) return "You reported some discomfort — Week 2 eases off the affected movements and keeps intensity conservative.";
  if (!target) return "Log a couple of sessions next week and SpotterAI will start tailoring your progression.";
  const ratio = sessions / target;
  if (ratio >= 1) return "You completed every planned session — Week 2 adds a small, gradual progression (a rep or a touch of load).";
  if (ratio < 0.7) return "Life got busy — totally normal. Week 2 keeps it lighter (fewer or shorter sessions) to rebuild the rhythm.";
  return "A solid, consistent week — Week 2 repeats it and progresses gently where it felt easy.";
}

export function weekOneReview({ sessions = 0, target = 0, nutritionDays = 0, proteinTargetDays = 0, painReports = 0, streakDays = 0 } = {}) {
  return {
    workouts: sessions,
    target,
    mealsLogged: nutritionDays,
    proteinDays: proteinTargetDays,
    painReports,
    bestStreak: streakDays,
    suggestion: weekTwoSuggestion({ sessions, target, painReports }),
  };
}
