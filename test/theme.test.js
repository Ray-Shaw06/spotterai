/**
 * Colour-scheme preference logic.
 *
 * The failure that matters here is subtle: picking "system" has to REMOVE the
 * data-theme attribute, not set it to "light". Setting it pins the app to
 * light forever, because style.css's prefers-color-scheme query is written to
 * lose to an explicit [data-theme="light"]. Both spellings look identical the
 * moment you click them in a light OS, and the bug only shows up later, on
 * someone else's machine, after dark mode turns on at sunset.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  THEME_KEY, THEME_PREFS, THEME_COLOR,
  normalizePref, themeAttr, effectiveTheme, applyTheme, initTheme,
} from "../theme.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---- pure rules -------------------------------------------------------------

test("unknown, missing or cleared preferences fall back to following the system", () => {
  for (const junk of [null, undefined, "", "DARK", "auto", 0, {}]) {
    assert.equal(normalizePref(junk), "system", `${JSON.stringify(junk)} should normalize to system`);
  }
  for (const p of THEME_PREFS) assert.equal(normalizePref(p), p);
});

test('"system" removes the attribute rather than pinning it to light', () => {
  assert.equal(themeAttr("system"), null);
  assert.equal(themeAttr("light"), "light");
  assert.equal(themeAttr("dark"), "dark");
  assert.equal(themeAttr("nonsense"), null, "a junk value must also keep tracking the system");
});

test("the effective theme follows the system only while the preference is system", () => {
  assert.equal(effectiveTheme("system", true), "dark");
  assert.equal(effectiveTheme("system", false), "light");
  // An explicit choice overrides the system in BOTH directions.
  assert.equal(effectiveTheme("light", true), "light");
  assert.equal(effectiveTheme("dark", false), "dark");
});

// ---- DOM application --------------------------------------------------------

function fakeDoc() {
  const meta = { attrs: { name: "theme-color", content: "" }, setAttribute(k, v) { this.attrs[k] = v; } };
  const root = {
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    removeAttribute(k) { delete this.attrs[k]; },
    getAttribute(k) { return this.attrs[k] ?? null; },
  };
  return {
    documentElement: root,
    _meta: meta,
    querySelector: (sel) => (sel.includes("theme-color") ? meta : null),
    querySelectorAll: () => [],
  };
}

test("applying a preference sets the attribute and the browser chrome colour", () => {
  const doc = fakeDoc();

  assert.equal(applyTheme("dark", { doc, media: { matches: false } }), "dark");
  assert.equal(doc.documentElement.getAttribute("data-theme"), "dark");
  assert.equal(doc._meta.attrs.content, THEME_COLOR.dark);

  assert.equal(applyTheme("light", { doc, media: { matches: true } }), "light");
  assert.equal(doc.documentElement.getAttribute("data-theme"), "light");
  assert.equal(doc._meta.attrs.content, THEME_COLOR.light);

  // Back to system on a dark OS: attribute gone, chrome follows the system.
  assert.equal(applyTheme("system", { doc, media: { matches: true } }), "dark");
  assert.equal(doc.documentElement.getAttribute("data-theme"), null);
  assert.equal(doc._meta.attrs.content, THEME_COLOR.dark);
});

// ---- wiring -----------------------------------------------------------------

function fakeEnv({ stored = null, systemDark = false } = {}) {
  const doc = fakeDoc();
  const buttons = THEME_PREFS.map((p) => ({
    dataset: { themePref: p },
    attrs: {},
    handlers: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(t, fn) { this.handlers[t] = fn; },
    removeEventListener(t) { delete this.handlers[t]; },
    click() { this.handlers.click?.({ currentTarget: this }); },
  }));
  doc.querySelectorAll = () => buttons;
  const mqHandlers = {};
  const media = {
    matches: systemDark,
    addEventListener: (t, fn) => { mqHandlers[t] = fn; },
    removeEventListener: (t) => { delete mqHandlers[t]; },
    fire() { mqHandlers.change?.(); },
  };
  const saved = { value: stored };
  const store = { getItem: () => saved.value, setItem: (_k, v) => { saved.value = v; } };
  return { doc, buttons, media, store, saved };
}

test("a stored choice is restored and reflected in the control", () => {
  const { doc, buttons, media, store } = fakeEnv({ stored: "dark" });
  initTheme({ doc, store, media });
  assert.equal(doc.documentElement.getAttribute("data-theme"), "dark");
  const pressed = buttons.filter((b) => b.attrs["aria-pressed"] === "true").map((b) => b.dataset.themePref);
  assert.deepEqual(pressed, ["dark"], "exactly the stored option reads as pressed");
});

test("choosing an option applies and persists it", () => {
  const { doc, buttons, media, store, saved } = fakeEnv();
  initTheme({ doc, store, media });

  buttons.find((b) => b.dataset.themePref === "dark").click();
  assert.equal(doc.documentElement.getAttribute("data-theme"), "dark");
  assert.equal(saved.value, "dark");

  buttons.find((b) => b.dataset.themePref === "system").click();
  assert.equal(doc.documentElement.getAttribute("data-theme"), null, "system must clear the attribute");
  assert.equal(saved.value, "system");
});

test("while on system, an OS change is followed live", () => {
  const { doc, media, store } = fakeEnv({ stored: "system", systemDark: false });
  initTheme({ doc, store, media });
  assert.equal(doc._meta.attrs.content, THEME_COLOR.light);

  media.matches = true;
  media.fire();
  assert.equal(doc._meta.attrs.content, THEME_COLOR.dark, "chrome colour tracks the OS");
  assert.equal(doc.documentElement.getAttribute("data-theme"), null, "still no attribute — the CSS decides");
});

test("a storage that throws does not stop the app theming itself", () => {
  const { doc, buttons, media } = fakeEnv();
  const hostile = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
  };
  assert.doesNotThrow(() => {
    initTheme({ doc, store: hostile, media });
    buttons.find((b) => b.dataset.themePref === "dark").click();
  });
  assert.equal(doc.documentElement.getAttribute("data-theme"), "dark", "the choice still applies this session");
});

test("teardown detaches the listeners it added", () => {
  const { doc, buttons, media, store } = fakeEnv();
  const detach = initTheme({ doc, store, media });
  detach();
  assert.deepEqual(buttons.map((b) => Object.keys(b.handlers)), buttons.map(() => []));
});

// ---- the inline no-flash copy ----------------------------------------------

test("the pre-paint inline script agrees with this module", () => {
  // It is duplicated on purpose (a deferred module cannot beat first paint),
  // so the duplication is pinned: same storage key, same two attribute values,
  // and it must not set the attribute for "system".
  const html = readFileSync(join(root, "index.html"), "utf8");
  const inline = html.slice(0, html.indexOf('<link rel="stylesheet"'));
  assert.ok(inline.includes(THEME_KEY), `the inline script must read ${THEME_KEY}`);
  assert.match(inline, /=== *"dark" *\|\| *\w+ *=== *"light"/, "only explicit choices set the attribute");
  assert.match(inline, /setAttribute\(\s*"data-theme"/, "the inline script sets data-theme");
  assert.match(inline, /catch/, "blocked storage must not throw before paint");
});
