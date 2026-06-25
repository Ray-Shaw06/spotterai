/**
 * Tiny shared client-side state.
 * ----------------------------------------------------------------------------
 * Lets independent modules share the latest generated plan without a framework
 * or globals. app.js writes the plan here after generating; chat.js reads it so
 * the coach can answer questions about "my plan".
 */

export const store = {
  /** The most recently rendered plan, or null. */
  plan: null,
  /** The form inputs used for that plan, or null. */
  inputs: null,
};

/** Update the shared plan and notify listeners. */
export function setPlan(plan, inputs) {
  store.plan = plan || null;
  store.inputs = inputs || null;
  window.dispatchEvent(new CustomEvent("spotter:plan", { detail: { plan, inputs } }));
}
