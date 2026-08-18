# Safety Lab telemetry: benchmark history and production audit counters

*Design, 2026-08-18. Status: approved, not yet implemented.*

## The problem

The Safety Lab is the project's strongest claim: a deterministic evaluator that
audits what the model wrote, benchmarked live in the browser against a red-team
suite. Today that page can only say one thing, and it says it about fixtures.

Two numbers are missing, and they are missing for different reasons.

**There is no history.** `runEvalSuite()` runs fresh on every page load, so the
page shows the evaluator as it exists right now. It cannot show whether an
earlier version caught fewer risky plans than the 17 of 17 `v1.3.0` catches
today, and it cannot show a regression as a step down. The claim "the evaluator does not get worse" is
currently unevidenced, even though CI has been enforcing it since June.

**There is no production signal.** Every public number describes the 21 fixtures
in `eval-suite.js`. Nobody knows which checks actually fire on plans real people
generate. A check that has never once fired in production is either
well-calibrated or dead code, and the page cannot tell those apart.

## Non-goals

- Not building an owned API server or migrating off Firestore. `sync.js` and
  `firestore.rules` are unchanged by this work.
- Not per-user analytics. Nothing here identifies a person or a plan.
- Not replacing the Vercel funnel events in `analytics.js`. That hack stays for
  now; this is deliberately scoped to the evaluator.
- No paywall, no account requirement, no change to what a user must do to use
  the Safety Lab.

## Phase 1: benchmark history

**This half needs no backend.** The history is append-only, tiny, and produced
by CI rather than by users, so it belongs in the repo. Storing it in git makes
it versioned, diffable, free, offline-capable inside the PWA, and impossible to
tamper with from outside a pull request.

### `eval.mjs --json`

`eval.mjs` gains a `--json` flag. With it, instead of the current table, it
prints one JSON record to stdout:

```json
{
  "date": "2026-08-18",
  "commit": "e275c0a",
  "evaluatorVersion": "v1.3.0",
  "cases": 21,
  "casesPassed": 21,
  "riskyTotal": 17,
  "riskyCaught": 17,
  "falsePositives": 0,
  "expectationsPassed": 30,
  "expectationsTotal": 30,
  "avgAuditMsRunner": 0.073,
  "perCase": [{ "name": "Balanced hypertrophy week", "passed": true, "score": 100 }]
}
```

Every field comes from the values `eval.mjs` already computes. No new
measurement logic, no second source of truth. `commit` is read from
`GITHUB_SHA`, falling back to `git rev-parse --short HEAD`, falling back to
`null`.

`avgAuditMsRunner` is named for what it is. It is measured on a GitHub Actions
runner and is not comparable to a user's device, so the Safety Lab keeps
showing the live in-browser timing as the headline number and uses the runner
figure only to spot order-of-magnitude regressions.

The default human-readable output and the process exit code are unchanged, so
`npm run eval` and the existing CI gate behave exactly as they do today.

### `docs/benchmark-history.json`

An array of those records, oldest first. Committed to the repo.

**Dedupe rule, so history stays readable.** A new record is appended only if it
differs from the last record in any field except `date`, `commit` and
`avgAuditMsRunner`. Most pushes do not touch the evaluator, and without this
rule the file would gain an identical row per commit. The comparison lives in a
pure exported function so it can be tested without running CI.

Seeding: the file starts with the single record produced by the first run. The
history genuinely begins on the day this ships. Earlier versions are not
back-filled, because reconstructing them would mean checking out old commits and
asserting numbers nobody recorded at the time, which is exactly the kind of
invented history the project's standing rules forbid.

### CI job

A new workflow, `.github/workflows/benchmark-history.yml`, on push to `main`
only:

1. `node eval.mjs --json` into the append script.
2. Append if the dedupe rule says to, otherwise exit clean.
3. If appended, commit `docs/benchmark-history.json` with message
   `chore: benchmark history <version> <short-sha> [skip ci]` and push.

Needs `permissions: contents: write`. The `[skip ci]` tag and a
`paths-ignore: [docs/benchmark-history.json]` guard on the workflow together
prevent the commit from re-triggering the job. Existing `ci.yml` is untouched.

