/**
 * SpotterAI — colour scheme
 * ============================================================================
 * Light is the default and stays the default: this gets used in a gym in
 * daylight, and a dark app is worse there. Dark is opt-in, two ways — the
 * reader's own system preference, or an explicit choice in the account sheet
 * that overrides it in both directions.
 *
 * Three states, not a boolean, because "follow my system" is a real answer and
 * a two-way switch cannot express it:
 *
 *   system  →  no data-theme attribute; style.css's prefers-color-scheme
 *              query decides, and follows the OS if it changes mid-session
 *   light   →  data-theme="light", which the query is written to lose to
 *   dark    →  data-theme="dark"
 *
 * The stylesheet is the source of truth for what each state looks like. This
 * module only decides which state is active. A matching two-line script runs
 * inline in <head> so the attribute is set before first paint; module scripts
 * are deferred, and without it a reader who chose dark would get a full white
 * flash on every cold load.
 */

export const THEME_KEY = "spotter.theme";
export const THEME_PREFS = ["system", "light", "dark"];

/** Anything we did not write, or a cleared store, means "follow the system". */
export function normalizePref(raw) {
  return THEME_PREFS.includes(raw) ? raw : "system";
}

/**
 * Pure: the value for the data-theme attribute, or null to remove it.
 * Null is not "light" — removing the attribute is what re-arms the media
 * query, so the app keeps tracking the OS after the reader picks "system".
 */
export function themeAttr(pref) {
  const p = normalizePref(pref);
  return p === "system" ? null : p;
}

/** Pure: what the reader will actually see, which the theme-color meta needs. */
export function effectiveTheme(pref, systemPrefersDark) {
  const p = normalizePref(pref);
  return p === "system" ? (systemPrefersDark ? "dark" : "light") : p;
}

/** Browser chrome colour per theme — kept in step with --bg in style.css. */
export const THEME_COLOR = { light: "#eef2f0", dark: "#0a0e0c" };

/**
 * Apply a preference to the document.
 * @returns {"light"|"dark"} the effective theme that was applied
 */
export function applyTheme(pref, { doc = document, media } = {}) {
  const attr = themeAttr(pref);
  const root = doc.documentElement;
  if (attr) root.setAttribute("data-theme", attr);
  else root.removeAttribute("data-theme");

  const systemDark = media ? media.matches : false;
  const effective = effectiveTheme(pref, systemDark);
  const meta = doc.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLOR[effective]);
  return effective;
}

/**
 * Wire the three-way control and keep it in step with the OS.
 * @returns {() => void} teardown
 */
export function initTheme({ doc = document, store, media } = {}) {
  const storage = store ?? (() => {
    try {
      return window.localStorage;
    } catch {
      return null; // private mode / blocked site data: fall back to session-only
    }
  })();
  const mq = media ?? (typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null);

  let pref = "system";
  try {
    pref = normalizePref(storage?.getItem(THEME_KEY));
  } catch { /* unreadable store: the default is already correct */ }

  const buttons = [...doc.querySelectorAll("[data-theme-pref]")];
  const paint = () => {
    applyTheme(pref, { doc, media: mq });
    for (const b of buttons) {
      b.setAttribute("aria-pressed", b.dataset.themePref === pref ? "true" : "false");
    }
  };
  paint();

  const onClick = (e) => {
    pref = normalizePref(e.currentTarget.dataset.themePref);
    try {
      storage?.setItem(THEME_KEY, pref);
    } catch { /* the choice still applies for this session */ }
    paint();
  };
  for (const b of buttons) b.addEventListener("click", onClick);

  // Only matters while the preference is "system", but repainting on an
  // explicit choice is harmless and keeps the meta colour honest.
  const onSystem = () => paint();
  mq?.addEventListener?.("change", onSystem);

  return () => {
    for (const b of buttons) b.removeEventListener("click", onClick);
    mq?.removeEventListener?.("change", onSystem);
  };
}

if (typeof document !== "undefined") initTheme();
