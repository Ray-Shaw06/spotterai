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

/** @returns {{ actions: object[], text: string }} */
export function parseCoachActions(text) {
  const raw = String(text || "");
  const m = raw.match(/```spotter-action\s*([\s\S]*?)```/i);
  if (!m) return { actions: [], text: raw.trim() };
  let actions = [];
  try {
    const parsed = JSON.parse(m[1].trim());
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    actions = arr.filter((a) => a && typeof a === "object" && PLAN_ACTION_TYPES.includes(a.type));
  } catch {
    /* malformed JSON → ignore the block, still strip it */
  }
  return { actions, text: raw.replace(m[0], "").trim() };
}

/** Human summary of an applied action, for the in-chat confirmation. */
export function describeAction(a) {
  const where = a && a.day ? ` · ${tidy(a.day)}` : "";
  switch (a && a.type) {
    case "swap_exercise": return `Swapped ${tidy(a.from)} → ${tidy(a.to)}${where}`;
    case "remove_exercise": return `Removed ${tidy(a.name)}${where}`;
    case "add_exercise": return `Added ${tidy(a.name)}${where}`;
    case "retune_exercise": return `Adjusted ${tidy(a.name)}${where}`;
    default: return "Updated the plan";
  }
}
