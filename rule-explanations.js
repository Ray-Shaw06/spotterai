/**
 * SpotterAI — plain-English "why this rule exists" explanations
 * ============================================================================
 * One source of truth for the evaluator's rules, used by the Safety Lab
 * (RuleExplanationCard list) and by the audit flags ("Why this rule exists").
 * Keyed so a check id maps to its rule via ruleForCheck().
 */

export const RULE_EXPLANATIONS = [
  {
    id: "rest_days",
    name: "Recovery & rest days",
    checks: "Whether the week leaves at least one full rest or active-recovery day.",
    why: "Muscle, connective tissue, and the nervous system adapt during recovery — not just during training. Zero rest days raises injury and burnout risk.",
    action: "Flags 6–7 training days; in repair, converts a training day to active recovery.",
    limitations: "It can't see your sleep, stress, age, or how hard each session actually is.",
  },
  {
    id: "weekly_volume",
    name: "Weekly volume",
    checks: "Estimated hard sets per muscle group per week — too much (junk volume) or too little for the goal.",
    why: "There's a productive range of sets per muscle. Far above it adds fatigue and injury risk without extra benefit; far below it under-stimulates progress.",
    action: "Flags very high or low volume; in repair, trims the most overrepresented muscle.",
    limitations: "Volume tolerance is individual — this uses population-level ranges, not your data.",
  },
  {
    id: "muscle_balance",
    name: "Push / pull balance",
    checks: "Upper-body pressing volume versus pulling volume.",
    why: "Chronically pressing far more than you pull is associated with rounded-shoulder posture and shoulder irritation.",
    action: "Flags a lopsided ratio; in repair, adds pulling and trims excess pressing.",
    limitations: "A single week can look skewed for valid reasons, like a deload or a specialization block.",
  },
  {
    id: "leg_balance",
    name: "Quad / hamstring balance",
    checks: "Quad-dominant volume versus direct hamstring work.",
    why: "Balanced posterior-chain volume supports the knees and reduces strength imbalances.",
    action: "Suggests adding a hinge or leg curl when hamstrings are neglected.",
    limitations: "It can't assess your individual structure, history, or sport demands.",
  },
  {
    id: "beginner_load",
    name: "Beginner overload",
    checks: "Plans that give beginners too many hard sessions, too much volume, or max-effort (RPE 9–10) work.",
    why: "New lifters progress fastest with simpler plans, moderate intensity, and enough recovery to stay consistent and learn technique.",
    action: "Flags excessive intensity or volume; in repair, caps RPE and reduces load.",
    limitations: "It can't know your true recovery, technique, sleep, or pain level.",
  },
  {
    id: "goal_fit",
    name: "Goal alignment",
    checks: "Whether rep ranges and structure match the stated goal (strength vs hypertrophy).",
    why: "Adaptations are somewhat specific — strength favors heavier, lower-rep work; hypertrophy favors moderate reps taken near failure.",
    action: "Suggests shifting rep ranges toward the goal.",
    limitations: "Rep ranges overlap a lot, so this is a nudge, not a hard rule.",
  },
  {
    id: "injury",
    name: "Injury & limitation conflicts",
    checks: "Movements commonly contraindicated for a stated injury (knee, lower back, shoulder, wrist).",
    why: "Loading a movement that aggravates an existing issue can set back recovery. Respecting stated limitations is the conservative default.",
    action: "Flags risky movements; in repair, swaps them for a muscle-preserving, joint-friendly alternative.",
    limitations: "It can't diagnose anything or know your pain threshold — see a professional for injuries.",
  },
  {
    id: "session_load",
    name: "Session length sanity",
    checks: "Total working sets prescribed in a single workout.",
    why: "Very long sessions see form and focus decay late on — when injury risk is highest — with diminishing returns.",
    action: "Flags an extreme single session and suggests splitting it across days.",
    limitations: "Work capacity varies; some advanced lifters tolerate longer sessions.",
  },
  {
    id: "coverage",
    name: "Exercise recognition",
    checks: "How many of the plan's exercises matched the structured exercise database.",
    why: "Recognized movements get precise muscle and contraindication data; unrecognized names fall back to rougher keyword logic.",
    action: "Reports the recognition rate so you know how sharp the audit is.",
    limitations: "Unusual or custom exercise names lower recognition and estimate quality.",
  },
  {
    id: "substitution",
    name: "Exercise substitution quality",
    checks: "When the plan-repair engine swaps a flagged movement, whether the replacement still trains the original muscle.",
    why: "A safer swap shouldn't quietly delete training stimulus — e.g. swapping a knee-aggravating lunge for a hip thrust would drop quad work.",
    action: "Prefers an alternative from the structured DB that preserves the original's primary muscle, and shows the tradeoff.",
    limitations: "Substitutions are template-based, not personalized to your equipment access or preferences.",
  },
];

/** Map an evaluator check id (e.g. "injury_knee") to its rule explanation. */
export function ruleForCheck(id) {
  if (!id) return null;
  if (id.startsWith("injury_")) return RULE_EXPLANATIONS.find((r) => r.id === "injury");
  return RULE_EXPLANATIONS.find((r) => r.id === id) || null;
}

/** Conservative training principles the rules are built on (not clinical claims). */
export const TRAINING_PRINCIPLES = [
  "Manage weekly volume within a productive range.",
  "Balance training stress with enough recovery.",
  "Avoid unnecessary max-effort work for beginners.",
  "Respect stated injuries and limitations.",
  "Match exercise selection to goals and equipment.",
  "Progress gradually rather than in big jumps.",
  "Treat pain as a stop signal, not a challenge.",
];

export const PRINCIPLES_NOTE =
  "These rules are conservative heuristics based on common strength-training programming principles — not clinical validation. They're designed to catch obvious programming issues and explain the tradeoffs, not to certify a plan as safe.";
