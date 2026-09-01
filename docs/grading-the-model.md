# Grading the model

*How SpotterAI audits its own LLM output, and what the benchmark actually
measures. A companion to [an evaluator that couldn't catch its own
bug](an-evaluator-that-couldnt-catch-its-own-bug.md), which is the narrower
story of one time this failed.*

The pitch for an LLM fitness coach writes itself, which is the problem. You send
a profile, you get back a training program, it reads beautifully, and you have
no idea whether it is any good. The model is fluent about deadlifts in exactly
the way it is fluent about everything, and fluency is not the same as being
right about how much volume a beginner's lower back can take.

So SpotterAI generates a plan with an LLM and then refuses to trust it. A
separate module reads the generated program and grades it against a fixed
rubric. No model in the loop. No embeddings. No second LLM asked politely to
check the first one's work. Just fourteen checks, thresholds in named
constants, and a benchmark that fails the build when it regresses.

| | |
|---|---|
| Deterministic checks | **14** |
| Red-team cases | **23** |
| Risky plans caught | **18 / 18** |
| Safe plans incorrectly flagged | **0** |

## Why not use an LLM to check the LLM

Because then there are two things you cannot verify instead of one. An LLM judge
is useful when the property is genuinely fuzzy, like tone. "Is 32 working sets
per muscle group per week too much" is not fuzzy. It is a number against a
threshold, and a threshold is a thing you can write down, argue about, and
change on purpose.

The deterministic version has a property the judge version never gets: it runs
in under a millisecond, offline, in the browser, for free, and it gives the same
answer twice. It can go in CI. A vibe cannot go in CI.

## What it checks

| # | Check | What it looks at |
|---|---|---|
| 1 | Recovery and rest days | Warn at six training days, fail at seven |
| 2 | Weekly volume sanity | Sets per muscle group, fractional: a full set to each primary mover, half to each secondary |
| 3 | Push / pull balance | Fails when one side is more than triple the other, or absent |
| 4 | Quad / hamstring balance | Programming balance. Deliberately **not** an injury claim, see [rubric sources](rubric-sources.md) |
| 5 | Injury conflicts | Each lift against curated contraindications, one row per injury |
| 6 | Beginner load sanity | RPE 10 for someone two months in is a hard flag |
| 7 | Session length sanity | Past ~40 working sets in one workout, quality has already collapsed |
| 8 | Goal fit | Rep ranges against the stated goal |
| 9 | Progressive overload | Is there a real rule, or just encouragement |
| 10 | Training frequency | A muscle getting real volume in one session grows better split across two |
| 11 | Equipment fit | Every lift against the gear the user said they have |
| 12 | Exercise recognition | How much matched the structured DB rather than falling back to keywords |
| 13 | Cardio load | Conditioning minutes competing with lifting recovery |
| 14 | Cardio / leg-day conflict | Hard intervals on, or the day before, a heavy squat session |

None of these are clever. That is the point. Every threshold lives in a named
constant in one block (`THRESHOLDS` in `evaluator.js`), so the rubric can be
read in ninety seconds and disagreed with specifically.

