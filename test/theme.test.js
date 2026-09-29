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
  // index.html ships a light and a dark theme-color meta; _meta is the first.
  const metas = ["(prefers-color-scheme: light)", "(prefers-color-scheme: dark)"].map((media) => ({
    attrs: { name: "theme-color", media, content: "" },
    setAttribute(k, v) { this.attrs[k] = v; },
  }));
  const meta = metas[0];
  const root = {
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    removeAttribute(k) { delete this.attrs[k]; },
    getAttribute(k) { return this.attrs[k] ?? null; },
  };
  return {
    documentElement: root,
    _meta: meta,
    _metas: metas,
    querySelector: (sel) => (sel.includes("theme-color") ? meta : null),
    querySelectorAll: (sel) => (sel.includes("theme-color") ? metas : []),
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

test("every theme-color meta takes the effective colour, so the light and dark pair cannot disagree", () => {
  // The pair is scoped by prefers-color-scheme so the chrome is right before
  // any script runs. After a reader chooses, the choice wins over the OS: dark
  // picked on a light OS must not leave the light-scoped meta in charge.
  const doc = fakeDoc();
  applyTheme("dark", { doc, media: { matches: false } });
  assert.deepEqual(doc._metas.map((m) => m.attrs.content), [THEME_COLOR.dark, THEME_COLOR.dark]);
  applyTheme("light", { doc, media: { matches: true } });
  assert.deepEqual(doc._metas.map((m) => m.attrs.content), [THEME_COLOR.light, THEME_COLOR.light]);
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
  doc.querySelectorAll = (sel) => (sel.includes("theme-color") ? doc._metas : buttons);
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

test("the chrome colours are the page grounds, in both themes", () => {
  // THEME_COLOR is what the browser paints around the page, so it has to be
  // the colour the page itself is painted. The manifest had drifted to an
  // older light ground (#f5f8f6) that nothing else used any more.
  const css = readFileSync(join(root, "style.css"), "utf8");
  assert.equal(css.match(/--bg:\s*(#[0-9a-fA-F]{6})\s*;/)?.[1], THEME_COLOR.light);
  assert.equal(css.match(/--d-bg:\s*(#[0-9a-fA-F]{6})\s*;/)?.[1], THEME_COLOR.dark);
});

test("before any script runs, the browser chrome and canvas already follow the OS", () => {
  // theme.js repaints the chrome once it runs, but it is a deferred module.
  // Until then the static tags decide: one light theme-color was showing a
  // light address bar above a dark page, and color-scheme "light" painted a
  // light canvas under it while the stylesheet loaded.
  const html = readFileSync(join(root, "index.html"), "utf8");
  const metas = [...html.matchAll(/<meta name="theme-color"([^>]*)>/g)].map(([, attrs]) => ({
    media: attrs.match(/media="([^"]+)"/)?.[1],
    content: attrs.match(/content="([^"]+)"/)?.[1],
  }));
  assert.deepEqual(metas, [
    { media: "(prefers-color-scheme: light)", content: THEME_COLOR.light },
    { media: "(prefers-color-scheme: dark)", content: THEME_COLOR.dark },
  ]);
  assert.match(html, /<meta name="color-scheme" content="light dark" \/>/);
});

test("the pre-paint script pins the canvas to an explicit choice, and leaves system alone", () => {
  // Run the real inline script against a stand-in document. "light dark"
  // follows the OS, so a reader who chose the other theme would get the OS
  // canvas for a moment on every cold start unless the script narrows it.
  const html = readFileSync(join(root, "index.html"), "utf8");
  const head = html.slice(0, html.indexOf('<link rel="stylesheet"'));
  const source = [...head.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.includes(THEME_KEY));
  assert.ok(source, "the inline pre-paint script should be in <head>, before the stylesheet");

  const run = (stored) => {
    const attrs = {};
    const scheme = { content: "light dark", setAttribute(k, v) { this[k] = v; } };
    const document = {
      documentElement: { setAttribute: (k, v) => { attrs[k] = v; } },
      querySelector: (sel) => (sel.includes("color-scheme") ? scheme : null),
    };
    const localStorage = { getItem: (k) => (k === THEME_KEY ? stored : null) };
    new Function("document", "localStorage", source)(document, localStorage);
    return { theme: attrs["data-theme"] ?? null, scheme: scheme.content };
  };
  assert.deepEqual(run("dark"), { theme: "dark", scheme: "dark" });
  assert.deepEqual(run("light"), { theme: "light", scheme: "light" });
  assert.deepEqual(run("system"), { theme: null, scheme: "light dark" });
  assert.deepEqual(run(null), { theme: null, scheme: "light dark" });
});

test("the pre-paint script survives blocked storage and a missing color-scheme tag", () => {
  // It runs before anything else on the page, so a throw here is a blank
  // stylesheet-less moment with nothing to report it. The theme attribute is
  // set first on purpose: a page without the color-scheme tag still gets it.
  const html = readFileSync(join(root, "index.html"), "utf8");
  const head = html.slice(0, html.indexOf('<link rel="stylesheet"'));
  const source = [...head.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.includes(THEME_KEY));
  const run = (localStorage, hasMeta) => {
    const attrs = {};
    const document = {
      documentElement: { setAttribute: (k, v) => { attrs[k] = v; } },
      querySelector: () => (hasMeta ? { setAttribute() {} } : null),
    };
    new Function("document", "localStorage", source)(document, localStorage);
    return attrs["data-theme"] ?? null;
  };
  const blocked = { getItem() { throw new Error("blocked"); } };
  assert.doesNotThrow(() => run(blocked, true));
  assert.equal(run(blocked, true), null, "blocked storage falls back to following the OS");
  assert.equal(run({ getItem: () => "dark" }, false), "dark", "a missing tag must not cost the reader their theme");
});
