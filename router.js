/**
 * SpotterAI — client-side page router (hash-based, zero-build)
 * ============================================================================
 * Turns the app's `[data-view]` sections into separate "pages" without a build
 * step or server routes. Switches views on `#/route`, highlights the active nav
 * link, updates the title, and emits a "spotter:route" event so features can
 * react (e.g. the form-check stops the camera when you navigate away).
 */

const ROUTES = ["home", "today", "dashboard", "split", "nutrition", "progress", "form-check", "library", "evals"];
const TITLES = {
  home: "SpotterAI — your AI fitness copilot (plan, track, adapt, audit)",
  today: "Today · SpotterAI",
  library: "Exercise library · SpotterAI",
  dashboard: "Dashboard · SpotterAI",
  split: "Split Lab · SpotterAI",
  nutrition: "Nutrition · SpotterAI",
  progress: "Progress · SpotterAI",
  "form-check": "Form check · SpotterAI",
  evals: "Safety Lab · SpotterAI",
};

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function currentRoute() {
  const h = location.hash.replace(/^#\/?/, "").trim();
  return ROUTES.includes(h) ? h : "home";
}

function show(route) {
  document.querySelectorAll("[data-view]").forEach((v) => {
    v.hidden = v.dataset.view !== route;
  });
  document.querySelectorAll("[data-nav]").forEach((a) => {
    const active = a.dataset.nav === route;
    a.classList.toggle("is-active", active);
    if (active) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  document.title = TITLES[route] || TITLES.home;
  closeMenu();
  window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
  window.dispatchEvent(new CustomEvent("spotter:route", { detail: { route } }));
}

// ----------------------------------------------------------------------------
// Mobile menu
// ----------------------------------------------------------------------------
const nav = document.getElementById("primary-nav");
const toggle = document.getElementById("nav-toggle");

function closeMenu() {
  nav?.classList.remove("is-open");
  toggle?.setAttribute("aria-expanded", "false");
}
function toggleMenu() {
  const open = nav?.classList.toggle("is-open");
  toggle?.setAttribute("aria-expanded", open ? "true" : "false");
}

toggle?.addEventListener("click", toggleMenu);
// Close the menu when a nav link is tapped.
nav?.addEventListener("click", (e) => {
  if (e.target.closest("[data-nav]")) closeMenu();
});

// ----------------------------------------------------------------------------
// Mobile "More" sheet — the bottom bar keeps 5 fixed tabs; the rest live here.
// ----------------------------------------------------------------------------
const moreBtn = document.getElementById("nav-more");
const moreSheet = document.getElementById("more-sheet");
function setMore(open) {
  if (!moreSheet || !moreBtn) return;
  moreSheet.hidden = !open;
  moreBtn.setAttribute("aria-expanded", String(open));
  moreBtn.classList.toggle("is-active", open);
}
moreBtn?.addEventListener("click", (e) => {
  e.stopPropagation(); // keep the document-level closer from re-toggling
  setMore(moreSheet.hidden);
});
moreSheet?.addEventListener("click", (e) => {
  // Any selection (a route link, or the Account button) closes the sheet.
  if (e.target.closest("a, button")) setMore(false);
});
document.addEventListener("click", (e) => {
  if (moreSheet && !moreSheet.hidden && !e.target.closest("#more-sheet")) setMore(false);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") setMore(false);
});

// ----------------------------------------------------------------------------
// Wire up
// ----------------------------------------------------------------------------
// Only `#/route` hashes drive navigation; plain `#anchor` links (e.g. the hero's
// "Build my plan" → #generator) keep their native in-page scroll.
window.addEventListener("hashchange", () => {
  if (location.hash === "" || location.hash.startsWith("#/")) show(currentRoute());
});
show(currentRoute());

/** Programmatic navigation. */
export function go(route) {
  location.hash = `#/${route}`;
}
