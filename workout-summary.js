/**
 * SpotterAI — post-workout completion summary (pure)
 * ============================================================================
 * Builds the data for the "workout complete" screen from the saved workout +
 * the user's prior PRs + any pain reported today. Conservative + recovery-
 * positive: it celebrates effort and PRs and points to the next sensible action,
 * and deliberately does NOT estimate calories burned.
 */

export const DIFFICULTY_LABEL = { easy: "Too easy", just_right: "Just right", hard: "Too hard" };

export const NEXT_ACTION = {
  easy: "It felt easy — add a little load or a rep or two next time, gradually.",
  just_right: "Right in the zone — repeat it, and progress a little when it starts to feel easy.",
  hard: "That was tough — keep the load the same (or ease off slightly) next time and focus on clean reps.",
  default: "Tell SpotterAI how it felt next time so it can tune your progression.",
};

export function buildWorkoutSummary({ workout = {}, priorPRs = {}, painToday = [] } = {}) {
  const exercises = workout.exercises || [];
  const prs = [];
  for (const e of exercises) {
    const top = (e.sets || []).reduce((m, s) => Math.max(m, Number(s.weight) || 0), 0);
    if (top > 0 && top > (Number(priorPRs[e.name]) || 0)) prs.push({ name: e.name, weight: top });
  }
  const diff = workout.difficulty || null;
  return {
    name: workout.name || "Workout",
    durationSec: workout.durationSec || 0,
    exerciseCount: exercises.length,
    setCount: exercises.reduce((n, e) => n + (e.sets || []).length, 0),
    volume: workout.volume || 0,
    xp: workout.xp || 0,
    prs,
    difficulty: diff,
    difficultyLabel: diff ? DIFFICULTY_LABEL[diff] : null,
    nextAction: NEXT_ACTION[diff] || NEXT_ACTION.default,
    painFlag: painToday.length > 0,
    recoveryNudge: "Refuel with some protein and water, and get good sleep before your next session.",
  };
}