Each one is also sourced in **[where the thresholds come from](rubric-sources.md)**,
which grades the evidence behind it: Supported, Directional, Practical, or
Contradicted. Three are Practical, meaning no literature sets them and they are
recovery judgments wearing a number. One was Contradicted, and writing that
document is what caught it: the quad/hamstring check was described as a
knee-health measure, and a systematic review concludes the
hamstrings-to-quadriceps ratio ["has limited value for the prediction of ACL and
hamstring injuries"](https://pubmed.ncbi.nlm.nih.gov/35065297/). The check
stays, because lopsided programming is still worth flagging. The injury claim
is gone.

## Three decisions that made it work

### The score is demoted

The first version led with a number out of 100. It was the worst thing in the
product. A score invites you to feel good at 82 and bad at 61 without telling
you what to change, and it implies a precision the heuristics do not have.

The UI leads with flags instead, and every flagged check carries a plain-English
fix and safer alternatives. The score still exists, quietly, below the flags.
"Two issues to review before training" is actionable. "Your plan scored 74" is
not.

### There is a third answer, and it is not "pass"

An early version told a user their plan was fine for a beginner when the user
had never said they were a beginner. The onboarding question was skipped, the
code defaulted, and the audit reported a judgment it had no basis for.

Checks now resolve into tiers:

| Tier | Meaning |
|---|---|
| `critical` | Safety-relevant failure: no rest day, junk volume, an injury conflict |
| `warning` | Worth reviewing before training |
| `suggestion` | Quality and optimization, never dressed up as safety |
| `pass` | Assessed, and clean |
| `not_assessed` | We did not have the input. Not a pass, not a flag, excluded from both counts |

`not_assessed` cost real work: `mapOnboardingToInputs` deliberately leaves
fields blank rather than defaulting them, so a question you skipped stays
skipped instead of becoming an answer asserted back at you. A product that says
"I don't know" is more trustworthy than one that never does.

### A new check ships at zero weight

Every check added after the first release lands with a penalty of zero. It
appears in the report, it explains itself, it does not move the score.

This is regression safety, not modesty. Adding a check cannot silently change
the grade of any plan that existed before it, so benchmark comparisons across
versions stay honest. The two cardio checks go further and are emitted only when
there is cardio to judge, so a lifting-only plan produces a byte-identical audit
to the one it produced before cardio existed.

## The bug that justifies the whole approach

The progressive-overload check looks for signal words in the plan's
`progression` field. Early on it matched them as plain substrings. Then a plan
came through whose entire progression rule was:

> Progress over time.

It passed. Twice over. The word "progress" contains `pr`, which was on the
signal list for personal record, and it contains "progress" itself. One vacuous
sentence scored two independent signals off one concept and was reported as a
concrete progression scheme.

The fix was word-boundary matching and deleting `pr` from the list entirely, on
the grounds that a personal record is a result, not an instruction. The
interesting part is not the fix. It is that a *deterministic* checker had a
false negative this dumb, and it was only caught because a red-team case existed
built from a real chatbot-generated plan that never got harder.

If a rules engine can fool itself that badly, an LLM judge grading the same text
was never the safer option. It would have been wrong less legibly.

## Measuring it

```
Test cases run                   23
Expectations passed              34/34
Risky plans caught               18/18
Safe plans incorrectly flagged   0
Average audit time               0.079 ms
Evaluator version                v1.4.0
```

**"Safe plans incorrectly flagged" is the number that matters most.** Catching
bad programs is easy if you are willing to flag everything. A safety checker
that cries wolf gets ignored, and an ignored checker is worse than no checker,
because it also cost the user's attention.

Four of the 23 cases are pure false-positive guards, and a fifth is a known-good
plan that has to come back clean. One guard is a well-constructed novice 5x5,
which an over-eager rep-range check would flag as monotonous. It is not
monotonous. It is a linear progression, and it is correct.

The suite runs in CI on every pull request (`npm run eval`). A change that
regresses it does not merge.

## What it refuses to do

The wording throughout is "potential concern", never "approved". The evaluator
flags; it does not certify. The checks are keyword and threshold heuristics over
exercise names, not medical rules, and the app says so in the interface rather
than in a footer nobody reads.

This is the part worth defending hardest. It would have been easy, and better
marketing, to render a green check mark and the word "Safe". The honest version
is less impressive and considerably more useful, and it is the only version
worth putting in front of someone about to load a barbell.

## The number that is not good

Thirty days of real traffic, read off analytics rather than estimated:

| Stage | Visitors |
|---|---|
| Landed | 170 |
| Started onboarding | 18 |
| Completed onboarding | 14 |
| Got a plan | 15 |
| **Started a first workout** | **3** |

Onboarding is not the problem: 78% of people who start it finish. Logging is not
the problem: everyone who started a workout finished it. The wall is the 79%
drop between holding a plan and training once. Fourteen people accepted a
program and eleven never did a session.

This is here because a writeup with only the good numbers in it is the same
failure mode as a safety checker that only ever says "Safe". The evaluator is
the part of this project worth defending in a technical conversation. The
activation rate is the part that is not solved, and no amount of additional
rubric fixes it, because it is not a rubric problem.

---

*[SpotterAI](https://spotterai.xyz) is a backend-free PWA: static hosting, an
LLM behind two serverless routes, everything else on the device. The red-team
suite is at [/#/evals](https://spotterai.xyz/#/evals) and runs in your browser.*
