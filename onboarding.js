/**
 * SpotterAI — guided onboarding (pure config + mapping)
 * ============================================================================
 * A coach-style intake collected over a few short steps, then mapped onto the
 * SAME inputs the plan generator already uses (goal / experience / days /
 * session / equipment / injuries / notes) plus profile data that feeds nutrition
 * targets and adaptation. Pure + dependency-light so the mapping is testable.
 */

export const GOAL_OPTIONS = [
  { value: "muscle", label: "Build muscle", goal: "Hypertrophy" },
  { value: "strength", label: "Get stronger", goal: "Strength" },
  { value: "fatloss", label: "Lose fat", goal: "Fat loss" },
  { value: "general", label: "General fitness", goal: "General" },
  { value: "consistency", label: "Return to consistency", goal: "General" },
];

export const TRAINING_AGE_OPTIONS = [
  { value: "new", label: "New (under a year)", experience: "Beginner" },
  { value: "some", label: "1–3 years", experience: "Intermediate" },
  { value: "experienced", label: "3+ years", experience: "Advanced" },
];

export const EQUIPMENT_OPTIONS = ["Full gym", "Dumbbells", "Barbell", "Bodyweight", "Bands"];
export const AGE_RANGES = ["Under 18", "18–29", "30–44", "45–59", "60+"];
export const SESSION_LENGTHS = [30, 45, 60, 90];
export const DAYS_OPTIONS = [2, 3, 4, 5, 6];
export const CARDIO_PREFS = ["None", "A little", "Lots"];
export const INTENSITY_PREFS = ["Easy", "Moderate", "Hard"];
export const COACHING_STYLES = ["Gentle", "Balanced", "Direct"];

// Pain/injury areas — those that map to an evaluator injury key become a limitation.
export const SAFETY_AREAS = [
  { value: "knee", label: "Knee", injuryKey: "knee" },
  { value: "lower_back", label: "Lower back", injuryKey: "lower_back" },
  { value: "shoulder", label: "Shoulder", injuryKey: "shoulder" },
  { value: "wrist", label: "Wrist", injuryKey: "wrist" },
  { value: "hip", label: "Hip", injuryKey: null },
  { value: "ankle", label: "Ankle", injuryKey: null },
  { value: "neck", label: "Neck", injuryKey: null },
];
const INJURY_KEYS = new Set(SAFETY_AREAS.filter((a) => a.injuryKey).map((a) => a.injuryKey));

export const ONBOARDING_STEPS = ["Goal", "About you", "Schedule", "Safety", "Preferences"];

/** Map the collected intake onto the generator's input shape. */
export function mapOnboardingToInputs(d = {}) {
  const goalOpt = GOAL_OPTIONS.find((g) => g.value === d.goal);
  const ageOpt = TRAINING_AGE_OPTIONS.find((a) => a.value === d.trainingAge);

  const injuries = (d.safetyAreas || []).filter((a) => INJURY_KEYS.has(a));
  const notes = [];
  if ((d.avoid || "").trim()) notes.push(d.avoid.trim());
  const unmapped = (d.safetyAreas || []).filter((a) => !INJURY_KEYS.has(a));
  if (unmapped.length) notes.push(`Take care of: ${unmapped.join(", ")}.`);
  if (d.currentPain === "yes") notes.push("Has current discomfort; keep intensity conservative.");
  if (d.goal === "consistency") notes.push("Returning to consistency; start conservative and build the habit.");
  if ((d.dislikes || "").trim()) notes.push(`Dislikes: ${d.dislikes.trim()}.`);

  // Two classes of field here, and the difference matters.
  //
  // `goal`, `daysPerWeek` and `sessionLength` shape the GENERATOR only; no
  // evaluator check reads them, so a default costs nothing and keeps generation
  // unblocked.
  //
  // `experience` and `equipment` are read by the AUDIT (checkBeginnerLoad,
  // checkEquipmentFit). Defaulting those turns a question the user skipped into
  // an answer we assert back at them: before this, skipping the intake produced
  // "14 exercises exceed RPE 8, which is aggressive for a beginner" for someone
  // who never said they were a beginner. They stay blank so the evaluator can
  // report them as not-assessed, which is the honest answer and the whole point
  // of that tier (v1.3.0).
  //
  // The generator loses nothing: api/generate.js buildPrompt already applies
  // `inputs.experience || "Beginner"` and falls back to "bodyweight only" when
  // equipment is empty. The conservative default lives where it belongs, at the
  // point of use, instead of being baked in upstream where it destroys the
  // distinction between "bodyweight" and "we never asked".
  return {
    goal: goalOpt ? goalOpt.goal : "General",
    experience: ageOpt ? ageOpt.experience : "",
    daysPerWeek: Number(d.days) || 3,
    sessionLength: Number(d.sessionLength) || 45,
    equipment: d.equipment && d.equipment.length ? d.equipment : [],
    injuries,
    injuryNotes: notes.join(" ").trim(),
  };
}

/** Bodyweight in kg (for nutrition targets), from the collected weight + units. */
export { bodyweightKg } from "./measurements.js";
