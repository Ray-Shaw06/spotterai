/**
 * SpotterAI — ambient animation gate
 * ============================================================================
 * The hero's radar bloom and the audit card's scan line loop forever by
 * design — but they shouldn't burn GPU while scrolled out of view. This
 * observer stamps `.is-offstage` on the hero when it leaves the viewport;
 * style.css pauses the loops via animation-play-state.
 *
 * Progressive enhancement: with no IntersectionObserver (or no JS) the
 * animations simply keep their default always-on behavior.
 */

const hero = document.querySelector(".hero");

if (hero && "IntersectionObserver" in window) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        entry.target.classList.toggle("is-offstage", !entry.isIntersecting);
      }
    },
    { rootMargin: "120px" }
  );
  io.observe(hero);
}
