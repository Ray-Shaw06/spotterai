/**
 * Open Food Facts text search, run on the server.
 * ----------------------------------------------------------------------------
 * The browser can only use OFF's legacy /cgi/search.pl, the one endpoint that
 * sends a CORS header, and it returned 503 on about half of requests when
 * probed on 2026-09-25. OFF's newer search (search.openfoodfacts.org) answered
 * 10 of 10 in under 1.5s but sends no CORS header, so only a server can call
 * it. This tries the newer search first and keeps the legacy one as a
 * fallback, all inside one deadline that fits the route's maxDuration.
 */

import { normalizeFoodQuery, offProductToFood } from "../foods.js";

// OFF asks API callers to identify themselves in the User-Agent.
const USER_AGENT = "SpotterAI/1.0 (https://spotterai-flax.vercel.app)";
const FIELDS = "product_name,brands,nutriments";
const PAGE_SIZE = 20;

const NEW_SEARCH = {
  url: (q) => `https://search.openfoodfacts.org/search?q=${encodeURIComponent(q)}&page_size=${PAGE_SIZE}&fields=${FIELDS}`,
  products: (data) => data?.hits,
};
const LEGACY_SEARCH = {
  url: (q) =>
    `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}` +
    `&search_simple=1&action=process&json=1&page_size=${PAGE_SIZE}&fields=${FIELDS}`,
  products: (data) => data?.products,
};
// The newer search rarely fails, so it gets a second try before the legacy one.
const ATTEMPTS = [NEW_SEARCH, NEW_SEARCH, LEGACY_SEARCH, LEGACY_SEARCH];

// Not worth starting an attempt with less time than this left.
const MIN_ATTEMPT_MS = 500;

/**
 * @param {string} query
 * @param {object} [opts]
 * @param {Function} [opts.fetchImpl]  - Injected in tests.
 * @param {number}   [opts.deadlineMs] - Total budget across every attempt.
 * @param {number}   [opts.attemptMs]  - Cap on any single attempt.
 * @returns {Promise<Array>} Per-100g foods; empty when nothing matches.
 * @throws when every attempt failed.
 */
export async function searchOffFoods(query, { fetchImpl = fetch, deadlineMs = 8000, attemptMs = 3500 } = {}) {
  const q = normalizeFoodQuery(query);
  if (q.length < 2) return [];

  const startedAt = Date.now();
  let lastError = new Error("Open Food Facts search ran out of time");
  for (const source of ATTEMPTS) {
    const left = deadlineMs - (Date.now() - startedAt);
    if (left < MIN_ATTEMPT_MS) break;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(attemptMs, left));
    try {
      const res = await fetchImpl(source.url(q), {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Open Food Facts ${res.status}`);
      const products = source.products(await res.json());
      if (!Array.isArray(products)) throw new Error("Open Food Facts returned no product list");
      return products.map(offProductToFood).filter(Boolean).slice(0, PAGE_SIZE);
    } catch (err) {
      lastError = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}
