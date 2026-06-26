/**
 * Tiny shared client-side state — the current plan.
 * ----------------------------------------------------------------------------
 * Lets independent modules share the latest plan without a framework or globals.
 * app.js writes the plan here after generating/adapting; chat.js and workout-ui
 * read it so the coach can answer "about my plan" and you can start a session
 * from it.
 *
 * The plan is persisted to localStorage (namespaced per profile, like the
 * tracker) so it survives a refresh — which is what makes the adaptive loop
 * meaningful: generate today, log over the week, come back and adapt. Switching
 * profiles swaps in that profile's plan.
 */

import { planKey } from "./profile-store.js";

function loadPlan() {
  try {
    const raw = JSON.parse(localStorage.getItem(planKey()) || "null");
    if (raw && raw.plan && typeof raw.plan === "object") return { plan: raw.plan, inputs: raw.inputs || null };
  } catch {
    /* ignore */
  }
  return { plan: null, inputs: null };
}

const restored = loadPlan();

export const store = {
  /** The most recently rendered plan, or null. */
  plan: restored.plan,
  /** The form inputs used for that plan, or null. */
  inputs: restored.inputs,
};

/** Update the shared plan, persist it, and notify listeners. */
export function setPlan(plan, inputs) {
  store.plan = plan || null;
  store.inputs = inputs || null;
  try {
    if (store.plan) localStorage.setItem(planKey(), JSON.stringify({ plan: store.plan, inputs: store.inputs, updatedAt: Date.now() }));
    else localStorage.removeItem(planKey());
  } catch {
    /* storage full / disabled — keep working in-memory */
  }
  window.dispatchEvent(new CustomEvent("spotter:plan", { detail: { plan: store.plan, inputs: store.inputs } }));
}

// Switching profiles swaps in that profile's stored plan, and tells listeners
// (app.js re-renders, chat/workout refresh).
window.addEventListener("spotter:profile", () => {
  const next = loadPlan();
  store.plan = next.plan;
  store.inputs = next.inputs;
  window.dispatchEvent(new CustomEvent("spotter:plan", { detail: { plan: store.plan, inputs: store.inputs } }));
});
