# Where the thresholds come from

*Last reviewed 2026-08-31, against evaluator v1.4.0.*

Every number in `THRESHOLDS` (`evaluator.js`) is listed here with the evidence
behind it and an honest grade of how well that evidence actually supports the
number. This document exists so the rubric can be argued with. A threshold you
cannot cite is a threshold you picked.

**Three of them are graded weak or contradicted.** Those are at the bottom, not
buried. Grounding the rubric in literature was worth doing precisely because it
found them.

## How to read the grades

| Grade | Meaning |
|---|---|
| **Supported** | A specific number in the literature maps onto the constant |
| **Directional** | The literature supports the *direction* but not the exact cut point; the number is a judgment inside an evidenced range |
| **Practical** | No literature sets this number. It is a usability or recovery judgment, and it is labelled as one |
| **Contradicted** | The stated rationale is not supported by current evidence and needs changing |

---

## Volume

### `LOW_WEEKLY_SETS_FOR_GROWTH: 6`

**Directional.** A prime mover below ~6 weekly sets is flagged as
under-stimulated for a muscle-building goal.

Schoenfeld, Ogborn & Krieger's dose-response meta-analysis found a graded
relationship between weekly set volume and hypertrophy, with the clearest gains
appearing across the 5 to 10+ sets-per-muscle-per-week range and roughly 0.38%
additional hypertrophy per added set.

