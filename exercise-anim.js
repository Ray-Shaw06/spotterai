/**
 * SpotterAI — animated movement demos (pure, zero-dep)
 * ============================================================================
 * A solid, proportioned side-profile figure (tapered limbs, front-lit depth,
 * worked-muscle glow) rigged so CSS keyframes rotate each limb around its
 * joint. The animation is chosen PER EXERCISE, not just per movement pattern:
 * animationSpec() reads the exercise's name + equipment and picks
 *   - the motion (anim): squat, hinge, pull-up, calf raise, leg extension…
 *   - the implement (gear): bar on back / front-rack / goblet / DBs at the
 *     sides / bar-or-DB in the hands / an overhead pull-up bar / none
 *   - the arm pose (arms): racked, goblet hold, hanging, overhead hang…
 * so a Goblet Squat, Front Squat and Back Squat all read differently — like a
 * real app. No video, no network; markup + CSS only; honours reduced-motion.
 *
 * Joints (view-box units): hip (70,92) · shoulder (71,53) · elbow (74,73) ·
 * knee (70,121). Gear lives inside the limb group it belongs to, so it tracks
 * the motion.
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
  pullup: "Pull your chin over the bar, lower slow.",
  benchpress: "Lower to your chest, press away strong.",
  calfraise: "Rise tall on your toes, lower slowly.",
  legext: "Straighten the knee, squeeze the quad.",
  legcurl: "Curl the heel toward you, lower slow.",
  pushdown: "Elbows pinned — extend, then control back.",
  raise: "Raise with control to shoulder height.",
};

/**
 * Decide the motion / implement / arm pose for ONE exercise.
 * @param {{name?:string, movementPattern?:string, equipment?:string[]}} e
 * @returns {{anim:string, gear:string, arms:string, pose:string}}
 */
export function animationSpec(e = {}) {
  const name = String(e.name || "").toLowerCase();
  const eq = new Set((e.equipment || []).map((x) => String(x).toLowerCase()));
  const pattern = KNOWN.has(e.movementPattern) ? e.movementPattern : "idle";
  const db = eq.has("dumbbell") || eq.has("kettlebell");
  const bar = eq.has("barbell");
  const spec = { anim: pattern, gear: "", arms: "", pose: "", apparatus: "" };

  // --- name-level specifics (most distinctive first) ------------------------
  if (/pull-?up|chin-?up/.test(name)) return { anim: "pullup", gear: "", apparatus: "pullupbar", arms: "overhead", pose: "hang" };
  if (/calf/.test(name)) return { anim: "calfraise", gear: db ? "dbsides" : "", arms: "sides", pose: "" };
  if (/leg extension/.test(name)) return { anim: "legext", gear: "", arms: "sides", pose: "" };
  if (/leg curl|nordic/.test(name)) return { anim: "legcurl", gear: "", arms: "sides", pose: "" };
  if (/pushdown|press-?down|kickback/.test(name)) return { anim: "pushdown", gear: "", arms: "", pose: "" };
  if (/lateral raise|side raise|front raise|delt raise|reverse fly|rear delt|face pull|fly|flye|pullover/.test(name))
    return { anim: "raise", gear: db ? "dbhand" : "", arms: "", pose: "" };
  if (/good morning/.test(name)) return { anim: "hinge", gear: "backbar", arms: "backrack", pose: "" };
  if (/front squat/.test(name)) return { anim: "squat", gear: "frontbar", arms: "frontrack", pose: "" };
  if (/goblet/.test(name)) return { anim: "squat", gear: "goblet", arms: "goblet", pose: "" };

  // --- pattern-level, differentiated by equipment ---------------------------
  switch (pattern) {
    case "squat":
      if (bar) Object.assign(spec, { gear: "backbar", arms: "backrack" });
      else if (db) Object.assign(spec, { gear: "goblet", arms: "goblet" });
      // bodyweight/machine: default counterbalance arms
      break;
    case "lunge":
      if (db) Object.assign(spec, { gear: "dbsides", arms: "sides" });
      else if (bar) Object.assign(spec, { gear: "backbar", arms: "backrack" });
      break;
    case "hinge":
      spec.gear = db ? "dbhand" : "handbar";
      break;
    case "horizontal_push":
      if (eq.has("bench")) Object.assign(spec, { anim: "benchpress", pose: "supine", gear: db ? "dbhand" : "handbar", apparatus: "bench" });
      else if (bar) spec.gear = "handbar";
      else if (db) spec.gear = "dbhand";
      break;
    case "vertical_push":
      spec.gear = db ? "dbhand" : bar ? "handbar" : "";
      break;
    case "horizontal_pull":
      spec.gear = db ? "dbhand" : bar ? "handbar" : "handbar"; // cable rows read fine with a bar
      break;
    case "vertical_pull":
      spec.gear = ""; // pulldown: hands empty (cable), motion carries it
      break;
    case "isolation":
      spec.gear = bar ? "handbar" : "dbhand"; // curls etc.
      break;
    case "plyometric":
    case "isometric":
      break;
  }
  return spec;
}

