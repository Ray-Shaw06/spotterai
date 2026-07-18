# SpotterAI Release 2 Design — Form Check Sessions

Date: 2026-07-18
Status: Approved by owner in conversation on 2026-07-18
Production baseline: `6a4d674` (`origin/main`)
Deployment: Existing Vercel project

## Purpose

Release 1's form check is live-only: cues appear on screen during the set and
vanish when the camera stops. That works for exercises you can watch while
performing (squat, curl), but fails for exercises where you physically cannot
look at the screen mid-set — pull-ups being the canonical case. Release 2 makes
every form-check session reviewable after the fact: a recorded session produces
a report with per-rep results, highlights of where form was good or bad, and
concrete tips — plus new exercises (pull-up, dip) that only make sense with
after-the-fact review.

## Product principles (inherited from Release 1, all still binding)

- All consumer features stay free.
- Privacy by default: video and pose data never leave the device. No new
  server storage, no uploads, no per-user cloud cost.
- Honest limitations: a single 2D camera gives heuristic cues, not a coach's
  eye. The report states this where the user will see it.
- Deterministic over generative: report content (scores, highlights, tips)
  comes from the existing pure cue engine, not from an unchecked LLM call.
- Safety boundaries unchanged: the pain stop button and its messaging keep
  priority over every new surface.

## Scope

Release 2 includes:

1. **Session timeline capture** — while the camera runs, a pure recorder
   collects per-rep records (timestamp, depth verdict, active cues,
   confidence) and session aggregates (cue frequency, best/worst rep).
2. **Post-session report** — shown after Stop when at least one rep was
   counted: rep count, per-rep timeline with good/warn markers, cue
   frequency summary ("hips sagging — 4 of 10 reps"), and deterministic
   tips derived from the most frequent warnings.
3. **New exercises** — pull-up and dip entries in the existing evaluator
   grammar (rep gate + metrics + cues + depth feedback), unit-tested.
4. **Local video recording with highlight scrubbing** — MediaRecorder
   captures the camera stream on-device for the duration of the session.
   The report embeds playback with timestamped markers at flagged and best
   reps; tapping a marker seeks the video. The recording lives in memory
   for the current session only, is never uploaded, and is discarded when
   the user leaves the report.

Release 2 does not include:

- Uploading video or pose data anywhere.
- Persistent video storage across sessions (IndexedDB session history is a
  candidate for a later release once size management is designed).
- LLM-generated report prose (the deterministic tips must exist first; an
  optional AI polish can layer on later without changing the data).
- Bench press form analysis (lying posture defeats the current side-on
  camera heuristics; deferred until a dedicated approach is designed).
- Any change to notification, nutrition, or plan-generation systems.

## User flows

### Record and review (primary)

1. User opens Form Check, picks Pull-up, taps Start.
2. Camera runs exactly as today (skeleton, live cues, rep counter). A small
   "REC" indicator shows the session is being captured on-device.
3. User does the set — without needing to watch the screen.
4. User taps Stop (or the pain button, which keeps its current behavior and
   priority). If ≥1 rep was counted, the report renders in place of the
   live readout.
5. Report shows: rep count, per-rep strip (each rep a good/warn chip with
   its verdict), cue frequency list, tips, and — when recording succeeded —
   the video with highlight markers. Tapping a rep or marker seeks the
   video to just before that rep.
6. Leaving the page or starting a new session discards the previous
   report and recording.

### Degraded paths

- **MediaRecorder unsupported / errors**: the report still renders fully
  from the pose timeline; the video area shows "Recording isn't supported
  on this browser" instead of failing the session.
- **Zero reps counted**: no report; the current "Camera stopped." status
  stands.
- **Low confidence throughout**: per-rep verdicts already collapse to
  "Unable to judge" via the existing confidence gate; the report says the
  camera angle limited feedback rather than inventing verdicts.
- **Pain stop**: the pain message keeps its current priority; the report
  renders below it, never above it.

## Acceptance criteria

1. `npm test` passes with new coverage for the session recorder, the
   pull-up and dip evaluators, and report rendering.
2. A session with mixed-quality reps produces a report whose per-rep
   verdicts match the live feedback the user saw, from the same data.
3. Cue frequency lines are counts from the recorded timeline — never
   fabricated ("X of N reps" is arithmetically true).
4. Tips are deterministic functions of the recorded cues; the same session
   data always yields the same tips.
5. Pull-up and dip rep gates count clean test sequences correctly and the
   confidence gate refuses judgment on poor visibility, as existing
   exercises do.
6. Video playback markers seek within the recorded clip on tap; the
   feature degrades to a text note when MediaRecorder is unavailable.
7. No network request carries video or pose data (verifiable: the feature
   works fully offline once the pose model is cached).
8. Mobile layout verified at 390px; report controls hit 44px targets.
9. Service worker cache bumped; production serves the new files.

## Verification

- Unit: `node --test` suites for form-session.js, new evaluator entries,
  and report DOM rendering (jsdom-free, string-level like existing UI
  tests where possible).
- Manual: browser preview session with simulated reps; mobile-width check;
  offline check.
- Deploy: Vercel deployment watched to `success`; production spot-check of
  served files and SW cache version.
