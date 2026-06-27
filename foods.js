/**
 * SpotterAI — Food database + search
 * ============================================================================
 * A built-in list of common foods (instant, offline) plus an optional online
 * lookup via Open Food Facts (free, no API key, CORS-enabled). Each food carries
 * macros for ONE serving; the UI multiplies by the quantity the user enters.
 */

// [name, serving label, kcal, protein, carbs, fat]  (per one serving)
const RAW = [
  // Protein
  ["Chicken breast, cooked", "100 g", 165, 31, 0, 3.6],
  ["Chicken thigh, cooked", "100 g", 209, 26, 0, 11],
  ["Lean beef mince, cooked", "100 g", 215, 26, 0, 12],
  ["Steak, sirloin, cooked", "100 g", 244, 27, 0, 15],
  ["Pork chop, cooked", "100 g", 231, 26, 0, 14],
  ["Salmon, cooked", "100 g", 208, 20, 0, 13],
  ["Tuna, canned in water", "100 g", 116, 26, 0, 1],
  ["Cod, cooked", "100 g", 105, 23, 0, 1],
  ["Shrimp, cooked", "100 g", 99, 24, 0, 0.3],
  ["Egg, large", "1 egg", 72, 6, 0.4, 5],
  ["Egg white", "1 white", 17, 3.6, 0.2, 0],
  ["Bacon, cooked", "1 slice", 43, 3, 0, 3.3],
  ["Turkey breast, deli", "1 slice", 22, 4, 0.5, 0.3],
  ["Tofu, firm", "100 g", 144, 17, 3, 9],
  ["Greek yogurt, plain 0%", "170 g", 100, 17, 6, 0.7],
  ["Cottage cheese, low-fat", "100 g", 72, 12, 3, 1],
  ["Whey protein powder", "1 scoop (30 g)", 120, 24, 3, 1.5],
  ["Tempeh", "100 g", 192, 20, 8, 11],
  ["Lentils, cooked", "100 g", 116, 9, 20, 0.4],
  ["Chickpeas, cooked", "100 g", 164, 9, 27, 2.6],
  ["Black beans, cooked", "100 g", 132, 9, 24, 0.5],

  // Carbs / grains
  ["White rice, cooked", "100 g", 130, 2.7, 28, 0.3],
  ["Brown rice, cooked", "100 g", 123, 2.7, 26, 1],
  ["Pasta, cooked", "100 g", 158, 6, 31, 0.9],
  ["Potato, baked", "1 medium", 161, 4.3, 37, 0.2],
  ["Sweet potato, baked", "1 medium", 112, 2, 26, 0.1],
  ["Oats, dry", "40 g", 152, 5, 27, 3],
  ["Bread, white", "1 slice", 79, 2.7, 15, 1],
  ["Bread, whole wheat", "1 slice", 81, 4, 14, 1.1],
  ["Bagel, plain", "1 bagel", 245, 10, 48, 1.5],
  ["Tortilla, flour", "1 (8 in)", 144, 4, 24, 4],
  ["Quinoa, cooked", "100 g", 120, 4.4, 21, 1.9],
  ["Cereal, cornflakes", "30 g", 113, 2, 25, 0.1],
  ["Granola", "50 g", 235, 5, 32, 10],
  ["Couscous, cooked", "100 g", 112, 3.8, 23, 0.2],

  // Fruit
  ["Banana", "1 medium", 105, 1.3, 27, 0.4],
  ["Apple", "1 medium", 95, 0.5, 25, 0.3],
  ["Orange", "1 medium", 62, 1.2, 15, 0.2],
  ["Strawberries", "100 g", 32, 0.7, 8, 0.3],
  ["Blueberries", "100 g", 57, 0.7, 14, 0.3],
  ["Grapes", "100 g", 69, 0.7, 18, 0.2],
  ["Avocado", "1/2 medium", 120, 1.5, 6, 11],
  ["Mango", "100 g", 60, 0.8, 15, 0.4],
  ["Pineapple", "100 g", 50, 0.5, 13, 0.1],
  ["Watermelon", "100 g", 30, 0.6, 8, 0.2],

  // Vegetables
  ["Broccoli, cooked", "100 g", 35, 2.4, 7, 0.4],
  ["Spinach, raw", "100 g", 23, 2.9, 3.6, 0.4],
  ["Carrot", "1 medium", 25, 0.6, 6, 0.1],
  ["Mixed salad greens", "100 g", 17, 1.4, 3, 0.2],
  ["Tomato", "1 medium", 22, 1.1, 4.8, 0.2],
  ["Bell pepper", "1 medium", 31, 1, 7, 0.3],
  ["Cucumber", "100 g", 15, 0.7, 3.6, 0.1],
  ["Green beans, cooked", "100 g", 35, 1.9, 8, 0.3],
  ["Corn, cooked", "100 g", 96, 3.4, 21, 1.5],

  // Dairy
  ["Milk, whole", "250 ml", 149, 8, 12, 8],
  ["Milk, skim", "250 ml", 83, 8, 12, 0.2],
  ["Cheddar cheese", "30 g", 120, 7, 0.4, 10],
  ["Mozzarella", "30 g", 85, 6, 1, 6],
  ["Butter", "1 tbsp", 102, 0.1, 0, 11.5],
  ["Yogurt, plain whole", "150 g", 90, 5, 7, 5],

  // Fats / nuts
  ["Almonds", "30 g", 174, 6, 6, 15],
  ["Peanut butter", "1 tbsp", 94, 4, 3, 8],
  ["Walnuts", "30 g", 196, 4.5, 4, 20],
  ["Olive oil", "1 tbsp", 119, 0, 0, 14],
  ["Cashews", "30 g", 157, 5, 9, 12],
  ["Chia seeds", "1 tbsp", 58, 2, 5, 4],

  // Snacks / other
  ["Protein bar", "1 bar", 200, 20, 22, 7],
  ["Dark chocolate", "30 g", 170, 2, 13, 12],
  ["Chips, potato", "30 g", 152, 2, 15, 10],
  ["Hummus", "2 tbsp", 70, 2, 6, 5],
  ["Honey", "1 tbsp", 64, 0, 17, 0],
  ["Pizza, cheese", "1 slice", 285, 12, 36, 10],
  ["Burger, fast food", "1 burger", 354, 17, 30, 18],
  ["Fries, medium", "1 serving", 365, 4, 48, 17],
  ["Sushi roll", "6 pieces", 250, 9, 38, 7],
  ["Coffee, black", "1 cup", 2, 0.3, 0, 0],
  ["Latte, whole milk", "1 medium", 190, 10, 18, 7],
  ["Orange juice", "250 ml", 112, 1.7, 26, 0.5],
  ["Beer", "1 can (355 ml)", 153, 1.6, 13, 0],
  ["Soda, cola", "1 can (355 ml)", 140, 0, 39, 0],

  // --- Extended list ---
  // Protein
  ["Ground turkey, cooked", "100 g", 203, 27, 0, 10],
  ["Ham, deli", "1 slice", 30, 5, 1, 1],
  ["Sausage, pork", "1 link", 180, 9, 1, 16],
  ["Tilapia, cooked", "100 g", 128, 26, 0, 3],
  ["Mackerel, cooked", "100 g", 262, 24, 0, 18],
  ["Sardines, canned", "100 g", 208, 25, 0, 11],
  ["Scallops, cooked", "100 g", 137, 24, 6, 1],
  ["Seitan", "100 g", 143, 25, 14, 2],
  ["Edamame", "100 g", 122, 11, 10, 5],
  ["Kidney beans, cooked", "100 g", 127, 9, 23, 0.5],
  ["Falafel", "1 piece", 57, 2, 5, 3],
  ["Protein yogurt", "150 g", 110, 15, 9, 2],
  ["Beef jerky", "30 g", 116, 9, 7, 7],
  // Grains / carbs
  ["Ramen noodles", "1 pack", 380, 8, 52, 14],
  ["Naan", "1 piece", 262, 9, 45, 5],
  ["Pita bread", "1 piece", 165, 6, 33, 1],
  ["English muffin", "1 muffin", 134, 5, 26, 1],
  ["Croissant", "1 medium", 231, 5, 26, 12],
  ["Pancake", "1 medium", 90, 2.5, 11, 4],
  ["Waffle", "1 waffle", 218, 6, 25, 11],
  ["Rice cake", "1 cake", 35, 0.7, 7, 0.3],
  ["Crackers", "5 crackers", 80, 1, 11, 3.5],
  ["Popcorn, air-popped", "30 g", 110, 3, 22, 1.3],
  ["Gnocchi", "100 g", 130, 3, 27, 1],
  // Fruit
  ["Pear", "1 medium", 101, 0.6, 27, 0.2],
  ["Peach", "1 medium", 59, 1.4, 14, 0.4],
  ["Kiwi", "1 medium", 42, 0.8, 10, 0.4],
  ["Cherries", "100 g", 63, 1, 16, 0.2],
  ["Raspberries", "100 g", 52, 1.2, 12, 0.7],
  ["Dates", "1 date", 66, 0.4, 18, 0],
  ["Raisins", "30 g", 90, 1, 22, 0.1],
  ["Cantaloupe", "100 g", 34, 0.8, 8, 0.2],
  ["Grapefruit", "1/2 medium", 52, 1, 13, 0.2],
  ["Pomegranate", "100 g", 83, 1.7, 19, 1.2],
  // Vegetables
  ["Zucchini", "100 g", 17, 1.2, 3, 0.3],
  ["Cauliflower", "100 g", 25, 1.9, 5, 0.3],
  ["Asparagus", "100 g", 20, 2.2, 4, 0.1],
  ["Mushrooms", "100 g", 22, 3.1, 3, 0.3],
  ["Onion", "100 g", 40, 1.1, 9, 0.1],
  ["Kale", "100 g", 49, 4.3, 9, 0.9],
  ["Brussels sprouts", "100 g", 43, 3.4, 9, 0.3],
  ["Peas, cooked", "100 g", 84, 5.4, 16, 0.4],
  ["Beets, cooked", "100 g", 44, 1.7, 10, 0.2],
  // Dairy
  ["Skyr", "150 g", 95, 17, 6, 0.3],
  ["Ricotta, part-skim", "100 g", 138, 11, 5, 8],
  ["Parmesan", "1 tbsp", 22, 2, 0.2, 1.4],
  ["Feta", "30 g", 79, 4, 1, 6],
  ["Cream cheese", "1 tbsp", 51, 1, 0.8, 5],
  ["Ice cream, vanilla", "100 g", 207, 3.5, 24, 11],
  ["Almond milk, unsweetened", "250 ml", 30, 1, 1, 2.5],
  ["Soy milk", "250 ml", 100, 7, 8, 4],
  ["Oat milk", "250 ml", 120, 3, 16, 5],
  // Fats / nuts / spreads
  ["Pistachios", "30 g", 159, 6, 8, 13],
  ["Pecans", "30 g", 196, 2.6, 4, 20],
  ["Sunflower seeds", "30 g", 165, 5.5, 7, 14],
  ["Pumpkin seeds", "30 g", 151, 9, 5, 13],
  ["Flaxseed, ground", "1 tbsp", 37, 1.3, 2, 3],
  ["Tahini", "1 tbsp", 89, 2.6, 3, 8],
  ["Coconut oil", "1 tbsp", 121, 0, 0, 14],
  ["Mayonnaise", "1 tbsp", 94, 0.1, 0.1, 10],
  // Meals / snacks
  ["Mac and cheese", "1 cup", 376, 13, 47, 15],
  ["Lasagna", "1 serving", 336, 19, 30, 16],
  ["Chicken curry", "1 serving", 293, 22, 12, 18],
  ["Pad thai", "1 serving", 400, 17, 47, 17],
  ["Burrito, bean & cheese", "1 burrito", 380, 14, 55, 12],
  ["Caesar salad", "1 serving", 280, 9, 12, 22],
  ["Scrambled eggs (2)", "2 eggs", 180, 12, 2, 14],
  ["French toast", "1 slice", 149, 5, 16, 7],
  ["Smoothie, fruit", "1 medium", 220, 4, 48, 2],
  ["Donut, glazed", "1 donut", 240, 4, 27, 14],
  ["Muffin, blueberry", "1 muffin", 265, 4, 37, 11],
  ["Cookie, chocolate chip", "1 cookie", 78, 0.9, 10, 4],
  ["Brownie", "1 piece", 132, 1.7, 18, 6],
  ["Cheesecake", "1 slice", 321, 6, 26, 22],
  ["Energy drink", "1 can (250 ml)", 110, 0, 28, 0],
  ["Sports drink", "500 ml", 125, 0, 35, 0],
  ["Wine, red", "1 glass (150 ml)", 125, 0, 4, 0],
  ["Cappuccino", "1 medium", 120, 6, 12, 4],
  ["Green tea", "1 cup", 2, 0, 0.5, 0],
];

