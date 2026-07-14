/**
 * SpotterAI — shared focus trap for modal dialogs
 * ============================================================================
 * Every modal follows the same convention: role="dialog" + aria-modal="true",
 * toggled open with an `is-open` class and aria-hidden="false" (account,
 * exercise detail, exercise picker, food picker, onboarding, workout summary,
 * pain). Each owning module already handles Escape, initial focus, and focus
 * restore; the one shared gap is Tab walking out of the open dialog into the
 * page behind it. This single document-level listener closes that gap for
 * all of them.
 *
 * The chat panel is role="dialog" WITHOUT aria-modal="true" — it's a
 * non-modal side panel and Tab may leave it, so it is deliberately excluded.
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), ' +
  'select:not([disabled]), textarea:not([disabled]), summary, ' +
  '[tabindex]:not([tabindex="-1"])';

function openModal() {
  for (const d of document.querySelectorAll('[role="dialog"][aria-modal="true"]')) {
    if (d.getAttribute("aria-hidden") !== "true" && d.offsetWidth > 0) return d;
  }
  return null;
}

document.addEventListener("keydown", (e) => {
  if (e.key !== "Tab") return;
  const modal = openModal();
  if (!modal) return;

  const items = [...modal.querySelectorAll(FOCUSABLE)].filter(
    (el) => el.offsetWidth > 0 || el.offsetHeight > 0
  );
  if (!items.length) return;

  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;

  if (!modal.contains(active)) {
    // Focus escaped (or never entered): pull it back in.
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  } else if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
});
