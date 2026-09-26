/**
 * Server-side Open Food Facts search.
 *
 * Why it exists: the browser can only reach OFF's legacy /cgi/search.pl, which
 * returned 503 on about half of requests on 2026-09-25, so the food picker's
 * online results were a coin flip. OFF's newer search answered 10 of 10, but
 * it sends no CORS header, so only a server can call it.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { searchOffFoods } from "../lib/food-search.js";
import handler from "../api/food-search.js";
import { searchOpenFoodFacts } from "../foods.js";
import { __resetRateLimitForTests } from "../lib/rate-limit.js";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const unavailable = () => new Response("<!DOCTYPE html><title>503</title>", { status: 503 });

const NEW_HITS = {
  hits: [
    { product_name: "Nonfat Greek Yogurt", brands: ["Fage"], nutriments: { "energy-kcal_100g": 59, proteins_100g: 10.3, carbohydrates_100g: 3.6, fat_100g: 0.4 } },
    { product_name: "No calories listed", brands: ["X"], nutriments: {} },
  ],
};
const LEGACY_PRODUCTS = {
  products: [{ product_name: "Greek Style Yogurt", brands: "Pilos, Lidl", nutriments: { "energy-kcal_100g": 96, proteins_100g: 5, carbohydrates_100g: 4, fat_100g: 7 } }],
};

function makeRes() {
  const res = { statusCode: null, body: null, headers: {} };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  res.setHeader = (key, value) => { res.headers[key] = value; return res; };
  return res;
}
const makeReq = (method, q) => ({ method, query: { q }, url: `/api/food-search?q=${encodeURIComponent(q)}`, headers: { "x-forwarded-for": "203.0.113.9" } });

test("searches OFF's newer search first, identifies itself, and keeps only foods with calories", async () => {
  const calls = [];
  const foods = await searchOffFoods("Greek  Yogurt ", {
    fetchImpl: async (url, init) => { calls.push({ url, init }); return json(NEW_HITS); },
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/search\.openfoodfacts\.org\/search\?q=greek%20yogurt&/);
  assert.match(calls[0].init.headers["User-Agent"], /^SpotterAI\//);
  assert.deepEqual(foods, [{ name: "Fage Nonfat Greek Yogurt", serving: "100 g", kcal: 59, protein: 10.3, carbs: 3.6, fat: 0.4, source: "off" }]);
});

test("falls back to the legacy search when the newer one fails twice", async () => {
  const urls = [];
  const foods = await searchOffFoods("greek yogurt", {
    fetchImpl: async (url) => {
      urls.push(url);
      return url.startsWith("https://search.openfoodfacts.org") ? unavailable() : json(LEGACY_PRODUCTS);
    },
  });

  assert.equal(urls.length, 3, "new, new, then legacy");
  assert.match(urls[2], /^https:\/\/world\.openfoodfacts\.org\/cgi\/search\.pl\?search_terms=greek%20yogurt&/);
  assert.deepEqual(foods.map((f) => f.name), ["Pilos Greek Style Yogurt"]);
});

test("no matches is an answer, not a failure", async () => {
  let calls = 0;
  const foods = await searchOffFoods("zzqx", { fetchImpl: async () => { calls += 1; return json({ hits: [] }); } });
  assert.deepEqual(foods, []);
  assert.equal(calls, 1);
});

test("stops inside its deadline when every source hangs", async () => {
  const hang = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
  });
  const startedAt = Date.now();
  await assert.rejects(searchOffFoods("banana", { fetchImpl: hang, deadlineMs: 1200, attemptMs: 400 }));
  assert.ok(Date.now() - startedAt < 1500, `took ${Date.now() - startedAt}ms`);
});

test("the route answers GET with foods the CDN may cache, and refuses the rest", async () => {
  __resetRateLimitForTests();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => json(NEW_HITS);
  try {
    const ok = makeRes();
    await handler(makeReq("GET", "greek yogurt"), ok);
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.body.foods[0].name, "Fage Nonfat Greek Yogurt");
    assert.match(ok.headers["Cache-Control"], /s-maxage=\d+/);

    const post = makeRes();
    await handler(makeReq("POST", "greek yogurt"), post);
    assert.equal(post.statusCode, 405);

    const short = makeRes();
    await handler(makeReq("GET", "g"), short);
    assert.equal(short.statusCode, 400);

    globalThis.fetch = async () => unavailable();
    const down = makeRes();
    await handler(makeReq("GET", "oat milk"), down);
    assert.equal(down.statusCode, 502);
    assert.equal(down.headers["Cache-Control"], "no-store", "a failure must not be cached for a day");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the app asks its own server first and only goes to OFF directly if that fails", async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return json({ foods: [{ name: "Fage Nonfat Greek Yogurt", serving: "100 g", kcal: 59, protein: 10.3, carbs: 3.6, fat: 0.4, source: "off" }] });
  };
  try {
    const foods = await searchOpenFoodFacts("Greek Yogurt");
    assert.deepEqual(urls, ["api/food-search?q=greek%20yogurt"]);
    assert.equal(foods[0].name, "Fage Nonfat Greek Yogurt");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
