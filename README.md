# SpotterAI 🟢

[![CI](https://github.com/Ray-Shaw06/spotterai/actions/workflows/ci.yml/badge.svg)](https://github.com/Ray-Shaw06/spotterai/actions/workflows/ci.yml)
&nbsp;[![codecov](https://codecov.io/gh/Ray-Shaw06/spotterai/branch/main/graph/badge.svg)](https://codecov.io/gh/Ray-Shaw06/spotterai)
&nbsp;[![License: MIT](https://img.shields.io/badge/License-MIT-1a5c42.svg)](LICENSE)

**A deterministic verifier for LLM output, in a domain where users can't check the answer themselves.** &nbsp;·&nbsp; **[▶ Live demo](https://spotterai.xyz)** &nbsp;·&nbsp; **[▶ Audit a plan you already have](https://spotterai.xyz/#/import)**

> **At a glance:** an LLM writes a training plan, then a separate **pure-code
> evaluator** (no AI, fixed rubric, 11 checks on every plan, up to 15 with
> cardio and injuries declared) grades that plan and shows the
> flags before you train. The red-team suite that tests the evaluator is
> [published and runs live in your browser](https://spotterai.xyz/#/evals).
> **886 tests, 23 adversarial eval cases, 2 runtime dependencies, no build step.**
> (These counts are [checked by CI](scripts/check-readme-claims.mjs) against the
> live repo, so they cannot silently go stale.)
> Solo-built by a CS student. Vanilla ES modules, Node serverless functions on
> Vercel, Gemini, on-device MediaPipe.

<p align="center">
  <img src="og-home.png" alt="A flags-first plan safety audit: issues to review, severity tiers, and a demoted quality score." width="700" />
</p>

## Don't take this README's word for it

Every quality claim below is a command you can run. The fastest check needs
**nothing installed at all** — Node 22 and the repo:

```bash
git clone https://github.com/Ray-Shaw06/spotterai && cd spotterai
npm test          # the full suite, ~7s, nothing to install
npm run eval      # the evaluator benchmark, no API key, no network
```

For the full gate, `npm ci && npm run verify`. That is four checks, and all four
run on every pull request ([`ci.yml`](.github/workflows/ci.yml)):

| Gate | What it actually proves | Command |
| --- | --- | --- |
| **Lint** | No undeclared identifiers, no dead imports, no undocumented silent `catch {}`. This repo has no build step and no type checker, so `no-undef` is the only thing standing between a typo in a browser module and a `ReferenceError` on someone's phone. Config and the reasoning for every rule: [`eslint.config.js`](eslint.config.js). | `npm run lint` |
| **Tests** | **886 tests**, holding **line coverage above 85%** ([live figure](https://codecov.io/gh/Ray-Shaw06/spotterai)), on Node's built-in runner. | `npm test` |
| **Evaluator benchmark** | The safety evaluator catches **18 of 18** known-risky plans and false-flags **0 of 5** known-good ones. A regression fails the build rather than quietly moving a dashboard. | `npm run eval` |
| **README claims** | The numbers on this page are derived from the repo, not typed by hand — [the check](scripts/check-readme-claims.mjs) fails CI if the prose drifts from reality. | `npm run check:readme` |

There is one more check that is not a CI gate, because it cannot honestly be
one: [`npm run visual:baseline`](scripts/visual-snapshot.mjs) then
`npm run visual:check` fingerprints ~108,000 computed styles across every
route, both themes and two viewports, and fails if a refactor moved anything.
It compares two runs in the same environment rather than against a committed
baseline, because computed values include resolved layout and those differ
between machines. It earned its place: flattening the stylesheet produced two
regressions that looked correct in the diff and were only wrong at one
viewport.

**The honest limits,** so you can weigh the above properly: there is **no type
checker** (vanilla ES modules, no build step — lint plus tests carry that load),
there is **no automated browser/E2E suite** (the visual harness above is a
refactor net, not behaviour coverage, and the [manual QA checklist](#manual-qa-checklist)
is genuinely run by hand), and coverage is a *report* above its floor rather
than a hard gate. The evaluator benchmark is a **bundled local suite**, not a
live-model eval; what it proves is that the deterministic checker behaves, not
that the LLM behind it does.

## The idea

Anyone can prompt a model for a workout. The interesting engineering is the
**second system that checks the first one's work.**

A beginner cannot tell a good training plan from a bad one. That is the whole
reason they asked an AI. So an LLM fitness app has a structural problem: it
ships confident output to exactly the person least able to catch it when it is
wrong. Being a language model, it is fluent about being wrong.

SpotterAI's answer is to not trust its own model. Every generated plan goes
through `evaluator.js`, which contains **no AI at all**. It is pure code against
a fixed rubric: rest days, weekly volume, push/pull balance, quad/hamstring
balance, per-muscle frequency, session load, progressive overload, goal fit,
equipment fit, exercise recognition, and injury conflicts. It returns flags
first, each with a plain-English reason, a suggested fix, and a safer
alternative. The numeric score exists but is deliberately demoted to a footnote.

Three properties matter more than the check list:

- **It says "not assessed" instead of "pass."** If you never told us your
  training experience, the beginner-intensity check reports that it could not
  run. It does not quietly call it a pass. A verifier that invents reassurance
  is worse than no verifier.
- **It is testable, and the tests are public.** The [Safety Lab](https://spotterai.xyz/#/evals)
  runs 23 adversarial cases against the evaluator live in your browser, including
  the known-good plans it must *not* flag.
- **It works on plans it did not write.** [`/import`](https://spotterai.xyz/#/import)
  takes a plan pasted from a chatbot, a PDF or a coach's email and runs the same
  audit, with no account. A test asserts an imported plan and a generated plan
  produce byte-identical verdicts.

**The evaluator has caught its own author.** In August 2026 it turned out the
evaluator could not detect either failure that motivated the entire project:
there was no progressive-overload check, and the rep-range check passed
unconditionally for any plan without a declared goal, which is every pasted
plan. Write-up: [an evaluator that couldn't catch its own bug](docs/an-evaluator-that-couldnt-catch-its-own-bug.md),
and [grading the model](docs/grading-the-model.md) for how the rubric, the
tiers and the benchmark fit together. Every threshold is sourced in
[where the thresholds come from](docs/rubric-sources.md), including the three
graded as judgment calls rather than findings, and the one whose original
rationale the evidence did not support.

Fitness is the demo. The pattern is a deterministic verifier for LLM output in
any domain where the consumer cannot evaluate correctness themselves.

## What happened when I shipped it

Six weeks in, honest numbers, because a project page with no numbers on it is
usually hiding the same ones.

| | 7 days ending 2026-08-02 |
|---|---|
| Visitors | 82 |
| Clicked "Build my plan" | 5 |
| Finished onboarding | 3 |
| Real AI plan generated | 4 |
| Completed a workout | 1 (me) |

**Zero external users have completed a workout.** The prior window had 36
visitors and produced the same absolute counts at every step, so 46 extra
visitors converted at roughly zero. That is not a funnel leaking, it is a funnel
not filling.

Two things I got from measuring rather than guessing:

**My primary success metric was broken.** `first_workout_completed` fired on
every logged workout instead of the first ever, and I train in the app. It could
never distinguish me from a stranger, so both traffic snapshots were misread
until I found it. It now fires once per profile, and `workout_completed` carries
the ongoing volume it was accidentally collecting.

**The one real usage signal I have points against my thesis.** In the only case
I have watched end to end, someone was shown that their plan had real problems
and carried on with it unchanged. If being corrected is a push rather than a
pull, the premise needs rethinking. One observation is not evidence, but it is
the only observation I have, and I would rather write it down than decorate
around it.

[`/import`](https://spotterai.xyz/#/import) is the current experiment: no
account, no onboarding, paste a plan and get a verdict. It is the cheapest
version of the question "does anyone actually want this."

## Screenshots

| Landing / hero | Safety score, checks & plan | Mobile |
| --- | --- | --- |
| ![Generator](docs/screenshot-generator.png) | ![Score](docs/screenshot-score.png) | ![Mobile](docs/screenshot-mobile.png) |

| Real-time form check | Coach chatbot |
| --- | --- |
| ![Form check](docs/screenshot-formcheck.png) | ![Coach chat](docs/screenshot-chat.png) |

| Gamified dashboard (track, rank up) | Local profiles ("accounts") |
| --- | --- |
| ![Dashboard](docs/screenshot-dashboard.png) | ![Account](docs/screenshot-account.png) |

> _Captured from the running app. Re-shoot anytime and overwrite the files in `docs/`._

---

## What's in it

- **Plan → Train → Log → Adapt → Re-audit.** Generate a week, train it, log it,
  and the plan adapts from what actually happened — then gets re-audited.
- **The evaluator** ([`evaluator.js`](evaluator.js)): pure code, fixed rubric,
  no AI. Flags first, each with a reason, a fix and a safer alternative.
- **Plan repair** ([`repair.js`](repair.js)): turns each flag into a concrete
  edit, re-audits, and shows you the before/after.
- **[Import](https://spotterai.xyz/#/import):** paste a plan from anywhere and
  get the same audit, no account.
- **Real-time form check:** on-device pose estimation counts reps and flags form
  through your webcam. The video never leaves the device.
- **Coach chat, nutrition guardrails, a gamified tracker,** local profiles, and
  optional Firebase sync.

The long version — every feature, the full rubric, the file layout — is in
[docs/features.md](docs/features.md).

## Tech stack

- **No framework, no build step.** Vanilla ES modules, deployed as static files.
  Two runtime dependencies.
- **Backend:** four Node functions on Vercel (plan generation, coach chat, food
  and exercise estimates, quick-log parsing). Plan adaptation runs entirely
  client-side. AI keys stay server-only.
- **Local-first:** `localStorage` for everything, with JSON export/import.
  Firebase Auth + Firestore sync is optional and off until configured.
- **On-device CV:** MediaPipe Tasks Vision for the form check — no server, no
  key, nothing uploaded.
- **Design:** a hand-built token system (colour, spacing, radius, type scale) in
  CSS variables. Inter + JetBrains Mono, self-hosted as variable woff2 rather
  than linked from Google Fonts, which used to be the last render-blocking
  resource on cold boot. Light by default, opt-in dark, both AA-verified.
- **Zero-cost by construction:** no Web Push, no scheduled functions, no paid
  tier. Reminders are `.ics` files built in the browser and local on-device
  alerts.

## Try it in 10 seconds + install it

- **See it populated instantly.** Open the **profile** menu (top-right) → **Load
  demo data**. It spins up an isolated **Demo** profile with ~6 weeks of workouts,
  nutrition, bodyweight, and a saved plan, so the dashboard, charts, rank, and the
  **adaptive coach loop** all do something on the very first click (your own
  profiles are never touched).
- **Install it.** SpotterAI is a **PWA**, a manifest + service worker make it
  installable on phone/desktop ("Add to Home Screen") and keep the app shell plus
  the built-in food/exercise databases working **offline** after the first visit.
  (The AI features need a connection and degrade gracefully without one.)
- **iPhone:** in Safari, choose **Share → Add to Home Screen**, then launch
  SpotterAI from the new Home Screen icon for the installed, offline-capable app.
- **Android:** use the browser's **Install app** or **Add to Home screen** action,
  then launch the installed app.
- **Reminders are zero-cost and never remote.** After a plan is generated you can
  **export your training days to your calendar** (a `.ics` file built in the
  browser, with an optional native reminder), your calendar app owns it from
  there. During a workout you can opt into **local rest-timer alerts** (Account →
  Workout alerts); permission is requested only on a deliberate tap, the choice is
  stored on that device only, and nothing is shown after the app is closed.
  Vibration, sound, and the on-screen timer always work regardless of notification
  support.

---

## Setup and deployment

Running or self-hosting SpotterAI (clone, set `GEMINI_API_KEY`, `vercel dev`), the full configuration reference, and optional Google/Firebase cross-device sync all live in **[docs/SETUP.md](docs/SETUP.md)**.

## Limitations & responsible use

- **This is an educational, heuristic tool, not medical or professional fitness
  advice.** The safety score is a heuristic, not a guarantee.
- **The evaluator flags concerns; it never certifies a plan as "safe."** A high
  score means *few automated checks fired*, not that a plan is appropriate for
  *you*.
- **The checks are deliberately simple.** Muscle-group and injury detection use
  keyword matching on exercise names, so they can misclassify unusual movements,
  and they can't see your medical history, technique, or recovery capacity.
- **Always consult a qualified coach or clinician** before starting a program,
  especially with injuries or medical conditions.
- **AI output is imperfect.** Generated plans can contain mistakes the evaluator
  doesn't catch, which is precisely why the audit layer exists, and why it's
  framed as a second opinion rather than the final word.
- **The form check is experimental.** It infers movement from a single 2D webcam,
  so rep counts and cues can be wrong, and it can't judge load, tempo, or true 3D
  joint positions. Treat it as a rough mirror, not a judge, and stop if anything
  hurts. It runs entirely on-device and uploads/stores nothing.
- **The chatbot is educational.** It can be wrong or out of date and is not a
  substitute for a qualified coach, dietitian, or clinician.
- **Nutrition is general habit support, not a diet.** The guardrails flag
  aggressive calorie/macro targets and refuse starvation / purging / extreme-loss
  language, but SpotterAI can't diagnose, prescribe a diet, or replace a
  registered dietitian.
- **Tracker data is local by default.** Clearing site data can wipe an unsynced
  profile. Optional Google/Firebase sync can copy the current profile across the
  owner's devices, but there is no shared global leaderboard.

### What not to trust SpotterAI for

Diagnosing pain or injuries · medical rehab plans · eating-disorder support or
treatment · extreme weight-loss plans · training through severe pain · replacing
professional coaching for complex cases · guaranteeing exercise safety · judging
true lifting form from one camera with certainty · handling medical conditions
without professional guidance. It **can** still help you build a conservative
general plan, track habits, and catch obvious programming issues.

---

## Going deeper

| Doc | What's in it |
| --- | --- |
| [Features, in detail](docs/features.md) | The full feature tour, rubric and file layout |
| [An evaluator that couldn't catch its own bug](docs/an-evaluator-that-couldnt-catch-its-own-bug.md) | The failure that motivated the project, found in the thing meant to prevent it |
| [Grading the model](docs/grading-the-model.md) | How the rubric, tiers and benchmark fit together |
| [Where the thresholds come from](docs/rubric-sources.md) | The evidence behind every number, including the ones graded as judgment calls |
| [Setup](docs/SETUP.md) | Running it yourself |

## License

MIT, free to use, learn from, and build on.
