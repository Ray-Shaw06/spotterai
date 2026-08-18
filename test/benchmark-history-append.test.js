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