export const FOODS = RAW.map(([name, serving, kcal, protein, carbs, fat]) => ({ name, serving, kcal, protein, carbs, fat, source: "builtin" }));

function dedupeFoods(list) {
  const seen = new Set();
  const out = [];
  for (const f of list) {
    const k = f.name.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(f);
    }
  }
  return out;
}

// Split a string into lowercase word tokens (drops punctuation/connectors).
function tokenize(s) {
  return String(s || "").toLowerCase().split(/[\s,/()&-]+/).filter(Boolean);
}
// Prefix match either direction, so partial typing and simple plurals both hit.
function wordMatch(w, qt) {
  return w === qt || w.startsWith(qt) || (qt.startsWith(w) && w.length >= 3);
}

// A couple of common food shorthands → full words.
const ABBREV = { pb: ["peanut", "butter"], oj: ["orange", "juice"] };
function expandAbbrev(tokens) {
  const out = [];
  for (const t of tokens) {
    if (ABBREV[t]) out.push(...ABBREV[t]);
    else out.push(t);
  }
  return out;
}

/**
 * Search foods, optionally merging in `extra` (the user's saved custom foods)
 * so anything logged once stays searchable. Token-based AND search: every word
 * you type must appear in the food name (any order) — "greek yogurt" and
 * "yogurt greek" both find "Greek yogurt, plain 0%". Ranked: full-name prefix >
 * name-word match.
 */
