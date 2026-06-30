/**
 * SpotterAI — animated movement demos (pure, zero-dep)
 * ============================================================================
 * A small jointed SVG figure whose limbs are rotated by CSS keyframes to loop
 * the core motion of each movement pattern. No video, no network, no copyright,
 * no shipped bytes beyond a little markup + CSS — fully local-first, and it
 * honours prefers-reduced-motion (the figure holds a neutral pose).
 *
 * The figure is rigged once; per-pattern CSS (in style.css, keyed off the
 * `data-anim` attribute) animates the relevant joints. Joints (view-box units):
 *   hip (70,92) · shoulder (70,47) · elbow (72,71) · knee (70,121)
 */

const KNOWN = new Set([
  "squat", "lunge", "hinge", "horizontal_push", "vertical_push",
  "horizontal_pull", "vertical_pull", "isolation", "plyometric", "isometric",
]);

const CAPTION = {
  squat: "Sit hips back and down, then drive up.",
  lunge: "Step down under control, then back up.",
  hinge: "Push hips back, flat back, then stand tall.",
  horizontal_push: "Press the load away from your chest.",
  vertical_push: "Press overhead, then lower with control.",
  horizontal_pull: "Pull the load to you, squeeze, release.",
  vertical_pull: "Pull down to your chest, then extend.",
  isolation: "Curl up, squeeze, lower slowly.",
  plyometric: "Load, then explode up — land soft.",
  isometric: "Brace and hold a strong neutral position.",
};

/**
 * @param {string} pattern movementPattern key
 * @returns {string} markup for an animated demo panel (safe; no user input)
 */
export function patternAnimation(pattern) {
  const key = KNOWN.has(pattern) ? pattern : "idle";
  const caption = CAPTION[pattern] || "A controlled, full-range repetition.";
  return `
    <figure class="ex-anim" aria-label="Animated movement demonstration">
      <svg class="ex-anim__svg" data-anim="${key}" viewBox="0 0 140 160" role="img" aria-hidden="true">
        <ellipse class="ex-shadow" cx="70" cy="151" rx="26" ry="4" />
        <line class="ex-ground" x1="28" y1="150" x2="112" y2="150" />
        <g class="ex-fig">
          <g class="ex-thigh">
            <line class="ex-limb" x1="70" y1="92" x2="70" y2="121" />
            <g class="ex-shin">
              <line class="ex-limb" x1="70" y1="121" x2="70" y2="148" />
              <line class="ex-limb" x1="70" y1="148" x2="83" y2="148" />
            </g>
          </g>
          <g class="ex-torso">
            <line class="ex-limb ex-spine" x1="70" y1="47" x2="70" y2="92" />
            <circle class="ex-head" cx="70" cy="34" r="11" />
            <g class="ex-arm">
              <line class="ex-limb" x1="70" y1="48" x2="72" y2="71" />
              <g class="ex-forearm">
                <line class="ex-limb" x1="72" y1="71" x2="73" y2="93" />
              </g>
            </g>
          </g>
        </g>
      </svg>
      <figcaption class="ex-anim__cap"><span class="ex-anim__dot" aria-hidden="true"></span>${caption}</figcaption>
    </figure>`;
}
