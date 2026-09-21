#!/usr/bin/env node
/**
 * Verify that the numbers the README claims are the numbers the repo actually
 * has.
 *
 * Why this exists: the README is the first thing a skeptical reader checks, and
 * a hardcoded count is stale the moment the next test lands. Before this script,
 * it advertised "717 tests, 21 adversarial eval cases, one runtime dependency"
 * while the repo had 855, 23, and two. Every one of those was wrong in a way a
 * reader could catch in about a minute — which is worse than never having
 * claimed a number, because it makes them wonder what else is out of date.
 *
 * It said "14 checks" too, which was worse: not stale, just wrong. No
 * configuration of the evaluator returns 14 — a plain plan gets 11 and the
 * ceiling is 15, once cardio and two injuries are declared.
 *
 * So the claims are derived, not trusted:
 *   - test count      — from an actual `node --test` run, not a grep
 *   - eval case count — imported from eval-suite.js, the same array the
 *                       benchmark and the in-app Safety Lab both run
 *   - rubric size     — by running evaluatePlan itself, both the every-plan
 *                       baseline and the maximum with cardio + injuries
 *   - runtime deps    — from package.json `dependencies`
 *
 * Run by `npm run verify` and by CI. When it fails it prints the corrected
 * line, so fixing it is a copy-paste.
 */

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CASES } from "../eval-suite.js";
import { evaluatePlan } from "../evaluator.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readmePath = join(root, "README.md");

// ---- gather the truth -----------------------------------------------------

/** Run the suite and read the TAP summary rather than counting `test(` calls,
 *  which would miss subtests and count commented-out ones. */
function actualTestCount() {
  const out = execFileSync(process.execPath, ["--test"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const tests = /^# tests (\d+)$/m.exec(out);
  const fail = /^# fail (\d+)$/m.exec(out);
  if (!tests) throw new Error("could not parse a test count from `node --test`");
  if (fail && fail[1] !== "0") {
    throw new Error(`the suite is failing (${fail[1]} failures) — fix that before trusting any count`);
  }
  return Number(tests[1]);
}

/** How many checks a plain plan gets, and the ceiling once cardio and injuries
 *  are in play. Both are advertised on the README, and both were wrong: it said
 *  "14 checks", a number no configuration of the evaluator actually produces. */
function rubricSize() {
  const plain = CASES.find((c) => /balanced hypertrophy/i.test(c.name));
  if (!plain) throw new Error("expected a plain, no-injury case to measure the baseline against");
  const baseline = evaluatePlan(plain.plan, plain.inputs ?? {}).checks.length;

  let max = 0;
  for (const c of CASES) {
    for (const injuries of [undefined, ["knee", "shoulder"]]) {
      const inputs = { ...(c.inputs ?? {}), ...(injuries ? { injuries } : {}) };
      let result;
      try { result = evaluatePlan(c.plan, inputs); } catch { continue; }
      max = Math.max(max, result?.checks?.length ?? 0);
    }
  }
  return { baseline, max };
}

const rubric = rubricSize();
const actual = {
  tests: actualTestCount(),
  evalCases: CASES.length,
  checksBaseline: rubric.baseline,
  checksMax: rubric.max,
  runtimeDeps: Object.keys(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).dependencies ?? {}).length,
};

// ---- compare against what the README says ---------------------------------

const readme = readFileSync(readmePath, "utf8");

/** Each claim names the phrase in the README, the live value it must equal,
 *  and how many times it is expected to appear. */
const claims = [
  {
    label: "test count",
    // Both the at-a-glance line and the testing section quote the figure;
    // catching both is the point, since they drifted independently before.
    pattern: /\b(\d{3,}) tests\b/g,
    expected: actual.tests,
    occurrences: 2,
  },
  {
    label: "adversarial eval cases",
    pattern: /(\d+) adversarial (?:eval )?cases/g,
    expected: actual.evalCases,
    occurrences: 2,
  },
  {
    label: "checks on every plan",
    pattern: /(\d+) checks on every plan/g,
    expected: actual.checksBaseline,
    occurrences: 1,
  },
  {
    label: "maximum rubric size",
    pattern: /up to (\d+) with\n?> ?cardio/g,
    expected: actual.checksMax,
    occurrences: 1,
  },
  {
    label: "runtime dependencies",
    pattern: /(\d+) runtime dependenc(?:y|ies)/g,
    expected: actual.runtimeDeps,
    occurrences: 1,
  },
];

const problems = [];

for (const { label, pattern, expected, occurrences } of claims) {
  const found = [...readme.matchAll(pattern)];
  if (found.length !== occurrences) {
    problems.push(
      `${label}: expected ${occurrences} mention(s) in README.md, found ${found.length}. ` +
        `If you reworded the sentence, update the pattern in ${"scripts/check-readme-claims.mjs"}.`,
    );
    continue;
  }
  for (const m of found) {
    const claimed = Number(m[1]);
    if (claimed !== expected) {
      problems.push(
        `${label}: README says ${claimed}, repo has ${expected}\n` +
          `      in: "${m[0]}"\n` +
          `      fix: "${m[0].replace(String(claimed), String(expected))}"`,
      );
    }
  }
}

if (problems.length) {
  console.error("README claims are out of date:\n");
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(
    `\n  Live values: ${actual.tests} tests, ${actual.evalCases} eval cases, ` +
      `${actual.runtimeDeps} runtime dependencies, ${actual.checksBaseline} checks baseline, ` +
      `${actual.checksMax} max.\n`,
  );
  process.exit(1);
}

console.log(
  `README claims check: OK (${actual.tests} tests, ${actual.evalCases} eval cases, ` +
    `${actual.runtimeDeps} runtime dependencies, ${actual.checksBaseline}-${actual.checksMax} checks)`,
);
