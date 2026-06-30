/**
 * SpotterAI — animated movement demos (pure, zero-dep)
 * ============================================================================
 * A solid, proportioned side-profile figure with TAPERED limbs (filled paths,
 * wider at the proximal joint), a front-lit gradient for 3D depth, the relevant
 * implement (barbell / dumbbell), and a soft pulsing highlight over the worked
 * muscle — rigged so CSS keyframes rotate each limb around its joint to loop
 * the core motion of every movement pattern. No video, no network, no
 * copyright; markup + CSS only, fully local-first, honours reduced-motion.
 *
 * Joints (view-box units): hip (70,92) · shoulder (71,53) · elbow (74,73) ·
 * knee (70,121). Equipment + muscle nodes live inside the limb group they
 * belong to, so they track the motion.
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

const SHOULDER_BAR = new Set(["squat", "lunge"]);
const HAND_BAR = new Set(["hinge", "horizontal_push", "vertical_push", "horizontal_pull", "vertical_pull"]);
const HAND_DB = new Set(["isolation"]);

// Worked-muscle highlight node → which limb group it lives in + where (view-box).
const MUSCLE_NODE = {
  chest: { g: "torso", x: 78, y: 62, r: 9 },
  back: { g: "torso", x: 63, y: 64, r: 10 },
  core: { g: "torso", x: 77, y: 79, r: 8 },
  shoulders: { g: "arm", x: 72, y: 56, r: 8 },
  biceps: { g: "arm", x: 77, y: 63, r: 7 },
  triceps: { g: "arm", x: 70, y: 64, r: 7 },
  glutes: { g: "thigh", x: 64, y: 97, r: 9 },
  quads: { g: "thigh", x: 74, y: 106, r: 9 },
  hamstrings: { g: "thigh", x: 66, y: 106, r: 9 },
  calves: { g: "shin", x: 66, y: 134, r: 7 },
};

/** Tapered, round-capped capsule from A(r1) to B(r2) as a fillable path. */
function capsule(x1, y1, r1, x2, y2, r2) {
  const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L, ny = dx / L; // unit perpendicular
  const n = (v) => v.toFixed(1);
  const aL = [x1 + nx * r1, y1 + ny * r1], aR = [x1 - nx * r1, y1 - ny * r1];
  const bL = [x2 + nx * r2, y2 + ny * r2], bR = [x2 - nx * r2, y2 - ny * r2];
  // Distal cap bulges out (sweep 1); proximal cap bulges out the other way (sweep 0).
  return `M${n(aL[0])} ${n(aL[1])} L${n(bL[0])} ${n(bL[1])} A${r2} ${r2} 0 0 1 ${n(bR[0])} ${n(bR[1])} L${n(aR[0])} ${n(aR[1])} A${r1} ${r1} 0 0 0 ${n(aL[0])} ${n(aL[1])} Z`;
}
const limb = (...a) => `<path class="ex-limbfill" d="${capsule(...a)}" />`;

function highlights(muscles) {
  const buckets = { torso: "", arm: "", forearm: "", thigh: "", shin: "" };
  for (const m of (muscles || []).slice(0, 2)) {
    const node = MUSCLE_NODE[m];
    if (node) buckets[node.g] += `<circle class="ex-musc" cx="${node.x}" cy="${node.y}" r="${node.r}" />`;
  }
  return buckets;
}

/**
 * @param {string} pattern movementPattern key
 * @param {string[]} [muscles] primaryMuscles to highlight
 * @returns {string} markup for an animated demo panel (safe; no user input)
 */
export function patternAnimation(pattern, muscles = []) {
  const key = KNOWN.has(pattern) ? pattern : "idle";
  const caption = CAPTION[pattern] || "A controlled, full-range repetition.";
  const shoulderGear = SHOULDER_BAR.has(key) ? barAcrossShoulders : "";
  const handGear = HAND_BAR.has(key) ? barInHands : HAND_DB.has(key) ? dumbbell : "";
  const hi = highlights(muscles);
  return `
    <figure class="ex-anim" aria-label="Animated movement demonstration">
      <svg class="ex-anim__svg" data-anim="${key}" viewBox="0 0 140 175" role="img" aria-hidden="true">
        <defs>
          <linearGradient id="exBody" gradientUnits="userSpaceOnUse" x1="48" y1="0" x2="93" y2="0">
            <stop class="ex-stop-dark" offset="0" />
            <stop class="ex-stop-mid" offset="0.55" />
            <stop class="ex-stop-light" offset="1" />
          </linearGradient>
          <radialGradient id="exMusc">
            <stop class="ex-stop-musc0" offset="0" />
            <stop class="ex-stop-musc1" offset="1" />
          </radialGradient>
        </defs>
        <ellipse class="ex-shadow" cx="70" cy="153" rx="27" ry="4.5" />
        <line class="ex-ground" x1="26" y1="152" x2="114" y2="152" />
        <g class="ex-fig">
          <g class="ex-thigh">
            ${limb(70, 92, 9, 70, 121, 6)}
            <g class="ex-shin">
              ${limb(70, 121, 6, 70, 148, 4.5)}
              ${limb(68, 149, 4.5, 85, 149, 3.5)}
              ${hi.shin}
            </g>
            ${hi.thigh}
          </g>
          <g class="ex-torso">
            ${limb(70, 52, 10.5, 71, 92, 9.5)}
            ${limb(65, 91, 8, 78, 91, 8)}
            ${limb(66, 52, 7, 78, 52, 7)}
            ${limb(70, 44, 4.5, 70, 52, 5)}
            <ellipse class="ex-head" cx="70" cy="33" rx="11" ry="12" />
            ${shoulderGear}
            <g class="ex-arm">
              ${limb(71, 53, 6, 74, 73, 4.5)}
              <g class="ex-forearm">
                ${limb(74, 73, 4.5, 76, 95, 3.5)}
                <circle class="ex-limbfill" cx="76" cy="96" r="4.5" />
                ${handGear}
                ${hi.forearm}
              </g>
              ${hi.arm}
            </g>
            ${hi.torso}
          </g>
        </g>
      </svg>
      <figcaption class="ex-anim__cap"><span class="ex-anim__dot" aria-hidden="true"></span>${caption}</figcaption>
    </figure>`;
}

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
