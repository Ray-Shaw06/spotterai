/**
 * SpotterAI — Form Coach (camera orchestration)
 * ============================================================================
 * Runs an on-device, real-time form check:
 *   webcam → MediaPipe Pose → form-evaluator.js (angles + cues) → UI
 *
 * Everything runs in the browser. The video never leaves the device — no server
 * call, no recording. The pose model is loaded lazily (only when the camera
 * starts) from a free CDN.
 *
 * Accuracy pipeline:
 *   • "full" pose model (more accurate landmarks than "lite").
 *   • Segment angles from 3D world landmarks; gravity cues from 2D landmarks.
 *   • Per-metric One-Euro smoothing removes jitter before the rules run.
 *   • Curated exercises get form cues; "Other" uses an adaptive rep counter.
 *
 * A single 2D camera gives heuristic cues, not a coach's eye.
 */

import { EXERCISES, RepCounter, AdaptiveRepCounter, OneEuroFilter } from "./form-evaluator.js";
import { frameConfidence, confidenceLevel, canJudge } from "./form-confidence.js";

// Pinned MediaPipe Tasks Vision build + a free, hosted pose model.
const TASKS_VISION_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
// "full" model — noticeably more accurate than "lite" (a bit larger to download).
const POSE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task";

// Skeleton connections (MediaPipe Pose indices) we draw.
const CONNECTIONS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28],
];

// Friendly labels for the adaptive counter's auto-detected joint.
const JOINT_LABEL = { knee: "legs", elbow: "arms", hip: "hips", shoulderAbd: "shoulders" };

// ----------------------------------------------------------------------------
// Element references (added in index.html). Bail out quietly if absent.
// ----------------------------------------------------------------------------
const el = {
  video: document.getElementById("form-video"),
  canvas: document.getElementById("form-canvas"),
  placeholder: document.getElementById("form-placeholder"),
  overlay: document.getElementById("form-overlay"),
  repCount: document.getElementById("form-rep-count"),
  liveCues: document.getElementById("form-live-cues"),
  start: document.getElementById("form-start"),
  stop: document.getElementById("form-stop"),
  status: document.getElementById("form-status"),
  setup: document.getElementById("form-setup"),
  lastRep: document.getElementById("form-lastrep"),
  select: document.getElementById("form-exercise"),
  conf: document.getElementById("form-confidence"),
  confBar: document.getElementById("form-confidence-bar"),
  confLabel: document.getElementById("form-confidence-label"),
  pain: document.getElementById("form-pain"),
  painMsg: document.getElementById("form-pain-msg"),
};

// Confidence landmarks + thresholds live in form-confidence.js (pure, tested).

const hasUI = el.video && el.canvas && el.start;

// ----------------------------------------------------------------------------
// State
// ----------------------------------------------------------------------------
let poseLandmarker = null;
let stream = null;
let running = false;
let rafId = null;
let counter = null;
let currentExercise = EXERCISES.squat;
let smoothers = new Map(); // metric key -> OneEuroFilter
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function esc(t) {
  const d = document.createElement("div");
  d.textContent = t == null ? "" : String(t);
  return d.innerHTML;
}

function setStatus(text, tone = "muted") {
  if (el.status) {
    el.status.textContent = text;
    el.status.dataset.tone = tone;
  }
}

function selectedExercise() {
  const id = el.select ? el.select.value : "squat";
  return EXERCISES[id] || EXERCISES.squat;
}

function makeCounter(ex) {
  return ex.adaptive ? new AdaptiveRepCounter() : new RepCounter(ex);
}

/** Smooth every numeric metric with its own One-Euro filter (kills jitter). */
function smoothMetrics(metrics, tMs) {
  if (!metrics) return metrics;
  const out = {};
  for (const k in metrics) {
    const v = metrics[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      let f = smoothers.get(k);
      if (!f) { f = new OneEuroFilter(); smoothers.set(k, f); }
      out[k] = f.filter(v, tMs);
    } else {
      out[k] = v; // booleans / arrays pass through
    }
  }
  return out;
}

function resetForExercise() {
  currentExercise = selectedExercise();
  counter = makeCounter(currentExercise);
  smoothers = new Map();
  if (el.setup) el.setup.textContent = currentExercise.setup;
  resetReadout();
}

// ----------------------------------------------------------------------------
// Model init (lazy)
// ----------------------------------------------------------------------------

