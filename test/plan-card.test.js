import test from "node:test";
import assert from "node:assert/strict";

import { planCardModel, planCardHTML, planFormHTML, statsFromForm, heightToFtIn, formValues } from "../plan-card.js";
import { buildPlan } from "../nutrition-plan.js";

const STATS = { heightCm: 178, ageRange: "18–29", sex: "Male", dailyActivity: "some", daysPerWeek: 4, sessionLength: 60, intent: "cut" };
const BANNED = ["missed", "failed", "fail", "behind", "lost", "broke", "clean", "junk", "bad", "cheat", "lazy", "slacking", "guilty"];
const plan = buildPlan({ bodyStats: STATS, kg: 80 });
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("with no stats the card invites setup and shows no numbers", () => {
  const m = planCardModel({ bodyStats: null, plan: null, current: { kcal: 2200 } });
  assert.equal(m.state, "setup");
  assert.equal(m.cta, "Get my targets");
  const html = planCardHTML(m);
  assert.match(html, /Get my targets/);
  assert.ok(!/kcal/.test(html), "no calorie figure before there is a plan");
});

test("with a plan the card shows the targets, the reasoning, protein per kg, confidence and limits", () => {
  const m = planCardModel({ bodyStats: STATS, plan, current: { kcal: 2200 } });
  assert.equal(m.state, "plan");
  const t = text(planCardHTML(m));
  assert.ok(t.includes(String(plan.targets.kcal.toLocaleString("en-US"))));
  for (const g of [plan.targets.protein, plan.targets.carbs, plan.targets.fat]) assert.ok(t.includes(`${g} g`), `${g} g`);
  assert.ok(t.includes(plan.basis));
  assert.match(t, /g per kg/);
  assert.match(t, /Confidence: High/);
  assert.ok(t.includes(plan.limitations));
});

test("Medium confidence says why, and a minor sees the notice", () => {
  const blankSex = buildPlan({ bodyStats: { ...STATS, sex: "" }, kg: 80 });
  assert.match(text(planCardHTML(planCardModel({ bodyStats: { ...STATS, sex: "" }, plan: blankSex, current: {} }))), /Medium, because sex was left blank/);
  const minor = buildPlan({ bodyStats: { ...STATS, ageRange: "Under 18" }, kg: 60 });
  assert.ok(text(planCardHTML(planCardModel({ bodyStats: { ...STATS, ageRange: "Under 18" }, plan: minor, current: {} }))).includes(minor.notice));
});

test("Use these targets appears only when the plan differs from the saved targets by 25 kcal or more", () => {
  const k = plan.targets.kcal;
  assert.equal(planCardModel({ bodyStats: STATS, plan, current: { kcal: k } }).canApply, false);
  assert.equal(planCardModel({ bodyStats: STATS, plan, current: { kcal: k - 24 } }).canApply, false);
  assert.equal(planCardModel({ bodyStats: STATS, plan, current: { kcal: k - 25 } }).canApply, true);
  assert.ok(planCardHTML(planCardModel({ bodyStats: STATS, plan, current: { kcal: k - 100 } })).includes("Use these targets"));
  assert.ok(!planCardHTML(planCardModel({ bodyStats: STATS, plan, current: { kcal: k } })).includes("Use these targets"));
});

test("a real heading, no eyebrow, no research claim, no shaming word, no em dash", () => {
  const html = [planCardHTML(planCardModel({ bodyStats: null, plan: null, current: {} })), planCardHTML(planCardModel({ bodyStats: STATS, plan, current: { kcal: 1000 } })), planFormHTML({ unit: "kg", values: {}, needWeight: true, errors: [] })].join(" ");
  assert.match(html, /<h2 class="card-title">/);
  assert.ok(!/eyebrow/.test(html), "the craft floor bans an eyebrow above a heading");
  const lower = text(html).toLowerCase();
  for (const w of BANNED) assert.ok(!new RegExp(`\\b${w}\\b`).test(lower), `"${w}"`);
  for (const w of ["studies show", "science", "proven", "research shows"]) assert.ok(!lower.includes(w), w);
  assert.ok(!html.includes("—"));
});

test("the setup form is inline, grouped in fieldsets, and honours the unit", () => {
  const kg = planFormHTML({ unit: "kg", values: {}, needWeight: false, errors: [] });
  assert.match(kg, /name="heightCm"/);
  assert.ok(!/heightFt/.test(kg));
  const lb = planFormHTML({ unit: "lb", values: {}, needWeight: false, errors: [] });
  assert.match(lb, /name="heightFt"/);
  assert.match(lb, /name="heightIn"/);
  assert.ok(!/name="heightCm"/.test(lb));
  assert.ok(!/role="dialog"|aria-modal/.test(kg), "never a modal");
  for (const legend of ["Age range", "Sex", "How active is your day", "Eating goal"]) assert.ok(kg.includes(`<legend>${legend}`), legend);
  assert.match(kg, /Prefer not to say/);
  assert.match(kg, /Optional/);
});

test("the weight field appears only when there is no weigh-in yet, and errors are announced", () => {
  assert.ok(!/name="weight"/.test(planFormHTML({ unit: "kg", values: {}, needWeight: false, errors: [] })));
  assert.match(planFormHTML({ unit: "kg", values: {}, needWeight: true, errors: [] }), /name="weight"/);
  const bad = planFormHTML({ unit: "kg", values: {}, needWeight: false, errors: ["heightCm: height must be between 100 and 250 cm"] });
  assert.match(bad, /role="alert"/);
  assert.match(bad, /height must be between 100 and 250 cm/);
  assert.ok(!/heightCm:/.test(text(bad)), "the field key is not shown to the user");
});

test("statsFromForm turns feet and inches into centimetres and numeric strings into numbers", () => {
  assert.equal(statsFromForm({ heightFt: "5", heightIn: "10", ageRange: "18–29", sex: "Male", dailyActivity: "some", daysPerWeek: "4", sessionLength: "60", intent: "cut" }, "lb").heightCm, 178);
  assert.equal(statsFromForm({ heightCm: "178" }, "kg").heightCm, 178);
  assert.equal(statsFromForm({ heightFt: "", heightIn: "" }, "lb").heightCm, NaN);
});

test("feet and inches never show 12 inches, and every height round-trips within a centimetre", () => {
  assert.deepEqual(heightToFtIn(182), { ft: 6, inch: 0 });
  assert.deepEqual(heightToFtIn(121), { ft: 4, inch: 0 });
  assert.deepEqual(heightToFtIn(178), { ft: 5, inch: 10 });
  for (let cm = 100; cm <= 250; cm++) {
    const { ft, inch } = heightToFtIn(cm);
    assert.ok(inch >= 0 && inch <= 11, `${cm} cm -> ${ft} ft ${inch} in`);
    const back = statsFromForm({ heightFt: ft, heightIn: inch }, "lb").heightCm;
    assert.ok(Math.abs(back - cm) <= 1, `${cm} -> ${back}`);
  }
});

test("formValues reads a form the way the draft needs: checked radios, selected values, typed text", () => {
  const els = [
    { name: "heightCm", type: "number", value: "178" },
    { name: "ageRange", type: "radio", value: "18–29", checked: false },
    { name: "ageRange", type: "radio", value: "30–44", checked: true },
    { name: "sex", type: "radio", value: "", checked: true },
    { name: "daysPerWeek", type: "select-one", value: "4" },
    { name: "", type: "submit", value: "go" },
  ];
  assert.deepEqual(formValues(els), { heightCm: "178", ageRange: "30–44", sex: "", daysPerWeek: "4" });
});
