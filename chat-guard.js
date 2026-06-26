/**
 * SpotterAI — coach-reply auditor (pure, no DOM)
 * ============================================================================
 * The plan isn't the only AI surface that can produce unsafe advice — the chat
 * coach can too. This is a small, transparent, code-based guardrail that scans
 * the assistant's reply for common red flags (training through pain, crash
 * dieting, maxing out constantly, dehydration cuts, PEDs, dismissing
 * professionals…) and returns any concerns so the UI can append a visible
 * "safety note". Same philosophy as evaluator.js: heuristics that FLAG, not an
 * LLM that judges.
 *
 * Because the coach is safety-FIRST, it often MENTIONS these concepts to warn
 * against them ("don't train through pain"). So risky phrases are only flagged
 * when they're NOT negated/cautionary nearby — which keeps the guard quiet on
 * the coach's own good advice.
 *
 * Pure + dependency-free so it runs under Node's test runner.
 */

// Negation/caution cues that, just before a risky phrase, mean it's advice
// AGAINST the thing rather than for it.
const NEG = /\b(?:don'?t|do not|does not|doesn'?t|never|avoid|avoiding|not|n['’]t|rather than|instead of|without|shouldn'?t|won'?t|wouldn'?t|stop|skip|no need to|myth|don['’]t)\b/;

/** True if `re` matches at least one occurrence that ISN'T negated just before it. */
function unnegated(t, re) {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let m;
  while ((m = g.exec(t)) !== null) {
    const before = t.slice(Math.max(0, m.index - 30), m.index).toLowerCase();
    if (!NEG.test(before)) return true;
  }
  return false;
}

// Daily-context calorie figure below a sane floor (crash-diet territory).
function lowCalorie(t) {
  const re = /(\d{3,4})\s*(?:kcal|cal(?:orie)?s?)\b/gi;
  let m;
  while ((m = re.exec(t)) !== null) {
    const n = Number(m[1]);
    const before = t.slice(Math.max(0, m.index - 30), m.index).toLowerCase();
    const ctx = t.slice(Math.max(0, m.index - 32), m.index + 44).toLowerCase();
    const dietContext = /(a day|per day|daily|eat|intake|diet|consume|only|just)/.test(ctx);
    if (n > 0 && n < 1200 && dietContext && !NEG.test(before)) return true;
  }
  return false;
}

// "lose N lbs/kg in a week" where N is aggressive (>~3 lb/week), not negated.
function rapidLoss(t) {
  const re = /\blos(?:e|ing)\s+(\d+(?:\.\d+)?)\s*(lbs?|pounds?|kgs?|kilos?|kilograms?)\b[^.]*?\b(?:in|per|a|every)\s*(?:a\s+)?(?:week|7\s*days)\b/gi;
  let m;
  while ((m = re.exec(t)) !== null) {
    const n = Number(m[1]);
    const lb = /lb|pound/i.test(m[2]) ? n : n * 2.205;
    const before = t.slice(Math.max(0, m.index - 30), m.index).toLowerCase();
    if (lb >= 3 && !NEG.test(before)) return true;
  }
  return false;
}

const RULES = [
  {
    id: "pain",
    label: "Training through pain",
    severity: "warn",
    test: (t) => unnegated(t, /(?:push|train|work|powering?)\s+(?:through|past)\s+(?:the\s+|your\s+|any\s+)?(?:sharp\s+|joint\s+)?pain\b/i) || unnegated(t, /\bno pain,?\s*no gain\b/i),
    note: "Sharp or joint pain is a stop signal, not something to push through — ease off and get it checked if it persists.",
  },
  {
    id: "crash_calories",
    label: "Very low calorie intake",
    severity: "warn",
    test: lowCalorie,
    note: "Extremely low daily calories are hard to sustain and tend to cost muscle. A modest deficit is safer and works better.",
  },
  {
    id: "rapid_loss",
    label: "Unrealistically fast weight loss",
    severity: "caution",
    test: rapidLoss,
    note: "Losing much more than ~0.5–1% of bodyweight a week usually burns muscle and rebounds. Aim slower and steadier.",
  },
  {
    id: "to_failure",
    label: "Training to failure every set",
    severity: "caution",
    test: (t) => unnegated(t, /(?:to|until)\s+failure\s+(?:on\s+)?(?:every|each)\s+(?:set|rep)\b/i) || unnegated(t, /(?:every|each)\s+(?:set|rep)\s+to\s+failure\b/i),
    note: "Going to failure on every set spikes fatigue and injury risk. Leaving 1–3 reps in reserve on most sets is usually better.",
  },
  {
    id: "max_out",
    label: "Frequent maxing / ego lifting",
    severity: "caution",
    test: (t) => unnegated(t, /\bmax(?:ing)?\s*out\s+(?:every|each)\b/i) || unnegated(t, /(?:one[- ]?rep max|1\s?rm)\s+(?:every|each)\s+(?:session|workout|week|day)\b/i) || unnegated(t, /\bego[- ]?lift/i),
    note: "Testing a true 1RM frequently is risky as form breaks down. Progress with submaximal loads most of the time.",
  },
  {
    id: "skip_warmup",
    label: "Skipping the warm-up",
    severity: "caution",
    test: (t) => unnegated(t, /\b(?:skip|skipping|forget)\s+(?:the\s+|a\s+|your\s+)?warm[\s-]?ups?\b/i),
    note: "A couple of warm-up sets prime the joints and the movement — worth the few minutes.",
  },
  {
    id: "dehydrate",
    label: "Dehydration / water cut",
    severity: "warn",
    test: (t) => unnegated(t, /\bwater[\s-]?cut\b/i) || unnegated(t, /\bdehydrat\w*/i) || unnegated(t, /\bsweat (?:out|off) (?:the )?water\b/i) || unnegated(t, /\bsauna\b[^.]*\b(?:cut|lose|weight)\b/i),
    note: "Cutting water or dehydrating to make weight is risky and only temporary — not advisable without professional supervision.",
  },
  {
    id: "peds",
    label: "Performance-enhancing drugs",
    severity: "warn",
    test: (t) => unnegated(t, /\b(?:steroids?|anabolics?|sarms?|clenbuterol|trenbolone|dianabol|dbol|winstrol|anavar)\b/i),
    note: "These carry serious health and legal risks. This app can't advise on them — please consult qualified medical professionals.",
  },
  {
    id: "skip_pro",
    label: "Dismissing professional help",
    severity: "warn",
    test: (t) => /\b(?:no need|don'?t need|you don'?t have to|skip(?:ping)?)\s+(?:to\s+)?(?:see|visit|consult)\s+(?:a\s+)?(?:doctor|physio(?:therapist)?|professional|gp)\b/i.test(t),
    note: "For pain, injury, or anything medical, a qualified professional is the right call — don't skip it.",
  },
];

/**
 * Audit a coach reply. Returns an array of concerns:
 *   [{ id, label, severity: "warn"|"caution", note }]
 */
export function auditReply(text) {
  const t = String(text || "");
  if (!t.trim()) return [];
  const out = [];
  for (const r of RULES) {
    let hit = false;
    try {
      hit = r.test(t);
    } catch {
      hit = false;
    }
    if (hit) out.push({ id: r.id, label: r.label, severity: r.severity, note: r.note });
  }
  return out;
}
