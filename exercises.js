/**
 * SpotterAI — Exercise library
 * ============================================================================
 * A built-in, searchable list of common exercises (name + muscle group +
 * equipment) so logging is a quick pick instead of free typing — and so we can
 * surface a "previous" reference per exercise. Users can still log a custom name.
 *
 * Kept intentionally broad-but-not-exhaustive; easy to extend.
 */

export const MUSCLES = ["Chest", "Back", "Shoulders", "Biceps", "Triceps", "Quads", "Hamstrings", "Glutes", "Calves", "Core", "Cardio", "Full body"];

// [name, muscle, equipment]
const RAW = [
  // Chest
  ["Barbell Bench Press", "Chest", "Barbell"],
  ["Incline Barbell Bench Press", "Chest", "Barbell"],
  ["Dumbbell Bench Press", "Chest", "Dumbbell"],
  ["Incline Dumbbell Press", "Chest", "Dumbbell"],
  ["Decline Bench Press", "Chest", "Barbell"],
  ["Machine Chest Press", "Chest", "Machine"],
  ["Pec Deck Fly", "Chest", "Machine"],
  ["Cable Fly", "Chest", "Cable"],
  ["Dumbbell Fly", "Chest", "Dumbbell"],
  ["Push-up", "Chest", "Bodyweight"],
  ["Dips", "Chest", "Bodyweight"],

  // Back
  ["Deadlift", "Back", "Barbell"],
  ["Conventional Deadlift", "Back", "Barbell"],
  ["Trap-Bar Deadlift", "Back", "Barbell"],
  ["Pull-up", "Back", "Bodyweight"],
  ["Chin-up", "Back", "Bodyweight"],
  ["Lat Pulldown", "Back", "Cable"],
  ["Barbell Row", "Back", "Barbell"],
  ["Pendlay Row", "Back", "Barbell"],
  ["Bent-Over Row", "Back", "Barbell"],
  ["Chest-Supported Row", "Back", "Machine"],
  ["Seated Cable Row", "Back", "Cable"],
  ["One-Arm Dumbbell Row", "Back", "Dumbbell"],
  ["T-Bar Row", "Back", "Barbell"],
  ["Face Pull", "Back", "Cable"],
  ["Straight-Arm Pulldown", "Back", "Cable"],
  ["Barbell Shrug", "Back", "Barbell"],
  ["Dumbbell Shrug", "Back", "Dumbbell"],

  // Shoulders
  ["Overhead Press", "Shoulders", "Barbell"],
  ["Standing Overhead Press", "Shoulders", "Barbell"],
  ["Seated Dumbbell Shoulder Press", "Shoulders", "Dumbbell"],
  ["Arnold Press", "Shoulders", "Dumbbell"],
  ["Machine Shoulder Press", "Shoulders", "Machine"],
  ["Dumbbell Lateral Raise", "Shoulders", "Dumbbell"],
  ["Cable Lateral Raise", "Shoulders", "Cable"],
  ["Rear Delt Fly", "Shoulders", "Dumbbell"],
  ["Reverse Pec Deck", "Shoulders", "Machine"],
  ["Front Raise", "Shoulders", "Dumbbell"],
  ["Upright Row", "Shoulders", "Barbell"],

  // Biceps
  ["Barbell Curl", "Biceps", "Barbell"],
  ["EZ-Bar Curl", "Biceps", "Barbell"],
  ["Dumbbell Curl", "Biceps", "Dumbbell"],
  ["Incline Dumbbell Curl", "Biceps", "Dumbbell"],
  ["Hammer Curl", "Biceps", "Dumbbell"],
  ["Preacher Curl", "Biceps", "Machine"],
  ["Cable Curl", "Biceps", "Cable"],
  ["Concentration Curl", "Biceps", "Dumbbell"],

  // Triceps
  ["Close-Grip Bench Press", "Triceps", "Barbell"],
  ["Triceps Rope Pushdown", "Triceps", "Cable"],
  ["Triceps Pushdown", "Triceps", "Cable"],
  ["Overhead Triceps Extension", "Triceps", "Dumbbell"],
  ["Skull Crusher", "Triceps", "Barbell"],
  ["Dumbbell Kickback", "Triceps", "Dumbbell"],
  ["Bench Dip", "Triceps", "Bodyweight"],

  // Quads
  ["Back Squat", "Quads", "Barbell"],
  ["Front Squat", "Quads", "Barbell"],
  ["Goblet Squat", "Quads", "Dumbbell"],
  ["Hack Squat", "Quads", "Machine"],
  ["Leg Press", "Quads", "Machine"],
  ["Leg Extension", "Quads", "Machine"],
  ["Bulgarian Split Squat", "Quads", "Dumbbell"],
  ["Walking Lunge", "Quads", "Dumbbell"],
  ["Reverse Lunge", "Quads", "Dumbbell"],
  ["Step-up", "Quads", "Dumbbell"],
  ["Bodyweight Squat", "Quads", "Bodyweight"],

  // Hamstrings
  ["Romanian Deadlift", "Hamstrings", "Barbell"],
  ["Stiff-Leg Deadlift", "Hamstrings", "Barbell"],
  ["Lying Leg Curl", "Hamstrings", "Machine"],
  ["Seated Leg Curl", "Hamstrings", "Machine"],
  ["Nordic Curl", "Hamstrings", "Bodyweight"],
  ["Good Morning", "Hamstrings", "Barbell"],

  // Glutes
  ["Hip Thrust", "Glutes", "Barbell"],
  ["Glute Bridge", "Glutes", "Bodyweight"],
  ["Cable Kickback", "Glutes", "Cable"],
  ["Hip Abduction", "Glutes", "Machine"],

  // Calves
  ["Standing Calf Raise", "Calves", "Machine"],
  ["Seated Calf Raise", "Calves", "Machine"],
  ["Leg Press Calf Raise", "Calves", "Machine"],

  // Core
  ["Plank", "Core", "Bodyweight"],
  ["Hanging Knee Raise", "Core", "Bodyweight"],
  ["Hanging Leg Raise", "Core", "Bodyweight"],
  ["Cable Crunch", "Core", "Cable"],
  ["Crunch", "Core", "Bodyweight"],
  ["Russian Twist", "Core", "Bodyweight"],
  ["Ab Wheel Rollout", "Core", "Bodyweight"],
  ["Dead Bug", "Core", "Bodyweight"],
  ["Pallof Press", "Core", "Cable"],

  // Cardio
  ["Treadmill Run", "Cardio", "Machine"],
  ["Incline Walk", "Cardio", "Machine"],
  ["Stationary Bike", "Cardio", "Machine"],
  ["Rowing Machine", "Cardio", "Machine"],
  ["Stair Climber", "Cardio", "Machine"],
  ["Elliptical", "Cardio", "Machine"],
  ["Jump Rope", "Cardio", "Bodyweight"],

  // Full body / Olympic
  ["Clean and Jerk", "Full body", "Barbell"],
  ["Power Clean", "Full body", "Barbell"],
  ["Snatch", "Full body", "Barbell"],
  ["Kettlebell Swing", "Full body", "Kettlebell"],
  ["Burpee", "Full body", "Bodyweight"],
  ["Thruster", "Full body", "Barbell"],
];

