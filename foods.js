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
];

export const FOODS = RAW.map(([name, serving, kcal, protein, carbs, fat]) => ({ name, serving, kcal, protein, carbs, fat, source: "builtin" }));

/** Search the built-in foods (ranked: prefix > word-start > substring). */
export function searchFoods(query, limit = 25) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return FOODS.slice(0, limit);
  const scored = [];
  for (const f of FOODS) {
    const n = f.name.toLowerCase();
    let score = -1;
    if (n.startsWith(q)) score = 0;
    else if (n.split(/[\s,]+/).some((w) => w.startsWith(q))) score = 1;
    else if (n.includes(q)) score = 2;
    if (score >= 0) scored.push({ f, score });
  }
  scored.sort((a, b) => a.score - b.score || a.f.name.localeCompare(b.f.name));
  return scored.slice(0, limit).map((s) => s.f);
}

/**
 * Search Open Food Facts (free, no key). Returns foods with per-100g macros.
 * Throws on network/CORS failure (caller falls back to built-in only).
 */
export async function searchOpenFoodFacts(query, signal) {
  const url =
    "https://world.openfoodfacts.org/cgi/search.pl?search_terms=" +
    encodeURIComponent(query) +
    "&search_simple=1&action=process&json=1&page_size=20&fields=product_name,brands,nutriments";
  const res = await fetch(url, { signal });
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
