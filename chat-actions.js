/**
 * SpotterAI — coach action protocol (pure)
 * ============================================================================
 * The coach may append a fenced `spotter-action` JSON block to its reply when
 * the user asks it to change the plan. This extracts + validates those actions
 * (keeping only known plan-edit types) and strips the block from the visible
 * text. chat.js then applies them through the shared plan-edit primitives, which
 * re-audit the plan — so the coach can modify, but never around the guardrails.
 */

import { PLAN_ACTION_TYPES } from "./plan-edit.js";

const tidy = (s) => String(s == null ? "" : s).trim();

/** @returns {{ actions: object[], text: string, dropped: number }} */
export function parseCoachActions(text) {
  const raw = String(text || "");
  const m = raw.match(/```spotter-action\s*([\s\S]*?)```/i);
  if (!m) return { actions: [], text: raw.trim(), dropped: 0 };
  let actions = [];
  let dropped = 0;
  try {
    const parsed = JSON.parse(m[1].trim());
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    const known = arr.filter((a) => a && typeof a === "object");
    actions = known.filter((a) => PLAN_ACTION_TYPES.includes(a.type));
    // Count what we refused so the caller can say so out loud. A dropped action
    // paired with a reply that claims the edit happened is the worst outcome.
    dropped = arr.length - actions.length;
  } catch {
    /* malformed JSON → ignore the block, still strip it */
    dropped = 1;
  }
  return { actions, text: raw.replace(m[0], "").trim(), dropped };
}

/** Human summary of an applied action, for the in-chat confirmation. */
export function describeAction(a) {
  const where = a && a.day ? ` · ${tidy(a.day)}` : "";
  switch (a && a.type) {
    case "swap_exercise": return `Swapped ${tidy(a.from)} → ${tidy(a.to)}${where}`;
    case "remove_exercise": return `Removed ${tidy(a.name)}${where}`;
    case "add_exercise": return `Added ${tidy(a.name)}${where}`;
    case "retune_exercise": return `Adjusted ${tidy(a.name)}${where}`;
    case "replace_day": {
      const day = tidy(a.day) || "that day";
      const n = Array.isArray(a.exercises) ? a.exercises.length : 0;
      if (a.focus && n) return `Rebuilt ${day} as ${tidy(a.focus)} (${n} exercise${n === 1 ? "" : "s"})`;
      if (a.focus) return `Retitled ${day} → ${tidy(a.focus)}`;
      return `Rebuilt ${day} (${n} exercise${n === 1 ? "" : "s"})`;
    }
    default: return "Updated the plan";
  }
}
