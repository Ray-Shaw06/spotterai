#!/usr/bin/env node
/**
 * Draft curated safety metadata for the catalog's uncurated lifts.
 * ============================================================================
 *
 * WHAT THIS IS NOT: a runtime dependency. Nothing in the app calls this. The
 * evaluator stays pure code with no LLM in the loop, which is the entire trust
 * story — an auditor whose input came from a model would depend on that model
 * not hallucinating in order to catch a model hallucinating.
 *
 * WHAT IT IS: a content pipeline. It drafts entries OFFLINE into a separate
 * file for a human to read, edit and paste into exercise-metadata.js. The
 * output is a reviewable diff, never a live data source.
 *
 * Why that distinction is safe to rely on: the structural invariants are
 * enforced HERE, in code, so review is about judgment rather than typos.
 *
 *   - Equipment is never asked for. The catalog already knows it, and asking
 *     would invite the model to disagree with a fact we hold.
 *   - Every enum (movement pattern, difficulty, joint stress, contraindication
 *     key, muscle name) is derived from the metadata that already exists, so a
 *     draft cannot introduce a value the evaluator does not understand.
 *   - Every substitution / regression / progression is resolved against the
 *     catalog and DROPPED if it does not exist. The repair engine once shipped
 *     28 substitutions that resolved to nothing; that cannot recur through this
 *     path.
 *
 * What still needs a human: contraindications. "Is this bad for a lower back"
 * is a judgment call, it is the field that matters most, and it is the one the
 * model is most likely to get plausibly wrong. The report prints every
 * contraindication it proposed, grouped, so they can be read in one pass.
 *
 * Usage:
 *   GEMINI_API_KEY=... node scripts/draft-exercise-metadata.mjs [options]
 *
 *   --limit N        stop after N lifts (default: all)
 *   --muscle Name    only this muscle group, e.g. --muscle Quads
 *   --batch N        lifts per model call (default 8)
 *   --include-cardio cardio lifts are skipped by default: they carry no lifting
 *                    volume and the metadata shape does not describe them
 *   --out PATH       default scripts/out/exercise-metadata.draft.js
 *   --dry-run        print the prompt for the first batch and exit
 *
 * Resumable: entries already present in the output file are skipped, so an
 * interrupted run can simply be re-run.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CATALOG, resolveExercise, normalizeExerciseName } from "../exercise-catalog.js";
import { EXERCISE_METADATA } from "../exercise-metadata.js";
import { callGemini } from "../lib/gemini.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// Vocabularies, derived rather than restated
// ---------------------------------------------------------------------------
// Restating these as literals here would let the file drift from what the
// evaluator actually accepts. Deriving them means a new movement pattern added
// to the real data is immediately legal in drafts, and nothing else is.
const valuesOf = (key) =>
  new Set(EXERCISE_METADATA.flatMap((e) => (Array.isArray(e[key]) ? e[key] : [e[key]])).filter(Boolean));

export const PATTERNS = valuesOf("movementPattern");
export const DIFFICULTIES = valuesOf("difficulty");
export const JOINTS = valuesOf("jointStress");
export const CONTRA = valuesOf("contraindications");
export const MUSCLES = new Set([...valuesOf("primaryMuscles"), ...valuesOf("secondaryMuscles")]);

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = { batch: 8, limit: Infinity, muscle: null, includeCardio: false, dryRun: false, out: join(root, "scripts/out/exercise-metadata.draft.js") };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--limit") out.limit = Number(argv[++i]);
    else if (a === "--muscle") out.muscle = argv[++i];
    else if (a === "--batch") out.batch = Math.max(1, Number(argv[++i]) || 8);
    else if (a === "--include-cardio") out.includeCardio = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--out") out.out = resolve(process.cwd(), argv[++i]);
    else if (a === "--help" || a === "-h") out.help = true;
    else throw new Error(`unknown option: ${a}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------
export function buildPrompt(batch) {
  const list = batch
    .map((e) => `- ${e.name} (${e.muscle}, performed with: ${e.equipmentTags.join(" + ")})`)
    .join("\n");

  return `You are a strength & conditioning coach writing reference data for an exercise database. Be conservative and conventional. This data is used to warn injured people away from movements, so err toward flagging a real risk and never invent a risk that isn't there.

For each exercise below, return one object.

FIELDS
- "name": copy the name EXACTLY as given.
- "primaryMuscles": 1-3 from ${JSON.stringify([...MUSCLES].sort())}. The movers doing the work.
- "secondaryMuscles": 0-3 from the same list. Assisting muscles. Never repeat a primary.
- "movementPattern": exactly one of ${JSON.stringify([...PATTERNS].sort())}.
- "difficulty": one of ${JSON.stringify([...DIFFICULTIES].sort())}. Judge technical demand, not how hard it feels.
- "jointStress": 0-3 from ${JSON.stringify([...JOINTS].sort())}. Joints under meaningful load. INFORMATIONAL ONLY.
- "contraindications": 0-3 from ${JSON.stringify([...CONTRA].sort())}. This is the important one. Include a key ONLY if someone with that existing injury should genuinely avoid this movement, not merely be careful. A leg press stresses the knee but is not contraindicated for knee pain; a deep loaded spinal flexion IS contraindicated for a lower back. Most exercises should have an EMPTY list.
- "commonSubstitutions": 1-3 exercise names that train the same thing with different equipment.
- "regressionOptions": 0-2 easier versions.
- "progressionOptions": 0-2 harder versions.

RULES
- Do NOT include an "equipment" field. It is already known.
- Substitutions, regressions and progressions must be REAL, conventional exercise names in standard English (e.g. "Goblet Squat", "Lat Pulldown"). Names that do not exist in the database are discarded, so prefer the common name for a common movement over an exotic one.
- Judge the movement as described, including its implement. A band row and a barbell row load the spine very differently.

EXERCISES
${list}

Return ONLY a JSON object of the form {"entries": [ ... ]} with one entry per exercise above, in the same order. No prose, no markdown.`;
}

// ---------------------------------------------------------------------------
// Validation — this is what makes a draft reviewable rather than trusted
// ---------------------------------------------------------------------------
export function pickFrom(list, allowed, max) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const raw of list) {
    const v = String(raw ?? "").trim().toLowerCase();
    if (allowed.has(v) && !out.includes(v)) out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

/** Names that resolve to a real catalog entry, canonicalized, self excluded. */
export function resolveNames(list, selfName, max) {
  if (!Array.isArray(list)) return { kept: [], dropped: [] };
  const kept = [];
  const dropped = [];
  for (const raw of list) {
    const hit = resolveExercise(String(raw ?? ""));
    if (!hit) { dropped.push(String(raw ?? "")); continue; }
    if (normalizeExerciseName(hit.name) === normalizeExerciseName(selfName)) continue; // no self-reference
    if (!kept.includes(hit.name)) kept.push(hit.name);
    if (kept.length >= max) break;
  }
  return { kept, dropped };
}

