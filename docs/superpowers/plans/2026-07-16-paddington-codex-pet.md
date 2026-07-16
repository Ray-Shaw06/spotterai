# Paddington Codex Pet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate, validate, and install a soft cinematic 3D Paddington-inspired Codex v2 animated pet.

**Architecture:** Use the installed Hatch Pet workflow as the orchestrator and the built-in ImageGen path as the sole visual-generation layer. Lightweight isolated workers generate one grounded visual job at a time; the parent copies approved outputs, runs deterministic extraction and atlas tooling, owns QA evidence, and packages only the final passing 8-by-11 atlas.

**Tech Stack:** Hatch Pet Python scripts, bundled Python/Pillow runtime, built-in ImageGen, `jq`, WebP/PNG/GIF QA artifacts, Codex custom-pet v2 manifest.

## Global Constraints

- Preserve warm brown fur, the red felt hat, royal-blue wool duffle coat with three wooden toggles, warm dark eyes, and the worn brown leather suitcase in the bear's left paw.
- Use soft cinematic 3D materials without scenery, readable text, logos, cast shadows, contact shadows, or detached effects.
- Generate running-left separately; never mirror the suitcase into the opposite paw.
- Generate every normal visual job through built-in ImageGen with every manifest-listed grounding image attached.
- Package only an atlas that is exactly `1536x2288`, uses `192x208` cells, and passes v2 validation with `spriteVersionNumber: 2`.
- Keep all final QA artifacts required by the Hatch Pet acceptance criteria.

---

### Task 1: Prepare the bounded pet run

**Files:**
- Create: `output/pets/paddington-soft-cinematic-3d/pet_request.json`
- Create: `output/pets/paddington-soft-cinematic-3d/imagegen-jobs.json`
- Create: `output/pets/paddington-soft-cinematic-3d/prompts/**`
- Create: `output/pets/paddington-soft-cinematic-3d/references/layout-guides/**`

**Interfaces:**
- Consumes: `docs/superpowers/specs/2026-07-16-paddington-codex-pet-design.md`.
- Produces: the Hatch Pet request, job dependency graph, chroma key, prompts, and layout guides used by every later task.

- [ ] **Step 1: Prepare the run directory**

```bash
/Users/rehaanshaw/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 \
  /Users/rehaanshaw/.codex/skills/hatch-pet/scripts/prepare_pet_run.py \
  --pet-name "Paddington" \
  --description "A polite brown bear in a red felt hat and blue duffle coat, carrying a worn leather suitcase." \
  --output-dir /Users/rehaanshaw/spotterai/output/pets/paddington-soft-cinematic-3d \
  --pet-notes "Faithful Paddington-inspired bear; warm natural brown fur, lighter muzzle, red felt bucket hat, royal-blue wool duffle coat with three wooden toggles, worn brown leather suitcase permanently held in the left paw, free right paw, gentle earnest expression." \
  --style-preset 3d-toy \
  --style-notes "Soft cinematic 3D with natural fur, felt, wool, leather, warm glassy eyes, compact whole-body proportions, clean sprite edges, flat removable chroma background, no shadows or scenery." \
  --force
```

Expected: the command exits successfully and creates the request, prompts, layout guides, and job manifest.

- [ ] **Step 2: Verify the prepared identity and job graph**

```bash
jq '{pet_id,display_name,description,chroma_key}' /Users/rehaanshaw/spotterai/output/pets/paddington-soft-cinematic-3d/pet_request.json
jq '.jobs[] | {id,kind,status,depends_on,input_images,output_path}' /Users/rehaanshaw/spotterai/output/pets/paddington-soft-cinematic-3d/imagegen-jobs.json
```

Expected: the pet id is `paddington`, base is the only initially ready visual job, and all row jobs declare their required grounding images.

### Task 2: Generate and approve the canonical base

**Files:**
- Create: `output/pets/paddington-soft-cinematic-3d/decoded/base.png`
- Create: `output/pets/paddington-soft-cinematic-3d/references/canonical-base.png`
- Modify: `output/pets/paddington-soft-cinematic-3d/imagegen-jobs.json`

**Interfaces:**
- Consumes: the prepared base prompt and optional prompt-only identity specification.
- Produces: one approved canonical base reference that grounds every animation row.

- [ ] **Step 1: Dispatch one lightweight base worker**

The worker reads `prompts/base-pet.md`, uses built-in ImageGen only, visually checks one centered full-body pet on the run's flat chroma background, and returns only `selected_source` plus a one-sentence QA note.

