# Where the thresholds come from

*Last reviewed 2026-08-31, against evaluator v1.4.0. Nutrition pace section added 2026-10-05.*

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

## Nutrition pace (the weekly check-in)

*Researched 2026-10-05; built in `nutrition-adjust.js`, where each constant is marked Directional, Practical or Derived. Every source below was read as a primary record (abstract
or open full text), not from a summary. Where a page could not be read, that is
said here and nothing is claimed from it.*

The weekly check-in compares a user's weight trend with the pace their goal
expects, and proposes one small calorie change when the trend is confidently
outside it. This section is the evidence for each number that decision uses, graded
with the same scale as above. **The headline finding is unflattering to anyone
hoping for tidy numbers:** the best-evidenced pace figures come from lean athletes
in short trials, almost none come from the recreational lifters this app serves,
and two of the numbers have no literature at all and are derived from measurement
noise instead.

### Cut: how fast is too fast

**Directional.** Fastest acceptable loss: **1.0% of bodyweight per week**, and
**0.5% per week** for lean users.

- Garthe et al. randomised 24 elite athletes doing resistance training to a slow
  (0.7%/wk target) or fast (1.4%/wk target) loss. Fat mass fell similarly
  (5.6% vs 5.5% of bodyweight) but lean mass **rose 2.1%** on the slow plan and was
  unchanged on the fast one (p < .01). [Garthe 2011, IJSNEM](https://pubmed.ncbi.nlm.nih.gov/21558571/)
  Note what it did and did not show: n = 24, 5 to 9 weeks, elite athletes, and the
  fast group achieved about 1.0%/wk, not the 1.4% planned.
- Helms, Aragon & Fitschen recommend losses of about **0.5 to 1% per week** to
  maximise muscle retention in contest preparation, resting chiefly on Garthe and
  explicitly noting that direct evidence in this population is limited. [Helms 2014, JISSN](https://pubmed.ncbi.nlm.nih.gov/24864135/)
- Roberts et al. prefer **0.5% per week or slower** for lean competitors,
  because slower loss attenuates fat-free mass loss. [Roberts 2020, J Hum Kinet](https://pubmed.ncbi.nlm.nih.gov/32148575/)
- The ISSN position stand: slower rates better preserve lean mass in **leaner**
  subjects, and the higher the baseline body fat the more aggressive a deficit
  may be. [Aragon 2017, JISSN](https://pubmed.ncbi.nlm.nih.gov/28630601/)
- For the general public, CDC advises about **1 to 2 pounds a week** (about
  0.45 to 0.9 kg; page reviewed 2025-01-17). [CDC, Steps for Losing Weight](https://www.cdc.gov/healthy-weight-growth/losing-weight/index.html)
  The 2013 AHA/ACC/TOS guideline prescribes a **500 or 750 kcal/day** deficit
  (Grade A) and does not state a per-week rate in the text I could read.
  [AHA/ACC/TOS 2013](https://pmc.ncbi.nlm.nih.gov/articles/PMC5819889/)

The 1.0% ceiling is the top of the athlete range and sits inside the CDC range
for a typical adult. The **0.5% limit for lean users** follows the direction the
literature gives (leaner means slower), but **the BMI cut-off we would use to call
someone "lean" is ours.** The app has no body-fat measurement, and BMI misreads
muscular people.

### Cut: the size of the deficit

**Supported, with a conflict to resolve.** Murphy & Koehler pooled randomised
trials of resistance training in an energy deficit. Lean-mass gains were impaired
versus no deficit (effect size -0.57, p = 0.02), strength gains were not, and
their meta-regression found that a deficit of **about 500 kcal/day prevented lean
mass gains**. Their advice: avoid deficits above 500 kcal/day when the aim is to
preserve lean mass. [Murphy & Koehler 2022](https://pubmed.ncbi.nlm.nih.gov/34623696/)

**The conflict, and the decision.** The target calculator waiting on an unmerged branch
cuts calories by a flat **20% of maintenance**. That exceeds 500 kcal/day once
maintenance is above 2,500, which is common for men who lift. The ISSN statement above
says people with more body fat can take a larger deficit, so a flat 500 cap is not
obviously right either. **Decided 2026-10-05: cap the cut deficit at 500 kcal/day for
BMI under 30, and keep 20% at BMI 30 and over.** The split follows both sources; **the
BMI cut-off is a proxy and a design choice (Practical)**, since BMI misreads muscular
people and the app has no body-fat measure.

### Bulk: how fast is too fast

**Directional, and weaker than the cut side.**

- Iraki et al. recommend a surplus of about 10 to 20% and a gain of **0.25 to 0.5%
  of bodyweight per week** for novice and intermediate lifters, and more
  conservative for advanced ones (they give about 0.25% per week with a 5 to 10%
  surplus). It is a narrative review, not a trial. [Iraki 2019, Sports](https://pubmed.ncbi.nlm.nih.gov/31247944/)
- Helms et al. randomised 21 trained lifters (17 completed, 8 weeks) to maintenance,
  a 5% surplus or a 15% surplus. Faster body-mass gain mostly increased skinfold
  thickness, meaning fat, rather than adding strength or muscle thickness.
  Small, short, and the authors limit it to its own conditions. [Helms 2023, Sports Med Open](https://pubmed.ncbi.nlm.nih.gov/37914977/)
- Slater et al. state plainly that **the energy surplus that maximises muscle gain
  is unknown** and that the common estimates have never been validated in a
  resistance-training population. [Slater 2019, Front Nutr](https://pubmed.ncbi.nlm.nih.gov/31482093/)

So 0.5% per week is a defensible ceiling and the three sources agree on its
direction, but nobody has measured the optimum. It must not be presented as one.

### Maintain, and the slow edge of each band

**Practical, and derived from noise, not cited.** There is no literature that sets
"stalled" at a number. The slow edges (cut: a loss under 0.25%/wk; bulk: a gain
under 0.1%/wk) and the maintenance band (within +/-0.25%/wk) are set at about the
smallest trend a four-week window of weigh-ins can resolve, per the simulation
below. They are labelled as design choices wherever they appear.

### How much the scale lies

**Supported.** This is what makes a trend rule necessary, and it sets how long the
window must be.

- One healthy adult weighed under standard conditions for 9,521 days: the SD of
  day-to-day change was **0.53%** of body mass, rising to **0.69% across a
  seven-day gap**, constant over the whole record. [Schneditz 2023](https://pubmed.ncbi.nlm.nih.gov/37955103/)
- In 1,421 adults in a weight-maintenance trial, weight followed a within-week
  rhythm of **0.35%**: higher at the weekend, lowest around Friday. Christmas added
  a mean 1.35% that was not fully lost. [Turicchi 2020, PLOS ONE](https://pubmed.ncbi.nlm.nih.gov/32353079/)
  An earlier study of 80 adults found the same Sunday-Monday peak.
  [Orsama 2014](https://pubmed.ncbi.nlm.nih.gov/24504358/)
- In free-living adults who were in energy balance, a two-week weight change had an
  SD of **1.2 kg** and was **84% fat-free mass** (mostly water), with an energy
  density of about **2,380 kcal/kg**, not the 7,700 usually assumed for fat.
  [Bhutani 2017](https://pubmed.ncbi.nlm.nih.gov/28676555/)

Taken together: a single weigh-in is noise of 0.4 to 1% of bodyweight, which is as
large as a whole week's real change on a good cut. Short windows cannot be read.

### Why a prediction cannot be turned into a calorie number

**Supported, and a rule for the copy.** Hall et al.'s dynamic model shows the weight
response to a change in intake is slow (half-times around a year) and slows as you
get lighter, and a review of the "3,500 kcal per pound" rule finds it consistently
over-predicts loss because it ignores falling energy expenditure and adaptive
thermogenesis. [Hall 2011, Lancet](https://pubmed.ncbi.nlm.nih.gov/21872751/),
[Egan & Collins 2022](https://pubmed.ncbi.nlm.nih.gov/35103583/),
[Trexler 2014](https://pubmed.ncbi.nlm.nih.gov/24571926/)
(I could not read Hall & Chow's 2013 letter on the rule and do not cite its
content.) **The check-in must therefore never say "100 fewer calories will cost you
X kilos".** It reports the observed trend and offers a small step.

### Can the log vouch for what was eaten?

**Supported, and it changes one gate.** In a classic study, obese people who
reported not losing weight on under 1,200 kcal/day were eating **47% more than they
reported** and overestimating activity by 51%, with normal measured expenditure.
It was 10 people with a history of "diet resistance", so it is evidence that logs
can be badly wrong, not a measure of how wrong typical logs are.
[Lichtman 1992, NEJM](https://pubmed.ncbi.nlm.nih.gov/1454084/) The check-in
therefore trusts the **scale** as the measurement and treats the food log as
fallible. When the two disagree, the message is that the log may be missing
something, never that the user is wrong.

### Does the rate of loss decide whether you keep it off?

**Supported, and it argues against over-reading the bands.** In 204 adults with
obesity randomised to a 12-week or a 36-week programme aimed at the same 15% loss,
both groups had regained about 71% by three years. [Purcell 2014, Lancet Diabetes
Endocrinol](https://pubmed.ncbi.nlm.nih.gov/25459211/) The bands above are about
protecting lean mass and avoiding an aggressive deficit, not about a promise that
slow loss lasts longer.

### Under 18

**Policy, not a number.** The in-app rule is that anyone under 18 is never offered
a deficit. The AAP's 2023 guideline puts treatment of paediatric obesity in
intensive, face-to-face programmes delivered by trained professionals with family
involvement, and says nothing endorsing self-directed dieting. [AAP guideline summary, HealthyChildren](https://www.healthychildren.org/English/news/Pages/evaluating-and-treating-obesity-in-children-and-adolescents.aspx),
[guideline record](https://pubmed.ncbi.nlm.nih.gov/36622115/) (the full text was
behind a 403, so only AAP's own summary page is relied on). Our rule is a
conservative product choice consistent with that, not something the guideline
prescribes.

### Eating disorders: why there is no streak for hitting a lower number

**Directional.** Both Helms 2014 and Roberts 2020 warn that physique-sport
participants have a higher risk of eating and body-image disorders and should have
access to mental-health professionals. This is the evidence behind the app's
deficit floors, the lack of any reward for a lower target, and the rule that the
check-in never auto-applies.

### The step size and the window: derived, not cited

**Practical.** A step of about **5% of the calorie target, rounded to 25 kcal**
(100 to 150 kcal at typical intakes) is a design choice with three constraints
behind it: it stays under Murphy & Koehler's 500 kcal/day ceiling; it cannot be
finer than the food log can be trusted (Lichtman); and the response is slow (Hall),
so one step is made and then given at least four weeks.

The window is derived from the noise above by simulation
(`node scripts/simulate-weight-trend.mjs`). A least-squares line through the
weigh-ins, with a one-sided 95% confidence limit on its slope, and a rule that fires
only when the **whole** interval lies outside the band:

| Per-weigh-in noise | Window, weigh-ins | False flag when truly on pace | Catches a true stall | Catches a true overshoot |
|---|---|---|---|---|
| 0.5% (typical) | 21 days, 12 | 0.1% | 43% | 73% |
| 0.5% (typical) | 28 days, 12 | 0.0% | 60% | 90% |
| 0.5% (typical) | 42 days, 24 | 0.0% | 99% | 100% |
| 1.0% (pessimistic) | 28 days, 12 | 0.4% | 27% | 47% |
| 1.0% (pessimistic) | 42 days, 24 | 0.0% | 68% | 95% |

Simulated, cut band 0.25 to 1.0%/wk, 6,000 trials per cell, seeded. This is the
statistics of a decision rule given published noise levels, **not a finding about
physiology**, and it is never cited as one.

Two things follow. **The rule almost never fires wrongly**: with a 28-day window it
flagged a genuinely on-pace user at most 0.4% of the time, even at the pessimistic
noise level (1.3% with only 21 days at that noise). That is the property a
calorie-changing feature most needs. **But it is slow and conservative**: at typical
noise a 28-day window catches 60% of true stalls, and at pessimistic noise only
27%. That is accepted on purpose. Silence is the safe failure; a wrong calorie
change is not.

An earlier draft of the design used three weekly means that had to agree. The same
script shows it flagging an on-pace user wrongly **1.0% to 13.3%** of the time
(21 days, 6 to 12 weigh-ins, 0.5% to 1.0% noise), and it cannot judge the 16% of
sparse weighers who skip a week. That draft was dropped for this reason.

### What this does not establish

- Almost every rate figure comes from athletes or from small, short trials.
  Nothing here tests these bands on recreational lifters in the real world.
- Fat mass sets how fast a deficit can safely run (Alpert's limit of about 290
  kJ per kg of fat per day, [Alpert 2005](https://pubmed.ncbi.nlm.nih.gov/15615615/)),
  and the app cannot measure it, so a BMI proxy is the best available stand-in.
- Hall's model and the adaptation literature predict that a long cut slows. A stall
  late in a cut is not necessarily non-adherence, and the check-in must not imply it.

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