async function ensureModel() {
  if (poseLandmarker) return poseLandmarker;
  setStatus("Loading the pose model… (first time only)");
  const vision = await import(/* @vite-ignore */ TASKS_VISION_URL);
  const { PoseLandmarker, FilesetResolver } = vision;
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
  poseLandmarker = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate: "GPU" },
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.6,
    minPosePresenceConfidence: 0.6,
    minTrackingConfidence: 0.6,
  });
  return poseLandmarker;
}

// ----------------------------------------------------------------------------
// Start / stop
// ----------------------------------------------------------------------------

async function start() {
  if (running) return;

  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("Camera needs HTTPS or localhost to run.", "warn");
    return;
  }

  resetForExercise();

  el.start.disabled = true;
  try {
    await ensureModel();
  } catch {
    setStatus("Couldn't load the pose model — check your connection and try again.", "warn");
    el.start.disabled = false;
    return;
  }

  try {
    setStatus("Requesting camera…");
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
  } catch (err) {
    setStatus(
      err?.name === "NotAllowedError"
        ? "Camera permission denied. Allow access and try again."
        : "Couldn't access the camera.",
      "warn"
    );
    el.start.disabled = false;
    return;
  }

  el.video.srcObject = stream;
  await el.video.play().catch(() => {});

  el.canvas.width = el.video.videoWidth || 1280;
  el.canvas.height = el.video.videoHeight || 720;

  running = true;
  el.start.hidden = true;
  el.stop.hidden = false;
  el.start.disabled = false;
  if (el.placeholder) el.placeholder.hidden = true;
  if (el.overlay) el.overlay.hidden = false;
  if (el.select) el.select.disabled = true;
  setStatus("Camera active — start your set.", "good");
  loop();
}

function stop() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  if (el.video) el.video.srcObject = null;
  const ctx = el.canvas?.getContext("2d");
  if (ctx) ctx.clearRect(0, 0, el.canvas.width, el.canvas.height);
  el.start.hidden = false;
  el.stop.hidden = true;
  if (el.overlay) el.overlay.hidden = true;
  if (el.placeholder) el.placeholder.hidden = false;
  if (el.select) el.select.disabled = false;
  if (el.conf) el.conf.hidden = true;
  setStatus("Camera stopped.");
}

function resetReadout() {
  if (el.repCount) el.repCount.textContent = "0";
  if (el.liveCues) el.liveCues.innerHTML = "";
  if (el.lastRep) el.lastRep.innerHTML = "";
}

function updateConfidence(conf) {
  if (!el.conf) return;
  el.conf.hidden = false;
  const pct = Math.round(conf * 100);
  const level = confidenceLevel(conf);
  if (el.confBar) {
    el.confBar.style.width = `${pct}%`;
    el.confBar.dataset.level = level;
  }
  if (el.confLabel) {
    el.confLabel.textContent = `${level === "high" ? "High" : level === "med" ? "Medium" : "Low"} · ${pct}%`;
    el.confLabel.dataset.level = level;
  }
}

// ----------------------------------------------------------------------------
// Per-frame loop
// ----------------------------------------------------------------------------

function loop() {
  if (!running) return;

  if (el.video.readyState >= 2 && el.video.videoWidth > 0) {
    let result = null;
    const t = performance.now();
    try {
      result = poseLandmarker.detectForVideo(el.video, t);
    } catch {
      /* transient detection hiccup — skip this frame */
    }

    const image = result?.landmarks?.[0] || null;
    const world = result?.worldLandmarks?.[0] || image; // 3D preferred; fall back to 2D

    if (image && world) {
      const conf = frameConfidence(image);
      updateConfidence(conf);

      const metrics = smoothMetrics(currentExercise.metrics(image, world), t);

      let cues;
      let justCompleted = false;
      let lastRep = null;

      if (currentExercise.adaptive) {
        const r = counter.update(metrics, t);
        justCompleted = r.justCompleted;
        cues = r.calibrating
          ? [{ level: "warn", text: "Calibrating — do a few full reps" }]
          : [{ level: "good", text: `Counting via ${JOINT_LABEL[r.dominant] || "motion"} — pick a lift for form cues` }];
      } else {
        cues = currentExercise.cues(metrics);
        const upd = counter.update(metrics, t);
        justCompleted = upd.justCompleted;
        lastRep = counter.lastRep;
      }

      // Low confidence: refuse strong form advice rather than guess.
      const lowConf = !canJudge(conf);
      if (lowConf) cues = [{ level: "warn", text: "Camera angle or visibility is too limited for useful feedback — step fully into frame, side-on." }];

      draw(image, metrics, cues);
      renderReadout(cues, justCompleted, lastRep, lowConf);
    } else {
      const ctx = el.canvas.getContext("2d");
      ctx.clearRect(0, 0, el.canvas.width, el.canvas.height);
      if (el.liveCues) el.liveCues.innerHTML = badge("warn", "Step into frame — full body in view");
    }
  }

  rafId = requestAnimationFrame(loop);
}