- [ ] **Step 2: Copy and register the selected base**

Set `SELECTED_SOURCE` to the exact absolute path returned by the base worker.

```bash
mkdir -p /Users/rehaanshaw/spotterai/output/pets/paddington-soft-cinematic-3d/decoded /Users/rehaanshaw/spotterai/output/pets/paddington-soft-cinematic-3d/references
cp "$SELECTED_SOURCE" /Users/rehaanshaw/spotterai/output/pets/paddington-soft-cinematic-3d/decoded/base.png
cp /Users/rehaanshaw/spotterai/output/pets/paddington-soft-cinematic-3d/decoded/base.png /Users/rehaanshaw/spotterai/output/pets/paddington-soft-cinematic-3d/references/canonical-base.png
```

Expected: both files contain the exact selected output; no row generation starts before they exist.

- [ ] **Step 3: Mark base complete only after the copy exists**

Update the base job with `status: "complete"`, the exact `source_path`, and an ISO-8601 `completed_at` value, then verify dependent rows become ready.

### Task 3: Generate and incrementally validate all standard rows

**Files:**
- Create: `output/pets/paddington-soft-cinematic-3d/decoded/{idle,running-right,running-left,waving,jumping,failed,waiting,running,review}.png`
- Create: `output/pets/paddington-soft-cinematic-3d/qa/rows/*/review.json`
- Modify: `output/pets/paddington-soft-cinematic-3d/imagegen-jobs.json`

**Interfaces:**
- Consumes: the canonical base, each row layout guide, and every `input_images` entry from the job manifest.
- Produces: nine independently generated, extracted, and inspected standard animation strips.

- [ ] **Step 1: Generate identity and gait checks first**

Dispatch separate lightweight workers for `idle` and `running-right`. Each worker uses built-in ImageGen only and attaches every manifest-listed input image with its role.

- [ ] **Step 2: Extract and inspect each returned strip immediately**

Set `ROW_ID` to the exact manifest job id whose selected strip was just copied into `decoded`.

```bash
/Users/rehaanshaw/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 \
  /Users/rehaanshaw/.codex/skills/hatch-pet/scripts/extract_strip_frames.py \
  --decoded-dir /Users/rehaanshaw/spotterai/output/pets/paddington-soft-cinematic-3d/decoded \
  --output-dir "/Users/rehaanshaw/spotterai/output/pets/paddington-soft-cinematic-3d/qa/rows/$ROW_ID/frames" \
  --states "$ROW_ID" --method auto

/Users/rehaanshaw/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 \
  /Users/rehaanshaw/.codex/skills/hatch-pet/scripts/inspect_frames.py \
  --frames-root "/Users/rehaanshaw/spotterai/output/pets/paddington-soft-cinematic-3d/qa/rows/$ROW_ID/frames" \
  --json-out "/Users/rehaanshaw/spotterai/output/pets/paddington-soft-cinematic-3d/qa/rows/$ROW_ID/review.json" \
  --states "$ROW_ID" --require-components
```

Expected: no errors, no clipping, no detached effects, and correct state semantics before the row is marked complete.

- [ ] **Step 3: Generate running-left separately**

Dispatch `running-left` as a normal grounded ImageGen row after `running-right` passes. Reject any result that moves the suitcase from the bear's left paw or faces screen-right.

- [ ] **Step 4: Backfill remaining rows with at most three concurrent generation workers**

Generate `waving`, `jumping`, `failed`, `waiting`, `running`, and `review` as separate jobs. Copy, extract, inspect, and mark each complete only after its row-level QA passes.

- [ ] **Step 5: Repair only failed rows**

For a visual-semantic or source-geometry failure, rerun the complete failing row with its retry prompt and the same grounding images. For extraction-only size popping with stable source slots, use `stable-slots` and `--allow-stable-slots` instead of regenerating.

### Task 4: Assemble and review the standard 8-by-9 atlas

**Files:**
- Create: `output/pets/paddington-soft-cinematic-3d/frames/**`
- Create: `output/pets/paddington-soft-cinematic-3d/final/spritesheet.webp`
- Create: `output/pets/paddington-soft-cinematic-3d/qa/contact-sheet.png`
- Create: `output/pets/paddington-soft-cinematic-3d/qa/previews/*.gif`
- Create: `output/pets/paddington-soft-cinematic-3d/qa/review.json`
- Create: `output/pets/paddington-soft-cinematic-3d/qa/look-mechanics.md`

