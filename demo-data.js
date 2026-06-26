/**
 * SpotterAI — one-click demo data
 * ============================================================================
 * Seeds a throwaway "Demo" profile with a few weeks of realistic training so a
 * first-time visitor sees the whole app populated — gamified dashboard, charts,
 * nutrition, a saved plan, and (crucially) enough logged history that the
 * adaptive coach loop has something to adapt FROM on the very first click.
 *
 * It writes through the normal store mutations (so XP, volume, streaks and
 * achievements compute exactly as they would in real use) into an ISOLATED
 * profile, so a visitor's own profiles are never touched.
 */

import { createProfile, listProfiles, signIn } from "./profile-store.js";
import { addBodyweight, addNutrition, addWater, addWorkout, resetAll, setTargets } from "./tracker-store.js";
import { setPlan } from "./store.js";

// ----------------------------------------------------------------------------
// Date helper
// ----------------------------------------------------------------------------
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const round = (v) => Math.round(v * 10) / 10;

// ----------------------------------------------------------------------------
// Training templates (kg). Each lift: start weight, per-week increment, sets, reps.
// Progressive overload across the weeks gives real PRs + a clear adapt signal.
// ----------------------------------------------------------------------------
const UPPER = [
  { name: "Barbell Bench Press", muscle: "Chest", start: 60, inc: 2.5, sets: 4, reps: 6 },
  { name: "One-Arm Dumbbell Row", muscle: "Back", start: 28, inc: 1, sets: 4, reps: 10 },
  { name: "Overhead Press", muscle: "Shoulders", start: 35, inc: 1, sets: 3, reps: 8 },
  { name: "Lat Pulldown", muscle: "Back", start: 50, inc: 2, sets: 3, reps: 10 },
  { name: "Dumbbell Curl", muscle: "Biceps", start: 14, inc: 0.5, sets: 3, reps: 12 },
  { name: "Triceps Rope Pushdown", muscle: "Triceps", start: 25, inc: 1, sets: 3, reps: 12 },
];
const LOWER = [
  { name: "Back Squat", muscle: "Quads", start: 80, inc: 5, sets: 4, reps: 5 },
  { name: "Romanian Deadlift", muscle: "Hamstrings", start: 70, inc: 2.5, sets: 3, reps: 8 },
  { name: "Leg Press", muscle: "Quads", start: 140, inc: 5, sets: 3, reps: 10 },
  { name: "Lying Leg Curl", muscle: "Hamstrings", start: 35, inc: 1.5, sets: 3, reps: 12 },
  { name: "Standing Calf Raise", muscle: "Calves", start: 60, inc: 2, sets: 4, reps: 12 },
];

function session(label, template, prog, date) {
  const exercises = template.map((ex) => {
    const weight = round(ex.start + ex.inc * prog);
    const sets = Array.from({ length: ex.sets }, (_, i) => ({
      weight,
      reps: ex.reps - (i === ex.sets - 1 ? 1 : 0), // last set a touch shy
      done: true,
    }));
    return { name: ex.name, muscle: ex.muscle, sets };
  });
  return { name: label, exercises, date };
}

// One typical eating day (~2175 kcal, ~155 g protein — beats the protein target).
const DAY_MEALS = [
  { meal: "breakfast", name: "Oats & whey shake", kcal: 430, protein: 38, carbs: 55, fat: 9 },
  { meal: "breakfast", name: "Banana", kcal: 105, protein: 1, carbs: 27, fat: 0 },
  { meal: "lunch", name: "Chicken, rice & veg", kcal: 620, protein: 48, carbs: 70, fat: 14 },
  { meal: "dinner", name: "Salmon, potatoes & salad", kcal: 640, protein: 42, carbs: 48, fat: 28 },
  { meal: "snacks", name: "Greek yogurt & berries", kcal: 210, protein: 20, carbs: 18, fat: 4 },
  { meal: "snacks", name: "Almonds (30g)", kcal: 170, protein: 6, carbs: 6, fat: 15 },
];

// ----------------------------------------------------------------------------
// The demo plan (matches the logged split, so "adapt" + "start from plan" cohere)
// ----------------------------------------------------------------------------
const DEMO_INPUTS = {
  goal: "Hypertrophy",
  experience: "Intermediate",
  daysPerWeek: 4,
  sessionLength: 60,
  equipment: ["Barbell", "Dumbbell", "Machine", "Cable"],
  injuries: [],
  injuryNotes: "",
};

