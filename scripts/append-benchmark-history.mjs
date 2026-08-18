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
