# An evaluator that couldn't catch its own bug

*August 2026*

I spent six weeks building an AI fitness app around one idea: don't trust the
model. An LLM writes your training plan, then a separate pure-code evaluator
grades it against a fixed rubric and shows you the flags before you train. No AI
in the grader. 11 checks. A published red-team suite you can run in your own
browser.

Then someone showed me a training plan they had put together from ChatGPT and
Instagram reels. I could see two things wrong within about ten seconds: there was
no progressive overload, and the rep ranges were far too high. The whole week
looked directionless.

So I ran it through my evaluator.

It said the plan was fine.

## Both failures were invisible to it

Not "the thresholds were slightly off." The evaluator was structurally incapable
of detecting either problem.

**There was no progressive-overload check at all.** `grep -n "progressive" evaluator.js`
returned exactly one hit, and it was a pass message inside a different check.
The plan schema had a `progression` field (`lib/plan.js:33`), populated on every
generation, and *nothing ever read it*. It had been decoration for six weeks.

**The rep-range check passed unconditionally for the case that matters most.**
`checkGoalFit` had branches for strength and hypertrophy goals. For the
`general` bucket it did this:

```js
// Fat loss / general: structure is flexible, so this stays light.
return finalize(id, label, "pass", `Program structure is reasonable for a ${goal.replace("_", " ")} goal.`);
```

An unconditional pass. And `normalizePlan` defaults any plan with no stated goal
to `"General fitness"`, which routes to exactly that bucket. So for any plan
where the user hadn't declared a goal, which is every plan pasted in from
somewhere else, the rep-range flag could never fire. Not "rarely." Never.

The product would have told that person their broken plan was reasonable, in a
confident flags-first UI, with a quality score, next to a page bragging about the
red-team suite.

## Why the tests didn't catch it

This is the part I find genuinely uncomfortable, because I had tests. 354 of
them, plus an 18-case adversarial eval suite running in CI, plus a public page
rendering the results.

None of it helped, because **every test asserted the behavior I had implemented,
and no test asserted the behavior I had promised.** The eval suite had a case
called "Strength goal, endurance reps" that passed. It had no case for "no goal
stated," because when I wrote the fixtures I always wrote a goal. My own fixtures
inherited my own blind spot.

The suite was measuring the wrong thing with great rigor. "18/18 expectations
passed" was true and meaningless.

## The fix was four lines and a trap

Adding the progressive-overload check was easy. Making `checkGoalFit` judge shape
instead of returning early was easy. What was not easy was a fourth thing I found
on the way in.

The evaluator had a `status` on each check (`pass` / `warn` / `fail`) and a
separate `tier` used by the UI for sorting and color. `tierFor` mapped between
them:

```js
function tierFor(check) {
  if (check.status === "pass") return "pass";
  // ... specific cases ...
  return "warning";   // ← everything else falls through to here
}
```

I wanted to add a fourth status, `not_assessed`, because I'd noticed something
worse than a missing check: when you hadn't told the app your training
experience, the beginner-intensity check returned

> "Not a beginner, advanced intensity is appropriate when well managed"

which is a *reassuring safety judgement invented from no information*, in a
product whose entire claim is that it doesn't do that.

But if I'd added the status without adding a matching tier, every unassessed
check would have fallen through that final `return "warning"` and rendered as a
**warning about the user's plan**. The fix for false reassurance would have
shipped as false alarm, on four checks at once.

Status and tier turned out to have five consumers: `tierFor` produces it,
`summarize` counts it, `app.js` filters the flag list on it, `eval-suite.js`
derives the public Safety Lab flag list from it, and `trust.js` maps it to a
confidence level. Miss any one and the number disagrees with the list.

I missed two.

`eval-suite.js` was the first. Node's summary still printed
`Safe plans incorrectly flagged: 0`, so CI stayed green. Running the same suite
in an actual browser showed known-good fixtures listing "Equipment fit" as
flagged. The aggregate counter was masking a per-case bug, and only the rendered
output exposed it.

`trust.js` was the second, and I only found it in review. The Trust Report was
still printing:

> **High confidence** — no critical issues or warnings, and inputs look complete

on audits where two checks had never run. The audit panel said "Nothing flagged,
but 2 checks could not be assessed." The Trust Report, on the same data, said
inputs look complete. The exact false reassurance the new tier existed to
delete, alive and well on a second screen.

## What I changed about how I work

**Write the failing case first, then prove it fails.** Now every regression test
gets checked against the *old* code before I write the fix. I've caught two
vacuous tests this way, tests that passed before the fix existed and would
therefore never have failed for the reason they claimed. One of them was mine,
written an hour earlier, asserting that every flagged check carries a suggested
fix. It passed. The fixture never tripped a flag.

**Aggregate counters lie; render the list.** `Safe plans incorrectly flagged: 0`
was computed as "how many known-good cases failed their own expectations," which
never looked at the flags at all. A fixture could light up and the public number
still read zero. Two of them were.

**Enumerate the consumers of any shared vocabulary before extending it.** Five
places read the tier. Adding a value to that vocabulary is an API change, not a
one-line edit.

**A verifier must be able to say "I don't know."** This is the change I care
about most. Silence from a checker means the rubric found nothing, not that the
thing is fine, and those are very different claims to make to someone who came
to you *because* they can't tell the difference.

## Where it stands

*Updated 2026-08-31.* The evaluator is v1.4.0. 845 tests, 23 adversarial eval
cases, 18 of 18 risky plans caught, zero false positives. There's a fourth tier
now, and a zero-input audit reports two checks it could not assess instead of
quietly passing them. The rubric has grown to 14 checks since this was written,
most recently two for cardio; how the whole thing fits together is in
[grading the model](grading-the-model.md).

Run the same directionless plan through it today and you get two flags:
**Progressive overload** and **Goal fit**. Exactly the two things I could see
wrong by eye and my own software could not.

The suite that told me everything was fine is the same suite, one class of
question wider.

I don't think the lesson is that I should have written more tests. I had plenty.
The lesson is that a test suite written by the person with the blind spot
inherits the blind spot, and the only thing that broke it was a real plan from a
real person that I could evaluate faster than my software could.

If you're building a checker for LLM output: the most valuable test case you will
ever write is the one somebody hands you after your thing has already shipped.

---

*[SpotterAI](https://spotterai.xyz) is open source at
[Ray-Shaw06/spotterai](https://github.com/Ray-Shaw06/spotterai). The red-team
suite is at [/#/evals](https://spotterai.xyz/#/evals) and runs in your browser.
Paste your own plan at [/#/import](https://spotterai.xyz/#/import).*