export function validate(raw, entry) {
  const problems = [];
  const primary = pickFrom(raw.primaryMuscles, MUSCLES, 3);
  if (!primary.length) problems.push("no usable primaryMuscles");

  const secondary = pickFrom(raw.secondaryMuscles, MUSCLES, 3).filter((m) => !primary.includes(m));

  const pattern = PATTERNS.has(String(raw.movementPattern || "").trim()) ? String(raw.movementPattern).trim() : null;
  if (!pattern) problems.push(`movementPattern ${JSON.stringify(raw.movementPattern)} not recognized`);

  const difficulty = DIFFICULTIES.has(String(raw.difficulty || "").trim()) ? String(raw.difficulty).trim() : null;
  if (!difficulty) problems.push(`difficulty ${JSON.stringify(raw.difficulty)} not recognized`);

  const subs = resolveNames(raw.commonSubstitutions, entry.name, 3);
  const regs = resolveNames(raw.regressionOptions, entry.name, 2);
  const progs = resolveNames(raw.progressionOptions, entry.name, 2);

  return {
    ok: problems.length === 0,
    problems,
    dropped: [...subs.dropped, ...regs.dropped, ...progs.dropped],
    value: {
      name: entry.name,
      primaryMuscles: primary,
      secondaryMuscles: secondary,
      movementPattern: pattern,
      // NOT from the model: the catalog already knows the implement, and asking
      // would invite a draft that disagrees with a fact we hold.
      equipment: entry.equipmentTags,
      difficulty,
      jointStress: pickFrom(raw.jointStress, JOINTS, 3),
      contraindications: pickFrom(raw.contraindications, CONTRA, 3),
      commonSubstitutions: subs.kept,
      regressionOptions: regs.kept,
      progressionOptions: progs.kept,
    },
  };
}