**Interfaces:**
- Consumes: nine passing decoded row strips.
- Produces: the reviewed standard atlas, canonical row frames, motion previews, and the pet-specific direction mechanics used by look generation.

- [ ] **Step 1: Extract, inspect, compose, and preview all standard rows**

Run `extract_strip_frames.py --states all`, `inspect_frames.py --require-components`, `compose_atlas.py`, `make_contact_sheet.py`, and `render_animation_previews.py` with the run's decoded, frames, final, and QA paths.

Expected: `qa/review.json` has no errors; the contact sheet and GIFs show one consistent pet, clear state semantics, correct facing, alternating gait, and no unintended size or baseline popping.

- [ ] **Step 2: Record look mechanics**

Write `qa/look-mechanics.md` stating that the feet, lower coat, and suitcase grip remain anchored; eyes lead; muzzle/head, ears, hat brim, and upper coat follow gradually; the suitcase remains attached with slight lag; and whole-sprite rotation is forbidden.

### Task 5: Generate cardinal anchors and coherent look rows

**Files:**
- Create: `output/pets/paddington-soft-cinematic-3d/decoded/look-cardinals.png`
- Create: `output/pets/paddington-soft-cinematic-3d/decoded/look-anchors/{000,090,180,270}.png`
- Create: `output/pets/paddington-soft-cinematic-3d/decoded/look-anchors-approved.png`
- Create: `output/pets/paddington-soft-cinematic-3d/decoded/look-row-{9,10}.png`
- Create: `output/pets/paddington-soft-cinematic-3d/qa/look-row-9-registration.json`

**Interfaces:**
- Consumes: canonical base, approved standard contact sheet, layout guides, and look mechanics.
- Produces: four semantically approved cardinal poses and two grounded coherent eight-pose direction families.

- [ ] **Step 1: Generate and approve the four-cardinal strip**

Dispatch one isolated ImageGen worker for `look-cardinals`, then run `extract_cardinal_anchors.py` and `compose_cardinal_anchor_strip.py` with the run chroma key.

Expected: `000` unmistakably looks up, `090` screen-right, `180` down, and `270` screen-left using eyes, nose, head turn, and upper-body follow-through.

- [ ] **Step 2: Generate and register row 9**

Dispatch one worker for directions `000` through `157.5`, grounded by the approved cardinal strip and standard references. Run `assemble_extended_atlas.py` in row-9 registration mode with `frames/idle/00.png` as the neutral cell.

Expected: eight separated poses, shared scale and baseline, no final-cell edge failure, no wrong quadrant, and a continuous `000 -> 157.5` arc.

- [ ] **Step 3: Generate row 10 only after row 9 passes**

Dispatch one worker for `180` through `337.5`, attaching the approved cardinals and completed row 9 as continuity evidence.

Expected: a continuous row that begins one even step after `157.5` and ends one even step before `000`.

### Task 6: Assemble, clean, and deterministically validate v2

**Files:**
- Create: `output/pets/paddington-soft-cinematic-3d/final/spritesheet-extended.{png,webp,json}`
- Create: `output/pets/paddington-soft-cinematic-3d/final/validation-extended.json`
- Create: `output/pets/paddington-soft-cinematic-3d/qa/chroma-despill-extended.json`
- Create: `output/pets/paddington-soft-cinematic-3d/qa/contact-sheet-extended.png`
- Create: `output/pets/paddington-soft-cinematic-3d/qa/look-directions.png`
- Create: `output/pets/paddington-soft-cinematic-3d/qa/look-continuity.json`

**Interfaces:**
- Consumes: passing standard atlas plus registered row 9 and approved row 10.
- Produces: the final cleaned v2 atlas and deterministic validation evidence.

- [ ] **Step 1: Assemble the extended atlas**

Run `assemble_extended_atlas.py` with the registered row-9 files, row 10, the idle neutral cell, the run chroma key, and threshold `96`.

- [ ] **Step 2: Run the single allowed chroma cleanup pass**

Run `despill_chroma_edges.py` in-place on `spritesheet-extended.png`, writing the WebP and `qa/chroma-despill-extended.json`.

Expected: the report has `ok: true`; do not add or repeat chroma cleanup after this pass.

- [ ] **Step 3: Validate geometry and create QA media**

