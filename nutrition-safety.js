/**
 * SpotterAI — nutrition safety guardrails (pure, deterministic)
 * ============================================================================
 * Conservative checks on a user's nutrition TARGETS — never medical advice, and
 * deliberately one-directional: it flags targets that are too aggressive, never
 * prescribes an extreme one. Pairs with safety-boundaries.js, which refuses
 * disordered-eating / extreme-loss *language* before any AI call.
 *
 *   evaluateNutrition({ targets, bodyweight, unit, goal }) -> { flags, trust }
 *   each flag: { tier: "critical"|"warning", label, why, fix }
 */

export const NUTRITION_THRESHOLDS = {
  VERY_LOW_KCAL: 1000, // below a safe floor for almost any adult
  LOW_KCAL: 1200, // aggressive
  PROTEIN_PER_KG_LOW: 1.2, // g/kg below this is low for someone training
  FAT_PCT_VERY_LOW: 0.15, // fat below 15% of calories is very low
  MAINTENANCE_KCAL_PER_KG: 31, // rough maintenance for a lightly-active adult
  AGGRESSIVE_DEFICIT: 0.3, // > 30% under estimated maintenance is a fast cut
};

const lbToKg = (lb) => lb * 0.45359237;

export function evaluateNutrition({ targets = {}, bodyweight = null, unit = "kg", goal = "" } = {}) {
  const T = NUTRITION_THRESHOLDS;
  const kcal = Number(targets.kcal) || 0;
  const protein = Number(targets.protein) || 0;
  const fat = Number(targets.fat) || 0;
  const kg = bodyweight ? (unit === "lb" ? lbToKg(Number(bodyweight)) : Number(bodyweight)) : null;
  const losing = /loss|lean|cut|deficit|shred/i.test(goal);

  const flags = [];
  const F = (tier, label, why, fix) => flags.push({ tier, label, why, fix });

  // 1. Absolute calorie floor.
  if (kcal) {
    if (kcal < T.VERY_LOW_KCAL) {
      F("critical", "Very low calorie target", `A target of ${kcal} kcal/day is below a safe floor for almost any adult — it risks under-fueling, muscle and bone loss, and disordered patterns.`, "Raise calories toward a moderate intake and speak with a doctor or registered dietitian if you have medical concerns.");
    } else if (kcal < T.LOW_KCAL) {
      F("warning", "Low calorie target", `${kcal} kcal/day is quite low and may be more aggressive than you need.`, "A smaller deficit is usually more sustainable and protects training and recovery.");
    }
  }

  // 2. Aggressive deficit vs a rough estimated maintenance (needs bodyweight).
  if (kg && kcal) {
    const maint = Math.round(kg * T.MAINTENANCE_KCAL_PER_KG);
    if (kcal < maint * (1 - T.AGGRESSIVE_DEFICIT)) {
      F("warning", "Aggressive deficit", `Your target (${kcal} kcal) is more than ${Math.round(T.AGGRESSIVE_DEFICIT * 100)}% below your rough estimated maintenance (~${maint} kcal) — a fast cut that's hard to sustain.`, "Aim for roughly a 10–20% deficit for steadier fat loss and better adherence.");
    }
  }

  // 3. Low protein per kg of bodyweight.
  if (kg && protein) {
    const perKg = protein / kg;
    if (perKg < T.PROTEIN_PER_KG_LOW) {
      F("warning", "Low protein target", `~${perKg.toFixed(1)} g/kg is low for someone training${losing ? " in a deficit" : ""}; protein supports muscle retention and satiety.`, `Aim for roughly 1.6–2.2 g/kg (about ${Math.round(kg * 1.6)}–${Math.round(kg * 2.2)} g).`);
    }
  }

  // 4. Very low fat.
  if (kcal && fat) {
    const fatPct = (fat * 9) / kcal;
    if (fatPct < T.FAT_PCT_VERY_LOW) {
      F("warning", "Very low fat target", `Fat is ~${Math.round(fatPct * 100)}% of calories; very low fat can affect hormones and the absorption of fat-soluble vitamins.`, "Keep fat around 20–30% of calories.");
    }
  }

  // --- Trust report + confidence -------------------------------------------
  const hasBody = !!kg;
  const critical = flags.some((f) => f.tier === "critical");
  const warnings = flags.filter((f) => f.tier === "warning").length;

  let confidence, whyLimited;
  if (critical || (!hasBody && warnings)) {
    confidence = "Low";
    whyLimited = critical ? "an aggressive or unsafe target was flagged" : "targets look aggressive and there's no logged bodyweight to check them against";
  } else if (warnings || !hasBody) {
    confidence = "Medium";
    whyLimited = warnings ? "minor warnings exist on your targets" : "no bodyweight is logged, so the per-kg checks couldn't run";
  } else {
    confidence = "High";
    whyLimited = "targets look reasonable and bodyweight is logged";
  }

  const dataUsed = ["Calorie target", "Protein target", "Fat target", hasBody ? "Logged bodyweight" : null, goal ? "Training goal" : null].filter(Boolean);
  const dataMissing = [hasBody ? null : "Bodyweight (for per-kg + deficit checks)", "Age, sex, activity level, and medical history"].filter(Boolean);

  const safer = saferTargets({ bodyweight, unit, goal });
  const saferSuggestion = safer
    ? `A moderate target for your goal is roughly ${safer.kcalLow}–${safer.kcalHigh} kcal with ${safer.proteinLow}–${safer.proteinHigh} g protein.`
    : "Log your bodyweight to get a moderate suggested range.";

  return {
    flags,
    trust: {
      goal: goal || "General",
      kcalTarget: kcal || null,
      proteinTarget: protein || null,
      fatTarget: fat || null,
      flagCount: flags.length,
      confidence,
      whyLimited,
      dataUsed,
      dataMissing,
      saferSuggestion,
    },
    safer,
  };
}