- [Dose-response relationship between weekly resistance training volume and increases in muscle mass (J Sports Sci, 2017)](https://pubmed.ncbi.nlm.nih.gov/27433992/)
- [The Resistance Training Dose Response: meta-regressions on weekly volume and frequency](https://pubmed.ncbi.nlm.nih.gov/41343037/)

The literature supports "more than a token amount." The specific line at 6 sits
at the bottom of the evidenced range and is ours.

### `HIGH_WEEKLY_SETS_WARN: 24` and `VERY_HIGH_WEEKLY_SETS_FAIL: 32`

**Practical, and the evidence arguably points the other way.** This is the most
important honest note in this document.

The dose-response literature above finds *more* volume producing *more*
hypertrophy, without establishing a clear plateau, let alone a harm threshold,
in the ranges these constants sit at. There is no meta-analysis that says
32 sets per muscle per week is dangerous.

So what are these numbers? They are a recovery and realism judgment for the
population this app actually serves: novice and intermediate lifters training
themselves, without a coach, without managed fatigue, and with a strong
tendency to write plans they cannot complete. A plan prescribing 32 weekly sets
per muscle to that person is far more likely to be an LLM padding a program
than a deliberate specialisation block.

The check is therefore honest about what it is: it says the volume is *likely
junk or unsustainable*, not that it is unsafe. If you are an advanced lifter
running a high-volume block deliberately, this check is wrong about you, and
that is a known limitation rather than a defect.

### `BEGINNER_MAX_WEEKLY_SETS_PER_MUSCLE: 22`

**Practical.** Same reasoning, tightened for people with the least training
history and the least ability to judge their own recovery.

---

## Frequency

### `FREQUENCY_TARGET_DAYS: 2`

**Supported.** The clearest mapping in the whole rubric.

Schoenfeld, Ogborn & Krieger's frequency meta-analysis concluded that major
muscle groups should be trained **at least twice a week** to maximise growth,
while noting that whether three times beats twice was not established.

- [Effects of Resistance Training Frequency on Measures of Muscle Hypertrophy (Sports Medicine, 2016)](https://link.springer.com/article/10.1007/s40279-016-0543-8)

The check fires only once a muscle already receives real weekly volume
(`FREQUENCY_MIN_SETS_TO_JUDGE: 10`), because splitting three sets across two
days is not what the finding is about. It carries zero score weight and is
surfaced as a suggestion, which matches a finding about *optimising* growth
rather than about safety.

---

## Intensity

### `BEGINNER_MAX_RPE: 8` and `BEGINNER_MAXOUT_RPE: 10`

**Directional.** RPE here is the repetitions-in-reserve scale, where 8 means
roughly two reps left in the tank and 10 means momentary failure.

- [Novel Resistance Training-Specific RPE Scale Measuring Repetitions in Reserve (JSCR, 2016)](https://pubmed.ncbi.nlm.nih.gov/26049792/)
- [Application of the Repetitions in Reserve-Based RPE Scale for Resistance Training (Strength Cond J, 2016)](https://pubmed.ncbi.nlm.nih.gov/27531969/)

The relevant finding for a beginner cap is that novice lifters are measurably
*worse* at judging proximity to failure than experienced ones: the Zourdos
validation compared experienced and novice squatters precisely on this. A
prescription of RPE 10 assumes an accuracy the person does not yet have, which
is the argument for capping it, rather than any claim that RPE 9 is injurious.

---

## Goal fit

### `STRENGTH_MAX_AVG_REPS: 10`

**Supported.** Loads above ~60% of 1RM produce greater maximal strength gains,
and strength adaptations are load- and specificity-sensitive in a way
hypertrophy is not.

- [Loading Recommendations for Muscle Strength, Hypertrophy, and Local Endurance (Sports, 2021)](https://pubmed.ncbi.nlm.nih.gov/33671664/)
- [Strength and Hypertrophy Adaptations Between Low- vs. High-Load Resistance Training (JSCR, 2017)](https://pubmed.ncbi.nlm.nih.gov/28834797/)

A "strength" program averaging 15 reps per set is genuinely mismatched to its
stated goal, and that is what this catches.

### `HYPERTROPHY_MIN_AVG_REPS: 5` / `HYPERTROPHY_MAX_AVG_REPS: 20`

**Directional, and deliberately wide.** The same 2021 review re-examines the
"repetition continuum" (heavy for strength, moderate for size, light for
endurance) and finds current research **does not support** its underlying
presumptions: hypertrophy is similar across a broad spectrum of loads.

That is why this band is 5 to 20 rather than the conventional 6 to 12. The
check is only meant to catch a program that is nearly all singles or nearly all
25-rep sets while claiming a hypertrophy goal. Narrowing it to the textbook
range would be flagging plans the evidence says are fine.

---

## Conditioning

### `CARDIO_WEEKLY_MIN_WARN: 300`

**Supported as a reference point, ours as a warning line.** The WHO 2020
guidelines recommend 150 to 300 minutes of moderate-intensity aerobic activity
per week for adults, and explicitly say adults *may* exceed 300 minutes for
additional health benefit.

- [WHO 2020 guidelines on physical activity and sedentary behaviour (Br J Sports Med)](https://pubmed.ncbi.nlm.nih.gov/33239350/)
- [WHO Guidelines full text, NCBI Bookshelf](https://www.ncbi.nlm.nih.gov/books/NBK566046/)

Note carefully what the warning is and is not. Exceeding 300 minutes is
explicitly *fine for health*. The check fires because this app programs
**lifting**, and past the top of that band, conditioning starts competing with
lifting recovery. The wording says exactly that rather than implying the cardio
itself is a health problem.

### `CARDIO_CONFLICT_LEG_SETS: 6` and the cardio/leg-day check

**Supported, and unusually specifically.** Wilson et al.'s concurrent-training
meta-analysis (21 studies, 422 effect sizes) found two things this check is
built directly on:

1. Interference is **modality-specific**: the *running* component produced
   significant decrements in strength and hypertrophy; the *cycling* component
   did not.
2. Interference is **body-part specific**: decrements appeared in lower-body,
   not upper-body, measures after lower-body-dominated endurance work.

- [Concurrent Training: A Meta-Analysis Examining Interference of Aerobic and Resistance Exercises (JSCR, 2012)](https://pubmed.ncbi.nlm.nih.gov/22002517/)

This is why the check targets **legs specifically** rather than flagging any
cardio near any lifting, and why easy aerobic work is explicitly not flagged.
The 6-set line for "this is a leg day" is ours; the shape of the rule is not.

---

## Contradicted, or unsupported

These are here because grounding the rubric found them. They have not been
silently corrected in the code as part of writing this document; see the
changes note at the end.

### `LEG_BALANCE_RATIO_WARN: 3.0` — the rationale was wrong

The code and the earlier writeups described this as **a knee-health antagonist
check**. A systematic and critical review of the hamstrings-to-quadriceps torque
ratio concludes, in its own words:

> The H:Q ratio has limited value for the prediction of ACL and hamstring
> injuries.

- [Is hamstrings-to-quadriceps torque ratio useful for predicting anterior cruciate ligament and hamstring injuries? A systematic and critical review (Journal of Sport and Health Science, 2023)](https://pubmed.ncbi.nlm.nih.gov/35065297/)

That is a statement about *predictive value*, which is weaker than "H:Q
imbalance is harmless" and weaker than the claim the code was making. It is
still more than enough to retire an injury-prevention claim, because the check
was asserting predictive power the measure does not have.

Two further caveats that matter for this app specifically: that literature
measures *isokinetic torque ratios in athletes*, whereas this check counts
*prescribed weekly sets in a plan*. Those are not the same quantity, so even a
positive finding would not transfer cleanly.

**What the check is still good for:** a program with 18 sets of quad work and
zero direct hamstring work is unbalanced *programming*, and saying so is
reasonable coaching. What it must not do is claim to reduce injury risk.

The check therefore stays, at zero score weight and `suggestion` tier, with
injury-prevention language removed. See `evaluator.js` and
`docs/grading-the-model.md`.

### `TRAINING_DAYS_WARN: 6` / `TRAINING_DAYS_FAIL: 7`

**Practical.** There is no study establishing that seven consecutive training
days is harmful and six is acceptable. Rest is genuinely necessary, but the
specific cut point is a judgment about self-coached lifters, not a finding.

The check is honest in its wording ("risk under-recovery, injury, and burnout")
but that sentence is reasoning from general principle, not from a citation, and
it should be read that way.

### `SESSION_SETS_WARN: 30` / `SESSION_SETS_FAIL: 40`

**Practical.** No literature sets a per-session set ceiling. The rationale is
that per-set quality declines across a very long session and that a 40-set
workout is usually a scheduling error rather than a plan. Defensible as
coaching, not citable as science.

### `COVERAGE_MIN: 0.7`

**Practical, and not a training claim at all.** This measures how much of a
plan matched the structured exercise database rather than falling back to
keyword heuristics. It is a statement about the evaluator's own confidence, and
0.7 is where we decided to start admitting the estimate is rough.

---

## What changed because of this review

Writing this document changed the code. That is the point of it:

- `leg_balance` lost its injury-prevention rationale in `evaluator.js`, in its
  remedy text, and in the writeups. It is now described as a programming
  balance check, which is what the evidence supports.
- The volume ceilings are now labelled in the source as recovery and realism
  judgments rather than implied findings.
- Each threshold group in `THRESHOLDS` carries a pointer to its section here.

## Standing limitations

The evaluator matches on exercise **names** using keyword and structured-catalog
lookups. Every threshold above is applied to that estimate, not to what you
actually lifted. It flags concerns in a written plan; it does not assess a
person, and none of this is medical advice. See the limitations section of the
[README](../README.md).