export const EXERCISES = RAW.map(([name, muscle, equipment]) => ({ name, muscle, equipment }));

const byName = new Map(EXERCISES.map((e) => [e.name.toLowerCase(), e]));

/** Look up an exercise's metadata by name (case-insensitive). */
export function findExercise(name) {
  return byName.get(String(name || "").toLowerCase()) || null;
}

/** Cardio/time-based exercises log time + distance rather than weight × reps. */
export function isCardio(name) {
  const e = findExercise(name);
  return e?.muscle === "Cardio";
}

/**
 * Search the library. Returns ranked matches (prefix > word-start > substring).
 * Empty query returns a sensible starter set.
 */
export function searchExercises(query, limit = 30) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return EXERCISES.slice(0, limit);
  const scored = [];
  for (const e of EXERCISES) {
    const n = e.name.toLowerCase();
    const m = e.muscle.toLowerCase();
    let score = -1;
    if (n.startsWith(q)) score = 0;
    else if (n.split(/[\s-]+/).some((w) => w.startsWith(q))) score = 1;
    else if (n.includes(q)) score = 2;
    else if (m.includes(q)) score = 3;
    if (score >= 0) scored.push({ e, score });
  }
  scored.sort((a, b) => a.score - b.score || a.e.name.localeCompare(b.e.name));
  return scored.slice(0, limit).map((s) => s.e);
}