### Safety Lab rendering

`safety-lab.js` fetches `docs/benchmark-history.json`, and renders a history
block directly above the existing live benchmark:

- one row per evaluator version, with risky-caught and false-positive counts
- a regression marker on any row where risky-caught dropped from the row before
- the date range the history covers, stated honestly ("since 2026-08-18"), so
  the page never implies it has data from before it was collecting any

The fetch is non-blocking and fails silently. If the file is missing or the
request fails, the page renders exactly as it does today. The live in-browser
benchmark stays the primary content and never depends on this.

## Phase 2: production audit telemetry

This half genuinely needs a server: a browser cannot append to the repo.

### The endpoint

New `api/audit-telemetry.js`, POST only. Fire-and-forget from the client via
`navigator.sendBeacon`, wrapped in try/catch, exactly like `trackFunnel` already
is. A telemetry failure must never be visible to a user mid-audit.

### The payload, allow-listed

The allow-list is the design. Anything not on it is dropped server-side before
a write, so a client bug or a hostile poster cannot widen what gets stored.

| field | values |
|---|---|
| `v` | `1` |
| `evaluatorVersion` | must match `/^v\d+\.\d+\.\d+$/` |
| `source` | `generate`, `import`, `adapt` |
| `scoreBucket` | `0-59`, `60-74`, `75-84`, `85-100` |
| `daysCount` | integer 1 to 7 |
| `exerciseCount` | integer 0 to 140 |
| `goal` | the existing onboarding goal enum |
| `experience` | the existing onboarding experience enum |
| `checks` | array of `{ id, status }` |

`checks[].id` must be one of the eleven ids already defined in `evaluator.js`
(`rest_days`, `weekly_volume`, `muscle_balance`, `beginner_load`, `goal_fit`,
`progressive_overload`, `leg_balance`, `muscle_frequency`, `equipment_fit`,
`session_load`, `coverage`), or `invalid_plan`, or `injury_<key>` for a key in
`INJURY_RULES`. The injury ids are generated at `evaluator.js:495`, so the
allow-list derives them from `Object.keys(INJURY_RULES)` rather than hardcoding
a list that would silently go stale when a rule is added.

`checks[].status` must be `pass`, `warn`, `fail` or `not_assessed`.

No plan content, no exercise names, no program name, no notes, no free text of
any kind, no user id, no profile id, no raw score. The score is bucketed
client-side before it is sent.

### Storage: aggregate counters only, no raw rows

Firestore, via the Admin SDK inside the function. Already the project's vendor,
free on the Spark tier, and writing server-side means `firestore.rules` stays
deny-all for clients. No rule is loosened.

One document per UTC day, `audit_telemetry/{YYYY-MM-DD}`, holding atomic
counters:

```
audits: 412
byCheck: { rest_days: { pass: 380, warn: 20, fail: 12 }, ... }
byScoreBucket: { "85-100": 300, ... }
byGoal: { Hypertrophy: 210, ... }
byExperience: { Beginner: 180, ... }
byDaysCount: { "4": 190, ... }
```

**Raw per-audit rows are never written.** Only counters are incremented. This is
better on privacy, cheaper on quota, and keeps the Safety Lab's read at one
document per day rendered.

The gap this creates, stated up front: cross-tab questions become impossible.
"Which checks fail on beginner plans specifically" cannot be answered from
counters, because the dimensions are collapsed independently. If that question
turns out to matter, the fix is to add one deliberate composite counter for it,
not to start storing rows.

### Quota

Spark's write ceiling is 20k/day. Traffic in the 30 days to 2026-08-16 was 170
visitors, so a normal day is nowhere near the ceiling. It is still a real
ceiling and a real failure mode, so the function stops writing and returns 204
once the day's document reports more than 5,000 audits. Losing the tail of an
anomalous day is strictly better than exhausting the project's shared free tier
and breaking user sync, which runs on the same quota.

### Abuse: the weakest part of this design, named

The endpoint is public, unauthenticated and writes to a database. That is
deliberate, because the product has no account requirement and this must not
introduce one. The consequences are real:

- someone can inflate the counters and skew a public number
- someone can burn the daily cap and blind the collection for that day

