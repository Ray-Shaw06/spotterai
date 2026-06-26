/**
 * SpotterAI — Gamification rules (pure, no state)
 * ============================================================================
 * Ranks, XP rules, levels, and achievement definitions. Kept separate from the
 * data store so the "game design" is all in one readable place and easy to tune.
 *
 * Note: ranks here are a PERSONAL progression ladder (XP → tier), not a global
 * multiplayer leaderboard — that would need a shared backend, which this $0,
 * no-database project deliberately avoids.
 */

// ----------------------------------------------------------------------------
// XP rules
// ----------------------------------------------------------------------------
export const XP = {
  WORKOUT_BASE: 100, // every logged session
  VOLUME_DIVISOR: 200, // +1 XP per 200 units of (weight × reps) volume…
  VOLUME_CAP: 120, // …capped so a single huge session can't dominate
  NUTRITION_DAY: 30, // a day where the protein target is met
  XP_PER_LEVEL: 250, // flavor "Level N" = floor(xp / 250) + 1
};

/** XP a single workout is worth, from its computed volume. */
export function workoutXp(volume) {
  const bonus = Math.min(XP.VOLUME_CAP, Math.floor((volume || 0) / XP.VOLUME_DIVISOR));
  return XP.WORKOUT_BASE + bonus;
}

export function levelFor(totalXp) {
  return Math.floor(totalXp / XP.XP_PER_LEVEL) + 1;
}

// ----------------------------------------------------------------------------
// Rank ladder (XP thresholds). Colors are used by the rank badge.
// ----------------------------------------------------------------------------
export const RANKS = [
  { name: "Newcomer", min: 0, color: "#9aa4b2" },
  { name: "Bronze", min: 300, color: "#cd7f32" },
  { name: "Silver", min: 800, color: "#c7ccd6" },
  { name: "Gold", min: 1600, color: "#ffd24a" },
  { name: "Platinum", min: 3000, color: "#7fe3d4" },
  { name: "Diamond", min: 5000, color: "#6b8fa3" },
  { name: "Champion", min: 8000, color: "#22a883" },
];

/** Resolve XP → current tier, next tier, and progress toward it. */
export function rankFor(totalXp) {
  let index = 0;
  for (let i = 0; i < RANKS.length; i++) if (totalXp >= RANKS[i].min) index = i;
  const tier = RANKS[index];
  const next = RANKS[index + 1] || null;
  const span = next ? next.min - tier.min : 1;
  const progress = next ? (totalXp - tier.min) / span : 1;
  return {
    tier,
    index,
    next,
    progress: Math.max(0, Math.min(1, progress)),
    xpForNext: next ? Math.max(0, next.min - totalXp) : 0,
  };
}

// ----------------------------------------------------------------------------
// Achievements — each `test(stats)` reads the derived stats from tracker-store.
// ----------------------------------------------------------------------------
export const ACHIEVEMENTS = [
  { id: "first", name: "First Steps", desc: "Log your first workout", icon: "flag", xp: 50, test: (s) => s.workoutCount >= 1 },
  { id: "streak3", name: "Warming Up", desc: "Reach a 3-day streak", icon: "flame", xp: 75, test: (s) => s.streakDays >= 3 },
  { id: "streak7", name: "On Fire", desc: "Reach a 7-day streak", icon: "flame", xp: 150, test: (s) => s.streakDays >= 7 },
  { id: "workouts10", name: "Committed", desc: "Log 10 workouts", icon: "dumbbell", xp: 150, test: (s) => s.workoutCount >= 10 },
  { id: "workouts25", name: "Iron Will", desc: "Log 25 workouts", icon: "dumbbell", xp: 300, test: (s) => s.workoutCount >= 25 },
  { id: "volume", name: "Heavy Lifter", desc: "5,000+ volume in one session", icon: "bolt", xp: 120, test: (s) => s.maxSessionVolume >= 5000 },
  { id: "week", name: "Full Week", desc: "Hit your weekly workout target", icon: "calendar", xp: 120, test: (s) => s.thisWeek.sessions >= s.thisWeek.target && s.thisWeek.target > 0 },
  { id: "nutrition1", name: "Fueled", desc: "Log nutrition for a day", icon: "apple", xp: 40, test: (s) => s.nutritionDays >= 1 },
  { id: "protein5", name: "Macro Master", desc: "Hit your protein target 5 days", icon: "apple", xp: 120, test: (s) => s.proteinTargetDays >= 5 },
  { id: "weigh", name: "Tracking Progress", desc: "Log your bodyweight", icon: "chart", xp: 40, test: (s) => s.bodyweightCount >= 1 },
];

/** Sum XP awarded by the currently-unlocked achievement ids. */
export function achievementXp(unlockedIds) {
  const set = new Set(unlockedIds || []);
  return ACHIEVEMENTS.reduce((sum, a) => sum + (set.has(a.id) ? a.xp : 0), 0);
}