// ---------------------------------------------------------------------------
// Rendering — the exact shape exercise-metadata.js uses, ready to paste
// ---------------------------------------------------------------------------
const j = (v) => JSON.stringify(v);
export function render(m) {
  return (
    `  E(${j(m.name)}, { primaryMuscles: ${j(m.primaryMuscles)}` +
    (m.secondaryMuscles.length ? `, secondaryMuscles: ${j(m.secondaryMuscles)}` : "") +
    `, movementPattern: ${j(m.movementPattern)}, equipment: ${j(m.equipment)}, difficulty: ${j(m.difficulty)}` +
    `, jointStress: ${j(m.jointStress)}, contraindications: ${j(m.contraindications)}` +
    `, commonSubstitutions: ${j(m.commonSubstitutions)}, regressionOptions: ${j(m.regressionOptions)}, progressionOptions: ${j(m.progressionOptions)} }),`
  );
}

const HEADER = `/**
 * DRAFT — machine-drafted exercise metadata awaiting human review.
 * ============================================================================
 * Generated by scripts/draft-exercise-metadata.mjs. NOT imported by anything.
 *
 * Every structural field here has already been checked in code: enums are legal,
 * substitutions resolve to real catalog entries, and equipment came from the
 * catalog rather than the model. What is left for a human is JUDGEMENT, and one
 * field carries almost all of it:
 *
 *   contraindications — read every one. A wrong entry either scares someone off
 *   a movement that would have helped them, or fails to warn them off one that
 *   will hurt. Most exercises should have an empty list.
 *
 * When an entry reads right, move it into exercise-metadata.js. The catalog
 * merges on canonical name, so nothing else needs to change.
 */

`;

