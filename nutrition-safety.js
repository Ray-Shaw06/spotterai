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

  return {
    flags,
    trust: {
      goal: goal || "General",
      kcalTarget: kcal || null,
      proteinTarget: protein || null,
      flagCount: flags.length,
      confidence,
      whyLimited,
      dataUsed,
      dataMissing,
    },
  };
}

export const NUTRITION_DISCLAIMER =
  "Nutrition estimates are approximate. SpotterAI can support general habit tracking, but it cannot diagnose conditions, prescribe diets, or replace a registered dietitian or medical professional.";
