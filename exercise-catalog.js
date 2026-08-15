/**
 * SpotterAI — canonical exercise catalog (T4)
 * ============================================================================
 * ONE table and ONE matcher for exercise identity.
 *
 * Before this file, resolving a name went through three functions with three
 * different semantics, over two tables that had drifted apart:
 *
 *   searchExercises   token AND + prefix        184 entries, no safety data
 *   findExercise      exact lowercase Map hit   ^ same table
 *   lookupExercise    O(n) substring scan       84 entries, safety data only
 *
 * So you could search "bench press", find it, log it, and then have the app
 * fail to recognise the same lift for your previous-set reference and for its
 * own contraindication check. 109 searchable lifts had no safety metadata; 9
 * lifts had safety metadata while being unsearchable; and the repair engine
 * recommended 28 substitutions that resolved to nothing at all.
 *
 * Everything now resolves through `resolveExercise`. `exercises.js` and
 * `exercise-data.js` are thin projections of this table and keep their old
 * public shapes, so no consumer had to change.
 *
 *   exercise-metadata.js ──┐
 *                          ├──> exercise-catalog.js ──> exercises.js
 *   BASE (below) ──────────┘            │               exercise-data.js
 *                                       │
 *                        normalize → alias → singular → squash → subset
 *                                       │
 *                                  one answer, or null
 *
 * Adding a lift: add a BASE tuple. Adding safety data: add an
 * exercise-metadata.js entry with the SAME canonical name. Tests assert the
 * two never drift apart again, and that every substitution the app can emit
 * resolves to something loggable.
 */

import { EXERCISE_METADATA } from "./exercise-metadata.js";

export const MUSCLES = ["Chest", "Back", "Shoulders", "Biceps", "Triceps", "Quads", "Hamstrings", "Glutes", "Calves", "Core", "Cardio", "Full body"];