// --- gear markup -------------------------------------------------------------
// Placement group: torso (tracks the lean), forearm (tracks the hand), or svg
// root (fixed apparatus like a pull-up bar or bench).
const GEAR = {
  backbar: { g: "torso", html: `<g class="ex-gear"><line class="ex-bar" x1="49" y1="49" x2="91" y2="49" /><rect class="ex-plate" x="47" y="42" width="5" height="14" rx="2" /><rect class="ex-plate" x="88" y="42" width="5" height="14" rx="2" /></g>` },
  frontbar: { g: "torso", html: `<g class="ex-gear"><line class="ex-bar" x1="58" y1="54" x2="100" y2="54" /><rect class="ex-plate" x="56" y="47" width="5" height="14" rx="2" /><rect class="ex-plate" x="97" y="47" width="5" height="14" rx="2" /></g>` },
  handbar: { g: "forearm", html: `<g class="ex-gear"><line class="ex-bar" x1="59" y1="96" x2="89" y2="96" /><rect class="ex-plate" x="57" y="90" width="5" height="12" rx="2" /><rect class="ex-plate" x="86" y="90" width="5" height="12" rx="2" /></g>` },
  dbhand: { g: "forearm", html: `<g class="ex-gear"><line class="ex-bar" x1="68" y1="95" x2="80" y2="95" /><rect class="ex-plate" x="66" y="90" width="5" height="11" rx="2" /><rect class="ex-plate" x="77" y="90" width="5" height="11" rx="2" /></g>` },
  goblet: { g: "forearm", html: `<g class="ex-gear"><line class="ex-bar" x1="70" y1="95" x2="80" y2="95" /><rect class="ex-plate" x="68" y="90" width="5" height="11" rx="2" /><rect class="ex-plate" x="78" y="90" width="5" height="11" rx="2" /></g>` },
  dbsides: { g: "forearm", html: `<g class="ex-gear"><line class="ex-bar" x1="70" y1="97" x2="82" y2="97" /><rect class="ex-plate" x="68" y="92" width="5" height="11" rx="2" /><rect class="ex-plate" x="79" y="92" width="5" height="11" rx="2" /></g>` },
};

// Fixed apparatus drawn at the svg root (doesn't move with the figure).
const APPARATUS = {
  pullupbar: `<g class="ex-gear"><line class="ex-bar" x1="34" y1="16" x2="106" y2="16" /><line class="ex-mount" x1="38" y1="4" x2="38" y2="16" /><line class="ex-mount" x1="102" y1="4" x2="102" y2="16" /></g>`,
  bench: `<g class="ex-gear"><rect class="ex-benchpad" x="8" y="116" width="72" height="9" rx="3" /><line class="ex-mount" x1="18" y1="125" x2="18" y2="150" /><line class="ex-mount" x1="68" y1="125" x2="68" y2="150" /></g>`,
};

// Worked-muscle highlight node → limb group + position (view-box units).
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
 * Render the animated demo panel for an exercise.
 * @param {string} pattern movementPattern key
 * @param {string[]} [muscles] primaryMuscles to highlight
 * @param {{name?:string, equipment?:string[]}} [exercise] full entry for
 *   per-exercise gear/pose differentiation (falls back to pattern defaults)
 */
export function patternAnimation(pattern, muscles = [], exercise = null) {
  const spec = animationSpec({ ...(exercise || {}), movementPattern: pattern });
  const caption = CAPTION[spec.anim] || CAPTION[pattern] || "A controlled, full-range repetition.";
  const gear = GEAR[spec.gear] || null;
  const at = (slot) => (gear && gear.g === slot ? gear.html : "");
  const apparatus = APPARATUS[spec.apparatus] || "";
  const hi = highlights(muscles);
  return `
    <figure class="ex-anim" aria-label="Animated movement demonstration">
      <svg class="ex-anim__svg" data-anim="${spec.anim}"${spec.arms ? ` data-arms="${spec.arms}"` : ""}${spec.pose ? ` data-pose="${spec.pose}"` : ""} viewBox="0 0 140 175" role="img" aria-hidden="true">
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
        ${apparatus}
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
            ${at("torso")}
            <g class="ex-arm">
              ${limb(71, 53, 6, 74, 73, 4.5)}
              <g class="ex-forearm">
                ${limb(74, 73, 4.5, 76, 95, 3.5)}
                <circle class="ex-limbfill" cx="76" cy="96" r="4.5" />
                ${at("forearm")}
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
