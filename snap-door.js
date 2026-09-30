/**
 * SpotterAI — the "Snap a meal" door
 * ============================================================================
 * The landing page's quickest way in opens the camera, and a browser opens a
 * file input only inside the tap that asked for it (iOS is strict about this).
 * The nutrition page now loads on first visit, so it cannot own that click any
 * more: waiting for it to load would put an await between the tap and the
 * camera, and the camera would silently not open.
 *
 * So this module owns the one thing that cannot wait: the hidden camera input
 * and its .click(), inside the tap. Everything after that (the food picker,
 * the route change, reading the photo) is nutrition-ui.js, loaded straight
 * away and handed the same input.
 */

import { trackFunnel } from "./analytics.js";

const inputs = new WeakMap();

/** The hidden camera input, made once per document and shared with nutrition-ui.js. */
export function photoInput(doc = document) {
  let input = inputs.get(doc);
  if (!input) {
    input = doc.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.setAttribute("capture", "environment");
    input.hidden = true;
    doc.body.appendChild(input);
    inputs.set(doc, input);
  }
  return input;
}

/**
 * Wire every [data-snap-meal] door, on the landing page and the nutrition page.
 * @returns {() => void} teardown
 */
export function initSnapDoor({
  doc = document,
  load = () => import("./nutrition-ui.js"),
  track = trackFunnel,
  onError = (error) => console.error("Could not load the nutrition page", error),
} = {}) {
  const onClick = (e) => {
    const door = e.target?.closest?.("[data-snap-meal]");
    if (!door) return;
    const source = door.dataset.snapMeal === "landing" ? "landing" : "nutrition";
    track("meal_photo_started", { source });
    photoInput(doc).click(); // inside the tap, before anything that could wait
    load().then((page) => page.continueSnap()).catch(onError);
  };
  doc.addEventListener("click", onClick);
  return () => doc.removeEventListener("click", onClick);
}

if (typeof document !== "undefined") initSnapDoor();