// ----------------------------------------------------------------------------
// Drawing the skeleton (uses 2D image landmarks)
// ----------------------------------------------------------------------------

function draw(landmarks, metrics, cues) {
  const ctx = el.canvas.getContext("2d");
  const w = el.canvas.width;
  const h = el.canvas.height;
  ctx.clearRect(0, 0, w, h);

  const warnActive = cues.some((c) => c.level === "warn" && c.joints);
  const focus = new Set(metrics?.focusJoints || []);
  const warnJoints = new Set(cues.flatMap((c) => c.joints || []));

  ctx.lineWidth = Math.max(2, w * 0.004);
  ctx.lineCap = "round";
  ctx.strokeStyle = warnActive ? "rgba(255, 90, 90, 0.85)" : "rgba(255, 255, 255, 0.55)";
  for (const [a, b] of CONNECTIONS) {
    const pa = landmarks[a];
    const pb = landmarks[b];
    if (!pa || !pb) continue;
    ctx.beginPath();
    ctx.moveTo(pa.x * w, pa.y * h);
    ctx.lineTo(pb.x * w, pb.y * h);
    ctx.stroke();
  }

  const r = Math.max(4, w * 0.007);
  for (let i = 0; i < landmarks.length; i++) {
    if (!focus.has(i) && !warnJoints.has(i)) continue;
    const p = landmarks[i];
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, warnJoints.has(i) ? r * 1.7 : r, 0, Math.PI * 2);
    ctx.fillStyle = warnJoints.has(i) ? "#db5a52" : "rgba(255,255,255,0.9)";
    ctx.fill();
    if (warnJoints.has(i)) {
      ctx.lineWidth = Math.max(2, w * 0.003);
      ctx.strokeStyle = "rgba(255,59,59,0.5)";
      ctx.stroke();
    }
  }
}

// ----------------------------------------------------------------------------
// Readout (rep count, live cues, last-rep feedback)
// ----------------------------------------------------------------------------

function badge(level, text) {
  return `<span class="cue cue--${level === "good" ? "good" : "warn"}">${esc(text)}</span>`;
}

function renderReadout(cues, justCompleted, lastRep, lowConf = false) {
  if (el.repCount) el.repCount.textContent = String(counter.reps);

  if (el.liveCues) {
    el.liveCues.innerHTML = cues.length
      ? cues.map((c) => badge(c.level, c.text)).join("")
      : badge("good", "Looking good — keep going");
  }

  // When confidence is low, don't grade the rep — say so plainly.
  if (justCompleted && lowConf && el.lastRep) {
    el.lastRep.innerHTML = `<span class="form-lastrep__label">Rep ${counter.reps}</span> ${badge("warn", "Unable to judge this rep")}`;
  } else if (justCompleted && lastRep && el.lastRep) {
    const { rep, depth } = lastRep;
    el.lastRep.innerHTML = `<span class="form-lastrep__label">Rep ${rep}</span> ${badge(depth.level, depth.text)}`;
    if (!reducedMotion) {
      el.lastRep.classList.remove("pulse");
      void el.lastRep.offsetWidth; // restart the pulse animation
      el.lastRep.classList.add("pulse");
    }
  }
}

// ----------------------------------------------------------------------------
// Wiring
// ----------------------------------------------------------------------------

if (hasUI) {
  el.start.addEventListener("click", start);
  el.stop.addEventListener("click", stop);

  // "I feel pain" — stop immediately and surface the conservative message.
  el.pain?.addEventListener("click", () => {
    if (el.painMsg) el.painMsg.hidden = false;
    if (running) stop();
    setStatus("Stopped — please read the note below.", "warn");
  });

  // Switching exercise rebuilds the counter, smoothers, and setup hint.
  el.select?.addEventListener("change", resetForExercise);

  // Free the camera if the user navigates away (tab hidden or route change).
  window.addEventListener("pagehide", stop);
  window.addEventListener("spotter:route", (e) => {
    if (e.detail?.route !== "form-check") stop();
  });

  // Initialize from the current selection.
  resetForExercise();
}
