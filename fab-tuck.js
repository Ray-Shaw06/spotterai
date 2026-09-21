/**
 * SpotterAI — coach launcher auto-tuck
 * ============================================================================
 * The coach launcher is fixed to the bottom-right corner. On a narrow screen
 * that corner is content: at 390px the button sits directly on top of whatever
 * card is beneath it, and on the landing page it covered the end of the audit
 * card's headline. Padding every page to clear it would cost ~60px of width on
 * the device that has the least to spare, which is the worse trade.
 *
 * So the launcher gets out of the way while you are reading forward, and comes
 * back the moment you reach for it: tuck on scroll down, untuck on scroll up.
 * That is the same gesture browser chrome already uses, so it needs no
 * explaining and no affordance of its own.
 *
 * It deliberately never tucks where doing so would strand the control:
 *
 *   - while the panel is open — the launcher is the close button,
 *   - while it holds keyboard focus — tucking would move focus to a control
 *     the user cannot see, which is the accessibility failure this whole
 *     pattern is usually guilty of,
 *   - in the top zone of a page, where it is a primary call to action,
 *   - at the bottom, where the page's own bottom padding already clears it.
 *
 * Progressive enhancement: with no JS, or no matchMedia, the launcher simply
 * stays put — the behaviour that shipped before this file existed.
 */

/** Scroll jitter below this is ignored, so a trackpad twitch cannot flicker it. */
export const TUCK_DELTA = 6;
/** Top of the page: the launcher is an offer here, not an obstruction. */
export const TUCK_TOP_ZONE = 160;
/** Within this of the bottom, page padding already clears the launcher. */
export const TUCK_BOTTOM_SLACK = 80;

/**
 * Pure: should the launcher be tucked away?
 *
 * Kept separate from the DOM so the rules above can be asserted directly,
 * including the ones that only matter in states that are painful to stage in a
 * real browser (focus held, panel open, bounce-scrolled past the end).
 *
 * @param {object} o
 * @param {boolean} o.tucked     current state — returned unchanged below the delta
 * @param {number}  o.lastY      previous scrollY
 * @param {number}  o.y          current scrollY
 * @param {number}  o.docH       full scrollable height
 * @param {number}  o.viewH      viewport height
 * @param {boolean} [o.focused]  launcher holds keyboard focus
 * @param {boolean} [o.panelOpen] chat panel is open
 * @returns {boolean}
 */
export function nextTucked({ tucked, lastY, y, docH, viewH, focused = false, panelOpen = false }) {
  // Never strand the control.
  if (panelOpen || focused) return false;

  // Clamp: iOS rubber-banding reports negative scrollY and overscroll past the
  // end, either of which would otherwise read as a large delta in one frame.
  const top = Math.max(0, y);
  const maxY = Math.max(0, docH - viewH);
  const atBottom = maxY - top <= TUCK_BOTTOM_SLACK;

  if (top <= TUCK_TOP_ZONE) return false;
  if (atBottom) return false;

  const delta = top - Math.max(0, lastY);
  if (delta > TUCK_DELTA) return true;   // reading forward — get out of the way
  if (delta < -TUCK_DELTA) return false; // reaching back — come back
  return tucked;                          // below the noise floor: hold steady
}

/**
 * Wire the pure rule above to a real launcher.
 *
 * @param {object} o
 * @param {HTMLElement} o.fab
 * @param {() => boolean} o.isPanelOpen
 * @param {Window} [o.env]
 * @returns {() => void} detach
 */
export function attachFabTuck({ fab, isPanelOpen, env = globalThis }) {
  if (!fab || typeof env.addEventListener !== "function") return () => {};

  let tucked = false;
  let lastY = Math.max(0, env.scrollY || 0);
  let queued = false;

  const settle = () => {
    queued = false;
    const doc = env.document?.documentElement;
    const y = Math.max(0, env.scrollY || 0);
    const next = nextTucked({
      tucked,
      lastY,
      y,
      docH: doc?.scrollHeight ?? 0,
      viewH: env.innerHeight ?? 0,
      focused: env.document?.activeElement === fab,
      panelOpen: isPanelOpen(),
    });
    lastY = y;
    if (next === tucked) return;
    tucked = next;
    fab.classList.toggle("is-tucked", tucked);
    // Mirrored to aria-hidden so a screen reader is not offered a control that
    // is visually gone; `visibility: hidden` in the stylesheet takes it out of
    // the tab order at the same time.
    fab.setAttribute("aria-hidden", tucked ? "true" : "false");
  };

  // rAF-coalesced: a scroll burst fires far more often than the page paints.
  const onScroll = () => {
    if (queued) return;
    queued = true;
    (env.requestAnimationFrame ?? ((f) => f()))(settle);
  };

  env.addEventListener("scroll", onScroll, { passive: true });
  return () => env.removeEventListener("scroll", onScroll);
}
