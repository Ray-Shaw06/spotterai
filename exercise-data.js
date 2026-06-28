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

  // --- Chest (more) --------------------------------------------------------
  E("Incline Barbell Bench Press", { primaryMuscles: ["chest", "shoulders"], secondaryMuscles: ["triceps"], movementPattern: "horizontal_push", equipment: ["barbell", "bench"], difficulty: "intermediate", jointStress: ["shoulder", "wrist"], contraindications: ["wrist"], commonSubstitutions: ["Incline Dumbbell Press"], regressionOptions: ["Incline Machine Press"], progressionOptions: [] }),
  E("Decline Bench Press", { primaryMuscles: ["chest"], secondaryMuscles: ["triceps"], movementPattern: "horizontal_push", equipment: ["barbell", "bench"], difficulty: "intermediate", jointStress: ["shoulder"], contraindications: [], commonSubstitutions: ["Dip", "Machine Chest Press"], regressionOptions: [], progressionOptions: [] }),
  E("Machine Chest Press", { primaryMuscles: ["chest"], secondaryMuscles: ["triceps", "shoulders"], movementPattern: "horizontal_push", equipment: ["machine"], difficulty: "beginner", jointStress: [], contraindications: [], commonSubstitutions: ["Dumbbell Bench Press"], regressionOptions: [], progressionOptions: ["Barbell Bench Press"] }),
  E("Cable Fly", { primaryMuscles: ["chest"], movementPattern: "isolation", equipment: ["cable"], difficulty: "beginner", jointStress: ["shoulder"], contraindications: [], commonSubstitutions: ["Pec Deck", "Dumbbell Fly"], regressionOptions: [], progressionOptions: [] }),
  E("Dumbbell Fly", { primaryMuscles: ["chest"], movementPattern: "isolation", equipment: ["dumbbell"], difficulty: "beginner", jointStress: ["shoulder"], contraindications: ["shoulder"], commonSubstitutions: ["Cable Fly", "Pec Deck"], regressionOptions: [], progressionOptions: [] }),
  E("Pec Deck", { primaryMuscles: ["chest"], movementPattern: "isolation", equipment: ["machine"], difficulty: "beginner", jointStress: [], contraindications: [], commonSubstitutions: ["Cable Fly"], regressionOptions: [], progressionOptions: [] }),

  // --- Back (more) ---------------------------------------------------------
  E("Pendlay Row", { primaryMuscles: ["back"], secondaryMuscles: ["biceps"], movementPattern: "horizontal_pull", equipment: ["barbell"], difficulty: "advanced", jointStress: ["lower_back"], contraindications: ["lower_back"], commonSubstitutions: ["Chest-Supported Row"], regressionOptions: ["Chest-Supported Row"], progressionOptions: [] }),
  E("Bent-Over Row", { primaryMuscles: ["back"], secondaryMuscles: ["biceps"], movementPattern: "horizontal_pull", equipment: ["barbell"], difficulty: "intermediate", jointStress: ["lower_back"], contraindications: ["lower_back"], commonSubstitutions: ["Chest-Supported Row", "Seated Cable Row"], regressionOptions: ["Chest-Supported Row"], progressionOptions: [] }),
  E("T-Bar Row", { primaryMuscles: ["back"], secondaryMuscles: ["biceps"], movementPattern: "horizontal_pull", equipment: ["barbell"], difficulty: "intermediate", jointStress: ["lower_back"], contraindications: ["lower_back"], commonSubstitutions: ["Chest-Supported Row"], regressionOptions: ["Chest-Supported Row"], progressionOptions: [] }),
  E("One-Arm Dumbbell Row", { primaryMuscles: ["back"], secondaryMuscles: ["biceps"], movementPattern: "horizontal_pull", equipment: ["dumbbell"], difficulty: "beginner", jointStress: [], contraindications: [], commonSubstitutions: ["Seated Cable Row"], regressionOptions: [], progressionOptions: [] }),
  E("Chin-up", { primaryMuscles: ["back", "biceps"], movementPattern: "vertical_pull", equipment: ["bodyweight"], difficulty: "intermediate", jointStress: ["shoulder", "wrist"], contraindications: [], commonSubstitutions: ["Lat Pulldown", "Assisted Chin-up"], regressionOptions: ["Assisted Chin-up", "Lat Pulldown"], progressionOptions: ["Weighted Chin-up"] }),
  E("Straight-Arm Pulldown", { primaryMuscles: ["back"], movementPattern: "isolation", equipment: ["cable"], difficulty: "beginner", jointStress: [], contraindications: [], commonSubstitutions: ["Pullover"], regressionOptions: [], progressionOptions: [] }),
  E("Barbell Shrug", { primaryMuscles: ["back"], movementPattern: "isolation", equipment: ["barbell"], difficulty: "beginner", jointStress: [], contraindications: [], commonSubstitutions: ["Dumbbell Shrug"], regressionOptions: [], progressionOptions: [] }),
  E("Rack Pull", { primaryMuscles: ["back", "hamstrings"], secondaryMuscles: ["glutes"], movementPattern: "hinge", equipment: ["barbell"], difficulty: "intermediate", jointStress: ["lower_back"], contraindications: [], commonSubstitutions: ["Trap-Bar Deadlift"], regressionOptions: [], progressionOptions: ["Deadlift"] }),

  // --- Shoulders (more) ----------------------------------------------------
  E("Dumbbell Shoulder Press", { primaryMuscles: ["shoulders"], secondaryMuscles: ["triceps"], movementPattern: "vertical_push", equipment: ["dumbbell"], difficulty: "beginner", jointStress: ["shoulder"], contraindications: [], commonSubstitutions: ["Overhead Press", "Machine Shoulder Press"], regressionOptions: ["Seated Dumbbell Press"], progressionOptions: ["Overhead Press"] }),
  E("Arnold Press", { primaryMuscles: ["shoulders"], secondaryMuscles: ["triceps"], movementPattern: "vertical_push", equipment: ["dumbbell"], difficulty: "intermediate", jointStress: ["shoulder"], contraindications: ["shoulder"], commonSubstitutions: ["Dumbbell Shoulder Press"], regressionOptions: [], progressionOptions: [] }),
  E("Cable Lateral Raise", { primaryMuscles: ["shoulders"], movementPattern: "isolation", equipment: ["cable"], difficulty: "beginner", jointStress: [], contraindications: [], commonSubstitutions: ["Dumbbell Lateral Raise"], regressionOptions: [], progressionOptions: [] }),
  E("Rear-Delt Fly", { primaryMuscles: ["shoulders", "back"], movementPattern: "isolation", equipment: ["dumbbell"], difficulty: "beginner", jointStress: [], contraindications: [], commonSubstitutions: ["Face Pull"], regressionOptions: [], progressionOptions: [] }),
  E("Front Raise", { primaryMuscles: ["shoulders"], movementPattern: "isolation", equipment: ["dumbbell"], difficulty: "beginner", jointStress: ["shoulder"], contraindications: [], commonSubstitutions: ["Cable Front Raise"], regressionOptions: [], progressionOptions: [] }),
  E("Upright Row", { primaryMuscles: ["shoulders"], secondaryMuscles: ["biceps"], movementPattern: "vertical_pull", equipment: ["barbell"], difficulty: "intermediate", jointStress: ["shoulder", "wrist"], contraindications: ["shoulder"], commonSubstitutions: ["Cable Lateral Raise"], regressionOptions: [], progressionOptions: [] }),

  // --- Arms (more) ---------------------------------------------------------
  E("EZ-Bar Curl", { primaryMuscles: ["biceps"], movementPattern: "isolation", equipment: ["barbell"], difficulty: "beginner", jointStress: ["wrist"], contraindications: [], commonSubstitutions: ["Dumbbell Curl"], regressionOptions: [], progressionOptions: [] }),
  E("Barbell Curl", { primaryMuscles: ["biceps"], movementPattern: "isolation", equipment: ["barbell"], difficulty: "beginner", jointStress: ["wrist"], contraindications: ["wrist"], commonSubstitutions: ["EZ-Bar Curl", "Dumbbell Curl"], regressionOptions: [], progressionOptions: [] }),
  E("Preacher Curl", { primaryMuscles: ["biceps"], movementPattern: "isolation", equipment: ["machine"], difficulty: "beginner", jointStress: ["wrist"], contraindications: [], commonSubstitutions: ["Dumbbell Curl"], regressionOptions: [], progressionOptions: [] }),
  E("Cable Curl", { primaryMuscles: ["biceps"], movementPattern: "isolation", equipment: ["cable"], difficulty: "beginner", jointStress: [], contraindications: [], commonSubstitutions: ["Dumbbell Curl"], regressionOptions: [], progressionOptions: [] }),
  E("Skullcrusher", { primaryMuscles: ["triceps"], movementPattern: "isolation", equipment: ["barbell"], difficulty: "intermediate", jointStress: ["elbow", "wrist"], contraindications: [], commonSubstitutions: ["Overhead Triceps Extension", "Triceps Pushdown"], regressionOptions: [], progressionOptions: [] }),
  E("Overhead Triceps Extension", { primaryMuscles: ["triceps"], movementPattern: "isolation", equipment: ["dumbbell"], difficulty: "beginner", jointStress: ["shoulder"], contraindications: [], commonSubstitutions: ["Triceps Pushdown"], regressionOptions: [], progressionOptions: [] }),
  E("Close-Grip Bench Press", { primaryMuscles: ["triceps", "chest"], movementPattern: "horizontal_push", equipment: ["barbell", "bench"], difficulty: "intermediate", jointStress: ["wrist", "shoulder"], contraindications: ["wrist"], commonSubstitutions: ["Dip", "Triceps Pushdown"], regressionOptions: [], progressionOptions: [] }),
  E("Triceps Kickback", { primaryMuscles: ["triceps"], movementPattern: "isolation", equipment: ["dumbbell"], difficulty: "beginner", jointStress: [], contraindications: [], commonSubstitutions: ["Triceps Pushdown"], regressionOptions: [], progressionOptions: [] }),

  // --- Legs (more) ---------------------------------------------------------
  E("Hack Squat", { primaryMuscles: ["quads"], secondaryMuscles: ["glutes"], movementPattern: "squat", equipment: ["machine"], difficulty: "intermediate", jointStress: ["knee"], contraindications: [], commonSubstitutions: ["Leg Press", "Back Squat"], regressionOptions: ["Leg Press"], progressionOptions: [] }),
  E("Bulgarian Split Squat", { primaryMuscles: ["quads", "glutes"], movementPattern: "lunge", equipment: ["dumbbell"], difficulty: "intermediate", jointStress: ["knee"], contraindications: [], commonSubstitutions: ["Split Squat", "Leg Press"], regressionOptions: ["Split Squat"], progressionOptions: [] }),
  E("Reverse Lunge", { primaryMuscles: ["quads", "glutes"], movementPattern: "lunge", equipment: ["dumbbell", "bodyweight"], difficulty: "beginner", jointStress: ["knee"], contraindications: [], commonSubstitutions: ["Split Squat", "Step-up"], regressionOptions: ["Split Squat"], progressionOptions: ["Walking Lunge"] }),
  E("Seated Leg Curl", { primaryMuscles: ["hamstrings"], movementPattern: "isolation", equipment: ["machine"], difficulty: "beginner", jointStress: [], contraindications: [], commonSubstitutions: ["Lying Leg Curl", "Nordic Curl"], regressionOptions: [], progressionOptions: ["Nordic Curl"] }),
  E("Nordic Curl", { primaryMuscles: ["hamstrings"], movementPattern: "isolation", equipment: ["bodyweight"], difficulty: "advanced", jointStress: [], contraindications: [], commonSubstitutions: ["Lying Leg Curl"], regressionOptions: ["Lying Leg Curl"], progressionOptions: [] }),
  E("Hip Abduction", { primaryMuscles: ["glutes"], movementPattern: "isolation", equipment: ["machine"], difficulty: "beginner", jointStress: [], contraindications: [], commonSubstitutions: ["Cable Kickback"], regressionOptions: [], progressionOptions: [] }),
  E("Standing Calf Raise", { primaryMuscles: ["calves"], movementPattern: "isolation", equipment: ["machine"], difficulty: "beginner", jointStress: ["ankle"], contraindications: [], commonSubstitutions: ["Seated Calf Raise"], regressionOptions: [], progressionOptions: [] }),
  E("Seated Calf Raise", { primaryMuscles: ["calves"], movementPattern: "isolation", equipment: ["machine"], difficulty: "beginner", jointStress: [], contraindications: [], commonSubstitutions: ["Standing Calf Raise"], regressionOptions: [], progressionOptions: [] }),

  // --- Core ----------------------------------------------------------------
  E("Plank", { primaryMuscles: ["core"], movementPattern: "isometric", equipment: ["bodyweight"], difficulty: "beginner", jointStress: [], contraindications: [], commonSubstitutions: ["Dead Bug"], regressionOptions: ["Knee Plank"], progressionOptions: ["Weighted Plank"] }),
  E("Hanging Leg Raise", { primaryMuscles: ["core"], movementPattern: "isolation", equipment: ["bodyweight"], difficulty: "intermediate", jointStress: ["shoulder"], contraindications: [], commonSubstitutions: ["Lying Leg Raise", "Cable Crunch"], regressionOptions: ["Lying Leg Raise"], progressionOptions: [] }),
  E("Cable Crunch", { primaryMuscles: ["core"], movementPattern: "isolation", equipment: ["cable"], difficulty: "beginner", jointStress: [], contraindications: [], commonSubstitutions: ["Crunch"], regressionOptions: [], progressionOptions: [] }),
  E("Ab Wheel Rollout", { primaryMuscles: ["core"], movementPattern: "isolation", equipment: ["bodyweight"], difficulty: "advanced", jointStress: ["lower_back"], contraindications: ["lower_back"], commonSubstitutions: ["Plank"], regressionOptions: ["Plank"], progressionOptions: [] }),
  E("Russian Twist", { primaryMuscles: ["core"], movementPattern: "isolation", equipment: ["bodyweight"], difficulty: "beginner", jointStress: ["lower_back"], contraindications: [], commonSubstitutions: ["Pallof Press"], regressionOptions: [], progressionOptions: [] }),
  E("Pallof Press", { primaryMuscles: ["core"], movementPattern: "isometric", equipment: ["cable"], difficulty: "beginner", jointStress: [], contraindications: [], commonSubstitutions: ["Plank"], regressionOptions: [], progressionOptions: [] }),
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

// The ten muscle groups the evaluator scores volume against.
const VOLUME_GROUPS = new Set(["chest", "back", "shoulders", "biceps", "triceps", "quads", "hamstrings", "glutes", "calves", "core"]);

/**
 * Per-set volume contribution for an exercise, by muscle group: a working set
 * counts 1.0 toward each primary mover and 0.5 toward each secondary (the
 * standard "direct vs indirect" convention) — far more accurate than counting a
 * full set toward every keyword-matched group. Returns null when the exercise
 * isn't in the DB (→ the evaluator falls back to keyword matching).
 */
export function volumeContribution(name) {
  const e = lookupExercise(name);
  if (!e) return null;
  const out = {};
  for (const m of e.primaryMuscles || []) if (VOLUME_GROUPS.has(m)) out[m] = (out[m] || 0) + 1;
  for (const m of e.secondaryMuscles || []) if (VOLUME_GROUPS.has(m)) out[m] = (out[m] || 0) + 0.5;
  return out;
}
