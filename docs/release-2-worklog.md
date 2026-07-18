# SpotterAI Release 2 Worklog

Version-controlled source of truth for Release 2 progress, decisions,
verification evidence, and remaining work. No secrets, personal data, or raw
AI content.

## Release baseline

| Item | Value |
| --- | --- |
| Production baseline | `6a4d674` (`origin/main`) |
| Release branch | `claude/release-2` |
| Design | `docs/superpowers/specs/2026-07-18-release-2-design.md` |
| Implementation plan | `docs/superpowers/plans/2026-07-18-release-2.md` |
| Current phase | Shipped. Merge `ee942fd` live in production; only the owner-gated physical-device video check remains open. |

## Gate status

| Gate | Status | Evidence or next action |
| --- | --- | --- |
| Scope approved in conversation | Complete | Owner approved the recorded-session report + pull-up direction on 2026-07-18 |
| Design + plan written | Complete | Both documents committed on the release branch |
| Task 1 — session timeline capture | Complete | `form-session.js` + 13-test suite; per-rep cue windows keep "N of M reps" arithmetically true |
| Task 2 — post-session report UI | Complete | `form-report.js` pure HTML builder + `#form-report` card; escaping, adaptive degradation, and arithmetic tested at the shipped markup |
| Task 3 — pull-up + dip evaluators | Complete | Bilateral pull-up metrics, chin-over-bar proxy, swing cue, dip elbow grammar; 9 new evaluator tests |
| Task 4 — local video recording + highlights | Complete | mp4-first MediaRecorder on the existing stream; markers verified seeking a real recorded blob in preview (click → currentTime 1.0s) |
| Full automated verification | Complete | 483/483 (`npm test`) after all four tasks |
| Mobile-width check | Complete | 390px: no horizontal overflow, report single-column, 44px marker buttons |
| Production promotion | Complete | Merge `ee942fd` deployed via GitHub deployment `5500156865` → `success`. Production serves SW `spotterai-v39`, the pull-up/dip options, the `#form-report` container, and `form-session.js` / `form-report.js` (HTTP 200) at `spotterai-flax.vercel.app`. |
| Physical-device video check (iPhone) | Owner-gated | No physical device in this workspace; degraded no-video path makes shipping safe regardless |

## Decisions

| Date | Decision | Reason |
| --- | --- | --- |
| 2026-07-18 | Report is generated from the pose timeline, not from the video. | The cue engine is already pure and tested; video is playback-only. Deterministic report content honors the "don't blindly trust the AI" value. |
| 2026-07-18 | Video stays in memory for the current session only; no upload, no IndexedDB persistence yet. | Privacy by default and zero cost. Cross-session storage needs a size-management design first. |
| 2026-07-18 | mp4-first MediaRecorder mime selection, webm fallback, timeline-only degraded path. | iOS Safari prefers mp4; the report must never fail because recording did. |
| 2026-07-18 | Pull-up cues use bilateral joint averages and skip torso-lean rules. | Pull-ups are filmed front-on; side-on heuristics would fire nonsense cues. |
| 2026-07-18 | Bench press deferred. | Lying posture defeats the current camera heuristics; needs its own design. |
| 2026-07-18 | Camera-angle guidance is per exercise, driven by what each rule set measures. | Owner feedback: blanket "side-on" instructions were wrong for front-view lifts. Pull-up stays front-on (not from behind, despite gym convention) because chin-over-bar tracking needs the nose landmark; the UI explains this. Follow-up commit `d2463fe`, SW v40, deployment `5500531478` → success. |

## Verification evidence

(recorded per task as work completes)

## Blockers

(none)
