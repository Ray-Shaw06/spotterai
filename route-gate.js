/**
 * SpotterAI — run-once route gate (pure)
 * ============================================================================
 * The router only toggles `hidden` on `[data-view]` sections; it never
 * removes them from the DOM (router.js `show()`). That means anything mounted
 * inside a route section — like the Safety Lab's benchmark history fetch —
 * stays reachable from every route unless it gates itself.
 *
 * `onceRouteActive` fires `run` exactly once: immediately if the target route
 * is already active (a cold load straight into that route never dispatches a
 * router navigation event, so there is nothing to subscribe to), or on the
 * first later change reported through `subscribe` that leaves it active.
 * After it fires once, it never fires again for the lifetime of the page.
 *
 * Pure and DOM-free on purpose, so it is reachable under Node and so more
 * than one hydrator (the benchmark history fetch today, a future telemetry
 * fetch tomorrow) can share this exact guard instead of each hand-rolling its
 * own "have I already run" flag.
 */

/**
 * @param {() => boolean} isActive returns true if the target route is active right now
 * @param {(onChange: () => void) => void} subscribe calls onChange whenever the
 *   route might have changed; onChange re-checks isActive() itself, so
 *   subscribe does not need to know which route it is gating
 * @param {() => void} run invoked at most once, the first time isActive() is true
 */
export function onceRouteActive(isActive, subscribe, run) {
  let fired = false;
  const fire = () => {
    if (fired) return;
    fired = true;
    run();
  };
  if (isActive()) {
    fire();
    return;
  }
  subscribe(() => {
    if (!fired && isActive()) fire();
  });
}
