/**
 * SpotterAI — floating pill nav indicator
 * ============================================================================
 * Slides a single accent pill under the active tab in the desktop header nav.
 * Positioned from the active link's geometry; recalculated on route change,
 * resize, and once fonts have loaded (which shifts widths). On the mobile bottom
 * bar the pill is hidden (CSS) and this is a no-op.
 */

const nav = document.getElementById("primary-nav");
const pill = nav?.querySelector(".nav-pill");

function position() {
  if (!nav || !pill) return;
  // Hidden on the mobile bottom tab bar — skip.
  if (getComputedStyle(pill).display === "none") return;

  const active = nav.querySelector(".nav-link.is-active");
  if (!active) {
    pill.style.opacity = "0";
    pill.style.width = "0px";
    return;
  }
  const navRect = nav.getBoundingClientRect();
  const aRect = active.getBoundingClientRect();
  pill.style.opacity = "1";
  pill.style.width = `${aRect.width}px`;
  pill.style.transform = `translateX(${aRect.left - navRect.left - nav.clientLeft}px)`;
}

if (nav && pill) {
  window.addEventListener("spotter:route", position);
  window.addEventListener("resize", position);
  window.addEventListener("load", position);
  document.fonts?.ready.then(position).catch(() => {});
  position();
}