export function searchFoods(query, limit = 25, extra = []) {
  const pool = extra && extra.length ? dedupeFoods([...extra, ...FOODS]) : FOODS;
  const q = String(query || "").trim().toLowerCase();
  if (!q) return pool.slice(0, limit);
  const qTokens = expandAbbrev(tokenize(q));
  const scored = [];
  for (const f of pool) {
    const name = f.name.toLowerCase();
    const words = tokenize(f.name);
    if (!qTokens.every((qt) => words.some((w) => wordMatch(w, qt)))) continue;
    const score = name.startsWith(q) ? 0 : 1;
    scored.push({ f, score });
  }
  scored.sort((a, b) => a.score - b.score || a.f.name.length - b.f.name.length || a.f.name.localeCompare(b.f.name));
  return scored.slice(0, limit).map((s) => s.f);
}

/**
 * Search Open Food Facts (free, no key, CORS-enabled). Returns foods with
 * per-100g macros. This endpoint sends `access-control-allow-origin: *` (so it
 * works from the browser) but intermittently returns 503 under load, so we retry
 * transient failures a couple of times. Throws on real failure (caller falls
 * back to the built-in + custom foods).
 */
export async function searchOpenFoodFacts(query, signal) {
  const url =
    "https://world.openfoodfacts.org/cgi/search.pl?search_terms=" +
    encodeURIComponent(query) +
    "&search_simple=1&action=process&json=1&page_size=20&fields=product_name,brands,nutriments";

  let res;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (signal?.aborted) {
      const e = new Error("aborted");
      e.name = "AbortError";
      throw e;
    }
    res = await fetch(url, { signal });
    if (res.ok) break;
    if (res.status < 500) throw new Error(`Open Food Facts ${res.status}`); // permanent
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1))); // transient (e.g. 503) → backoff + retry
  }
  if (!res.ok) throw new Error(`Open Food Facts ${res.status}`);
  const data = await res.json();
  const out = [];
  for (const p of data.products || []) {
    const n = p.nutriments || {};
    let kcal = n["energy-kcal_100g"];
    if (kcal == null && n["energy_100g"] != null) kcal = n["energy_100g"] / 4.184; // kJ → kcal
    if (!p.product_name || kcal == null) continue;
    const brand = p.brands ? p.brands.split(",")[0].trim() + " " : "";
    out.push({
      name: (brand + p.product_name).slice(0, 60),
      serving: "100 g",
      kcal: Math.round(kcal),
      protein: round1(n.proteins_100g),
      carbs: round1(n.carbohydrates_100g),
      fat: round1(n.fat_100g),
      source: "off",
    });
    if (out.length >= 20) break;
  }
  return out;
}

function round1(v) {
  return Math.round((Number(v) || 0) * 10) / 10;
}
