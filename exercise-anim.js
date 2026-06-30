/**
 * SpotterAI — animated movement demos (pure, zero-dep)
 * ============================================================================
 * A solid, proportioned side-profile figure (capsule limbs + filled torso,
 * head, hands, feet) plus the relevant implement (barbell / dumbbell), rigged
 * so CSS keyframes rotate each limb around its joint to loop the core motion of
 * every movement pattern. No video, no network, no copyright, nothing shipped
 * beyond markup + CSS — fully local-first, and it honours prefers-reduced-motion.
 *
 * Joints (view-box units): hip (70,92) · shoulder (70,50) · elbow (72,72) ·
 * knee (70,121). Limbs are grouped so a parent rotation carries its children.
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

// Which implement each pattern shows (Hevy-style context).
const SHOULDER_BAR = new Set(["squat", "lunge"]);
const HAND_BAR = new Set(["hinge", "horizontal_push", "vertical_push", "horizontal_pull", "vertical_pull"]);
const HAND_DB = new Set(["isolation"]);

// A loaded barbell across the upper back (sits in the torso group).
const barAcrossShoulders = `<g class="ex-gear">
  <line class="ex-bar" x1="49" y1="49" x2="91" y2="49" />
  <rect class="ex-plate" x="47" y="42" width="5" height="14" rx="2" />
  <rect class="ex-plate" x="88" y="42" width="5" height="14" rx="2" />
</g>`;

// A loaded barbell held in the hands (sits in the forearm group, tracks the hand).
const barInHands = `<g class="ex-gear">
  <line class="ex-bar" x1="59" y1="96" x2="89" y2="96" />
  <rect class="ex-plate" x="57" y="90" width="5" height="12" rx="2" />
  <rect class="ex-plate" x="86" y="90" width="5" height="12" rx="2" />
</g>`;

// A dumbbell in the hand (sits in the forearm group).
const dumbbell = `<g class="ex-gear">
  <line class="ex-bar" x1="68" y1="95" x2="80" y2="95" />
  <rect class="ex-plate" x="66" y="90" width="5" height="11" rx="2" />
  <rect class="ex-plate" x="77" y="90" width="5" height="11" rx="2" />
</g>`;

/**
 * @param {string} pattern movementPattern key
 * @returns {string} markup for an animated demo panel (safe; no user input)
 */
export function patternAnimation(pattern) {
  const key = KNOWN.has(pattern) ? pattern : "idle";
  const caption = CAPTION[pattern] || "A controlled, full-range repetition.";
  const shoulderGear = SHOULDER_BAR.has(key) ? barAcrossShoulders : "";
  const handGear = HAND_BAR.has(key) ? barInHands : HAND_DB.has(key) ? dumbbell : "";
  return `
    <figure class="ex-anim" aria-label="Animated movement demonstration">
      <svg class="ex-anim__svg" data-anim="${key}" viewBox="0 0 140 175" role="img" aria-hidden="true">
        <ellipse class="ex-shadow" cx="70" cy="153" rx="27" ry="4.5" />
        <line class="ex-ground" x1="26" y1="152" x2="114" y2="152" />
        <g class="ex-fig">
          <g class="ex-thigh">
            <line class="ex-cap" x1="70" y1="92" x2="70" y2="121" stroke-width="16" />
            <g class="ex-shin">
              <line class="ex-cap" x1="70" y1="121" x2="70" y2="148" stroke-width="12" />
              <line class="ex-cap" x1="68" y1="149" x2="85" y2="149" stroke-width="9" />
            </g>
          </g>
          <g class="ex-torso">
            <line class="ex-cap" x1="70" y1="52" x2="71" y2="92" stroke-width="18" />
            <line class="ex-cap" x1="65" y1="91" x2="77" y2="91" stroke-width="15" />
            <line class="ex-cap" x1="68" y1="52" x2="77" y2="52" stroke-width="13" />
            <line class="ex-cap" x1="70" y1="44" x2="70" y2="52" stroke-width="9" />
            <ellipse class="ex-fill ex-head" cx="70" cy="33" rx="11" ry="12" />
            ${shoulderGear}
            <g class="ex-arm">
              <line class="ex-cap" x1="71" y1="53" x2="74" y2="73" stroke-width="11" />
              <g class="ex-forearm">
                <line class="ex-cap" x1="74" y1="73" x2="76" y2="95" stroke-width="9" />
                <circle class="ex-fill" cx="76" cy="96" r="4.5" />
                ${handGear}
              </g>
            </g>
          </g>
        </g>
      </svg>
      <figcaption class="ex-anim__cap"><span class="ex-anim__dot" aria-hidden="true"></span>${caption}</figcaption>
    </figure>`;
}
