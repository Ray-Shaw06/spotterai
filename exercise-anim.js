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
 * knee (70,121) · ankle (70,148). Gear lives inside the limb group it belongs
 * to, so it tracks the motion. Motions play as full rep cycles (eccentric /
 * pause / drive / reset) driven by multi-keyframe CSS — see style.css.
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
  plyometric: "Load, then explode up, land soft.",
  isometric: "Brace and hold a strong neutral position.",
  pullup: "Pull your chin over the bar, lower slow.",
  benchpress: "Lower to your chest, press away strong.",
  calfraise: "Rise tall on your toes, lower slowly.",
  legext: "Straighten the knee, squeeze the quad.",
  legcurl: "Curl the heel toward you, lower slow.",
  pushdown: "Elbows pinned, extend, then control back.",
  raise: "Raise with control to shoulder height.",
  bentraise: "Hinge over, sweep up wide, lower slow.",
  pushup: "Body rigid, lower, then press the floor away.",
  plank: "Hold one straight line, head to heels.",
  dip: "Lower until the elbows bend, press back up.",
  bridge: "Drive the hips up, squeeze, lower slow.",
  hangraise: "Hang tall, lift the legs, lower with control.",
  crunch: "Round down with the abs, rise tall.",
  rollout: "Roll out under control, pull back in.",
  nordic: "Lower slowly, hamstrings fight the fall.",
  twist: "Rotate side to side under control.",
  shrug: "Shoulders straight up, squeeze, lower.",
  ohext: "Lower behind the head, then extend up.",
  skullcrusher: "Elbows still, lower to the forehead, press.",
  kickleg: "Sweep the leg back, control the return.",
  facepull: "Pull toward your face, elbows high.",
  kickback: "Elbow pinned high, extend straight back.",
  legpress: "Press away smooth, return with control.",
  legcurlseat: "Curl the heel down and back, return slow.",
  row: "Pull to your hip, squeeze the back.",
  pallof: "Press out and hold, resist the twist.",
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
  const S = (o) => ({ anim: pattern, gear: "", arms: "", pose: "", apparatus: "", ...o });
  const spec = S({});

  // --- name-level specifics (most distinctive first) ------------------------
  if (/hanging (leg|knee) raise/.test(name)) return S({ anim: "hangraise", apparatus: "pullupbar", arms: "overhead", pose: "hang" });
  if (/pull-?up|chin-?up/.test(name)) return S({ anim: "pullup", apparatus: "pullupbar", arms: "overhead", pose: "hang" });
  if (/push-?up/.test(name)) return S({ anim: "pushup", pose: "prone" });
  if (/plank/.test(name)) return S({ anim: "plank", pose: "prone" });
  if (/\bdips?\b/.test(name)) return S({ anim: "dip", apparatus: "dipbar" });
  if (/hip thrust/.test(name)) return S({ anim: "bridge", pose: "thrust", gear: "hipbar", apparatus: "hipbench" });
  if (/glute bridge|hip bridge/.test(name)) return S({ anim: "bridge", pose: "supinefloor" });
  if (/leg press/.test(name)) return S({ anim: "legpress", pose: "recline", gear: "sled", apparatus: "sledseat" });
  if (/calf/.test(name)) return S({ anim: "calfraise", gear: db ? "dbsides" : "", arms: "sides" });
  if (/leg extension/.test(name)) return S({ anim: "legext", arms: "sides", apparatus: "seat" });
  if (/seated leg curl/.test(name)) return S({ anim: "legcurlseat", arms: "sides", apparatus: "seat" });
  if (/nordic/.test(name)) return S({ anim: "nordic", pose: "kneel" });
  if (/leg curl/.test(name)) return S({ anim: "legcurl" });
  if (/skull ?crusher|lying triceps/.test(name)) return S({ anim: "skullcrusher", pose: "supine", gear: "handbar", apparatus: "bench" });
  if (/overhead .*(triceps|tricep).*extension|french press/.test(name)) return S({ anim: "ohext", gear: db ? "dbhand" : "" });
  if (/glute kickback|cable kickback|abduction/.test(name)) return S({ anim: "kickleg", arms: "sides" });
  if (/kickback/.test(name)) return S({ anim: "kickback", gear: "dbhand" });
  if (/pushdown|press-?down/.test(name)) return S({ anim: "pushdown" });
  if (/upright row/.test(name)) return S({ anim: "raise", gear: bar ? "handbar" : "dbhand" });
  if (/shrug/.test(name)) return S({ anim: "shrug", gear: bar ? "handbar" : "dbsides" });
  if (/straight-?arm pulldown|pullover/.test(name)) return S({ anim: "raise", gear: db ? "dbhand" : "" });
  if (/pec deck/.test(name)) return S({ anim: "raise" });
  if (/face pull/.test(name)) return S({ anim: "facepull" });
  if (/reverse fly|rear.?delt/.test(name)) return S({ anim: "bentraise", gear: db ? "dbhand" : "" });
  if (/seated (cable )?row/.test(name)) return S({ anim: "horizontal_pull", gear: "cablebar", pose: "longsit" });
  if (/lateral raise|side raise|front raise|delt raise|fly|flye/.test(name))
    return S({ anim: "raise", gear: db ? "dbhand" : "" });
  if (/good morning/.test(name)) return S({ anim: "hinge", gear: "backbar", arms: "backrack" });
  if (/front squat/.test(name)) return S({ anim: "squat", gear: "frontbar", arms: "frontrack" });
  if (/goblet/.test(name)) return S({ anim: "squat", gear: "goblet", arms: "goblet" });
  if (/crunch/.test(name)) return S({ anim: "crunch", pose: "kneel" });
  if (/rollout|ab wheel/.test(name)) return S({ anim: "rollout", pose: "kneel", gear: "wheel" });
  if (/russian twist/.test(name)) return S({ anim: "twist", pose: "vsit" });
  if (/pallof/.test(name)) return S({ anim: "pallof" });
  if (/box jump/.test(name)) return S({ anim: "plyometric", apparatus: "plyobox" });

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
      spec.gear = bar ? "handbar" : db ? "dbhand" : "handbar";
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
      // Barbell/dumbbell rows are bent-over; cable/machine rows stay upright.
      if (bar || db) Object.assign(spec, { anim: "row", gear: bar ? "handbar" : "dbhand" });
      else spec.gear = "cablebar";
      break;
    case "vertical_pull":
      spec.gear = "cablebar"; // pulldown bar, no plates
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
// A loaded barbell seen from the side reads as a big round plate at the grip
// (the bar runs into the screen), so plates are DISCS with a hub — not thin
// rects. A dumbbell is a short handle with a compact bell at each end. Barbells
// are long with large discs; dumbbells are small — so the two never look alike.
const bbar = (x1, x2, y) =>
  `<g class="ex-gear"><line class="ex-bar" x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" />` +
  `<ellipse class="ex-plate" cx="${x1}" cy="${y}" rx="3.4" ry="9" /><ellipse class="ex-collar" cx="${x1}" cy="${y}" rx="1.3" ry="4" />` +
  `<ellipse class="ex-plate" cx="${x2}" cy="${y}" rx="3.4" ry="9" /><ellipse class="ex-collar" cx="${x2}" cy="${y}" rx="1.3" ry="4" /></g>`;
