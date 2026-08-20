# Safety Lab Telemetry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Safety Lab two numbers it cannot show today: how the evaluator's benchmark has moved across versions, and which checks actually fire on real plans.

**Architecture:** Phase 1 needs no server. A shared pure record builder feeds both the existing CLI table and a new `--json` mode; CI appends deduped records to `docs/benchmark-history.json` in the repo, and the Safety Lab fetches that static file. Phase 2 adds one serverless endpoint that validates an allow-listed payload and increments per-day Firestore counters, never storing raw rows.

**Tech Stack:** Node 22 ESM, no build step, native ES modules in the browser, `node --test`, Vercel serverless functions, Firestore via `firebase-admin`.

**Spec:** `docs/superpowers/specs/2026-08-18-safety-lab-telemetry-design.md`

## Global Constraints

- Node `22.x`. Package is `"type": "module"`. Every file is ESM, no CommonJS.
- No build step. Browser files are native ES modules loaded directly by `index.html`.
- Tests use Node's built-in runner only. New tests go in `test/<name>.test.js` and must pass under `node --test`.
- Runtime dependencies today: `@vercel/analytics` only. This work adds exactly one more, `firebase-admin`. Add nothing else.
- **Standing rule 6:** do not modify `evaluator.js`, `safety-boundaries.js`, or `nutrition-safety.js`. Import from them only. If a task appears to need a change there, stop and run `spotterai/directives/safety_evaluator_change.md` first.
- Never fabricate a number. Every figure rendered to a user must trace to a real computation or a stored record.
- Copy rule from the spec: the fixture benchmark is labelled **reproducible**, the production telemetry is labelled **unverified**, in those words.
- Firestore Spark tier allows 20k writes/day and is shared with user sync. The endpoint must never be the thing that exhausts it.
- Telemetry must be fire-and-forget. No telemetry failure may ever be visible to a user mid-audit.
- **Nothing on the Safety Lab may fetch on page load.** `#safety-lab` sits inside `<section id="evals" data-view="evals" hidden>` (index.html:924, 941) and the router only toggles `hidden`, so the element is present on every route. Any fetch must be gated behind the `spotter:route` event (router.js:87) and run once, on first arrival at the `evals` route. An ungated fetch bills a serverless invocation and 30 Firestore reads to every page view of the entire app.
- **Every new top-level browser module must be added to the asset list in `service-worker.js`**, and `CACHE` must be bumped exactly once on this branch (Task 7 owns the bump, from `spotterai-v61` to `spotterai-v62`). Without the bump, installed PWAs never fetch anything this branch added.

---

## File Structure

**Create:**
- `lib/benchmark-record.js` — pure record builder plus the dedupe predicate. Single source for every benchmark number.
- `scripts/append-benchmark-history.mjs` — CI entry point. Reads history, builds a record, appends if it is new.
- `docs/benchmark-history.json` — the history itself, committed to the repo.
- `.github/workflows/benchmark-history.yml` — push-to-main job that runs the script and commits the result.
- `lib/telemetry-schema.js` — allow-list and pure sanitizer. Shared by browser and endpoint.
- `api/audit-telemetry.js` — POST increments counters, GET returns the 30-day aggregate.
- `test/benchmark-record.test.js`, `test/benchmark-history-append.test.js`, `test/telemetry-schema.test.js`, `test/audit-telemetry-endpoint.test.js`

**Modify:**
- `eval.mjs` — print from the shared record; add `--json`.
- `safety-lab.js` — render history block and production block.
- `app.js:332`, `import-ui.js:148`, `adapt-engine.js:158` — fire telemetry after an audit.
- `.env.example`, `docs/SETUP.md`, `package.json`, `vercel.json`

---

### Task 1: Shared benchmark record

`eval.mjs` and `safety-lab.js` each compute the benchmark independently today. Before adding a third consumer, the numbers get one home so they cannot drift.

**Files:**
- Create: `lib/benchmark-record.js`
- Modify: `eval.mjs`
- Test: `test/benchmark-record.test.js`

**Interfaces:**
- Consumes: `runEvalSuite`, `CASES`, `isRiskyCase` from `eval-suite.js`; `evaluatePlan`, `EVALUATOR_VERSION` from `evaluator.js`.
- Produces: `buildBenchmarkRecord({ date, commit, timingRuns })` returning the record object below; `isNewHistoryRecord(record, previous)` returning boolean; `HISTORY_SIGNIFICANT_FIELDS` frozen array.

- [ ] **Step 1: Write the failing test**

Create `test/benchmark-record.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { buildBenchmarkRecord, isNewHistoryRecord, HISTORY_SIGNIFICANT_FIELDS } from "../lib/benchmark-record.js";
import { EVALUATOR_VERSION } from "../evaluator.js";

test("the record carries every documented field with the right type", () => {
  const r = buildBenchmarkRecord({ date: "2026-08-18", commit: "abc1234", timingRuns: 2 });
  assert.equal(r.date, "2026-08-18");
  assert.equal(r.commit, "abc1234");
  assert.equal(r.evaluatorVersion, EVALUATOR_VERSION);
  for (const k of ["cases", "casesPassed", "riskyTotal", "riskyCaught", "falsePositives", "expectationsPassed", "expectationsTotal"]) {
    assert.equal(Number.isInteger(r[k]), true, `${k} must be an integer`);
  }
  assert.equal(typeof r.avgAuditMsRunner, "number");
  assert.equal(r.perCase.length, r.cases);
  for (const c of r.perCase) {
    assert.equal(typeof c.name, "string");
    assert.equal(typeof c.passed, "boolean");
    assert.equal(typeof c.score, "number");
  }
});

test("the suite is currently green, so the record says so", () => {
  const r = buildBenchmarkRecord({ timingRuns: 2 });
  assert.equal(r.casesPassed, r.cases);
  assert.equal(r.riskyCaught, r.riskyTotal);
  assert.equal(r.falsePositives, 0);
  assert.equal(r.expectationsPassed, r.expectationsTotal);
});

test("commit defaults to null and date defaults to today", () => {
  const r = buildBenchmarkRecord({ timingRuns: 2 });
  assert.equal(r.commit, null);
  assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
});

test("a first record is always new", () => {
  const r = buildBenchmarkRecord({ timingRuns: 2 });
  assert.equal(isNewHistoryRecord(r, null), true);
});

test("a different commit and date on identical numbers is not new", () => {
  const a = buildBenchmarkRecord({ date: "2026-08-18", commit: "aaaaaaa", timingRuns: 2 });
  const b = buildBenchmarkRecord({ date: "2026-08-19", commit: "bbbbbbb", timingRuns: 2 });
  assert.equal(isNewHistoryRecord(b, a), false);
});

test("timing drift alone is not new", () => {
  const a = buildBenchmarkRecord({ timingRuns: 2 });
  const b = { ...a, avgAuditMsRunner: a.avgAuditMsRunner + 99 };
  assert.equal(isNewHistoryRecord(b, a), false);
});

test("a changed risky-caught count is new", () => {
  const a = buildBenchmarkRecord({ timingRuns: 2 });
  const b = { ...a, riskyCaught: a.riskyCaught - 1 };
  assert.equal(isNewHistoryRecord(b, a), true);
});

test("a changed evaluator version is new", () => {
  const a = buildBenchmarkRecord({ timingRuns: 2 });
  const b = { ...a, evaluatorVersion: "v9.9.9" };
  assert.equal(isNewHistoryRecord(b, a), true);
});

test("date, commit and runner timing are excluded from the significance check", () => {
  assert.equal(HISTORY_SIGNIFICANT_FIELDS.includes("date"), false);
  assert.equal(HISTORY_SIGNIFICANT_FIELDS.includes("commit"), false);
  assert.equal(HISTORY_SIGNIFICANT_FIELDS.includes("avgAuditMsRunner"), false);
  assert.ok(Object.isFrozen(HISTORY_SIGNIFICANT_FIELDS));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/benchmark-record.test.js`
Expected: FAIL with `Cannot find module .../lib/benchmark-record.js`

- [ ] **Step 3: Write the implementation**

Create `lib/benchmark-record.js`:

