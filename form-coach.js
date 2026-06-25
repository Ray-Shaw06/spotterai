/**
 * SpotterAI — Form Coach (camera orchestration)
 * ============================================================================
 * Runs an on-device, real-time form check:
 *   webcam → MediaPipe Pose (landmarks) → form-evaluator.js (angles + cues) → UI
 *
 * Everything runs in the browser. The video never leaves the device — there is
 * no server call and no recording. The heavy pose model is loaded lazily (only
 * when the user starts the camera) from a free CDN, so it never slows the
 * initial page load or affects users who don't use this feature.
 *
 * This is a "beta" assist from a single 2D camera — helpful cues, not a coach.
 */

import { EXERCISES, RepCounter } from "./form-evaluator.js";

// Pinned MediaPipe Tasks Vision build + a free, hosted pose model (lite = fast).
const TASKS_VISION_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const POSE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

// Skeleton connections (MediaPipe Pose indices) we draw.
const CONNECTIONS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28],
];

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
};

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
  const checked = document.querySelector('input[name="formExercise"]:checked');
  const id = checked ? checked.value : "squat";
  return EXERCISES[id] || EXERCISES.squat;
}

// ----------------------------------------------------------------------------
// Model init (lazy)
// ----------------------------------------------------------------------------

async function ensureModel() {
  if (poseLandmarker) return poseLandmarker;
  setStatus("Loading the pose model… (first time only)");
  // Dynamic import so MediaPipe is only fetched when the camera is used.
  const vision = await import(/* @vite-ignore */ TASKS_VISION_URL);
  const { PoseLandmarker, FilesetResolver } = vision;
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
  poseLandmarker = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate: "GPU" },
    runningMode: "VIDEO",
    numPoses: 1,
  });
  return poseLandmarker;
}

// ----------------------------------------------------------------------------
// Start / stop
// ----------------------------------------------------------------------------

async function start() {
  if (running) return;

  // Camera requires a secure context (HTTPS or localhost).
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("Camera needs HTTPS or localhost to run.", "warn");
    return;
  }

  currentExercise = selectedExercise();
  counter = new RepCounter(currentExercise);
  if (el.setup) el.setup.textContent = currentExercise.setup;

  el.start.disabled = true;
  try {
    await ensureModel();
  } catch (err) {
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

  // Match the canvas resolution to the video for crisp overlays.
  el.canvas.width = el.video.videoWidth || 1280;
  el.canvas.height = el.video.videoHeight || 720;

  running = true;
  el.start.hidden = true;
  el.stop.hidden = false;
  el.start.disabled = false;
  if (el.placeholder) el.placeholder.hidden = true;
  if (el.overlay) el.overlay.hidden = false;
  resetReadout();
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
  setStatus("Camera stopped.");
}

function resetReadout() {
  if (el.repCount) el.repCount.textContent = "0";
  if (el.liveCues) el.liveCues.innerHTML = "";
  if (el.lastRep) el.lastRep.innerHTML = "";
}

// ----------------------------------------------------------------------------
// Per-frame loop
// ----------------------------------------------------------------------------

function loop() {
  if (!running) return;

  if (el.video.readyState >= 2 && el.video.videoWidth > 0) {
    let result = null;
    try {
      result = poseLandmarker.detectForVideo(el.video, performance.now());
    } catch {
      /* transient detection hiccup — skip this frame */
    }

    const landmarks = result?.landmarks?.[0] || null;
    const metrics = landmarks ? currentExercise.metrics(landmarks) : null;
    const cues = metrics ? currentExercise.liveCues(metrics) : [];

    if (landmarks) {
      const { justCompleted } = counter.update(metrics);
      draw(landmarks, metrics, cues);
      renderReadout(cues, justCompleted);
    } else {
      const ctx = el.canvas.getContext("2d");
      ctx.clearRect(0, 0, el.canvas.width, el.canvas.height);
      if (el.liveCues) el.liveCues.innerHTML = badge("warn", "Step into frame — full body in view");
    }
  }

  rafId = requestAnimationFrame(loop);
}

// ----------------------------------------------------------------------------
// Drawing the skeleton
// ----------------------------------------------------------------------------

function draw(landmarks, metrics, cues) {
  const ctx = el.canvas.getContext("2d");
  const w = el.canvas.width;
  const h = el.canvas.height;
  ctx.clearRect(0, 0, w, h);

  const warnActive = cues.some((c) => c.level === "warn");
  const focus = new Set(metrics?.focusJoints || []);
  const warnJoints = new Set(cues.flatMap((c) => c.joints || []));

  // Connectors
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

  // Joints
  const r = Math.max(4, w * 0.007);
  for (let i = 0; i < landmarks.length; i++) {
    if (!focus.has(i) && !warnJoints.has(i)) continue;
    const p = landmarks[i];
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, warnJoints.has(i) ? r * 1.7 : r, 0, Math.PI * 2);
    ctx.fillStyle = warnJoints.has(i) ? "#ff3b3b" : "rgba(255,255,255,0.9)";
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

function renderReadout(cues, justCompleted) {
  if (el.repCount) el.repCount.textContent = String(counter.reps);

  if (el.liveCues) {
    el.liveCues.innerHTML = cues.length
      ? cues.map((c) => badge(c.level, c.text)).join("")
      : badge("good", "Looking good — keep going");
  }

  if (justCompleted && counter.lastRep && el.lastRep) {
    const { rep, depth } = counter.lastRep;
    el.lastRep.innerHTML = `<span class="form-lastrep__label">Rep ${rep}</span> ${badge(depth.level, depth.text)}`;
    if (!reducedMotion) {
      el.lastRep.classList.remove("pulse");
      // restart the pulse animation
      void el.lastRep.offsetWidth;
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

  // Switching exercise resets the rep count + setup hint.
  document.querySelectorAll('input[name="formExercise"]').forEach((input) =>
    input.addEventListener("change", () => {
      currentExercise = selectedExercise();
      if (el.setup) el.setup.textContent = currentExercise.setup;
      if (counter) counter.reset();
      resetReadout();
    })
  );

  // Free the camera if the user navigates away.
  window.addEventListener("pagehide", stop);

  // Initialize the setup hint.
  if (el.setup) el.setup.textContent = EXERCISES.squat.setup;
}
