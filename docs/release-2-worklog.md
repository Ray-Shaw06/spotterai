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
| Current phase | Tasks 1–4 complete and committed (`3f9cb68` report, `992da7b` pull-up/dip, `c17f09e` recording). Full suite 483/483. Production promotion pending. |

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
| Production promotion | Pending | |
| Physical-device video check (iPhone) | Owner-gated | No physical device in this workspace; degraded no-video path makes shipping safe regardless |

## Decisions

| Date | Decision | Reason |
| --- | --- | --- |
| 2026-07-18 | Report is generated from the pose timeline, not from the video. | The cue engine is already pure and tested; video is playback-only. Deterministic report content honors the "don't blindly trust the AI" value. |
| 2026-07-18 | Video stays in memory for the current session only; no upload, no IndexedDB persistence yet. | Privacy by default and zero cost. Cross-session storage needs a size-management design first. |
| 2026-07-18 | mp4-first MediaRecorder mime selection, webm fallback, timeline-only degraded path. | iOS Safari prefers mp4; the report must never fail because recording did. |
| 2026-07-18 | Pull-up cues use bilateral joint averages and skip torso-lean rules. | Pull-ups are filmed front-on; side-on heuristics would fire nonsense cues. |
| 2026-07-18 | Bench press deferred. | Lying posture defeats the current camera heuristics; needs its own design. |

## Verification evidence

(recorded per task as work completes)

## Blockers

(none)