```js
/**
 * SpotterAI — benchmark record (pure)
 * ============================================================================
 * ONE definition of the evaluator benchmark numbers. The CLI (`eval.mjs`), the
 * committed history (`docs/benchmark-history.json`) and the public Safety Lab
 * all read from here, so the number a visitor sees and the number CI enforces
 * cannot drift apart.
 *
 * Dependency-free: only the pure evaluator and the pure suite.
 */

import { CASES, runEvalSuite, isRiskyCase } from "../eval-suite.js";
import { evaluatePlan, EVALUATOR_VERSION } from "../evaluator.js";

/**
 * Fields that decide whether a run is worth a new history row.
 *
 * `date` and `commit` change on every push and `avgAuditMsRunner` is measured
 * on whatever GitHub runner happened to pick the job up, so all three would
 * make every push look like a change and fill the file with identical rows.
 */
export const HISTORY_SIGNIFICANT_FIELDS = Object.freeze([
  "evaluatorVersion",
  "cases",
  "casesPassed",
  "riskyTotal",
  "riskyCaught",
  "falsePositives",
  "expectationsPassed",
  "expectationsTotal",
  "perCase",
]);

/**
 * @param {{date?: string, commit?: string|null, timingRuns?: number}} options
 * @returns {object} one history record
 */
export function buildBenchmarkRecord({ date, commit = null, timingRuns = 50 } = {}) {
  const results = runEvalSuite();
  const paired = CASES.map((cse, i) => ({ cse, result: results[i] }));
  const risky = paired.filter((x) => isRiskyCase(x.cse));
  const safe = paired.filter((x) => !isRiskyCase(x.cse));

  const expectationsTotal = results.reduce((n, r) => n + r.expectations.length, 0);
  const expectationsPassed = results.reduce((n, r) => n + r.expectations.filter((e) => e.ok).length, 0);

  // Warm average over many runs, same method the CLI has always used.
  const t0 = performance.now();
  for (let n = 0; n < timingRuns; n++) for (const cse of CASES) evaluatePlan(cse.plan, cse.inputs || {});
  const avgMs = (performance.now() - t0) / (timingRuns * CASES.length);

  return {
    date: date || new Date().toISOString().slice(0, 10),
    commit,
    evaluatorVersion: EVALUATOR_VERSION,
    cases: results.length,
    casesPassed: results.filter((r) => r.passed).length,
    riskyTotal: risky.length,
    riskyCaught: risky.filter((x) => x.result.passed).length,
    falsePositives: safe.filter((x) => x.result.unexpectedFlags.length > 0).length,
    expectationsPassed,
    expectationsTotal,
    avgAuditMsRunner: Number(avgMs.toFixed(3)),
    perCase: results.map((r) => ({ name: r.name, passed: r.passed, score: r.score })),
  };
}

/** True when `record` says something the previous row did not already say. */
export function isNewHistoryRecord(record, previous) {
  if (!previous) return true;
  return HISTORY_SIGNIFICANT_FIELDS.some(
    (key) => JSON.stringify(record[key]) !== JSON.stringify(previous[key])
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/benchmark-record.test.js`
Expected: PASS, 9 tests

- [ ] **Step 5: Rewrite `eval.mjs` to print from the record, and add `--json`**

Replace the whole of `eval.mjs` with:

```js
/**
 * SpotterAI — CLI evaluator benchmark (`npm run eval`)
 * ============================================================================
 * Runs the same red-team suite the Safety Lab and CI use, and prints the
 * benchmark to the terminal. Pure, zero-dependency — no browser needed.
 *
 * `--json` prints the same numbers as one machine-readable record, which is
 * what CI appends to docs/benchmark-history.json. Both modes read from
 * buildBenchmarkRecord, so the printed table and the stored history can never
 * disagree.
 */
import { buildBenchmarkRecord } from "./lib/benchmark-record.js";
import { caseType } from "./eval-suite.js";

const asJson = process.argv.includes("--json");
const record = buildBenchmarkRecord();
const ok = record.casesPassed === record.cases;

if (asJson) {
  console.log(JSON.stringify(record, null, 2));
  process.exit(ok ? 0 : 1);
}

const pad = (s, n) => String(s).padEnd(n);
const ms = record.avgAuditMsRunner;

console.log("\nSpotterAI — Evaluator Benchmark (bundled local suite)");
console.log("=".repeat(56));
console.log(pad("Test cases run", 32), record.cases);
console.log(pad("Expectations passed", 32), `${record.expectationsPassed}/${record.expectationsTotal}`);
console.log(pad("Expectations failed", 32), record.expectationsTotal - record.expectationsPassed);
console.log(pad("Risky plans caught", 32), `${record.riskyCaught}/${record.riskyTotal}`);
console.log(pad("Safe plans incorrectly flagged", 32), record.falsePositives);
console.log(pad("Average audit time", 32), `${ms < 1 ? ms.toFixed(3) : Math.round(ms)} ms`);
console.log(pad("Evaluator version", 32), record.evaluatorVersion);
console.log(pad("Regression status", 32), ok ? "Passing" : "Needs review");
console.log("=".repeat(56));

for (const c of record.perCase) {
  console.log(`${c.passed ? "✓" : "✗"} [${pad(caseType(c.name), 6)}] ${pad(c.name, 36)} score ${c.score}`);
}
console.log("");
process.exit(ok ? 0 : 1);
```

- [ ] **Step 6: Verify the human output did not change**

Run:

```bash
node eval.mjs
```

Expected: byte-identical to the pre-change output. At the time of writing that is `Test cases run 21`, `Expectations passed 30/30`, `Risky plans caught 17/17`, `Safe plans incorrectly flagged 0`, `Evaluator version v1.3.0`, `Regression status Passing`, then 21 case lines. Exit code 0.

If the table differs in anything but the timing figure, the refactor changed a number and must be fixed before continuing.

- [ ] **Step 7: Verify `--json` emits valid JSON**

Run:

```bash
node eval.mjs --json | node --input-type=module -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);if(r.cases!==r.perCase.length)process.exit(1);console.log('ok',r.evaluatorVersion,r.cases)})"
```

Expected: `ok v1.3.0 21`

- [ ] **Step 8: Run the whole suite**

Run: `node --test`
Expected: PASS. `test/eval-suite.test.js` and `test/benchmark.test.js` must still pass untouched.

- [ ] **Step 9: Commit**

```bash
git add lib/benchmark-record.js eval.mjs test/benchmark-record.test.js
git commit -m "refactor: one source for every benchmark number, plus eval --json"
```

---

### Task 2: Committed benchmark history

**Files:**
- Create: `scripts/append-benchmark-history.mjs`
- Create: `docs/benchmark-history.json`
- Create: `.github/workflows/benchmark-history.yml`
- Modify: `package.json`
- Test: `test/benchmark-history-append.test.js`

**Interfaces:**
- Consumes: `buildBenchmarkRecord`, `isNewHistoryRecord` from `lib/benchmark-record.js`.
- Produces: `docs/benchmark-history.json` as a JSON array of records, oldest first. The script writes `appended`, `version` and `commit` to `$GITHUB_OUTPUT` when that variable is set.

- [ ] **Step 1: Write the failing test**

Create `test/benchmark-history-append.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "scripts", "append-benchmark-history.mjs");

/** Run the script with an isolated GITHUB_OUTPUT and history file. */
function run(historyContent) {
  const dir = mkdtempSync(join(tmpdir(), "spotterai-history-"));
  const historyPath = join(dir, "history.json");
  const outputPath = join(dir, "output.txt");
  if (historyContent !== undefined) writeFileSync(historyPath, historyContent);
  const result = execFileSync("node", [script], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, BENCHMARK_HISTORY_PATH: historyPath, GITHUB_OUTPUT: outputPath, GITHUB_SHA: "" },
  });
  const history = existsSync(historyPath) ? JSON.parse(readFileSync(historyPath, "utf8")) : null;
  const output = existsSync(outputPath) ? readFileSync(outputPath, "utf8") : "";
  return { stdout: result, history, output };
}

test("a missing history file is created with exactly one record", () => {
  const { history, output } = run(undefined);
  assert.equal(Array.isArray(history), true);
  assert.equal(history.length, 1);
  assert.match(history[0].evaluatorVersion, /^v\d+\.\d+\.\d+$/);
  assert.match(output, /appended=true/);
});

test("running twice against the same evaluator appends only once", () => {
  const first = run(undefined);
  const dirHistory = JSON.stringify(first.history);
  const second = run(dirHistory);
  assert.equal(second.history.length, 1);
  assert.match(second.output, /appended=false/);
});

test("a changed previous record produces a second row", () => {
  const first = run(undefined);
  const stale = [{ ...first.history[0], riskyCaught: 0 }];
  const second = run(JSON.stringify(stale));
  assert.equal(second.history.length, 2);
  assert.match(second.output, /appended=true/);
});

test("a history file that is not an array fails loudly instead of being overwritten", () => {
  assert.throws(() => run('{"not":"an array"}'), /not a JSON array|Refusing/);
});

test("a history file that is not valid JSON fails loudly instead of being overwritten", () => {
  assert.throws(() => run("{{{"), /./);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/benchmark-history-append.test.js`
Expected: FAIL. The script does not exist, so `execFileSync` throws `Cannot find module`.

- [ ] **Step 3: Write the script**

Create `scripts/append-benchmark-history.mjs`:

```js
/**
 * SpotterAI — append one benchmark record to the committed history.
 * ============================================================================
 * Run by .github/workflows/benchmark-history.yml on push to main. Appends only
 * when the numbers actually changed, so the file stays a record of evaluator
 * behaviour rather than a log of every commit.
 *
 * BENCHMARK_HISTORY_PATH overrides the target file (used by the tests).
 */
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { buildBenchmarkRecord, isNewHistoryRecord } from "../lib/benchmark-record.js";

const FILE = process.env.BENCHMARK_HISTORY_PATH || "docs/benchmark-history.json";

function shortSha() {
  const fromCi = (process.env.GITHUB_SHA || "").trim();
  if (fromCi) return fromCi.slice(0, 7);
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

function emit(pairs) {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(pairs).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
}

let history = [];
if (existsSync(FILE)) {
  // A parse error here must NOT be swallowed: silently starting a new array
  // would delete the entire recorded history of the evaluator.
  history = JSON.parse(readFileSync(FILE, "utf8"));
  if (!Array.isArray(history)) {
    console.error(`${FILE} is not a JSON array. Refusing to overwrite it.`);
    process.exit(1);
  }
}

const record = buildBenchmarkRecord({ commit: shortSha() });
const previous = history.length ? history[history.length - 1] : null;

if (!isNewHistoryRecord(record, previous)) {
  console.log("Benchmark unchanged. Nothing appended.");
  emit({ appended: "false" });
  process.exit(0);
}

history.push(record);
writeFileSync(FILE, JSON.stringify(history, null, 2) + "\n");
console.log(`Appended ${record.evaluatorVersion} ${record.commit || "(no sha)"}, ${history.length} record(s) total.`);
emit({ appended: "true", version: record.evaluatorVersion, commit: record.commit || "" });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/benchmark-history-append.test.js`
Expected: PASS, 5 tests