const dbell = (cx, y) =>
  `<g class="ex-gear"><line class="ex-dbhandle" x1="${cx - 5}" y1="${y}" x2="${cx + 5}" y2="${y}" />` +
  `<ellipse class="ex-plate" cx="${cx - 5}" cy="${y}" rx="2.8" ry="5.5" />` +
  `<ellipse class="ex-plate" cx="${cx + 5}" cy="${y}" rx="2.8" ry="5.5" /></g>`;

const GEAR = {
  backbar: { g: "torsoback", html: bbar(52, 88, 52) },
  frontbar: { g: "torso", html: bbar(58, 94, 55) },
  handbar: { g: "forearm", html: bbar(58, 94, 96) },
  dbhand: { g: "forearm", html: dbell(76, 96) },
  goblet: { g: "forearm", html: `<g class="ex-gear"><rect class="ex-plate" x="70" y="88" width="12" height="15" rx="4" /><circle class="ex-collar" cx="76" cy="95.5" r="2.6" /></g>` },
  dbsides: { g: "forearm", html: dbell(76, 97) },
  cablebar: { g: "forearm", html: `<g class="ex-gear"><line class="ex-bar" x1="60" y1="96" x2="92" y2="96" /></g>` },
  wheel: { g: "forearm", html: `<g class="ex-gear"><circle class="ex-plate" cx="76" cy="99" r="6" /><circle class="ex-benchpad" cx="76" cy="99" r="2" /></g>` },
  hipbar: { g: "torso", html: `<g class="ex-gear"><circle class="ex-plate" cx="80" cy="88" r="6.5" /><circle class="ex-benchpad" cx="80" cy="88" r="2" /></g>` },
  sled: { g: "shin", html: `<g class="ex-gear"><rect class="ex-plate" x="54" y="145" width="6" height="14" rx="2" /><line class="ex-bar" x1="57" y1="151" x2="90" y2="151" /></g>` },
};

