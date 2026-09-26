/**
 * SpotterAI — food search
 * ----------------------------------------------------------------------------
 * GET /api/food-search?q=greek%20yogurt  ->  { foods: [...] }
 *
 * The Open Food Facts lookup behind the food picker's online results. The
 * browser cannot make it reliably on its own; see lib/food-search.js.
 *
 * No AI and no key. Successful answers are cached at the CDN per query, so a
 * common food is fetched from OFF about once a day, not once per person.
 */

import { normalizeFoodQuery } from "../foods.js";
import { searchOffFoods } from "../lib/food-search.js";
import { enforceRateLimit } from "../lib/rate-limit.js";
import { withSentry } from "../lib/sentry-server.js";

async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed. Use GET." });
  }

  if (enforceRateLimit("foodSearch", req, res)) return;

  const raw = req.query?.q ?? new URL(req.url || "", "http://localhost").searchParams.get("q");
  const q = normalizeFoodQuery(raw);
  if (q.length < 2) return res.status(400).json({ error: "Search for at least 2 characters." });

  try {
    const foods = await searchOffFoods(q);
    res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
    return res.status(200).json({ foods });
  } catch {
    res.setHeader("Cache-Control", "no-store");
    return res.status(502).json({ error: "Food search is unavailable right now." });
  }
}

export default withSentry(handler, { route: "food-search" });
