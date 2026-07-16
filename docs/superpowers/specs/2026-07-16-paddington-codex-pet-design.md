# Paddington Codex Pet Design

## Goal

Create a highly recognizable Paddington-inspired Codex desktop pet in a soft cinematic 3D style. The pet must preserve the familiar character identity while remaining compact, readable, and mechanically consistent across the complete Codex v2 animation atlas.

## Visual identity

- Warm medium-brown natural fur with a lighter muzzle and small rounded ears.
- Soft red felt bucket hat with a slightly irregular brim.
- Royal-blue wool duffle coat with three light wooden toggles, a visible collar, and compact pockets.
- Small, worn brown leather suitcase held consistently in the bear's left paw; the right paw remains available for waving and expressive gestures.
- Warm, dark, glassy eyes; a black nose; a gentle, earnest expression; and compact whole-body proportions with a slightly oversized head.
- Soft cinematic 3D materials and lighting, with clean sprite edges and no cast or contact shadow.
- No logos, scenery, readable luggage-tag text, captions, or detached decorative effects.

The generated artwork should be a faithful, immediately recognizable interpretation rather than a pixel-for-pixel copy of a particular official still.

## Animation design

The atlas contains the nine standard Codex rows: idle, running-right, running-left, waving, jumping, failed, waiting, running, and review. Idle uses subtle breathing, blinking, and a tiny hat/fur response. Directional running uses a clear alternating gait while the suitcase remains attached. Running-left is generated separately so the suitcase does not switch paws through mirroring.

Waving uses the free right paw without motion lines. Jumping changes body height without shadows or landing effects. Failed uses a small attached emotional reaction only. Waiting reads as politely expectant. Running shows focused task work rather than literal running. Review uses eyes, head angle, and restrained paw movement without adding props or UI.

## Look-direction mechanics

The feet, lower coat, and suitcase grip form the stable anchor. The eyes lead each gaze, followed by a small head and muzzle turn, then subtle ear, hat-brim, and upper-coat follow-through. The suitcase stays attached and lags only slightly. Cardinal directions must read unmistakably as up, screen-right, down, and screen-left; the intermediate poses form an even clockwise 16-direction loop without whole-sprite rotation.

## Production and validation

The Hatch Pet workflow generates a canonical base image, nine standard animation strips, one four-cardinal anchor strip, and two coherent eight-pose look rows. Deterministic assembly produces a transparent 8-by-11 atlas of 192-by-208 cells, exactly 1536 by 2288 pixels.

Acceptance requires consistent identity and materials, complete and distinct motion, unclipped silhouettes, no detached effects, successful chroma cleanup, passing v2 atlas validation, three isolated blind direction reviews, labeled direction semantics, continuity review, and independent final visual QA.

## Deliverables

- A packaged custom pet with `spriteVersionNumber: 2`.
- `pet.json` and `spritesheet.webp` installed together in the Codex custom-pet directory.
- Final contact sheet, direction sheet, animation previews, validation reports, and run summary retained as QA artifacts.