/**
 * A moderate, conservative target range from bodyweight + goal — used for the
 * "Safer targets" suggestion. Deliberately gentle: ~10–20% deficit for fat loss,
 * maintenance ± a small surplus for muscle, never an aggressive cut.
 */
export function saferTargets({ bodyweight = null, unit = "kg", goal = "" } = {}) {
  const kg = bodyweight ? (unit === "lb" ? lbToKg(Number(bodyweight)) : Number(bodyweight)) : null;
  if (!kg) return null;
  const T = NUTRITION_THRESHOLDS;
  const maint = kg * T.MAINTENANCE_KCAL_PER_KG;
  const losing = /loss|lean|cut|deficit|shred/i.test(goal);
  const gaining = /muscle|gain|bulk|hypertrophy|mass|strength/i.test(goal);
  let low, high;
  if (losing) { low = maint * 0.8; high = maint * 0.9; }
  else if (gaining) { low = maint; high = maint * 1.1; }
  else { low = maint * 0.95; high = maint * 1.05; }
  const round50 = (n) => Math.max(T.LOW_KCAL, Math.round(n / 50) * 50);
  return {
    kcalLow: round50(low),
    kcalHigh: round50(high),
    proteinLow: Math.round(kg * 1.6),
    proteinHigh: Math.round(kg * 2.2),
  };
}

// Disordered-eating / starvation / purge / detox language, for screening any
// free-text nutrition input. Returns a tier so the UI/coach can respond
// supportively rather than with a diet. (The coach also screens via
// safety-boundaries.js before any API call.)
const NUTRITION_LANGUAGE = [
  /\b(anorexi\w*|bulimi\w*|purg\w*|laxative|make myself (throw up|sick))\b/i,
  /\b(starv\w*|stop eating|barely eat\w*|not eating|skip(ping)? meals to lose|fast(ing)? to lose)\b/i,
  /\b(detox|cleanse|crash diet|juice cleanse)\b.*\b(lose|weight|fat)\b/i,
  /\bignore (the )?(hunger|dizziness|fainting|fatigue|warning signs)\b/i,
  /\blose\s+\d{2,}\s?(lbs?|pounds|kgs?)\s+in\s+(a|one|1|two|2|three|3)\s?(week|month)\b/i,
];

/** Screen free-text for disordered-eating / starvation intent. */
export function screenNutritionText(text) {
  const t = String(text || "");
  return NUTRITION_LANGUAGE.some((re) => re.test(t)) ? "block" : "ok";
}

export const NUTRITION_REDIRECT =
  "I can't help build a plan based on starvation, purging, or ignoring warning signs. I can support general habits like regular meals, hydration, and balanced protein — but this is best handled with qualified support. If you're struggling, please reach out to a doctor or a trusted professional.";

export const NUTRITION_DISCLAIMER =
  "Nutrition estimates are approximate. SpotterAI can support general habit tracking, but it cannot diagnose conditions, prescribe diets, or replace a registered dietitian or medical professional.";

/** What SpotterAI will not do with nutrition (shown on the nutrition page). */
export const NUTRITION_WONT_DO = [
  "Extreme calorie restriction",
  "Purging or starvation instructions",
  "Medical diet prescriptions",
  "Eating-disorder support or treatment",
  "Dangerous supplement or drug advice",
  "Promising rapid weight loss",
];