- [ ] **Step 5: Seed the real history file**

Run:

```bash
node scripts/append-benchmark-history.mjs
```

Expected: `Appended v1.3.0 <sha>, 1 record(s) total.` and `docs/benchmark-history.json` now exists with one record.

Do not hand-write or back-fill earlier rows. The history begins today, and the Safety Lab says so.

- [ ] **Step 6: Add the npm script**

In `package.json`, inside `"scripts"`, after the `"eval:nutrition"` line, add:

```json
    "benchmark:history": "node scripts/append-benchmark-history.mjs",
```

- [ ] **Step 7: Add the workflow**

Create `.github/workflows/benchmark-history.yml`:

```yaml
name: Benchmark history

# Only main, and never in response to its own commit: the append below writes
# docs/benchmark-history.json, and without paths-ignore that push would
# retrigger this job forever. [skip ci] on the commit is the second guard.
on:
  push:
    branches: [main]
    paths-ignore:
      - "docs/benchmark-history.json"

permissions:
  contents: write

concurrency:
  group: benchmark-history
  cancel-in-progress: false

jobs:
  append:
    name: Append benchmark record
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"

      # Zero dependencies — nothing to install.
      - name: Build and append the record
        id: append
        run: node scripts/append-benchmark-history.mjs

      - name: Commit the new record
        if: steps.append.outputs.appended == 'true'
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add docs/benchmark-history.json
          git commit -m "chore: benchmark history ${{ steps.append.outputs.version }} ${{ steps.append.outputs.commit }} [skip ci]"
          git push
```

- [ ] **Step 8: Run the whole suite**

Run: `node --test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add scripts/append-benchmark-history.mjs docs/benchmark-history.json .github/workflows/benchmark-history.yml package.json test/benchmark-history-append.test.js
git commit -m "feat: commit evaluator benchmark history from CI"
```

---

### Task 3: Safety Lab renders the history

**Files:**
- Modify: `safety-lab.js`
- Test: `test/safety-lab-history.test.js`

**Interfaces:**
- Consumes: `docs/benchmark-history.json` over HTTP at `/docs/benchmark-history.json`.
- Produces: `historyRows(history)` exported from `safety-lab.js`, mapping a history array to render rows `{ version, date, riskyCaught, riskyTotal, falsePositives, regressed }`.

- [ ] **Step 1: Write the failing test**

Create `test/safety-lab-history.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "safety-lab.js"), "utf8");

// safety-lab.js touches `document` at module scope, so it can only be READ as
// text under Node, never imported. That is why the pure shaping lives in
// safety-lab-history.js, which imports cleanly.
import { historyRows } from "../safety-lab-history.js";

test("the committed history file is a non-empty array of well-formed records", () => {
  const history = JSON.parse(readFileSync(join(root, "docs", "benchmark-history.json"), "utf8"));
  assert.equal(Array.isArray(history), true);
  assert.ok(history.length >= 1);
  for (const r of history) {
    assert.match(r.evaluatorVersion, /^v\d+\.\d+\.\d+$/);
    assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(Number.isInteger(r.riskyCaught), true);
    assert.equal(Number.isInteger(r.riskyTotal), true);
  }
});

test("rows carry the version, the catch rate and the false positives", () => {
  const rows = historyRows([
    { date: "2026-08-18", evaluatorVersion: "v1.3.0", riskyCaught: 17, riskyTotal: 17, falsePositives: 0 },
  ]);
  assert.deepEqual(rows, [
    { version: "v1.3.0", date: "2026-08-18", riskyCaught: 17, riskyTotal: 17, falsePositives: 0, regressed: false },
  ]);
});

test("a drop in risky-caught marks the row as a regression", () => {
  const rows = historyRows([
    { date: "2026-08-18", evaluatorVersion: "v1.3.0", riskyCaught: 17, riskyTotal: 17, falsePositives: 0 },
    { date: "2026-09-01", evaluatorVersion: "v1.4.0", riskyCaught: 16, riskyTotal: 17, falsePositives: 0 },
  ]);
  assert.equal(rows[0].regressed, false);
  assert.equal(rows[1].regressed, true);
});

test("a rise in risky-caught is not a regression", () => {
  const rows = historyRows([
    { date: "2026-08-18", evaluatorVersion: "v1.3.0", riskyCaught: 16, riskyTotal: 17, falsePositives: 0 },
    { date: "2026-09-01", evaluatorVersion: "v1.4.0", riskyCaught: 17, riskyTotal: 17, falsePositives: 0 },
  ]);
  assert.equal(rows[1].regressed, false);
});

test("an empty or malformed history yields no rows rather than throwing", () => {
  assert.deepEqual(historyRows([]), []);
  assert.deepEqual(historyRows(null), []);
  assert.deepEqual(historyRows("nope"), []);
});

test("the Safety Lab labels the bundled benchmark reproducible", () => {
  assert.match(source, /reproducible/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/safety-lab-history.test.js`
Expected: FAIL with `Cannot find module .../safety-lab-history.js`

- [ ] **Step 3: Write the pure history module**

`safety-lab.js` reads `document` at module scope, so the pure part lives in its own file and stays testable under Node.

Create `safety-lab-history.js`:

```js
/**
 * SpotterAI — benchmark history shaping (pure)
 * ============================================================================
 * Turns docs/benchmark-history.json into render rows. Kept out of
 * safety-lab.js so it can be tested under Node, which has no `document`.
 */

/**
 * @param {Array<object>} history oldest first
 * @returns {Array<{version:string,date:string,riskyCaught:number,riskyTotal:number,falsePositives:number,regressed:boolean}>}
 */
export function historyRows(history) {
  if (!Array.isArray(history)) return [];
  return history.map((r, i) => {
    const previous = i > 0 ? history[i - 1] : null;
    return {
      version: r.evaluatorVersion,
      date: r.date,
      riskyCaught: r.riskyCaught,
      riskyTotal: r.riskyTotal,
      falsePositives: r.falsePositives,
      regressed: !!previous && r.riskyCaught < previous.riskyCaught,
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/safety-lab-history.test.js`
Expected: the five `historyRows` tests PASS. The last test, "labels the bundled benchmark reproducible", still FAILS: `safety-lab.js` does not carry that word until Step 5. That is the point of writing it now.

- [ ] **Step 5: Render the history in `safety-lab.js`**

Add the import at the top of `safety-lab.js`, directly under the existing `rule-explanations.js` import (currently line 16):

```js
import { historyRows } from "./safety-lab-history.js";
```

Inside `render()`, in the `bench` template literal, change the benchmark heading tag so the bundled number carries the word the spec requires. Replace:

```js
<h3 class="lab-block__title">Evaluator benchmark <span class="bench__tag">Bundled local benchmark</span></h3>
```

with:

```js
<h3 class="lab-block__title">Evaluator benchmark <span class="bench__tag">Bundled local benchmark, reproducible</span></h3>
```

Then, in `render()`, change the final assignment (currently line 245) from:

```js
  mount.innerHTML = bench + cols + rules + examples + privacy + principles + tech;
```

to:

```js
  // History is fetched, so it lands after first paint. The anchor keeps its
  // slot in document order without blocking anything.
  const history = `<div class="lab-block" id="bench-history" hidden></div>`;
  mount.innerHTML = bench + history + cols + rules + examples + privacy + principles + tech;
```

Add this function immediately above `renderTeaser()`:

```js
/**
 * Fill the history block from the committed record. Fetched, not bundled, so
 * it must never block or break the live benchmark above it: any failure leaves
 * the block hidden and the page reads exactly as it did before this shipped.
 */
async function hydrateHistory() {
  const el = document.getElementById("bench-history");
  if (!el) return;
  let rows = [];
  try {
    const res = await fetch("/docs/benchmark-history.json", { cache: "no-cache" });
    if (!res.ok) return;
    rows = historyRows(await res.json());
  } catch {
    return;
  }
  if (rows.length === 0) return;

  const body = rows
    .map(
      (r) => `<tr class="${r.regressed ? "is-regression" : ""}">
        <td>${esc(r.version)}</td>
        <td>${esc(r.date)}</td>
        <td>${r.riskyCaught}/${r.riskyTotal}${r.regressed ? " <span class=\"is-warn\">regression</span>" : ""}</td>
        <td>${r.falsePositives}</td>
      </tr>`
    )
    .join("");

  el.innerHTML = `
    <div class="lab-block__head">
      <div>
        <h3 class="lab-block__title">Benchmark history</h3>
        <p class="lab-block__sub">One row per evaluator version, written by CI on every change since ${esc(rows[0].date)}. Nothing before that date is shown, because nothing before that date was recorded.</p>
      </div>
    </div>
    <table class="bench-history">
      <thead><tr><th>Version</th><th>First seen</th><th>Risky plans caught</th><th>False positives</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
  el.hidden = false;
}
```

Finally, call it from the idle block at the bottom of the file. Change:

```js
    if (mount) render();
    renderTeaser();