Run `validate_atlas.py --require-v2`, `make_contact_sheet.py`, `make_direction_qa_sheet.py`, `make_direction_blind_qa_sheet.py`, and `measure_direction_continuity.py`.

Expected: the atlas is exactly `1536x2288`, unused cells are transparent, used cells are populated, and deterministic validation passes.

### Task 7: Run independent semantic and final visual QA

**Files:**
- Create: `output/pets/paddington-soft-cinematic-3d/qa/direction-blind-verdicts-{1,2,3}.json`
- Create: `output/pets/paddington-soft-cinematic-3d/qa/direction-blind-verdicts.json`
- Create: `output/pets/paddington-soft-cinematic-3d/qa/direction-blind-validation.json`
- Create: `output/pets/paddington-soft-cinematic-3d/qa/direction-semantics.json`
- Create when needed: `output/pets/paddington-soft-cinematic-3d/qa/blind-review-resolution.json`

**Interfaces:**
- Consumes: the unlabeled blind sheet for three isolated reviewers and the full labeled QA set for one fresh final reviewer.
- Produces: cardinal hard-gate evidence, per-direction semantic verdicts, and final independent visual acceptance.

- [ ] **Step 1: Collect three isolated blind classifications**

Each worker sees only `qa/direction-blind-pairs.png` and returns every requested A/B axis classification. Save the three JSON objects separately, then run `combine_direction_blind_verdicts.py` and `validate_direction_blind_verdicts.py`.

Expected: both cardinal pairs pass; intermediate uncertainty is retained as review evidence.

- [ ] **Step 2: Record all 16 labeled semantic verdicts**

Create `qa/direction-semantics.json` with `verdict`, `expected`, `observed`, and `reason` for every direction from `000` through `337.5`, including separate horizontal and vertical evidence for diagonals.

- [ ] **Step 3: Run one fresh final visual QA worker**

The worker inspects both contact sheets, direction sheet, GIF previews, semantic verdicts, blind validation, continuity report, standard review, and v2 validation.

Expected: `visual_qa=pass`; any major failure regenerates the complete containing row, while only documented minor warnings may be accepted.

### Task 8: Package, install, summarize, and retain QA

**Files:**
- Create in workspace: `output/pets/paddington-soft-cinematic-3d/package/paddington/pet.json`
- Create in workspace: `output/pets/paddington-soft-cinematic-3d/package/paddington/spritesheet.webp`
- Create: `output/pets/paddington-soft-cinematic-3d/qa/run-summary.json`
- Install with approval: `/Users/rehaanshaw/.codex/pets/paddington/pet.json`
- Install with approval: `/Users/rehaanshaw/.codex/pets/paddington/spritesheet.webp`

**Interfaces:**
- Consumes: the passing final v2 WebP and all acceptance evidence.
- Produces: one installed custom pet plus a retained workspace package and QA summary.

- [ ] **Step 1: Build the workspace package**

Copy `final/spritesheet-extended.webp` to `package/paddington/spritesheet.webp` and write `package/paddington/pet.json` with id `paddington`, display name `Paddington`, the prepared description, `spriteVersionNumber: 2`, and `spritesheetPath: "spritesheet.webp"`.

- [ ] **Step 2: Verify the package before installation**

```bash
jq -e '.id == "paddington" and .spriteVersionNumber == 2 and .spritesheetPath == "spritesheet.webp"' /Users/rehaanshaw/spotterai/output/pets/paddington-soft-cinematic-3d/package/paddington/pet.json
cmp /Users/rehaanshaw/spotterai/output/pets/paddington-soft-cinematic-3d/final/spritesheet-extended.webp /Users/rehaanshaw/spotterai/output/pets/paddington-soft-cinematic-3d/package/paddington/spritesheet.webp
```

Expected: both commands exit successfully.

- [ ] **Step 3: Install both package files together**

After obtaining permission to write outside the workspace, create `/Users/rehaanshaw/.codex/pets/paddington` and copy both package files into it.

- [ ] **Step 4: Write the run summary and clean intermediates**

Write `qa/run-summary.json` with `ok: true`, all required retained artifact paths, the package path, and `spriteVersionNumber: 2`. Remove prompts, layout guides, decoded row strips, extracted frames, PNG intermediates, the 8-by-9 atlas, and the image-generation manifest only after installation and summary verification succeed.

- [ ] **Step 5: Run final completion verification**

Re-run v2 atlas validation on the installed spritesheet, check the installed manifest, confirm retained QA files exist, and report the workspace run directory plus installed package directory.
