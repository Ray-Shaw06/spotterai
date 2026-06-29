/**
 * SpotterAI — client-side page router (hash-based, zero-build)
 * ============================================================================
 * Turns the app's `[data-view]` sections into separate "pages" without a build
 * step or server routes. Switches views on `#/route`, highlights the active nav
 * link, updates the title, and emits a "spotter:route" event so features can
 * react (e.g. the form-check stops the camera when you navigate away).
 */

const ROUTES = ["home", "today", "dashboard", "nutrition", "progress", "form-check", "evals"];
const TITLES = {
  home: "SpotterAI — your AI fitness copilot (plan, track, adapt, audit)",
  today: "Today · SpotterAI",
  dashboard: "Dashboard · SpotterAI",
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