function parseExisting(path) {
  if (!existsSync(path)) return new Set();
  const src = readFileSync(path, "utf8");
  return new Set([...src.matchAll(/^\s*E\("([^"]+)"/gm)].map((m) => normalizeExerciseName(m[1])));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]);
    return;
  }

  const already = parseExisting(opts.out);
  let todo = CATALOG.filter((e) => !e.hasSafetyData)
    .filter((e) => opts.includeCardio || e.muscle !== "Cardio")
    .filter((e) => !opts.muscle || e.muscle.toLowerCase() === opts.muscle.toLowerCase())
    .filter((e) => !already.has(normalizeExerciseName(e.name)));

  if (already.size) console.log(`Resuming: ${already.size} already drafted in ${opts.out}`);
  console.log(`${todo.length} lift(s) to draft${opts.muscle ? ` in ${opts.muscle}` : ""}.`);
  if (!todo.length) return;

  todo = todo.slice(0, opts.limit);
  const batches = [];
  for (let i = 0; i < todo.length; i += opts.batch) batches.push(todo.slice(i, i + opts.batch));

  if (opts.dryRun) {
    console.log(`\n--- prompt for batch 1 of ${batches.length} ---\n`);
    console.log(buildPrompt(batches[0]));
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY is not set. This script calls the model directly; the app's own key lives in Vercel.");
    process.exit(1);
  }

  const accepted = [];
  const rejected = [];
  const droppedNames = [];

  for (const [i, batch] of batches.entries()) {
    process.stdout.write(`batch ${i + 1}/${batches.length} (${batch.length} lifts)… `);
    let parsed;
    try {
      const text = await callGemini({
        apiKey,
        contents: [{ role: "user", parts: [{ text: buildPrompt(batch) }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 4096, responseMimeType: "application/json" },
        timeoutMs: 60000,
      });
      parsed = JSON.parse(text);
    } catch (err) {
      console.log(`FAILED (${err.message})`);
      for (const e of batch) rejected.push({ name: e.name, problems: [`model call failed: ${err.message}`] });
      continue;
    }

    const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    const byName = new Map(entries.map((r) => [normalizeExerciseName(r?.name ?? ""), r]));
    let ok = 0;
    for (const entry of batch) {
      const raw = byName.get(normalizeExerciseName(entry.name));
      if (!raw) { rejected.push({ name: entry.name, problems: ["no entry returned"] }); continue; }
      const result = validate(raw, entry);
      droppedNames.push(...result.dropped);
      if (!result.ok) { rejected.push({ name: entry.name, problems: result.problems }); continue; }
      accepted.push(result.value);
      ok += 1;
    }
    console.log(`${ok}/${batch.length} accepted`);
  }

  // Write (append-safe: re-read what was there and keep it)
  mkdirSync(dirname(opts.out), { recursive: true });
  const prior = existsSync(opts.out) ? readFileSync(opts.out, "utf8") : "";
  const priorBody = prior.includes("export const DRAFT_METADATA = [")
    ? prior.slice(prior.indexOf("export const DRAFT_METADATA = [") + "export const DRAFT_METADATA = [".length, prior.lastIndexOf("];"))
    : "";
  const body = `${priorBody.trimEnd()}\n${accepted.map(render).join("\n")}\n`;
  writeFileSync(
    opts.out,
    `${HEADER}const E = (name, o) => ({ name, secondaryMuscles: [], jointStress: [], contraindications: [], commonSubstitutions: [], regressionOptions: [], progressionOptions: [], ...o });\n\nexport const DRAFT_METADATA = [${body}];\n`
  );

  // ---- Report -------------------------------------------------------------
  console.log(`\nWrote ${accepted.length} entr${accepted.length === 1 ? "y" : "ies"} to ${opts.out}`);

  if (droppedNames.length) {
    const counts = new Map();
    for (const n of droppedNames) counts.set(n, (counts.get(n) || 0) + 1);
    const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 12);
    console.log(`\nDropped ${droppedNames.length} substitution name(s) that resolve to nothing.`);
    console.log("Most frequent — each is either a real lift worth ADDING to the catalog, or noise:");
    for (const [n, c] of top) console.log(`  ${String(c).padStart(3)}x  ${n}`);
  }

  if (rejected.length) {
    console.log(`\n${rejected.length} lift(s) rejected outright:`);
    for (const r of rejected.slice(0, 20)) console.log(`  ${r.name}: ${r.problems.join("; ")}`);
  }

  // The field that actually needs eyes.
  const flagged = accepted.filter((m) => m.contraindications.length);
  console.log(`\nREVIEW THESE. ${flagged.length} of ${accepted.length} drafts propose a contraindication:`);
  const byKey = new Map();
  for (const m of flagged) for (const k of m.contraindications) {
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(m.name);
  }
  for (const [key, names] of [...byKey].sort()) {
    console.log(`\n  ${key} (${names.length}):`);
    for (const n of names) console.log(`    ${n}`);
  }
  console.log(`\n${accepted.length - flagged.length} drafts propose NO contraindication. Skim for anything that obviously should have one.`);
}

// Only when invoked directly. Without this guard, importing anything from this
// file to test it would run the whole pipeline and demand an API key.
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
