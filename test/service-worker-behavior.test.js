import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "service-worker.js"), "utf8");
const html = readFileSync(join(root, "index.html"), "utf8");
const currentCache = source.match(/const CACHE = "([^"]+)"/)?.[1];

function bootModuleGraph() {
  const entries = [...html.matchAll(/<script\b([^>]*)>/gi)]
    .map((match) => match[1])
    .filter((attributes) => /\btype=["']module["']/i.test(attributes))
    .map((attributes) => attributes.match(/\bsrc=["']([^"']+)["']/i)?.[1])
    .filter((path) => path && !/^(?:[a-z]+:)?\/\//i.test(path));
  const graph = new Set();
  const visit = (relativePath) => {
    const modulePath = normalize(relativePath).replaceAll("\\", "/").replace(/^\.\//, "");
    if (graph.has(modulePath)) return;
    graph.add(modulePath);
    const moduleSource = readFileSync(join(root, modulePath), "utf8");
    const specifiers = [
      ...moduleSource.matchAll(/\b(?:import|export)\s+(?:[\w*{},\s]+?\s+from\s+)?["'](\.[^"']+)["']/g),
      ...moduleSource.matchAll(/\bimport\(\s*["'](\.[^"']+)["']\s*\)/g),
    ].map((match) => match[1]);
    for (const specifier of specifiers) visit(join(dirname(modulePath), specifier));
  };
  for (const entry of entries) visit(entry);
  return graph;
}

function harness({ windows = [], precacheFailure = null, existingCaches = {}, offline = false } = {}) {
  const handlers = new Map();
  const shown = [];
  const opened = [];
  const cacheStorage = new Map(Object.entries(existingCaches).map(([name, assets]) => [name, new Set(assets)]));
  let skipWaitingCalls = 0;
  let claimCalls = 0;
  const cacheKey = (request) => {
    if (typeof request === "string") return request;
    const url = new URL(request.url);
    return url.pathname === "/" ? "./" : url.pathname.replace(/^\//, "");
  };
  const cachedResponse = (request) => {
    const key = cacheKey(request);
    for (const assets of cacheStorage.values()) {
      if (assets.has(key)) return new Response(`cached:${key}`);
    }
    return undefined;
  };
  const self = {
    location: { origin: "https://spotter.example" },
    addEventListener: (name, handler) => handlers.set(name, handler),
    skipWaiting: async () => { skipWaitingCalls += 1; },
    registration: {
      showNotification: async (...args) => { shown.push(args); },
    },
    clients: {
      claim: async () => { claimCalls += 1; },
      matchAll: async () => windows,
      openWindow: async (url) => { opened.push(url); },
    },
  };
  const context = vm.createContext({
    self,
    URL,
    Response,
    fetch: async () => {
      if (offline) throw new Error("offline");
      return new Response("ok");
    },
    caches: {
      open: async (name) => {
        if (!cacheStorage.has(name)) cacheStorage.set(name, new Set());
        const assets = cacheStorage.get(name);
        return {
          add: async (url) => {
            if (url === precacheFailure) throw new Error("precache failed");
            assets.add(url);
          },
          addAll: async (urls) => {
            if (urls.includes(precacheFailure)) throw new Error("precache failed");
            for (const url of urls) assets.add(url);
          },
          put: async (request) => { assets.add(cacheKey(request)); },
        };
      },
      keys: async () => [...cacheStorage.keys()],
      delete: async (name) => cacheStorage.delete(name),
      match: async (request) => cachedResponse(request),
    },
    Promise,
    Set,
    Object,
    encodeURIComponent,
  });
  vm.runInContext(source, context, { filename: "service-worker.js" });
  return {
    handlers,
    shown,
    opened,
    skipWaitingCalls: () => skipWaitingCalls,
    claimCalls: () => claimCalls,
    cacheNames: () => [...cacheStorage.keys()],
    cacheAssets: (name) => new Set(cacheStorage.get(name) || []),
  };
}

async function dispatch(handler, event) {
  let pending;
  handler({ ...event, waitUntil: (promise) => { pending = promise; } });
  await pending;
}

function dispatchFetch(handler, request) {
  let response;
  handler({ request, respondWith: (promise) => { response = Promise.resolve(promise); } });
  return response;
}

test("a failed v36 boot precache leaves the active v35 cache available and cannot activate", async () => {
  const workingAssets = ["./", "index.html", "style.css", "app.js"];
  const { handlers, skipWaitingCalls, claimCalls, cacheAssets, cacheNames } = harness({
    precacheFailure: "app.js",
    existingCaches: { "spotterai-v35": workingAssets },
  });

  await assert.rejects(dispatch(handlers.get("install"), {}), /precache failed/);
  assert.equal(skipWaitingCalls(), 0);
  assert.equal(claimCalls(), 0);
  assert.deepEqual([...cacheAssets("spotterai-v35")].sort(), [...workingAssets].sort());
  assert.deepEqual([...cacheAssets(currentCache)], []);
  assert.deepEqual(cacheNames(), ["spotterai-v35", currentCache]);
});

test("activation supports an offline relaunch for the complete local boot module graph", async () => {
  const modules = bootModuleGraph();
  const { handlers, cacheAssets, cacheNames, claimCalls } = harness({
    existingCaches: { "spotterai-v35": ["stale.js"] },
    offline: true,
  });

  await dispatch(handlers.get("install"), {});
  await dispatch(handlers.get("activate"), {});

  const cached = cacheAssets(currentCache);
  const missing = [...modules].filter((modulePath) => !cached.has(modulePath));
  assert.deepEqual(missing, []);
  assert.equal([...cached].some((asset) => /^(?:[a-z]+:)?\/\//i.test(asset) || /^\/?api\//.test(asset)), false);
  assert.deepEqual(cacheNames(), [currentCache]);
  assert.equal(claimCalls(), 1);

  const navigation = await dispatchFetch(handlers.get("fetch"), {
    method: "GET",
    mode: "navigate",
    url: "https://spotter.example/#/today",
  });
  assert.equal(await navigation.text(), "cached:index.html");
  for (const modulePath of modules) {
    const response = await dispatchFetch(handlers.get("fetch"), {
      method: "GET",
      mode: "cors",
      url: `https://spotter.example/${modulePath}`,
    });
    assert.equal(await response.text(), `cached:${modulePath}`, `${modulePath} must load during an offline relaunch`);
  }

  assert.equal(dispatchFetch(handlers.get("fetch"), {
    method: "GET",
    mode: "cors",
    url: "https://spotter.example/api/generate",
  }), undefined);
  assert.equal(dispatchFetch(handlers.get("fetch"), {
    method: "GET",
    mode: "cors",
    url: "https://fonts.googleapis.com/css2",
  }), undefined);
});

test("the service worker registers no push handler (remote Web Push is retired)", () => {
  const { handlers } = harness();
  assert.equal(handlers.has("push"), false);
  assert.doesNotMatch(source, /addEventListener\(\s*["']push["']/);
});

test("notification click navigates and focuses only an existing same-origin client, ignoring any payload URL", async () => {
  const actions = [];
  const windows = [
    { url: "https://evil.example/", navigate: async () => actions.push("evil-navigate"), focus: async () => actions.push("evil-focus") },
    { url: "https://spotter.example/#/account", navigate: async (url) => actions.push(["navigate", url]), focus: async () => actions.push("focus") },
  ];
  const { handlers, opened } = harness({ windows });
  let closed = false;
  // A payload URL must be completely ignored — the destination is fixed.
  await dispatch(handlers.get("notificationclick"), {
    notification: { data: { kind: "rest", url: "https://evil.example/" }, close: () => { closed = true; } },
  });

  assert.equal(closed, true);
  assert.deepEqual(actions, [["navigate", "https://spotter.example/#/today"], "focus"]);
  assert.deepEqual(opened, []);
});

test("notification click opens the canonical same-origin Today URL when no client is reusable", async () => {
  const { handlers, opened } = harness({ windows: [] });
  await dispatch(handlers.get("notificationclick"), {
    notification: { data: { url: "javascript:alert(1)" }, close: () => {} },
  });

  assert.deepEqual(opened, ["https://spotter.example/#/today"]);
});