Mitigations: the allow-list bounds what can be written at all, the 5,000/day cap
bounds the damage, and a per-IP hourly cap rejects the cheapest floods. A
determined attacker still gets through, and serverless makes any in-memory
throttle leaky.

The honest response is in the labelling, not the defense. The Safety Lab must
present these two numbers with different confidence:

- the fixture benchmark is **reproducible**. Anyone can clone the repo, run
  `npm run eval`, and get the same number.
- production telemetry is **unverified**. It is a public counter with no
  authentication behind it.

The page says so in those terms. A number the project cannot vouch for must not
be displayed as if it could.

### Configuration

One new environment variable, `FIREBASE_SERVICE_ACCOUNT`, holding the service
account JSON. Set in Vercel, documented in `.env.example` and `docs/SETUP.md`.
Absent locally, the endpoint returns 204 and writes nothing, so `vercel dev` and
`npm test` work with no setup. This is the project's first secret beyond model
keys.

Adds `firebase-admin` as the second runtime dependency. `@vercel/analytics` is
currently the only one. That is a real cost to a deliberately dependency-light
project and it is accepted here because the alternative, hand-rolling
authenticated REST calls to Firestore, is worse.

### Safety Lab rendering

Below the fixture benchmark, a production block: per check, how often it fired
in the last 30 days, against how many audits, with the "unverified" label and
the collection start date. If the endpoint is unreachable or no data exists, the
block is omitted entirely. It never shows a zero that could be read as "this
check never fires" when the truth is "nothing was collected".

## Safety rules check

The project's standing rule 6 requires the `safety_evaluator_change.md`
directive for any change to `evaluator.js`, `safety-boundaries.js` or
`nutrition-safety.js`.

**This design touches none of them.** It reads their output only. `INJURY_RULES`
is imported, not modified.

Files changed: `eval.mjs`, `safety-lab.js`, `.env.example`, `docs/SETUP.md`,
`package.json`. Files added: `docs/benchmark-history.json`,
`.github/workflows/benchmark-history.yml`, `scripts/append-benchmark-history.mjs`,
`api/audit-telemetry.js`, `lib/telemetry-schema.js`, and their tests.

If implementation finds it needs an evaluator change, work stops and the
directive runs first.

## Testing

Node's built-in runner, matching the existing 60 files in `test/`.

`test/benchmark-history.test.js`
- the `--json` record contains every documented field, with correct types
- the record's numbers equal the numbers the human-readable output prints, so
  the two views cannot drift
- dedupe: identical benchmark, different commit and date, does not append
- dedupe: changed `riskyCaught` does append
- a malformed existing history file fails loudly rather than being overwritten

`test/audit-telemetry.test.js`
- every allow-listed field shape is accepted
- an unknown `checks[].id` is rejected
- an unknown `checks[].status` is rejected
- extra top-level fields are stripped, not stored
- a payload carrying an exercise name or any free-text field is rejected
- `injury_<key>` ids are accepted for every key in `INJURY_RULES`, proving the
  derived allow-list tracks the source
- score bucketing is correct at every boundary (59/60, 74/75, 84/85)
- with `FIREBASE_SERVICE_ACCOUNT` unset the handler returns 204 and writes
  nothing
- over the daily cap, the handler returns 204 and writes nothing

## Success criteria

1. `npm run eval` output and exit code are byte-identical to today's.
2. A push to `main` that changes the evaluator appends exactly one history row.
   A push that does not touch it appends none.
3. The Safety Lab renders history, and renders normally with the history file
   deleted.
4. An audit in production increments the day's counters, and the same audit run
   with telemetry blocked at the network layer is visually identical.
5. No document in Firestore contains an exercise name, plan text, or any
   identifier for a person.
6. The Safety Lab labels the fixture number reproducible and the production
   number unverified, in those words.

## Open question, deferred deliberately

Phase 2 answers "which checks fire in the wild". It does not answer "were those
flags correct", because nothing collects whether the user agreed with a flag or
trained anyway. That is the more valuable question and it needs a UI affordance
that does not exist yet. Out of scope here, and worth its own spec once the
counters show which checks are even worth asking about.
