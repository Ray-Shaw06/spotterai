/**
 * Tests for Pain Mode — it must stay conservative: no diagnosis, no rehab,
 * never "train through it", and severe pain blocks aggressive training.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { assessPain, PAIN_DISCLAIMER } from "../pain.js";

const allText = (r) => [r.headline, ...r.advice, r.disclaimer].join(" ").toLowerCase();

test("every response carries the can't-diagnose disclaimer and never says 'train through'", () => {
  for (const severity of ["mild", "moderate", "severe"]) {
    const r = assessPain({ location: "knee", severity });
    assert.equal(r.disclaimer, PAIN_DISCLAIMER);
    assert.doesNotMatch(allText(r), /train through|push through the pain|no pain no gain/);
    // No *affirmative* diagnosis. (Saying it "cannot diagnose" is fine and expected.)
    assert.doesNotMatch(allText(r), /you (have|'?ve) (a |an |torn |sprained )|it'?s (probably|likely) (a|an|torn)/);
  }
});

test("severe pain blocks aggressive training and points to a professional, with no rehab prescription", () => {
  const r = assessPain({ location: "shoulder", severity: "severe" });
  assert.equal(r.blockAggressive, true);
  assert.equal(r.seekProfessional, true);
  assert.match(allText(r), /professional|doctor|physiotherapist/);
  assert.doesNotMatch(allText(r), /rehab (program|protocol|plan|exercises)|do these (stretches|exercises)/);
});

test("mild pain is handled conservatively (modify) without blocking all training", () => {
  const r = assessPain({ location: "knee", severity: "mild" });
  assert.equal(r.blockAggressive, false);
  assert.match(r.headline, /modify|skip/i);
});

test("evaluator-mapped locations become a limitation; unmapped ones still respond safely", () => {
  assert.equal(assessPain({ location: "knee", severity: "moderate" }).injuryKey, "knee");
  assert.equal(assessPain({ location: "lower_back", severity: "mild" }).injuryKey, "lower_back");
  const neck = assessPain({ location: "neck", severity: "moderate" });
  assert.equal(neck.injuryKey, null); // not evaluator-mapped
  assert.equal(neck.addLimitation, false);
  assert.ok(neck.advice.length > 0); // still gives a conservative response
});