const DEMO_PLAN = {
  program_name: "Upper / Lower Hypertrophy",
  goal: "Hypertrophy",
  days_per_week: 4,
  days: [
    {
      day: "Day 1", focus: "Upper Body",
      exercises: [
        { name: "Barbell Bench Press", sets: 4, reps: "6-8", rpe: 8, notes: "Add weight when you hit 4×8." },
        { name: "One-Arm Dumbbell Row", sets: 4, reps: "10-12", rpe: 8, notes: "" },
        { name: "Overhead Press", sets: 3, reps: "8-10", rpe: 8, notes: "" },
        { name: "Lat Pulldown", sets: 3, reps: "10-12", rpe: 9, notes: "" },
        { name: "Dumbbell Curl", sets: 3, reps: "12-15", rpe: 9, notes: "" },
        { name: "Triceps Rope Pushdown", sets: 3, reps: "12-15", rpe: 9, notes: "" },
      ],
    },
    {
      day: "Day 2", focus: "Lower Body",
      exercises: [
        { name: "Back Squat", sets: 4, reps: "5-6", rpe: 8, notes: "Brace hard; depth to parallel." },
        { name: "Romanian Deadlift", sets: 3, reps: "8-10", rpe: 8, notes: "Feel the hamstring stretch." },
        { name: "Leg Press", sets: 3, reps: "10-12", rpe: 9, notes: "" },
        { name: "Lying Leg Curl", sets: 3, reps: "12-15", rpe: 9, notes: "" },
        { name: "Standing Calf Raise", sets: 4, reps: "12-15", rpe: 9, notes: "Pause at the bottom." },
      ],
    },
    {
      day: "Day 3", focus: "Upper Body",
      exercises: [
        { name: "Incline Dumbbell Press", sets: 4, reps: "8-10", rpe: 8, notes: "" },
        { name: "Seated Cable Row", sets: 4, reps: "10-12", rpe: 8, notes: "" },
        { name: "Dumbbell Lateral Raise", sets: 4, reps: "12-15", rpe: 9, notes: "" },
        { name: "Pull-up", sets: 3, reps: "AMRAP", rpe: 9, notes: "Add load once you clear 10." },
        { name: "Hammer Curl", sets: 3, reps: "12-15", rpe: 9, notes: "" },
        { name: "Overhead Triceps Extension", sets: 3, reps: "12-15", rpe: 9, notes: "" },
      ],
    },
    {
      day: "Day 4", focus: "Lower Body",
      exercises: [
        { name: "Front Squat", sets: 3, reps: "6-8", rpe: 8, notes: "" },
        { name: "Hip Thrust", sets: 3, reps: "8-10", rpe: 8, notes: "" },
        { name: "Walking Lunge", sets: 3, reps: "10-12", rpe: 8, notes: "Per leg." },
        { name: "Seated Leg Curl", sets: 3, reps: "12-15", rpe: 9, notes: "" },
        { name: "Seated Calf Raise", sets: 4, reps: "15-20", rpe: 9, notes: "" },
      ],
    },
  ],
  progression: "Add a small amount of load whenever you hit the top of the rep range on all sets. Deload every 5-6 weeks by cutting volume ~40%.",
  general_notes: "Warm up each first lift with 2-3 ramping sets. Keep 1-2 reps in reserve on isolation work. Prioritize sleep and ~1.6-2.2 g/kg protein.",
};

// ----------------------------------------------------------------------------
// Seed
// ----------------------------------------------------------------------------
async function ensureDemoProfile() {
  const existing = listProfiles().find((p) => p.name === "Demo");
  if (existing) await signIn(existing.id);
  else await createProfile("Demo");
  resetAll(); // clean slate, so re-running the demo doesn't pile up
}

/** Create/refresh the Demo profile and fill it with a few weeks of activity. */
export async function seedDemo() {
  await ensureDemoProfile();

  setTargets({ kcal: 2300, protein: 150, carbs: 240, fat: 75, weeklyWorkouts: 4, waterMl: 3000 });

  // ~6 weeks of Upper/Lower, 4 days/week, with progressive overload.
  const WEEKS = 6;
  for (let w = WEEKS - 1; w >= 0; w--) {
    const prog = WEEKS - 1 - w; // 0 (oldest) … 5 (this week, heaviest)
    const plan = [
      [0, "Upper A", UPPER],
      [1, "Lower A", LOWER],
      [3, "Upper B", UPPER],
      [4, "Lower B", LOWER],
    ];
    for (const [dayOffset, label, tmpl] of plan) {
      addWorkout(session(label, tmpl, prog, daysAgo(w * 7 + dayOffset)));
    }
  }

  // Nutrition: full days for the past week+, plus a partial day today.
  for (let d = 8; d >= 1; d--) {
    for (const m of DAY_MEALS) addNutrition({ ...m, date: daysAgo(d) });
  }
  for (const m of DAY_MEALS.slice(0, 3)) addNutrition({ ...m, date: daysAgo(0) }); // today: still eating

  // Bodyweight: a gentle downward trend over the block.
  for (const [off, val] of [[40, 82.0], [33, 81.6], [26, 81.3], [19, 81.0], [12, 80.6], [7, 80.4], [3, 80.2], [0, 80.0]]) {
    addBodyweight({ value: val, date: daysAgo(off) });
  }

  addWater(1500); // today

  // A saved plan to match — so the adaptive loop + "start from plan" are live.
  setPlan(DEMO_PLAN, DEMO_INPUTS);
}