// ---------------------------------------------------------------------------
// Normalization — the one shared primitive. Idempotent by construction.
// ---------------------------------------------------------------------------
/** Lowercase, punctuation to spaces, collapse runs, trim. */
export function normalizeExerciseName(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Normalized with spaces removed, so "pushup" and "push-up" compare equal. */
const squash = (value) => normalizeExerciseName(value).replace(/ /g, "");

/** Strip a plural "s" so "curls" matches "curl". Leaves "-ss" and short words. */
function singularize(token) {
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

const tokensOf = (value) => normalizeExerciseName(value).split(" ").filter(Boolean);
const singularTokens = (value) => tokensOf(value).map(singularize);
const singularKey = (value) => singularTokens(value).join(" ");

// ---------------------------------------------------------------------------
// Aliases — what a lift gets called that is not its canonical name.
//
// Three sources: gym shorthand people actually type, the naming variants that
// had drifted between the two old tables, and the phrasings the safety layer
// emits in its substitution lists. Keys are matched after normalization.
// ---------------------------------------------------------------------------
const ALIASES = {
  // Gym shorthand
  "bench press": "Barbell Bench Press",
  bench: "Barbell Bench Press",
  bp: "Barbell Bench Press",
  "flat bench": "Barbell Bench Press",
  "barbell bench": "Barbell Bench Press",
  "incline bench": "Incline Barbell Bench Press",
  "db bench": "Dumbbell Bench Press",
  "dumbbell bench": "Dumbbell Bench Press",
  squat: "Back Squat",
  "barbell squat": "Back Squat",
  ohp: "Overhead Press",
  "military press": "Overhead Press",
  rdl: "Romanian Deadlift",
  sldl: "Stiff-Leg Deadlift",
  "stiff leg deadlift": "Stiff-Leg Deadlift",
  bss: "Bulgarian Split Squat",
  "bulgarian split": "Bulgarian Split Squat",
  pulldown: "Lat Pulldown",
  "lat pull down": "Lat Pulldown",
  "lateral raise": "Dumbbell Lateral Raise",
  "side raise": "Dumbbell Lateral Raise",
  "side lateral raise": "Dumbbell Lateral Raise",
  pendlay: "Pendlay Row",
  "t bar": "T-Bar Row",
  gm: "Good Morning",
  ghr: "Glute-Ham Raise",
  "gh raise": "Glute-Ham Raise",
  "ab wheel": "Ab Wheel Rollout",
  "hip thruster": "Hip Thrust",
  "calf raise": "Standing Calf Raise",
  "leg raise": "Hanging Leg Raise",
  "21s": "Twenty-One Curl",
  "21 s": "Twenty-One Curl",
  "ski": "Ski Erg",
  "reverse hyper": "Reverse Hyperextension",
  "back ext": "Back Extension",
  "abduction": "Hip Abduction",
  "adduction": "Hip Adduction",

  // Naming variants that had drifted between the two old tables
  skullcrusher: "Skull Crusher",
  skullcrushers: "Skull Crusher",
  "pec deck": "Pec Deck Fly",
  "triceps kickback": "Dumbbell Kickback",
  "tricep kickback": "Dumbbell Kickback",
  "dumbbell shoulder press": "Seated Dumbbell Shoulder Press",
  "db shoulder press": "Seated Dumbbell Shoulder Press",

  // Phrasings the safety layer emits in its substitution lists
  dip: "Dips",
  "close grip press": "Close-Grip Bench Press",
  "incline barbell press": "Incline Barbell Bench Press",
  "leg curl": "Lying Leg Curl",
  pullover: "Cable Pullover",
  "seated dumbbell press": "Seated Dumbbell Shoulder Press",
  "rdl from blocks": "Romanian Deadlift from Blocks",
  "walking lunge loaded": "Walking Lunge",
};

// ---------------------------------------------------------------------------
// Base list — every searchable lift. [name, muscle, equipment]
// `muscle` is one of MUSCLES; `equipment` is the single-word display label.
// ---------------------------------------------------------------------------
const BASE = [
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

  // --- Extended library ---
  // Chest
  ["Incline Cable Fly", "Chest", "Cable"],
  ["Machine Fly", "Chest", "Machine"],
  ["Floor Press", "Chest", "Barbell"],
  ["Svend Press", "Chest", "Plate"],
  ["Smith Machine Bench Press", "Chest", "Machine"],
  ["Weighted Dip", "Chest", "Bodyweight"],
  ["Push-up (Deficit)", "Chest", "Bodyweight"],
  // Back
  ["Single-Arm Lat Pulldown", "Back", "Cable"],
  ["Meadows Row", "Back", "Barbell"],
  ["Kroc Row", "Back", "Dumbbell"],
  ["Inverted Row", "Back", "Bodyweight"],
  ["Machine Row", "Back", "Machine"],
  ["Wide-Grip Pull-up", "Back", "Bodyweight"],
  ["Neutral-Grip Pulldown", "Back", "Cable"],
  ["Cable Pullover", "Back", "Cable"],
  ["Snatch-Grip Deadlift", "Back", "Barbell"],
  ["Deficit Deadlift", "Back", "Barbell"],
  // Shoulders
  ["Landmine Press", "Shoulders", "Barbell"],
  ["Machine Lateral Raise", "Shoulders", "Machine"],
  ["Cable Rear Delt Fly", "Shoulders", "Cable"],
  ["Cable Front Raise", "Shoulders", "Cable"],
  ["Seated Barbell Press", "Shoulders", "Barbell"],
  ["Behind-the-Neck Press", "Shoulders", "Barbell"],
  ["Lu Raise", "Shoulders", "Dumbbell"],
  // Biceps
  ["Cable Hammer Curl", "Biceps", "Cable"],
  ["Spider Curl", "Biceps", "Dumbbell"],
  ["Reverse Curl", "Biceps", "Barbell"],
  ["Drag Curl", "Biceps", "Barbell"],
  ["Zottman Curl", "Biceps", "Dumbbell"],
  ["Bayesian Cable Curl", "Biceps", "Cable"],
  // Triceps
  ["JM Press", "Triceps", "Barbell"],
  ["Cable Overhead Extension", "Triceps", "Cable"],
  ["Diamond Push-up", "Triceps", "Bodyweight"],
  ["Machine Dip", "Triceps", "Machine"],
  ["Single-Arm Pushdown", "Triceps", "Cable"],
  ["Tate Press", "Triceps", "Dumbbell"],
  // Quads / legs
  ["Box Squat", "Quads", "Barbell"],
  ["Belt Squat", "Quads", "Machine"],
  ["Pendulum Squat", "Quads", "Machine"],
  ["Smith Machine Squat", "Quads", "Machine"],
  ["Zercher Squat", "Quads", "Barbell"],
  ["Pistol Squat", "Quads", "Bodyweight"],
  ["Curtsy Lunge", "Quads", "Dumbbell"],
  ["Sissy Squat", "Quads", "Bodyweight"],
  ["Single-Leg Leg Press", "Quads", "Machine"],
  ["Jump Squat", "Quads", "Bodyweight"],
  // Hamstrings / glutes
  ["Single-Leg Romanian Deadlift", "Hamstrings", "Dumbbell"],
  ["Glute-Ham Raise", "Hamstrings", "Bodyweight"],
  ["Cable Pull-Through", "Glutes", "Cable"],
  ["Glute Kickback Machine", "Glutes", "Machine"],
  ["Frog Pump", "Glutes", "Bodyweight"],
  ["Hip Adduction", "Quads", "Machine"],
  ["Reverse Hyperextension", "Glutes", "Machine"],
  ["Back Extension", "Hamstrings", "Machine"],
  // Calves
  ["Donkey Calf Raise", "Calves", "Machine"],
  ["Single-Leg Calf Raise", "Calves", "Bodyweight"],
  // Core
  ["Cable Woodchopper", "Core", "Cable"],
  ["Side Plank", "Core", "Bodyweight"],
  ["Bicycle Crunch", "Core", "Bodyweight"],
  ["V-up", "Core", "Bodyweight"],
  ["Decline Sit-up", "Core", "Bodyweight"],
  ["Flutter Kick", "Core", "Bodyweight"],
  ["Toes-to-Bar", "Core", "Bodyweight"],
  ["Reverse Crunch", "Core", "Bodyweight"],
  ["Hanging Windshield Wiper", "Core", "Bodyweight"],
  // Cardio
  ["Jog", "Cardio", "Bodyweight"],
  ["Sprint", "Cardio", "Bodyweight"],
  ["Walking", "Cardio", "Bodyweight"],
  ["Hiking", "Cardio", "Bodyweight"],
  ["Swimming", "Cardio", "Bodyweight"],
  ["Cycling (outdoor)", "Cardio", "Bodyweight"],
  ["HIIT Circuit", "Cardio", "Bodyweight"],
  ["Assault Bike", "Cardio", "Machine"],
  // Full body / functional
  ["Kettlebell Clean", "Full body", "Kettlebell"],
  ["Kettlebell Snatch", "Full body", "Kettlebell"],
  ["Turkish Get-up", "Full body", "Kettlebell"],
  ["Wall Ball", "Full body", "Medicine ball"],
  ["Box Jump", "Full body", "Bodyweight"],
  ["Battle Ropes", "Full body", "Cardio"],
  ["Sled Push", "Full body", "Sled"],
  ["Farmer's Carry", "Full body", "Dumbbell"],
  ["Devil Press", "Full body", "Dumbbell"],
  ["Man Maker", "Full body", "Dumbbell"],
  ["Clean and Press", "Full body", "Barbell"],

  // --- Variants the safety layer already recommends -------------------------
  // Added in T4. Before this, `commonSubstitutions`, `regressionOptions`, and
  // `progressionOptions` emitted 28 names that resolved to nothing, so the app
  // could tell you to swap in a safer lift you could not find or log.
  ["Split Squat", "Quads", "Dumbbell"],
  ["Assisted Split Squat", "Quads", "Bodyweight"],
  ["Push Press", "Shoulders", "Barbell"],
  ["Rack Pull", "Back", "Barbell"],
  ["Assisted Pull-up", "Back", "Machine"],
  ["Assisted Chin-up", "Back", "Machine"],
  ["Assisted Dip", "Chest", "Machine"],
  ["B-stance Hip Thrust", "Glutes", "Barbell"],
  ["Deficit RDL", "Hamstrings", "Barbell"],
  ["Romanian Deadlift from Blocks", "Hamstrings", "Barbell"],
  ["Incline Machine Press", "Chest", "Machine"],
  ["Incline Push-up", "Chest", "Bodyweight"],
  ["Knee Plank", "Core", "Bodyweight"],
  ["Weighted Plank", "Core", "Bodyweight"],
  ["Lying Leg Raise", "Core", "Bodyweight"],
  ["Low-box Step-up", "Quads", "Bodyweight"],
  ["Loaded Step-up", "Quads", "Dumbbell"],
  ["Partial-range Leg Extension", "Quads", "Machine"],
  ["Partial-range Leg Press", "Quads", "Machine"],
  ["Paused Squat", "Quads", "Barbell"],
  ["Paused Front Squat", "Quads", "Barbell"],
  ["Paused Bench Press", "Chest", "Barbell"],
  ["Weighted Pull-up", "Back", "Bodyweight"],
  ["Weighted Chin-up", "Back", "Bodyweight"],
  ["Weighted Push-up", "Chest", "Bodyweight"],

  // --- Coverage expansion --------------------------------------------------
  // Added once the matcher was unified. Growing the table before that would
  // have multiplied near-miss collisions rather than improving recognition.
  // Chest
  ["Low Cable Fly", "Chest", "Cable"],
  ["High Cable Fly", "Chest", "Cable"],
  ["Incline Dumbbell Fly", "Chest", "Dumbbell"],
  ["Decline Dumbbell Press", "Chest", "Dumbbell"],
  ["Landmine Chest Press", "Chest", "Barbell"],
  ["Larsen Press", "Chest", "Barbell"],
  ["Plate Pinch Press", "Chest", "Plate"],
  ["Incline Machine Fly", "Chest", "Machine"],
  ["Ring Push-up", "Chest", "Bodyweight"],
  ["Archer Push-up", "Chest", "Bodyweight"],
  // Back
  ["Seal Row", "Back", "Barbell"],
  ["Chest-Supported T-Bar Row", "Back", "Machine"],
  ["Gorilla Row", "Back", "Kettlebell"],
  ["Renegade Row", "Back", "Dumbbell"],
  ["Dumbbell Pullover", "Back", "Dumbbell"],
  ["Reverse-Grip Pulldown", "Back", "Cable"],
  ["Seated Machine Row", "Back", "Machine"],
  ["Deadstop Row", "Back", "Barbell"],
  ["Half-Kneeling Lat Pulldown", "Back", "Cable"],
  ["Rack Chin", "Back", "Bodyweight"],
  ["Snatch-Grip Row", "Back", "Barbell"],
  ["Banded Pull-Apart", "Back", "Band"],
  // Shoulders
  ["Z Press", "Shoulders", "Barbell"],
  ["Bradford Press", "Shoulders", "Barbell"],
  ["Viking Press", "Shoulders", "Machine"],
  ["Cable Upright Row", "Shoulders", "Cable"],
  ["Egyptian Lateral Raise", "Shoulders", "Cable"],
  ["Leaning Lateral Raise", "Shoulders", "Dumbbell"],
  ["Rear Delt Row", "Shoulders", "Barbell"],
  ["Plate Front Raise", "Shoulders", "Plate"],
  ["Cuban Press", "Shoulders", "Dumbbell"],
  ["Scott Press", "Shoulders", "Dumbbell"],
  ["Half-Kneeling Landmine Press", "Shoulders", "Barbell"],
  ["Seated Machine Lateral Raise", "Shoulders", "Machine"],
  // Biceps
  ["Cable Preacher Curl", "Biceps", "Cable"],
  ["Incline Hammer Curl", "Biceps", "Dumbbell"],
  ["Cross-Body Hammer Curl", "Biceps", "Dumbbell"],
  ["Machine Preacher Curl", "Biceps", "Machine"],
  ["Waiter Curl", "Biceps", "Dumbbell"],
  ["Reverse EZ-Bar Curl", "Biceps", "Barbell"],
  ["Twenty-One Curl", "Biceps", "Barbell"],
  ["Seated Dumbbell Curl", "Biceps", "Dumbbell"],
  // Triceps
  ["Cable Triceps Kickback", "Triceps", "Cable"],
  ["Rope Overhead Extension", "Triceps", "Cable"],
  ["Katana Extension", "Triceps", "Cable"],
  ["Board Press", "Triceps", "Barbell"],
  ["Floor Skull Crusher", "Triceps", "Barbell"],
  ["Reverse-Grip Pushdown", "Triceps", "Cable"],
  ["California Press", "Triceps", "Barbell"],
  ["Bench Skull Crusher", "Triceps", "Dumbbell"],
  // Quads
  ["Front-Foot-Elevated Split Squat", "Quads", "Dumbbell"],
  ["Cyclist Squat", "Quads", "Barbell"],
  ["Heels-Elevated Goblet Squat", "Quads", "Dumbbell"],
  ["Landmine Squat", "Quads", "Barbell"],
  ["Safety Bar Squat", "Quads", "Barbell"],
  ["Wall Sit", "Quads", "Bodyweight"],
  ["Reverse Nordic Curl", "Quads", "Bodyweight"],
  ["Lateral Lunge", "Quads", "Dumbbell"],
  ["Front Rack Reverse Lunge", "Quads", "Barbell"],
  ["Deficit Reverse Lunge", "Quads", "Dumbbell"],
  // Hamstrings
  ["Standing Leg Curl", "Hamstrings", "Machine"],
  ["Single-Leg Leg Curl", "Hamstrings", "Machine"],
  ["Razor Curl", "Hamstrings", "Bodyweight"],
  ["45-Degree Back Extension", "Hamstrings", "Machine"],
  ["Snatch-Grip Romanian Deadlift", "Hamstrings", "Barbell"],
  ["Kettlebell Romanian Deadlift", "Hamstrings", "Kettlebell"],
  ["Slider Leg Curl", "Hamstrings", "Bodyweight"],
  // Glutes
  ["Barbell Glute Bridge", "Glutes", "Barbell"],
  ["Single-Leg Hip Thrust", "Glutes", "Bodyweight"],
  ["Cable Hip Abduction", "Glutes", "Cable"],
  ["Banded Hip Thrust", "Glutes", "Band"],
  ["Kas Glute Bridge", "Glutes", "Barbell"],
  ["Machine Hip Thrust", "Glutes", "Machine"],
  ["Standing Cable Kickback", "Glutes", "Cable"],
  ["Seated Hip Abduction", "Glutes", "Machine"],
  // Calves
  ["Smith Machine Calf Raise", "Calves", "Machine"],
  ["Tibialis Raise", "Calves", "Bodyweight"],
  ["Dumbbell Calf Raise", "Calves", "Dumbbell"],
  ["Leg Press Toe Press", "Calves", "Machine"],
  ["Jump Rope Calf Bounce", "Calves", "Bodyweight"],
  // Core
  ["Hollow Body Hold", "Core", "Bodyweight"],
  ["Copenhagen Plank", "Core", "Bodyweight"],
  ["Weighted Sit-up", "Core", "Plate"],
  ["Dragon Flag", "Core", "Bodyweight"],
  ["L-Sit", "Core", "Bodyweight"],
  ["Suitcase Carry", "Core", "Dumbbell"],
  ["Landmine Twist", "Core", "Barbell"],
  ["GHD Sit-up", "Core", "Machine"],
  ["Bird Dog", "Core", "Bodyweight"],
  ["Stir the Pot", "Core", "Bodyweight"],
  ["Banded Anti-Rotation Hold", "Core", "Band"],
  // Cardio
  ["Ski Erg", "Cardio", "Machine"],
  ["Sled Drag", "Cardio", "Sled"],
  ["Shadow Boxing", "Cardio", "Bodyweight"],
  ["Incline Treadmill Run", "Cardio", "Machine"],
  ["Rucking", "Cardio", "Bodyweight"],
  ["Box Step-up Cardio", "Cardio", "Bodyweight"],
  // Full body
  ["Hang Clean", "Full body", "Barbell"],
  ["Push Jerk", "Full body", "Barbell"],
  ["Split Jerk", "Full body", "Barbell"],
  ["Overhead Squat", "Full body", "Barbell"],
  ["Bear Crawl", "Full body", "Bodyweight"],
  ["Sandbag Carry", "Full body", "Sled"],
  ["Dumbbell Snatch", "Full body", "Dumbbell"],
  ["Clean Pull", "Full body", "Barbell"],
  ["Medicine Ball Slam", "Full body", "Medicine ball"],
  ["Dead Hang", "Back", "Bodyweight"],
];

// ---------------------------------------------------------------------------
// Merge: base list + curated metadata -> one catalog.
// ---------------------------------------------------------------------------
// Fallback equipment tags for lifts with no curated metadata entry. Keeps the
// equipment-fit check meaningful for the whole catalog rather than only the
// curated slice.
const TAGS_FOR_LABEL = {
  Barbell: ["barbell"],
  Dumbbell: ["dumbbell"],
  Machine: ["machine"],
  Cable: ["cable"],
  Bodyweight: ["bodyweight"],
  Band: ["band"],
  Kettlebell: ["kettlebell"],
  Plate: ["plate"],
  Sled: ["sled"],
  "Medicine ball": ["medicine ball"],
  Cardio: ["machine"],
};

/** A name that is an alias resolves to the canonical it points at. */
function canonicalNameOf(name) {
  return ALIASES[normalizeExerciseName(name)] ?? name;
}

// Curated metadata, keyed by the CANONICAL name it belongs to. Metadata authored
// under a drifted name (e.g. "Skullcrusher") lands on its canonical entry
// ("Skull Crusher") instead of creating a second, unsearchable lift.
const METADATA_BY_KEY = new Map();
for (const meta of EXERCISE_METADATA) {
  const key = normalizeExerciseName(canonicalNameOf(meta.name));
  if (!METADATA_BY_KEY.has(key)) METADATA_BY_KEY.set(key, meta);
}

// Aliases grouped by target, so an entry can list what it answers to.
const ALIASES_BY_TARGET = new Map();
for (const [alias, target] of Object.entries(ALIASES)) {
  const key = normalizeExerciseName(target);
  if (!ALIASES_BY_TARGET.has(key)) ALIASES_BY_TARGET.set(key, []);
  ALIASES_BY_TARGET.get(key).push(alias);
}

/**
 * The canonical catalog. One entry per lift, carrying both the searchable
 * fields and the curated safety fields when they exist.
 *
 * `hasSafetyData` is load-bearing: the evaluator falls back to keyword matching
 * when a lift has no curated entry, so a lift must NOT appear to have empty
 * contraindications when the truth is that nobody has assessed it yet.
 */
export const CATALOG = BASE.map(([name, muscle, equipment]) => {
  const key = normalizeExerciseName(name);
  const meta = METADATA_BY_KEY.get(key);
  return {
    name,
    muscle,
    equipment,
    aliases: ALIASES_BY_TARGET.get(key) ?? [],
    hasSafetyData: Boolean(meta),
    primaryMuscles: meta?.primaryMuscles ?? [],
    secondaryMuscles: meta?.secondaryMuscles ?? [],
    movementPattern: meta?.movementPattern ?? null,
    difficulty: meta?.difficulty ?? null,
    equipmentTags: meta?.equipment ?? TAGS_FOR_LABEL[equipment] ?? ["bodyweight"],
    jointStress: meta?.jointStress ?? [],
    contraindications: meta?.contraindications ?? [],
    commonSubstitutions: meta?.commonSubstitutions ?? [],
    regressionOptions: meta?.regressionOptions ?? [],
    progressionOptions: meta?.progressionOptions ?? [],
  };
});

/** Curated metadata that matched no catalog entry. Must stay empty. */
export const ORPHANED_METADATA = EXERCISE_METADATA
  .map((m) => m.name)
  .filter((n) => !CATALOG.some((e) => normalizeExerciseName(e.name) === normalizeExerciseName(canonicalNameOf(n))));

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------
const BY_NORM = new Map();
const BY_SQUASH = new Map();
const BY_SINGULAR = new Map();
for (const entry of CATALOG) {
  BY_NORM.set(normalizeExerciseName(entry.name), entry);
  BY_SQUASH.set(squash(entry.name), entry);
  BY_SINGULAR.set(singularKey(entry.name), entry);
}

const ALIAS_TO_ENTRY = new Map();
const ALIAS_SINGULAR = new Map();
const ALIAS_SQUASH = new Map();
for (const [alias, target] of Object.entries(ALIASES)) {
  const entry = BY_NORM.get(normalizeExerciseName(target));
  if (!entry) continue; // an alias pointing at nothing is caught by tests
  ALIAS_TO_ENTRY.set(normalizeExerciseName(alias), entry);
  ALIAS_SINGULAR.set(singularKey(alias), entry);
  ALIAS_SQUASH.set(squash(alias), entry);
}

/** Aliases that point at a lift the catalog does not contain. Must stay empty. */
export const DANGLING_ALIASES = Object.entries(ALIASES)
  .filter(([, target]) => !BY_NORM.has(normalizeExerciseName(target)))
  .map(([alias, target]) => `${alias} -> ${target}`);

// Token-subset candidates, precomputed once.
const SUBSET_CANDIDATES = CATALOG.map((entry) => ({
  entry,
  tokens: new Set(singularTokens(entry.name)),
}));

// ---------------------------------------------------------------------------
// Resolution — the single matcher.
// ---------------------------------------------------------------------------
/**
 * Resolve a free-typed name to exactly one catalog entry, or null.
 *
 * Order, cheapest and most certain first:
 *   1. exact canonical name
 *   2. exact alias
 *   3. singular form of either ("hammer curls" -> "Hammer Curl")
 *   4. spacing-insensitive form ("pushup" -> "Push-up")
 *   5. longest canonical whose words are all present in the query
 *      ("Barbell Back Squat" -> "Back Squat")
 *
 * Returns null rather than guessing. An ambiguous token like "curl" resolves to
 * nothing on purpose: search offers the options, resolution does not pick one.
 */
export function resolveExercise(name) {
  const norm = normalizeExerciseName(name);
  if (!norm) return null;

  const exact = BY_NORM.get(norm) ?? ALIAS_TO_ENTRY.get(norm);
  if (exact) return exact;

  const singular = singularKey(norm);
  const bySingular = BY_SINGULAR.get(singular) ?? ALIAS_SINGULAR.get(singular) ?? BY_NORM.get(singular) ?? ALIAS_TO_ENTRY.get(singular);
  if (bySingular) return bySingular;

  const flat = squash(norm);
  const byFlat = BY_SQUASH.get(flat) ?? ALIAS_SQUASH.get(flat);
  if (byFlat) return byFlat;

  // Longest canonical fully contained in what was typed. Token shorthand is
  // expanded first, so "incline db press" reaches "Incline Dumbbell Press"
  // rather than failing on the literal token "db".
  const queryTokens = new Set(expandAbbrev(singularTokens(norm)));
  let best = null;
  let bestSize = 0;
  let tied = false;
  for (const { entry, tokens } of SUBSET_CANDIDATES) {
    if (tokens.size < 2 || tokens.size <= bestSize - 1) continue;
    let contained = true;
    for (const token of tokens) {
      if (!queryTokens.has(token)) { contained = false; break; }
    }
    if (!contained) continue;
    if (tokens.size > bestSize) { best = entry; bestSize = tokens.size; tied = false; }
    else if (tokens.size === bestSize && entry !== best) tied = true;
  }
  return tied ? null : best;
}

// ---------------------------------------------------------------------------
// Search — ranked, forgiving, for pickers.
// ---------------------------------------------------------------------------
// Shorthand expanded at the TOKEN level (as opposed to whole-name ALIASES).
// Only unambiguous fragments: none is a prefix of a real exercise word.
const ABBREV = {
  db: ["dumbbell"],
  bb: ["barbell"],
  kb: ["kettlebell"],
  bw: ["bodyweight"],
  ohp: ["overhead", "press"],
  rdl: ["romanian", "deadlift"],
  sldl: ["stiff", "leg", "deadlift"],
  bp: ["bench", "press"],
  cg: ["close", "grip"],
  bss: ["bulgarian", "split", "squat"],
};

function expandAbbrev(tokens) {
  const out = [];
  for (const token of tokens) out.push(...(ABBREV[token] ?? [token]));
  return out;
}

/** Does haystack word `w` match query token `q`? Prefix either direction. */
function wordMatch(w, q) {
  return w === q || w.startsWith(q) || (q.startsWith(w) && w.length >= 3);
}

/**
 * Rank catalog entries against a free-typed query. Every typed word must match
 * somewhere in the name, muscle, equipment, or an alias.
 * Ranked: full-name prefix > name-word match > anywhere.
 */
export function searchCatalog(query, limit = 30, extra = []) {
  const pool = extra?.length ? dedupeByName([...extra, ...CATALOG]) : CATALOG;
  const q = normalizeExerciseName(query);
  if (!q) return pool.slice(0, limit);
  const queryTokens = expandAbbrev(singularTokens(q));

  // If the query resolves to exactly one lift, that lift is the top hit. Without
  // this, "bench press" ranks "Paused Bench Press" above "Barbell Bench Press"
  // purely because the name is a character shorter.
  const resolved = resolveExercise(q);

  const scored = [];
  for (const entry of pool) {
    const name = normalizeExerciseName(entry.name);
    const nameWords = singularTokens(entry.name);
    const allWords = [
      ...nameWords,
      ...singularTokens(entry.muscle ?? ""),
      ...singularTokens(entry.equipment ?? ""),
      ...(entry.aliases ?? []).flatMap(singularTokens),
    ];
    const isResolved = resolved && entry === resolved;
    if (!isResolved && !queryTokens.every((qt) => allWords.some((w) => wordMatch(w, qt)))) continue;
    let score = 2;
    if (isResolved) score = -1;
    else if (name.startsWith(q)) score = 0;
    else if (queryTokens.every((qt) => nameWords.some((w) => wordMatch(w, qt)))) score = 1;
    scored.push({ entry, score });
  }
  scored.sort((a, b) => a.score - b.score || a.entry.name.length - b.entry.name.length || a.entry.name.localeCompare(b.entry.name));
  return scored.slice(0, limit).map((s) => s.entry);
}

function dedupeByName(list) {
  const seen = new Set();
  const out = [];
  for (const entry of list) {
    const key = normalizeExerciseName(entry.name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Time-based work
// ---------------------------------------------------------------------------
// Isometric holds and loaded carries are prescribed in SECONDS, not reps. The
// plan schema already allows it (`reps` accepts "30s", and the evaluator parses
// time holds), but anything generating a prescription had been defaulting every
// exercise to "8-12" — so the coach could add a Plank as "3 x 8-12 @ RPE 8",
// which is not a thing.
//
// This is an explicit list rather than a name pattern on purpose: matching
// /hold|sit|hang/ sweeps up Hanging Leg Raise, GHD Sit-up and Hang Clean, which
// are all rep-based.
const TIME_BASED = new Set([
  "Plank",
  "Side Plank",
  "Knee Plank",
  "Weighted Plank",
  "Copenhagen Plank",
  "Hollow Body Hold",
  "L-Sit",
  "Wall Sit",
  "Banded Anti-Rotation Hold",
  "Stir the Pot",
  "Farmer's Carry",
  "Suitcase Carry",
  "Sandbag Carry",
  "Bear Crawl",
  "Sled Push",
  "Sled Drag",
  "Battle Ropes",
  "Dead Hang",
].map((n) => normalizeExerciseName(n)));

/**
 * True when this exercise is prescribed and logged in time rather than reps.
 * Cardio is separate: it carries its own time + distance handling.
 */
export const TIME_BASED_NOT_IN_CATALOG = [...TIME_BASED].filter(
  (key) => !CATALOG.some((e) => normalizeExerciseName(e.name) === key)
);

export function isTimeBasedExercise(name) {
  const entry = resolveExercise(name);
  return entry ? TIME_BASED.has(normalizeExerciseName(entry.name)) : false;
}

/** Cardio lifts log time + distance rather than weight x reps. */
export function isCardioExercise(name) {
  return resolveExercise(name)?.muscle === "Cardio";
}