```

to:

```js
    if (mount) render();
    renderTeaser();
    hydrateHistory();
```

`hydrateHistory` is async and deliberately not awaited. It already swallows its own failures, and the `catch` around `render()` must keep protecting the synchronous benchmark only.

- [ ] **Step 6: Run the history tests again, now fully green**

Run: `node --test test/safety-lab-history.test.js`
Expected: PASS, 6 tests

- [ ] **Step 7: Verify in the browser**

Run the dev server and open the Safety Lab. Confirm three things: the live benchmark renders as before, the history table appears below it with one row, and the bundled benchmark tag reads "reproducible".

Then confirm the fail-safe: rename `docs/benchmark-history.json` temporarily, reload, and check the page renders normally with no history block and no console error beyond the failed fetch.

- [ ] **Step 8: Add the new module to the offline precache**

`service-worker.js` carries an explicit asset list, currently including `"safety-lab.js"` around line 77. A browser module missing from that list is not available offline and is not fetched by an installed PWA.

Add `"safety-lab-history.js",` to that list, directly after the `"safety-lab.js",` entry. Do NOT bump `CACHE` yet; Task 7 bumps it once for all of this branch's modules.

- [ ] **Step 9: Run the whole suite**

Run: `node --test`
Expected: PASS. `test/pwa.test.js` and `test/service-worker-behavior.test.js` must both stay green.

- [ ] **Step 10: Commit**

```bash
git add safety-lab.js safety-lab-history.js service-worker.js test/safety-lab-history.test.js
git commit -m "feat: show benchmark history on the Safety Lab"
```

---

### Task 4: Telemetry allow-list

The allow-list is the privacy design. It is written and tested before anything can send or store a byte.

**Files:**
- Create: `lib/telemetry-schema.js`
- Test: `test/telemetry-schema.test.js`

**Interfaces:**
- Consumes: `INJURY_RULES` from `evaluator.js` (read-only import).
- Produces: `sanitizeTelemetry(input)` returning a clean object or `null`; `scoreBucket(score)` returning a bucket string or `null`; frozen constants `CHECK_IDS`, `CHECK_STATUSES`, `SOURCES`, `SCORE_BUCKETS`, `GOALS`, `EXPERIENCES`, `TELEMETRY_VERSION`.

- [ ] **Step 1: Write the failing test**

Create `test/telemetry-schema.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { INJURY_RULES } from "../evaluator.js";
import {
  sanitizeTelemetry, scoreBucket, CHECK_IDS, CHECK_STATUSES,
  SOURCES, SCORE_BUCKETS, GOALS, EXPERIENCES, TELEMETRY_VERSION,
} from "../lib/telemetry-schema.js";

const valid = () => ({
  v: TELEMETRY_VERSION,
  evaluatorVersion: "v1.3.0",
  source: "generate",
  scoreBucket: "85-100",
  daysCount: 4,
  exerciseCount: 22,
  goal: "Hypertrophy",
  experience: "Intermediate",
  checks: [{ id: "rest_days", status: "pass" }, { id: "muscle_balance", status: "warn" }],
});

test("a fully valid payload survives unchanged", () => {
  assert.deepEqual(sanitizeTelemetry(valid()), valid());
});

test("score bucketing is correct at every boundary", () => {
  assert.equal(scoreBucket(0), "0-59");
  assert.equal(scoreBucket(59), "0-59");
  assert.equal(scoreBucket(60), "60-74");
  assert.equal(scoreBucket(74), "60-74");
  assert.equal(scoreBucket(75), "75-84");
  assert.equal(scoreBucket(84), "75-84");
  assert.equal(scoreBucket(85), "85-100");
  assert.equal(scoreBucket(100), "85-100");
  assert.equal(scoreBucket("nope"), null);
  assert.equal(scoreBucket(undefined), null);
});

test("an unknown check id is rejected outright", () => {
  const p = valid();
  p.checks = [{ id: "secret_check", status: "pass" }];
  assert.equal(sanitizeTelemetry(p), null);
});

test("an unknown check status is rejected outright", () => {
  const p = valid();
  p.checks = [{ id: "rest_days", status: "catastrophe" }];
  assert.equal(sanitizeTelemetry(p), null);
});

test("every injury id derived from INJURY_RULES is accepted", () => {
  const keys = Object.keys(INJURY_RULES);
  assert.ok(keys.length > 0, "INJURY_RULES must not be empty");
  for (const key of keys) {
    const p = valid();
    p.checks = [{ id: `injury_${key}`, status: "fail" }];
    assert.notEqual(sanitizeTelemetry(p), null, `injury_${key} should be allowed`);
  }
  assert.equal(CHECK_IDS.includes(`injury_${keys[0]}`), true);
});

test("free text and extra fields never reach the output", () => {
  const p = { ...valid(), programName: "My Program", notes: "private", exerciseName: "Back Squat" };
  const clean = sanitizeTelemetry(p);
  const serialized = JSON.stringify(clean);
  assert.doesNotMatch(serialized, /My Program|private|Back Squat|programName|notes|exerciseName/);
  assert.deepEqual(Object.keys(clean).sort(), Object.keys(valid()).sort());
});

test("a check entry carrying extra keys is stripped down to id and status", () => {
  const p = valid();
  p.checks = [{ id: "rest_days", status: "pass", detail: "Seven straight training days" }];
  const clean = sanitizeTelemetry(p);
  assert.deepEqual(clean.checks, [{ id: "rest_days", status: "pass" }]);
  assert.doesNotMatch(JSON.stringify(clean), /Seven straight/);
});

test("out-of-range counts are rejected", () => {
  assert.equal(sanitizeTelemetry({ ...valid(), daysCount: 0 }), null);
  assert.equal(sanitizeTelemetry({ ...valid(), daysCount: 8 }), null);
  assert.equal(sanitizeTelemetry({ ...valid(), exerciseCount: -1 }), null);
  assert.equal(sanitizeTelemetry({ ...valid(), exerciseCount: 141 }), null);
  assert.equal(sanitizeTelemetry({ ...valid(), daysCount: 4.5 }), null);
});

test("bad enums and versions are rejected", () => {
  assert.equal(sanitizeTelemetry({ ...valid(), source: "elsewhere" }), null);
  assert.equal(sanitizeTelemetry({ ...valid(), goal: "Aesthetics" }), null);
  assert.equal(sanitizeTelemetry({ ...valid(), experience: "Elite" }), null);
  assert.equal(sanitizeTelemetry({ ...valid(), scoreBucket: "90-100" }), null);
  assert.equal(sanitizeTelemetry({ ...valid(), evaluatorVersion: "1.3.0" }), null);
  assert.equal(sanitizeTelemetry({ ...valid(), v: 99 }), null);
});

test("junk input is rejected rather than throwing", () => {
  assert.equal(sanitizeTelemetry(null), null);
  assert.equal(sanitizeTelemetry("string"), null);
  assert.equal(sanitizeTelemetry([]), null);
  assert.equal(sanitizeTelemetry({}), null);
  assert.equal(sanitizeTelemetry({ ...valid(), checks: "nope" }), null);
  assert.equal(sanitizeTelemetry({ ...valid(), checks: [] }), null);
});