// Fixed apparatus drawn at the svg root (doesn't move with the figure).
const APPARATUS = {
  pullupbar: `<g class="ex-gear"><line class="ex-bar" x1="34" y1="16" x2="106" y2="16" /><line class="ex-mount" x1="38" y1="4" x2="38" y2="16" /><line class="ex-mount" x1="102" y1="4" x2="102" y2="16" /></g>`,
  bench: `<g class="ex-gear"><rect class="ex-benchpad" x="8" y="116" width="72" height="9" rx="3" /><line class="ex-mount" x1="18" y1="125" x2="18" y2="150" /><line class="ex-mount" x1="68" y1="125" x2="68" y2="150" /></g>`,
  dipbar: `<g class="ex-gear"><line class="ex-bar" x1="64" y1="90" x2="92" y2="90" /><line class="ex-mount" x1="78" y1="90" x2="78" y2="152" /></g>`,
  plyobox: `<g class="ex-gear"><rect class="ex-benchpad" x="92" y="126" width="26" height="26" rx="3" /></g>`,
  seat: `<g class="ex-gear"><rect class="ex-benchpad" x="42" y="98" width="26" height="8" rx="3" /><line class="ex-mount" x1="48" y1="106" x2="48" y2="152" /><line class="ex-mount" x1="62" y1="106" x2="62" y2="152" /></g>`,
  hipbench: `<g class="ex-gear"><rect class="ex-benchpad" x="14" y="126" width="30" height="8" rx="3" /><line class="ex-mount" x1="20" y1="134" x2="20" y2="152" /><line class="ex-mount" x1="38" y1="134" x2="38" y2="152" /></g>`,
  sledseat: `<g class="ex-gear"><line class="ex-mount" x1="20" y1="150" x2="56" y2="98" /><line class="ex-mount" x1="20" y1="150" x2="44" y2="150" /></g>`,
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
              <g class="ex-foot">${limb(68, 149, 4.5, 85, 149, 3.5)}</g>
              ${at("shin")}
              ${hi.shin}
            </g>
            ${hi.thigh}
          </g>
          <g class="ex-torso">
            ${limb(70, 52, 10.5, 71, 92, 9.5)}
            ${limb(65, 91, 8, 78, 91, 8)}
            ${limb(66, 52, 7, 78, 52, 7)}
            ${at("torsoback")}
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
