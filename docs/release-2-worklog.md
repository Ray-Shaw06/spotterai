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
| Current phase | Planning complete; Task 1 (session timeline capture) in progress. |

## Gate status

| Gate | Status | Evidence or next action |
| --- | --- | --- |
| Scope approved in conversation | Complete | Owner approved the recorded-session report + pull-up direction on 2026-07-18 |
| Design + plan written | Complete | Both documents committed on the release branch |
| Task 1 — session timeline capture | In progress | |
| Task 2 — post-session report UI | Pending | |
| Task 3 — pull-up + dip evaluators | Pending | |
| Task 4 — local video recording + highlights | Pending | |
| Full automated verification | Pending | |
| Mobile-width check | Pending | |
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