test("the constants are frozen so nothing can widen them at runtime", () => {
  for (const frozen of [CHECK_IDS, CHECK_STATUSES, SOURCES, SCORE_BUCKETS, GOALS, EXPERIENCES]) {
    assert.ok(Object.isFrozen(frozen));
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/telemetry-schema.test.js`
Expected: FAIL with `Cannot find module .../lib/telemetry-schema.js`

- [ ] **Step 3: Write the schema**

Create `lib/telemetry-schema.js`:

```js
/**
 * SpotterAI — audit telemetry allow-list (pure)
 * ============================================================================
 * The allow-list IS the privacy design. Output is built by copying known keys
 * onto a fresh object, never by deleting unknown ones from the input, so a
 * field nobody anticipated cannot reach storage even if the client sends it.
 *
 * Rejected outright (returns null): a bad enum, a bad count, an unknown check
 * id or status. Silently dropped: any key not on this list.
 *
 * Shared by the browser and api/audit-telemetry.js so the sender and the
 * receiver cannot disagree about what is collectable.
 */

import { INJURY_RULES } from "../evaluator.js";

export const TELEMETRY_VERSION = 1;

export const SOURCES = Object.freeze(["generate", "import", "adapt"]);
export const SCORE_BUCKETS = Object.freeze(["0-59", "60-74", "75-84", "85-100"]);

// Mirrors GOAL_OPTIONS / TRAINING_AGE_OPTIONS in onboarding.js. Pinned by test.
export const GOALS = Object.freeze(["Hypertrophy", "Strength", "Fat loss", "General"]);
export const EXPERIENCES = Object.freeze(["Beginner", "Intermediate", "Advanced"]);

export const CHECK_STATUSES = Object.freeze(["pass", "warn", "fail", "not_assessed"]);

/** The eleven fixed ids in evaluator.js, plus its structural failure id. */
export const BASE_CHECK_IDS = Object.freeze([
  "rest_days", "weekly_volume", "muscle_balance", "beginner_load", "goal_fit",
  "progressive_overload", "leg_balance", "muscle_frequency", "equipment_fit",
  "session_load", "coverage", "invalid_plan",
]);

/**
 * Injury check ids are generated at evaluator.js:495 as `injury_${key}`, so
 * they are DERIVED here rather than listed. A hardcoded list would silently go
 * stale the day a new injury rule is added, and the new check's data would be
 * dropped without anyone noticing.
 */
export const CHECK_IDS = Object.freeze([
  ...BASE_CHECK_IDS,
  ...Object.keys(INJURY_RULES).map((key) => `injury_${key}`),
]);

const MAX_DAYS = 7;
const MAX_EXERCISES = 140; // 7 days x the 20/day ceiling enforced in api/import.js
const MAX_CHECKS = 40;

/** Bucket a raw score client-side. The raw number is never transmitted. */
export function scoreBucket(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return null;
  if (n < 60) return "0-59";
  if (n < 75) return "60-74";
  if (n < 85) return "75-84";
  return "85-100";
}

const isCount = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

/**
 * @param {unknown} input
 * @returns {object|null} a freshly built, allow-listed object, or null
 */
export function sanitizeTelemetry(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;

  if (input.v !== TELEMETRY_VERSION) return null;
  if (typeof input.evaluatorVersion !== "string" || !/^v\d+\.\d+\.\d+$/.test(input.evaluatorVersion)) return null;
  if (!SOURCES.includes(input.source)) return null;
  if (!SCORE_BUCKETS.includes(input.scoreBucket)) return null;
  if (!GOALS.includes(input.goal)) return null;
  if (!EXPERIENCES.includes(input.experience)) return null;
  if (!isCount(input.daysCount, 1, MAX_DAYS)) return null;
  if (!isCount(input.exerciseCount, 0, MAX_EXERCISES)) return null;

  if (!Array.isArray(input.checks) || input.checks.length === 0 || input.checks.length > MAX_CHECKS) return null;
  const checks = [];
  for (const entry of input.checks) {
    if (!entry || typeof entry !== "object") return null;
    if (!CHECK_IDS.includes(entry.id)) return null;
    if (!CHECK_STATUSES.includes(entry.status)) return null;
    checks.push({ id: entry.id, status: entry.status });
  }

  return {
    v: TELEMETRY_VERSION,
    evaluatorVersion: input.evaluatorVersion,
    source: input.source,
    scoreBucket: input.scoreBucket,
    daysCount: input.daysCount,
    exerciseCount: input.exerciseCount,
    goal: input.goal,
    experience: input.experience,
    checks,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/telemetry-schema.test.js`
Expected: PASS, 11 tests

- [ ] **Step 5: Pin the enums against onboarding**

Append to `test/telemetry-schema.test.js`. ESM hoists imports, so an `import` at the bottom of the file is valid and runs first:

```js
import { GOAL_OPTIONS, TRAINING_AGE_OPTIONS } from "../onboarding.js";

test("the goal and experience enums match what onboarding can actually produce", () => {
  for (const option of GOAL_OPTIONS) {
    assert.ok(GOALS.includes(option.goal), `onboarding can produce goal "${option.goal}" but telemetry would reject it`);
  }
  for (const option of TRAINING_AGE_OPTIONS) {
    assert.ok(EXPERIENCES.includes(option.experience), `onboarding can produce experience "${option.experience}" but telemetry would reject it`);
  }
});
```

Run: `node --test test/telemetry-schema.test.js`
Expected: PASS, 12 tests

- [ ] **Step 6: Commit**

```bash
git add lib/telemetry-schema.js test/telemetry-schema.test.js
git commit -m "feat: allow-list for audit telemetry, derived injury ids included"
```

---

### Task 5: The telemetry endpoint

**Files:**
- Create: `api/audit-telemetry.js`
- Modify: `package.json`, `.env.example`, `docs/SETUP.md`, `vercel.json`
- Test: `test/audit-telemetry-endpoint.test.js`

**Interfaces:**
- Consumes: `sanitizeTelemetry` from `lib/telemetry-schema.js`.
- Produces: default export `handler(req, res)`; named exports `DAILY_AUDIT_CAP`, `IP_HOURLY_CAP`, `dayKey(date)`, `counterUpdates(clean, FieldValue)` for testing without Firestore.

- [ ] **Step 1: Write the failing test**

Create `test/audit-telemetry-endpoint.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import handler, { DAILY_AUDIT_CAP, IP_HOURLY_CAP, dayKey, counterUpdates } from "../api/audit-telemetry.js";

/** Minimal res double matching what the handler uses. */
function makeRes() {
  const res = { statusCode: null, body: null, ended: false };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; res.ended = true; return res; };
  res.end = () => { res.ended = true; return res; };
  return res;
}

const validBody = {
  v: 1,
  evaluatorVersion: "v1.3.0",
  source: "generate",
  scoreBucket: "85-100",
  daysCount: 4,
  exerciseCount: 22,
  goal: "Hypertrophy",
  experience: "Intermediate",
  checks: [{ id: "rest_days", status: "pass" }, { id: "muscle_balance", status: "warn" }],
};

test("a day key is the UTC date", () => {
  assert.equal(dayKey(new Date("2026-08-18T23:59:59Z")), "2026-08-18");
  assert.equal(dayKey(new Date("2026-08-19T00:00:01Z")), "2026-08-19");
});

test("the caps are set to the values the spec commits to", () => {
  assert.equal(DAILY_AUDIT_CAP, 5000);
  assert.equal(IP_HOURLY_CAP, 60);
});

test("counter updates increment exactly the documented paths", () => {
  const increment = (n) => ({ __increment: n });
  const updates = counterUpdates(validBody, { increment });
  assert.deepEqual(updates["audits"], { __increment: 1 });
  assert.deepEqual(updates["byCheck.rest_days.pass"], { __increment: 1 });
  assert.deepEqual(updates["byCheck.muscle_balance.warn"], { __increment: 1 });
  assert.deepEqual(updates["byScoreBucket.85-100"], { __increment: 1 });
  assert.deepEqual(updates["byGoal.Hypertrophy"], { __increment: 1 });
  assert.deepEqual(updates["byExperience.Intermediate"], { __increment: 1 });
  assert.deepEqual(updates["byDaysCount.4"], { __increment: 1 });
});

test("counter updates never contain free text or a raw score", () => {
  const updates = counterUpdates(validBody, { increment: (n) => n });
  const keys = JSON.stringify(Object.keys(updates));
  assert.doesNotMatch(keys, /score"?:\s*\d|exerciseName|notes|programName/);
  assert.equal(Object.keys(updates).some((k) => k.startsWith("byScore.")), false);
});

test("GET serves the aggregate, and serves an empty one when unconfigured", async () => {
  const saved = process.env.FIREBASE_SERVICE_ACCOUNT;
  delete process.env.FIREBASE_SERVICE_ACCOUNT;
  const res = makeRes();
  await handler({ method: "GET", body: null, headers: {}, query: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { audits: 0, byCheck: {}, since: null });
  if (saved !== undefined) process.env.FIREBASE_SERVICE_ACCOUNT = saved;
});

test("a method that is neither GET nor POST is refused", async () => {
  const res = makeRes();
  await handler({ method: "PUT", body: null, headers: {}, setHeader: () => {}, query: {} }, res);
  assert.equal(res.statusCode, 405);
});

test("with no service account configured the handler accepts and writes nothing", async () => {
  const saved = process.env.FIREBASE_SERVICE_ACCOUNT;
  delete process.env.FIREBASE_SERVICE_ACCOUNT;
  const res = makeRes();
  await handler({ method: "POST", body: validBody, headers: {}, query: {} }, res);
  assert.equal(res.statusCode, 204);
  if (saved !== undefined) process.env.FIREBASE_SERVICE_ACCOUNT = saved;
});

test("an invalid payload is accepted and dropped, never surfaced as an error", async () => {
  const saved = process.env.FIREBASE_SERVICE_ACCOUNT;
  delete process.env.FIREBASE_SERVICE_ACCOUNT;
  const res = makeRes();
  await handler({ method: "POST", body: { v: 1, checks: [{ id: "secret", status: "pass" }] }, headers: {}, query: {} }, res);
  assert.equal(res.statusCode, 204);
  if (saved !== undefined) process.env.FIREBASE_SERVICE_ACCOUNT = saved;
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/audit-telemetry-endpoint.test.js`
Expected: FAIL with `Cannot find module .../api/audit-telemetry.js`

- [ ] **Step 3: Install the one new dependency**

Run:

```bash
npm install firebase-admin@^14.0.0
```

Confirm `package.json` now lists exactly two runtime dependencies, `@vercel/analytics` and `firebase-admin`.

- [ ] **Step 4: Write the endpoint**

Create `api/audit-telemetry.js`:

```js
/**
 * SpotterAI — /api/audit-telemetry
 * ============================================================================
 * Counts which evaluator checks fire on real plans. Every public number on the
 * Safety Lab today describes 21 bundled fixtures; this is the only source that
 * can say whether a check ever fires outside them.
 *
 * Three properties this endpoint holds to, in priority order:
 *
 *   1. It cannot hurt a user. Fire-and-forget from the client, and every
 *      failure path here returns 204. A telemetry outage is invisible.
 *   2. It cannot store anything personal. AGGREGATE COUNTERS ONLY — no raw row
 *      is ever written, so there is nothing to correlate even in principle.
 *      The payload is allow-listed by lib/telemetry-schema.js before it gets
 *      near a write.
 *   3. It cannot exhaust the free tier. Firestore Spark allows 20k writes/day
 *      and USER SYNC RUNS ON THE SAME QUOTA, so the cap below matters: losing
 *      the tail of an anomalous day is strictly better than breaking sync.
 *
 * It is public and unauthenticated, because the product has no account
 * requirement and telemetry must not introduce one. The counters can therefore
 * be skewed by someone determined. That is answered in the Safety Lab's copy,
 * which labels this number "unverified" against the reproducible bundled
 * benchmark, not by pretending the endpoint is trustworthy.
 */

import { createHash } from "node:crypto";
import { sanitizeTelemetry } from "../lib/telemetry-schema.js";

export const DAILY_AUDIT_CAP = 5000;
export const IP_HOURLY_CAP = 60;
const HISTORY_DAYS = 30;

/** UTC date key. Deliberately UTC so the bucket does not depend on the caller. */
export function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function hourKey(date = new Date()) {
  return date.toISOString().slice(0, 13);
}

/**
 * Build the increment map for one audit. Pure, so the shape of what gets
 * stored is testable without Firestore.
 */
export function counterUpdates(clean, FieldValue) {
  const updates = {
    audits: FieldValue.increment(1),
    [`byScoreBucket.${clean.scoreBucket}`]: FieldValue.increment(1),
    [`byGoal.${clean.goal}`]: FieldValue.increment(1),
    [`byExperience.${clean.experience}`]: FieldValue.increment(1),
    [`byDaysCount.${clean.daysCount}`]: FieldValue.increment(1),
  };
  for (const check of clean.checks) {
    updates[`byCheck.${check.id}.${check.status}`] = FieldValue.increment(1);
  }
  return updates;
}

let cached = null;

/** Lazy Firestore handle. Returns null when the project is not configured. */
async function firestore() {
  if (cached) return cached;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const { cert, getApps, initializeApp } = await import("firebase-admin/app");
    const { getFirestore, FieldValue } = await import("firebase-admin/firestore");
    if (!getApps().length) initializeApp({ credential: cert(JSON.parse(raw)) });
    cached = { store: getFirestore(), FieldValue };
    return cached;
  } catch {
    // A malformed service account must not take the endpoint down noisily.
    return null;
  }
}

/**
 * Hash the caller's IP with the service account as salt. The raw IP is never
 * written, and the hash is scoped to the hour so it is not a stable
 * pseudonym across a day.
 */
function ipKey(req) {
  const forwarded = req.headers?.["x-forwarded-for"];
  const ip = String(Array.isArray(forwarded) ? forwarded[0] : forwarded || "unknown").split(",")[0].trim();
  const salt = (process.env.FIREBASE_SERVICE_ACCOUNT || "").slice(0, 64);
  return createHash("sha256").update(`${salt}:${ip}:${hourKey()}`).digest("hex").slice(0, 32);
}

async function readAggregate(store) {
  const days = [];
  const now = new Date();
  for (let i = 0; i < HISTORY_DAYS; i++) {
    const d = new Date(now.getTime() - i * 86400000);
    days.push(dayKey(d));
  }
  const docs = await store.getAll(...days.map((key) => store.collection("audit_telemetry").doc(key)));

  const totals = { audits: 0, byCheck: {}, since: null };
  for (const doc of docs) {
    if (!doc.exists) continue;
    const data = doc.data();
    totals.audits += data.audits || 0;
    totals.since = totals.since && totals.since < doc.id ? totals.since : doc.id;
    for (const [id, statuses] of Object.entries(data.byCheck || {})) {
      totals.byCheck[id] = totals.byCheck[id] || { pass: 0, warn: 0, fail: 0, not_assessed: 0 };
      for (const [status, count] of Object.entries(statuses)) {
        totals.byCheck[id][status] = (totals.byCheck[id][status] || 0) + count;
      }
    }
  }
  return totals;
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    const fs = await firestore();
    if (!fs) return res.status(200).json({ audits: 0, byCheck: {}, since: null });
    try {
      return res.status(200).json(await readAggregate(fs.store));
    } catch {
      return res.status(200).json({ audits: 0, byCheck: {}, since: null });
    }
  }

  if (req.method !== "POST") {
    res.setHeader?.("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  // Every remaining path returns 204. The client is fire-and-forget and must
  // never learn whether its telemetry landed.
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { return res.status(204).end(); }
  }

  const clean = sanitizeTelemetry(body);
  if (!clean) return res.status(204).end();

  const fs = await firestore();
  if (!fs) return res.status(204).end();

  try {
    const { store, FieldValue } = fs;
    const dayRef = store.collection("audit_telemetry").doc(dayKey());
    const ipRef = store.collection("audit_telemetry_throttle").doc(ipKey(req));

    const [daySnap, ipSnap] = await Promise.all([dayRef.get(), ipRef.get()]);
    if ((daySnap.data()?.audits || 0) >= DAILY_AUDIT_CAP) return res.status(204).end();
    if ((ipSnap.data()?.hits || 0) >= IP_HOURLY_CAP) return res.status(204).end();

    await Promise.all([
      dayRef.set(counterUpdates(clean, FieldValue), { merge: true }),
      ipRef.set({ hits: FieldValue.increment(1), expiresAt: new Date(Date.now() + 3600000) }, { merge: true }),
    ]);
  } catch {
    // Quota exhaustion, a network fault, a permissions problem: all the same
    // from here. Drop it.
  }
  return res.status(204).end();
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/audit-telemetry-endpoint.test.js`
Expected: PASS, 8 tests

- [ ] **Step 6: Document the environment variable**

Append to `.env.example`:

```
# OPTIONAL — Safety Lab production telemetry. A Firebase service account JSON,
# pasted as one line. Only api/audit-telemetry.js reads it, and it is never
# exposed to the browser.
#
# Leave it unset and the endpoint accepts requests and writes nothing, so local
# development and CI need no setup at all. Without it the Safety Lab simply
# omits its production block rather than showing a misleading zero.
#
# Firebase console -> Project settings -> Service accounts -> Generate new key.
# FIREBASE_SERVICE_ACCOUNT={"type":"service_account","project_id":"..."}
```

Add the same variable to `docs/SETUP.md` wherever `GEMINI_API_KEY` is documented, with the note that it is optional and only affects the Safety Lab's production block.

- [ ] **Step 7: Register the function timeout**

In `vercel.json`, inside `"functions"`, add:

```json
    "api/audit-telemetry.js": {
      "maxDuration": 10
    },
```

- [ ] **Step 8: Extend the Content-Security-Policy check**

The endpoint is same-origin, so `connect-src 'self'` already covers it. Confirm no CSP change is needed by checking that `vercel.json` still contains `connect-src 'self'`. Make no edit if it does.

- [ ] **Step 9: Run the whole suite**

Run: `node --test`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add api/audit-telemetry.js test/audit-telemetry-endpoint.test.js package.json package-lock.json .env.example docs/SETUP.md vercel.json
git commit -m "feat: audit telemetry endpoint, aggregate counters only"
```

---

### Task 6: Send telemetry from the three audit paths

**Files:**
- Create: `audit-telemetry-client.js`
- Modify: `app.js`, `import-ui.js`, `adapt-engine.js`
- Test: `test/audit-telemetry-client.test.js`

**Interfaces:**
- Consumes: `sanitizeTelemetry`, `scoreBucket`, `TELEMETRY_VERSION` from `lib/telemetry-schema.js`; `EVALUATOR_VERSION` from `evaluator.js`.
- Produces: `buildTelemetryPayload(audit, plan, inputs, source)` returning a payload or `null`; `sendAuditTelemetry(audit, plan, inputs, source)` returning boolean sent.

- [ ] **Step 1: Write the failing test**

Create `test/audit-telemetry-client.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { buildTelemetryPayload, sendAuditTelemetry } from "../audit-telemetry-client.js";
import { sanitizeTelemetry } from "../lib/telemetry-schema.js";
import { evaluatePlan } from "../evaluator.js";

const plan = {
  program_name: "My Secret Program",
  goal: "Hypertrophy",
  days_per_week: 2,
  progression: "Add 2.5kg when you hit the top of the range.",
  general_notes: "private note",
  days: [
    { day: "Day", focus: "Upper", exercises: [
      { name: "Barbell Bench Press", sets: 4, reps: "6-8", rpe: 8, notes: "keep elbows tucked" },
      { name: "Barbell Row", sets: 4, reps: "6-8", rpe: 8, notes: "" },
    ] },
    { day: "Rest", focus: "Rest", exercises: [] },
  ],
};
const inputs = { goal: "Hypertrophy", experience: "Intermediate" };

test("a real audit produces a payload the server-side sanitizer accepts", () => {
  const audit = evaluatePlan(plan, inputs);
  const payload = buildTelemetryPayload(audit, plan, inputs, "generate");
  assert.notEqual(payload, null);
  assert.deepEqual(sanitizeTelemetry(payload), payload);
});

test("the payload carries no plan content of any kind", () => {
  const audit = evaluatePlan(plan, inputs);
  const serialized = JSON.stringify(buildTelemetryPayload(audit, plan, inputs, "generate"));
  assert.doesNotMatch(serialized, /My Secret Program|Barbell Bench Press|Barbell Row|private note|elbows|2\.5kg/);
});

test("the raw score never leaves the browser, only its bucket", () => {
  const audit = evaluatePlan(plan, inputs);
  const payload = buildTelemetryPayload(audit, plan, inputs, "generate");
  assert.equal("score" in payload, false);
  assert.ok(["0-59", "60-74", "75-84", "85-100"].includes(payload.scoreBucket));
});

test("counts describe shape only", () => {
  const audit = evaluatePlan(plan, inputs);
  const payload = buildTelemetryPayload(audit, plan, inputs, "generate");
  assert.equal(payload.daysCount, 2);
  assert.equal(payload.exerciseCount, 2);
});

test("missing profile inputs fall back to the General/Beginner defaults rather than dropping the audit", () => {
  const audit = evaluatePlan(plan, {});
  const payload = buildTelemetryPayload(audit, plan, {}, "import");
  assert.notEqual(payload, null);
  assert.equal(payload.goal, "General");
  assert.equal(payload.experience, "Beginner");
  assert.equal(payload.source, "import");
});

test("an unknown source is refused", () => {
  const audit = evaluatePlan(plan, inputs);
  assert.equal(buildTelemetryPayload(audit, plan, inputs, "somewhere"), null);
});

test("a malformed audit yields null instead of throwing", () => {
  assert.equal(buildTelemetryPayload(null, plan, inputs, "generate"), null);
  assert.equal(buildTelemetryPayload({ checks: [] }, plan, inputs, "generate"), null);
});

test("sending uses sendBeacon and never throws when the transport fails", () => {
  const audit = evaluatePlan(plan, inputs);
  const calls = [];
  globalThis.navigator = { sendBeacon: (url, blob) => { calls.push(url); return true; } };
  assert.equal(sendAuditTelemetry(audit, plan, inputs, "generate"), true);
  assert.deepEqual(calls, ["/api/audit-telemetry"]);

  globalThis.navigator = { sendBeacon: () => { throw new Error("blocked"); } };
  assert.equal(sendAuditTelemetry(audit, plan, inputs, "generate"), false);

  delete globalThis.navigator;
  assert.equal(sendAuditTelemetry(audit, plan, inputs, "generate"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/audit-telemetry-client.test.js`
Expected: FAIL with `Cannot find module .../audit-telemetry-client.js`

- [ ] **Step 3: Write the client**

Create `audit-telemetry-client.js`:

```js
/**
 * SpotterAI — audit telemetry sender
 * ============================================================================
 * Turns a completed audit into the allow-listed payload and fires it at
 * /api/audit-telemetry. Fire-and-forget: every failure path returns false and
 * nothing is ever surfaced to the user mid-audit.
 *
 * The payload is validated against the SAME sanitizer the server runs, so a
 * payload that would be silently dropped server-side is caught here instead of
 * being sent into a void.
 */

import { EVALUATOR_VERSION } from "./evaluator.js";
import { sanitizeTelemetry, scoreBucket, TELEMETRY_VERSION } from "./lib/telemetry-schema.js";

const ENDPOINT = "/api/audit-telemetry";

/**
 * Defaults for the no-profile paths. Someone who pasted a plan never onboarded,
 * so their goal and experience are genuinely unknown; "General" and "Beginner"
 * are what the evaluator itself assumes for them, and matching that keeps the
 * telemetry consistent with the audit it describes.
 */
const DEFAULT_GOAL = "General";
const DEFAULT_EXPERIENCE = "Beginner";

export function buildTelemetryPayload(audit, plan, inputs, source) {
  if (!audit || !Array.isArray(audit.checks) || audit.checks.length === 0) return null;
  if (!plan || !Array.isArray(plan.days)) return null;

  const bucket = scoreBucket(audit.score);
  if (!bucket) return null;

  const payload = {
    v: TELEMETRY_VERSION,
    evaluatorVersion: EVALUATOR_VERSION,
    source,
    scoreBucket: bucket,
    daysCount: plan.days.length,
    exerciseCount: plan.days.reduce((n, day) => n + (day.exercises?.length || 0), 0),
    goal: inputs?.goal || DEFAULT_GOAL,
    experience: inputs?.experience || DEFAULT_EXPERIENCE,
    checks: audit.checks.map((check) => ({ id: check.id, status: check.status })),
  };

  // The server would drop an invalid payload silently, which would make a
  // client-side bug invisible. Validating here means a bad payload never gets
  // sent at all.
  return sanitizeTelemetry(payload);
}

export function sendAuditTelemetry(audit, plan, inputs, source) {
  const payload = buildTelemetryPayload(audit, plan, inputs, source);
  if (!payload) return false;
  try {
    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    return navigator.sendBeacon(ENDPOINT, blob) === true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/audit-telemetry-client.test.js`
Expected: PASS, 8 tests

Note: the `sendBeacon` test needs a global `Blob`. Node 22 provides one, so no polyfill is required. If the test fails on `Blob is not defined`, add `import { Blob } from "node:buffer";` to the test file only, never to `audit-telemetry-client.js`.

- [ ] **Step 5: Wire the generated-plan path**

In `app.js`, add to the import block after line 21:

```js
import { sendAuditTelemetry } from "./audit-telemetry-client.js";
```

Then at `app.js:332`, the existing block reads:

```js
  // Run the pure-code audit, then render it flags-first.
  const audit = evaluatePlan(plan, inputs);

  // Snapshot this audit into the per-profile history (real user plans only, not
  // the saved fallback example). Deduped, so re-renders don't pile up.
  if (!usedFallback) {
    const injuries = (inputs?.injuries || []).filter((v) => v && v !== "none");
    const hasInjuries = injuries.length > 0 || !!(inputs?.injuryNotes || "").trim();
    recordAudit(buildAuditEntry(plan, audit, { hasInjuries, note }));
  }
```

Add the telemetry call inside the existing `if (!usedFallback)` block, after `recordAudit(...)`:

```js
    recordAudit(buildAuditEntry(plan, audit, { hasInjuries, note }));
    // Same guard as the history snapshot: the saved fallback example is not a
    // real plan, and counting it would put a fixture into the production number.
    sendAuditTelemetry(audit, plan, inputs, "generate");
```

- [ ] **Step 6: Wire the imported-plan path**

In `import-ui.js`, add to the imports at the top of the file:

```js
import { sendAuditTelemetry } from "./audit-telemetry-client.js";
```

At `import-ui.js:148` the block reads:

```js
  const audit = evaluatePlan(parsedPlan, {});
  const s = audit.summary;
```

Change it to:

```js
  const audit = evaluatePlan(parsedPlan, {});
  sendAuditTelemetry(audit, parsedPlan, {}, "import");
  const s = audit.summary;
```

- [ ] **Step 7: Wire the adapt path**

In `adapt-engine.js`, add to the imports at the top of the file:

```js
import { sendAuditTelemetry } from "./audit-telemetry-client.js";
```

At `adapt-engine.js:158` the line reads:

```js
  const baseline = evaluatePlan(plan, effInputs).summary;
```

Change it to:

```js
  const baselineAudit = evaluatePlan(plan, effInputs);
  sendAuditTelemetry(baselineAudit, plan, effInputs, "adapt");
  const baseline = baselineAudit.summary;
```

- [ ] **Step 8: Confirm nothing else changed behaviour**

Run: `node --test`
Expected: PASS. `test/adapt-engine.test.js` and `test/import-endpoint.test.js` must still pass. If `adapt-engine.test.js` fails on a missing `navigator`, that proves `sendAuditTelemetry` is not swallowing correctly. Fix the client, not the test.

- [ ] **Step 9: Verify in the browser with the endpoint unconfigured**

Generate a plan locally with no `FIREBASE_SERVICE_ACCOUNT` set. Confirm the audit renders identically, and that the network panel shows one `POST /api/audit-telemetry` returning 204. Then block the endpoint in devtools and generate again: the audit must render identically.

- [ ] **Step 10: Add the new module to the offline precache**

Add `"audit-telemetry-client.js",` to the asset list in `service-worker.js`, next to the other top-level browser modules. `CACHE` is bumped once in Task 7.

Run: `node --test`
Expected: PASS, including `test/pwa.test.js`.

- [ ] **Step 11: Commit**

```bash
git add audit-telemetry-client.js app.js import-ui.js adapt-engine.js service-worker.js test/audit-telemetry-client.test.js
git commit -m "feat: fire audit telemetry from the generate, import and adapt paths"
```

---

### Task 7: Safety Lab renders the production block

**Files:**
- Create: `safety-lab-production.js`
- Modify: `safety-lab.js`
- Test: `test/safety-lab-production.test.js`

**Interfaces:**
- Consumes: `GET /api/audit-telemetry` returning `{ audits, byCheck, since }`.
- Produces: `productionRows(aggregate)` returning `{ audits, since, rows: [{ id, fired, rate }] }` or `null`.

- [ ] **Step 1: Write the failing test**

Create `test/safety-lab-production.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { productionRows } from "../safety-lab-production.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "safety-lab.js"), "utf8");

const aggregate = {
  audits: 100,
  since: "2026-08-18",
  byCheck: {
    rest_days: { pass: 90, warn: 0, fail: 10, not_assessed: 0 },
    equipment_fit: { pass: 0, warn: 0, fail: 0, not_assessed: 100 },
    muscle_balance: { pass: 75, warn: 20, fail: 5, not_assessed: 0 },
  },
};

test("a check's fired count is its warn plus fail, never its passes", () => {
  const { rows } = productionRows(aggregate);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(byId.rest_days.fired, 10);
  assert.equal(byId.muscle_balance.fired, 25);
});

test("not_assessed is not a firing", () => {
  const { rows } = productionRows(aggregate);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(byId.equipment_fit.fired, 0);
});

test("rates are computed against the audit total", () => {
  const { rows } = productionRows(aggregate);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(byId.rest_days.rate, 10);
  assert.equal(byId.muscle_balance.rate, 25);
});

test("rows are ordered by how often the check fires", () => {
  const { rows } = productionRows(aggregate);
  assert.deepEqual(rows.map((r) => r.id), ["muscle_balance", "rest_days", "equipment_fit"]);
});

test("no data returns null so the block can be omitted rather than showing a zero", () => {
  assert.equal(productionRows({ audits: 0, byCheck: {}, since: null }), null);
  assert.equal(productionRows(null), null);
  assert.equal(productionRows({}), null);
  assert.equal(productionRows("nope"), null);
});

test("the Safety Lab labels the production number unverified", () => {
  assert.match(source, /unverified/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/safety-lab-production.test.js`
Expected: FAIL with `Cannot find module .../safety-lab-production.js`

- [ ] **Step 3: Write the pure module**

Create `safety-lab-production.js`:

```js
/**
 * SpotterAI — production telemetry shaping (pure)
 * ============================================================================
 * Turns the /api/audit-telemetry aggregate into render rows.
 *
 * "Fired" means warn or fail. A pass is the check running and finding nothing,
 * and `not_assessed` is the check declining to run at all, so counting either
 * as a firing would inflate the headline number the page is built to be honest
 * about.
 */

export function productionRows(aggregate) {
  if (!aggregate || typeof aggregate !== "object" || Array.isArray(aggregate)) return null;
  const audits = Number(aggregate.audits) || 0;
  if (audits <= 0) return null;

  const byCheck = aggregate.byCheck && typeof aggregate.byCheck === "object" ? aggregate.byCheck : {};
  const rows = Object.entries(byCheck)
    .map(([id, statuses]) => {
      const fired = (statuses?.warn || 0) + (statuses?.fail || 0);
      return { id, fired, rate: Math.round((fired / audits) * 100) };
    })
    .sort((a, b) => b.fired - a.fired || a.id.localeCompare(b.id));

  if (rows.length === 0) return null;
  return { audits, since: aggregate.since || null, rows };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/safety-lab-production.test.js`
Expected: the five `productionRows` tests PASS. The last test, "labels the production number unverified", still FAILS until Step 5 adds that word to `safety-lab.js`.

- [ ] **Step 5: Render the block in `safety-lab.js`**

Add the import next to the `safety-lab-history.js` import:

```js
import { productionRows } from "./safety-lab-production.js";
```

In `render()`, extend the anchors line added in Task 3 from:

```js
  const history = `<div class="lab-block" id="bench-history" hidden></div>`;
  mount.innerHTML = bench + history + cols + rules + examples + privacy + principles + tech;
```

to:

```js
  const history = `<div class="lab-block" id="bench-history" hidden></div>`;
  const production = `<div class="lab-block" id="bench-production" hidden></div>`;
  mount.innerHTML = bench + history + production + cols + rules + examples + privacy + principles + tech;
```

Add this function immediately below `hydrateHistory()`:

```js
/**
 * Fill the production block from the telemetry aggregate.
 *
 * The block stays hidden when there is no data. A rendered zero would read as
 * "this check never fires on real plans" when the truth is "nothing has been
 * collected", and those are opposite claims.
 */
async function hydrateProduction() {
  const el = document.getElementById("bench-production");
  if (!el) return;
  let shaped = null;
  try {
    const res = await fetch("/api/audit-telemetry", { cache: "no-cache" });
    if (!res.ok) return;
    shaped = productionRows(await res.json());
  } catch {
    return;
  }
  if (!shaped) return;

  // RULE_EXPLANATIONS is an ARRAY of { id, name, ... }, not a map, and the
  // human label lives on `name`. Built once here rather than scanned per row.
  const labels = new Map(RULE_EXPLANATIONS.map((r) => [r.id, r.name]));
  const labelFor = (id) => labels.get(id) || id;
  const body = shaped.rows
    .map((r) => `<tr><td>${esc(labelFor(r.id))}</td><td>${r.fired}</td><td>${r.rate}%</td></tr>`)
    .join("");

  el.innerHTML = `
    <div class="lab-block__head">
      <div>
        <h3 class="lab-block__title">On real plans <span class="bench__tag">Production telemetry, unverified</span></h3>
        <p class="lab-block__sub">How often each check flagged something across ${shaped.audits} audited plans${shaped.since ? `, since ${esc(shaped.since)}` : ""}. Anonymous counters only: no plan content, no accounts, nothing identifying anyone. Unlike the bundled benchmark above, which anyone can reproduce by running the suite from the repo, this endpoint is public and unauthenticated, so treat these numbers as a direction rather than a proof.</p>
      </div>
    </div>
    <table class="bench-history">
      <thead><tr><th>Check</th><th>Times flagged</th><th>Share of plans</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
  el.hidden = false;
}
```

`RULE_EXPLANATIONS` is already imported at the top of `safety-lab.js`. Injury ids (`injury_knee` and friends) are generated per user and have no entry, so they fall back to the raw id, which is correct and readable.

Do NOT call it eagerly from the idle block. `#safety-lab` lives inside `<section id="evals" data-view="evals" hidden>` (index.html:924, 941), and the router only toggles `hidden` — the element exists in the DOM on every route. An eager call would fire a serverless invocation, and 30 Firestore document reads, on every single page load of the app rather than on visits to the Safety Lab.

Task 3 introduced a route gate for exactly this reason. Reuse it: register `hydrateProduction` through the same gate that runs `hydrateHistory`, so both run once, on first arrival at the `evals` route. Read how Task 3 wired it in `safety-lab.js` and follow that shape rather than inventing a second mechanism.

- [ ] **Step 6: Run the production tests again, now fully green**

Run: `node --test test/safety-lab-production.test.js`
Expected: PASS, 6 tests

- [ ] **Step 7: Verify both labels are present and distinct**

Run:

```bash
grep -n "reproducible\|unverified" safety-lab.js
```

Expected: at least one line containing `reproducible` on the bundled benchmark, and at least one containing `unverified` on the production block.

- [ ] **Step 8: Verify in the browser**

With no `FIREBASE_SERVICE_ACCOUNT` set, open the Safety Lab. The production block must be absent entirely, and the rest of the page unchanged. This is the state real visitors see until the variable is configured in Vercel.

- [ ] **Step 9: Precache the last module and bump the cache version**

Two edits in `service-worker.js`:

1. Add `"safety-lab-production.js",` to the asset list, next to `"safety-lab-history.js",`.
2. Bump the cache constant. It currently reads `const CACHE = "spotterai-v61";` — change it to `const CACHE = "spotterai-v62";`.

The bump is not cosmetic and is not optional. `activate` deletes every cache that is not the current `CACHE`, so without a bump an already-installed PWA keeps serving the old bundle and never fetches any module this branch added. A previous release on this repo shipped with this step missed; it is called out here so it is not missed twice.

Confirm all three of this branch's browser modules are now listed:

```bash
grep -n "safety-lab-history.js\|safety-lab-production.js\|audit-telemetry-client.js\|const CACHE" service-worker.js
```

Expected: four lines, with `CACHE` reading `spotterai-v62`.

- [ ] **Step 10: Run the whole suite**

Run: `node --test`
Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add safety-lab.js safety-lab-production.js service-worker.js test/safety-lab-production.test.js
git commit -m "feat: show what the evaluator catches on real plans, labelled unverified"
```

---

## Verification against the spec's success criteria

Run each of these before opening the pull request. Each maps to a numbered criterion in the spec.

1. **CLI unchanged.** `node eval.mjs` prints the same table and exits 0.
2. **Dedupe works.** `node scripts/append-benchmark-history.mjs` twice in a row appends once, and prints `Benchmark unchanged.` the second time.
3. **History fail-safe.** Move `docs/benchmark-history.json` aside, load the Safety Lab, confirm the page renders with no history block and no broken layout. Restore the file.
4. **Telemetry is invisible.** Block `/api/audit-telemetry` in devtools, generate a plan, confirm the audit is identical.
5. **Nothing personal is stored.** `node --test test/telemetry-schema.test.js test/audit-telemetry-client.test.js` passes, including the tests asserting no plan content, no free text and no raw score reach a payload.
6. **Both labels present.** `grep -n "reproducible\|unverified" safety-lab.js` returns both.
7. **Dependency count.** `node -p "Object.keys(require('./package.json').dependencies).length"` returns `2`.
8. **Safety files untouched.** `git diff --stat main -- evaluator.js safety-boundaries.js nutrition-safety.js` returns empty output.
9. **No fetch on page load.** Load any route other than the Safety Lab and confirm the network panel shows no request to `docs/benchmark-history.json` and none to `/api/audit-telemetry`. Then navigate to the Safety Lab and confirm both fire exactly once, and do not fire again on a second visit.
10. **Offline shell current.** Every new browser module must be in `BOOT_MODULES`. The branch adds five: `route-gate.js` (Task 3 fix round), `safety-lab-history.js`, `audit-telemetry-client.js`, `lib/telemetry-schema.js` (a transitive import of the client, caught by `service-worker-behavior.test.js` during Task 6), and `safety-lab-production.js`. `grep -c "safety-lab-history.js\|safety-lab-production.js\|audit-telemetry-client.js\|route-gate.js\|lib/telemetry-schema.js" service-worker.js` returns `5`, and `grep -n "const CACHE" service-worker.js` reads `spotterai-v62`.

Criterion 8 is the standing-rule-6 gate. If it returns anything, stop and run the safety directive before merging.
