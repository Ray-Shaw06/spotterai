/**
 * SpotterAI — structured exercise knowledge layer
 * ============================================================================
 * Richer metadata than the search library (exercises.js): muscles, movement
 * pattern, joint stress, contraindications, and substitution / regression /
 * progression options. The evaluator consults this for injury contraindications
 * (falling back to keyword matching when an exercise isn't in the DB), and the
 * repair engine can borrow safer substitutions from it.
 *
 * Contraindication / jointStress keys match the evaluator's injury keys:
 *   "knee" | "lower_back" | "shoulder" | "wrist".
 */

const E = (name, o) => ({ name, secondaryMuscles: [], jointStress: [], contraindications: [], commonSubstitutions: [], regressionOptions: [], progressionOptions: [], ...o });

export const EXERCISE_DATA = [
  // --- Squat pattern -------------------------------------------------------
  E("Back Squat", { primaryMuscles: ["quads", "glutes"], secondaryMuscles: ["core", "adductors"], movementPattern: "squat", equipment: ["barbell", "rack"], difficulty: "intermediate", jointStress: ["knee", "lower_back"], contraindications: ["lower_back"], commonSubstitutions: ["Goblet Squat", "Leg Press", "Split Squat"], regressionOptions: ["Box Squat", "Goblet Squat", "Bodyweight Squat"], progressionOptions: ["Front Squat", "Paused Squat"] }),
  E("Front Squat", { primaryMuscles: ["quads"], secondaryMuscles: ["glutes", "core"], movementPattern: "squat", equipment: ["barbell", "rack"], difficulty: "advanced", jointStress: ["knee", "wrist"], contraindications: ["wrist"], commonSubstitutions: ["Goblet Squat", "Leg Press"], regressionOptions: ["Goblet Squat"], progressionOptions: ["Paused Front Squat"] }),
  E("Goblet Squat", { primaryMuscles: ["quads", "glutes"], movementPattern: "squat", equipment: ["dumbbell"], difficulty: "beginner", jointStress: ["knee"], contraindications: [], commonSubstitutions: ["Leg Press", "Box Squat"], regressionOptions: ["Box Squat", "Bodyweight Squat"], progressionOptions: ["Front Squat"] }),
  E("Leg Press", { primaryMuscles: ["quads", "glutes"], movementPattern: "squat", equipment: ["machine"], difficulty: "beginner", jointStress: ["knee"], contraindications: [], commonSubstitutions: ["Goblet Squat", "Hack Squat"], regressionOptions: ["Partial-range Leg Press"], progressionOptions: ["Back Squat"] }),
  E("Walking Lunge", { primaryMuscles: ["quads", "glutes"], movementPattern: "lunge", equipment: ["dumbbell", "bodyweight"], difficulty: "intermediate", jointStress: ["knee"], contraindications: ["knee"], commonSubstitutions: ["Split Squat", "Step-up", "Leg Press"], regressionOptions: ["Reverse Lunge", "Split Squat"], progressionOptions: ["Walking Lunge (loaded)"] }),
  E("Split Squat", { primaryMuscles: ["quads", "glutes"], movementPattern: "lunge", equipment: ["dumbbell", "bodyweight"], difficulty: "beginner", jointStress: ["knee"], contraindications: [], commonSubstitutions: ["Leg Press", "Step-up"], regressionOptions: ["Assisted Split Squat"], progressionOptions: ["Bulgarian Split Squat"] }),
  E("Step-up", { primaryMuscles: ["quads", "glutes"], movementPattern: "lunge", equipment: ["dumbbell", "bodyweight"], difficulty: "beginner", jointStress: ["knee"], contraindications: [], commonSubstitutions: ["Split Squat"], regressionOptions: ["Low-box Step-up"], progressionOptions: ["Loaded Step-up"] }),
  E("Leg Extension", { primaryMuscles: ["quads"], movementPattern: "isolation", equipment: ["machine"], difficulty: "beginner", jointStress: ["knee"], contraindications: ["knee"], commonSubstitutions: ["Leg Press", "Goblet Squat"], regressionOptions: ["Partial-range Leg Extension"], progressionOptions: [] }),
  E("Sissy Squat", { primaryMuscles: ["quads"], movementPattern: "squat", equipment: ["bodyweight"], difficulty: "advanced", jointStress: ["knee"], contraindications: ["knee"], commonSubstitutions: ["Leg Extension"], regressionOptions: ["Leg Press"], progressionOptions: [] }),
  E("Jump Squat", { primaryMuscles: ["quads", "glutes"], movementPattern: "plyometric", equipment: ["bodyweight"], difficulty: "advanced", jointStress: ["knee", "ankle"], contraindications: ["knee"], commonSubstitutions: ["Goblet Squat", "Leg Press"], regressionOptions: ["Bodyweight Squat"], progressionOptions: [] }),
  E("Box Jump", { primaryMuscles: ["quads", "glutes"], movementPattern: "plyometric", equipment: ["bodyweight"], difficulty: "advanced", jointStress: ["knee", "ankle"], contraindications: ["knee"], commonSubstitutions: ["Step-up"], regressionOptions: ["Low-box Step-up"], progressionOptions: [] }),

  // --- Hinge pattern -------------------------------------------------------
  E("Deadlift", { primaryMuscles: ["hamstrings", "glutes", "back"], secondaryMuscles: ["core"], movementPattern: "hinge", equipment: ["barbell"], difficulty: "intermediate", jointStress: ["lower_back"], contraindications: ["lower_back"], commonSubstitutions: ["Trap-Bar Deadlift", "Romanian Deadlift", "Hip Thrust"], regressionOptions: ["Rack Pull", "Romanian Deadlift from blocks"], progressionOptions: ["Deficit Deadlift"] }),
  E("Conventional Deadlift", { primaryMuscles: ["hamstrings", "glutes", "back"], movementPattern: "hinge", equipment: ["barbell"], difficulty: "intermediate", jointStress: ["lower_back"], contraindications: ["lower_back"], commonSubstitutions: ["Trap-Bar Deadlift", "Romanian Deadlift"], regressionOptions: ["Rack Pull"], progressionOptions: ["Deficit Deadlift"] }),
  E("Trap-Bar Deadlift", { primaryMuscles: ["quads", "glutes", "hamstrings"], movementPattern: "hinge", equipment: ["barbell"], difficulty: "beginner", jointStress: ["lower_back"], contraindications: [], commonSubstitutions: ["Romanian Deadlift", "Hip Thrust"], regressionOptions: ["Rack Pull"], progressionOptions: ["Conventional Deadlift"] }),
  E("Romanian Deadlift", { primaryMuscles: ["hamstrings", "glutes"], movementPattern: "hinge", equipment: ["barbell", "dumbbell"], difficulty: "intermediate", jointStress: ["lower_back"], contraindications: [], commonSubstitutions: ["Hip Thrust", "Leg Curl"], regressionOptions: ["RDL from blocks"], progressionOptions: ["Deficit RDL"] }),
  E("Good Morning", { primaryMuscles: ["hamstrings", "glutes"], movementPattern: "hinge", equipment: ["barbell"], difficulty: "advanced", jointStress: ["lower_back"], contraindications: ["lower_back"], commonSubstitutions: ["Romanian Deadlift", "Hip Thrust"], regressionOptions: ["Hip Thrust"], progressionOptions: [] }),
  E("Hip Thrust", { primaryMuscles: ["glutes"], secondaryMuscles: ["hamstrings"], movementPattern: "hinge", equipment: ["barbell"], difficulty: "beginner", jointStress: [], contraindications: [], commonSubstitutions: ["Glute Bridge"], regressionOptions: ["Glute Bridge"], progressionOptions: ["B-stance Hip Thrust"] }),
  E("Glute Bridge", { primaryMuscles: ["glutes"], movementPattern: "hinge", equipment: ["bodyweight"], difficulty: "beginner", jointStress: [], contraindications: [], commonSubstitutions: ["Hip Thrust"], regressionOptions: [], progressionOptions: ["Hip Thrust"] }),
  E("Lying Leg Curl", { primaryMuscles: ["hamstrings"], movementPattern: "isolation", equipment: ["machine"], difficulty: "beginner", jointStress: [], contraindications: [], commonSubstitutions: ["Seated Leg Curl", "Nordic Curl"], regressionOptions: [], progressionOptions: ["Nordic Curl"] }),

  // --- Horizontal / vertical press ----------------------------------------
  E("Barbell Bench Press", { primaryMuscles: ["chest"], secondaryMuscles: ["triceps", "shoulders"], movementPattern: "horizontal_push", equipment: ["barbell", "bench"], difficulty: "intermediate", jointStress: ["shoulder", "wrist"], contraindications: ["wrist"], commonSubstitutions: ["Dumbbell Bench Press", "Machine Chest Press"], regressionOptions: ["Machine Chest Press", "Push-up"], progressionOptions: ["Paused Bench Press"] }),
  E("Dumbbell Bench Press", { primaryMuscles: ["chest"], secondaryMuscles: ["triceps", "shoulders"], movementPattern: "horizontal_push", equipment: ["dumbbell", "bench"], difficulty: "beginner", jointStress: ["shoulder"], contraindications: [], commonSubstitutions: ["Machine Chest Press", "Push-up"], regressionOptions: ["Push-up"], progressionOptions: ["Barbell Bench Press"] }),
  E("Incline Dumbbell Press", { primaryMuscles: ["chest", "shoulders"], secondaryMuscles: ["triceps"], movementPattern: "horizontal_push", equipment: ["dumbbell", "bench"], difficulty: "beginner", jointStress: ["shoulder"], contraindications: [], commonSubstitutions: ["Incline Machine Press"], regressionOptions: ["Push-up"], progressionOptions: ["Incline Barbell Press"] }),
  E("Push-up", { primaryMuscles: ["chest"], secondaryMuscles: ["triceps", "core"], movementPattern: "horizontal_push", equipment: ["bodyweight"], difficulty: "beginner", jointStress: ["wrist"], contraindications: ["wrist"], commonSubstitutions: ["Machine Chest Press"], regressionOptions: ["Incline Push-up"], progressionOptions: ["Weighted Push-up"] }),
  E("Dips", { primaryMuscles: ["chest", "triceps"], movementPattern: "vertical_push", equipment: ["bodyweight"], difficulty: "intermediate", jointStress: ["shoulder"], contraindications: ["shoulder"], commonSubstitutions: ["Close-grip Press", "Machine Dip"], regressionOptions: ["Assisted Dip"], progressionOptions: ["Weighted Dip"] }),
  E("Overhead Press", { primaryMuscles: ["shoulders"], secondaryMuscles: ["triceps"], movementPattern: "vertical_push", equipment: ["barbell"], difficulty: "intermediate", jointStress: ["shoulder", "lower_back"], contraindications: ["shoulder"], commonSubstitutions: ["Dumbbell Shoulder Press", "Landmine Press"], regressionOptions: ["Seated Dumbbell Press"], progressionOptions: ["Push Press"] }),
  E("Push Press", { primaryMuscles: ["shoulders"], secondaryMuscles: ["triceps", "quads"], movementPattern: "vertical_push", equipment: ["barbell"], difficulty: "advanced", jointStress: ["shoulder"], contraindications: ["shoulder"], commonSubstitutions: ["Overhead Press"], regressionOptions: ["Overhead Press"], progressionOptions: [] }),
  E("Dumbbell Lateral Raise", { primaryMuscles: ["shoulders"], movementPattern: "isolation", equipment: ["dumbbell"], difficulty: "beginner", jointStress: ["shoulder"], contraindications: [], commonSubstitutions: ["Cable Lateral Raise"], regressionOptions: [], progressionOptions: [] }),

  // --- Pull ---------------------------------------------------------------
  E("Pull-up", { primaryMuscles: ["back"], secondaryMuscles: ["biceps"], movementPattern: "vertical_pull", equipment: ["bodyweight"], difficulty: "intermediate", jointStress: ["shoulder"], contraindications: [], commonSubstitutions: ["Lat Pulldown", "Assisted Pull-up"], regressionOptions: ["Assisted Pull-up", "Lat Pulldown"], progressionOptions: ["Weighted Pull-up"] }),
  E("Lat Pulldown", { primaryMuscles: ["back"], secondaryMuscles: ["biceps"], movementPattern: "vertical_pull", equipment: ["cable"], difficulty: "beginner", jointStress: [], contraindications: [], commonSubstitutions: ["Pull-up", "Seated Cable Row"], regressionOptions: [], progressionOptions: ["Pull-up"] }),
  E("Barbell Row", { primaryMuscles: ["back"], secondaryMuscles: ["biceps"], movementPattern: "horizontal_pull", equipment: ["barbell"], difficulty: "intermediate", jointStress: ["lower_back"], contraindications: ["lower_back"], commonSubstitutions: ["Chest-Supported Row", "Seated Cable Row"], regressionOptions: ["Chest-Supported Row"], progressionOptions: ["Pendlay Row"] }),
  E("Seated Cable Row", { primaryMuscles: ["back"], secondaryMuscles: ["biceps"], movementPattern: "horizontal_pull", equipment: ["cable"], difficulty: "beginner", jointStress: [], contraindications: [], commonSubstitutions: ["Chest-Supported Row", "Lat Pulldown"], regressionOptions: [], progressionOptions: ["Barbell Row"] }),
  E("Chest-Supported Row", { primaryMuscles: ["back"], secondaryMuscles: ["biceps"], movementPattern: "horizontal_pull", equipment: ["machine"], difficulty: "beginner", jointStress: [], contraindications: [], commonSubstitutions: ["Seated Cable Row"], regressionOptions: [], progressionOptions: ["Barbell Row"] }),
  E("Face Pull", { primaryMuscles: ["shoulders", "back"], movementPattern: "horizontal_pull", equipment: ["cable"], difficulty: "beginner", jointStress: [], contraindications: [], commonSubstitutions: ["Rear-delt Fly"], regressionOptions: [], progressionOptions: [] }),
  E("Dumbbell Curl", { primaryMuscles: ["biceps"], movementPattern: "isolation", equipment: ["dumbbell"], difficulty: "beginner", jointStress: ["wrist"], contraindications: [], commonSubstitutions: ["EZ-bar Curl", "Hammer Curl"], regressionOptions: [], progressionOptions: [] }),
  E("Hammer Curl", { primaryMuscles: ["biceps"], movementPattern: "isolation", equipment: ["dumbbell"], difficulty: "beginner", jointStress: [], contraindications: [], commonSubstitutions: ["Dumbbell Curl"], regressionOptions: [], progressionOptions: [] }),
  E("Triceps Pushdown", { primaryMuscles: ["triceps"], movementPattern: "isolation", equipment: ["cable"], difficulty: "beginner", jointStress: [], contraindications: [], commonSubstitutions: ["Overhead Triceps Extension"], regressionOptions: [], progressionOptions: [] }),
];

// ----------------------------------------------------------------------------
// Lookup (normalized + forgiving partial match)
// ----------------------------------------------------------------------------
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const INDEX = new Map();
for (const e of EXERCISE_DATA) INDEX.set(norm(e.name), e);

/** Find the structured entry for an exercise name, or null (→ keyword fallback). */
export function lookupExercise(name) {
  const n = norm(name);
  if (!n) return null;
  if (INDEX.has(n)) return INDEX.get(n);
  // forgiving: a DB key contained in the name (e.g. "Barbell Back Squat" → "back squat")
  let best = null;
  for (const [key, entry] of INDEX) {
    if (n.includes(key) && (!best || key.length > best.key.length)) best = { key, entry };
  }
  return best ? best.entry : null;
}

/** True if this exercise is contraindicated for an injury key, per the curated
 *  DB list (jointStress is informational only, so knee-friendly lifts like the
 *  leg press aren't over-flagged). */
export function isContraindicated(name, injuryKey) {
  const e = lookupExercise(name);
  return !!e && e.contraindications.includes(injuryKey);
}
