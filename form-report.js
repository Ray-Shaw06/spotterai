/**
 * SpotterAI — Form Report (pure code)
 * ============================================================================
 * Builds the post-set report markup from a SessionRecorder summary. Pure
 * string in, string out — no DOM access — so the arithmetic the user reads
 * ("4 of 8 reps") is unit-testable at the exact HTML that ships.
 *
 * The report answers, after the set, what the live overlay answered during
 * it: which reps were good, which were flagged and why, and what to work on.
 * Exercises like pull-ups make this the only usable feedback surface — you
 * can't watch a screen mid-rep.
 */

function esc(t) {
  return String(t == null ? "" : t)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function mmss(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const MAX_FINDINGS = 5;
const MAX_MARKERS = 7;
const SEEK_LEAD_S = 1.5; // land just before the rep so the viewer sees it happen

/**
 * MediaRecorder container preference: mp4 first (iOS Safari), then webm.
 * Takes the isTypeSupported predicate so it stays pure and testable.
 */
export function pickRecorderMime(isTypeSupported) {
  for (const t of ["video/mp4", "video/webm;codecs=vp9", "video/webm"]) {
    try {
      if (isTypeSupported(t)) return t;
    } catch {
      /* a throwing predicate is the same as "not supported" */
    }
  }
  return null;
}

/**
 * Highlight markers for the session recording: the best rep plus flagged reps,
 * capped so a rough set doesn't produce a wall of buttons. Seek times land
 * slightly before the rep and never below zero.
 */
export function markersFor(summary) {
  const byRep = new Map(summary.repRecords.map((r) => [r.rep, r]));
  const markers = [];
  if (summary.bestRep != null && byRep.has(summary.bestRep)) {
    markers.push({ rep: summary.bestRep, kind: "best" });
  }
  for (const rep of summary.flaggedReps) {
    if (rep !== summary.bestRep) markers.push({ rep, kind: "flagged" });
    if (markers.length >= MAX_MARKERS) break;
  }
  return markers.map((m) => {
    const r = byRep.get(m.rep);
    return {
      ...m,
      atMs: r.atMs,
      seekS: Math.max(0, r.atMs / 1000 - SEEK_LEAD_S),
      label: `${m.kind === "best" ? "Best — rep" : "Rep"} ${m.rep} · ${mmss(r.atMs)}`,
    };
  });
}

/** Markup for the session-recording block (video src is attached by the caller). */
export function videoHTML(markers) {
  const buttons = markers
    .map(
      (m) =>
        `<button type="button" class="marker-btn${m.kind === "best" ? " marker-btn--best" : ""}" data-seek="${m.seekS}">${esc(m.label)}</button>`
    )
    .join("");
  return `<div class="form-report__block form-video">
      <h4 class="form-report__heading">Session recording</h4>
      <video class="form-video__player" playsinline controls preload="metadata"></video>
      ${markers.length ? `<div class="form-video__markers">${buttons}</div>` : ""}
      <p class="form-report__note form-video__note">Recorded on this device only — never uploaded, gone when you leave or start a new set.</p>
    </div>`;
}

/**
 * @param {object} summary  SessionRecorder#summary()
 * @param {string} exerciseLabel  e.g. "Squat"
 * @param {Array}  tips  tipsFor(summary)
 * @param {object} [opts]  { adaptive } — the auto counter has no form rules
 * @returns {string} innerHTML for the #form-report card
 */
export function reportHTML(summary, exerciseLabel, tips, opts = {}) {
  const { reps, judgedReps, repRecords, cueFrequency, bestRep, worstRep, durationMs } = summary;

  const head = `
    <header class="form-report__head">
      <h3 class="form-report__title">Set report — ${esc(exerciseLabel)}</h3>
      <p class="form-report__meta">${reps} rep${reps === 1 ? "" : "s"} · ${mmss(durationMs)}${
        opts.adaptive ? "" : ` · judged ${judgedReps} of ${reps}`
      }</p>
    </header>`;

  // The auto counter deliberately has no form rules — say so, don't pretend.
  if (opts.adaptive) {
    return `${head}
    <p class="form-report__note">Rep counting only — pick a specific lift to get form analysis and a full report.</p>`;
  }

  const chips = repRecords
    .map((r) => {
      const state = !r.judged ? "unjudged" : r.verdict.level === "good" && !r.cues.some((c) => c.level === "warn") ? "good" : "warn";
      const marks = [r.rep === bestRep ? "Best rep" : "", r.rep === worstRep ? "Needs the most work" : ""].filter(Boolean);
      const title = [...marks, !r.judged ? "Unable to judge" : r.verdict.text].join(" — ");
      const best = r.rep === bestRep ? " rep-chip--best" : "";
      return `<span class="rep-chip rep-chip--${state}${best}" role="listitem" title="${esc(title)}">${r.rep}</span>`;
    })
    .join("");

  const warns = cueFrequency.filter((e) => e.level === "warn").slice(0, MAX_FINDINGS);
  const bestGood = cueFrequency.find((e) => e.level === "good");
  const findingLine = (e) =>
    `<li class="form-finding form-finding--${e.level}">${esc(e.text)} <span class="form-finding__count">${e.reps} of ${reps} rep${reps === 1 ? "" : "s"}</span></li>`;
  const clean =
    judgedReps > 0 && !warns.length
      ? `<p class="form-report__clean">Clean set — no recurring form flags.</p>`
      : "";
  const findings =
    warns.length || bestGood || clean
      ? `<div class="form-report__block">
      <h4 class="form-report__heading">What the camera saw</h4>
      ${clean}
      ${warns.length || bestGood ? `<ul class="form-report__findings">${[bestGood ? findingLine(bestGood) : "", ...warns.map(findingLine)].join("")}</ul>` : ""}
    </div>`
      : "";

  const tipsBlock = tips.length
    ? `<div class="form-report__block">
      <h4 class="form-report__heading">Work on next</h4>
      <ul class="form-report__tips">${tips
        .map((t) => `<li><strong>${esc(t.finding)}</strong> — ${esc(t.tip)}</li>`)
        .join("")}</ul>
    </div>`
    : "";

  const angleHint = opts.angle ? `A ${String(opts.angle).toLowerCase()}, full-body view helps.` : "A full-body view helps.";
  const lowJudged =
    judgedReps < reps
      ? `<p class="form-report__note">${reps - judgedReps} rep${reps - judgedReps === 1 ? " was" : "s were"} not judged — camera angle or visibility was too limited. ${esc(angleHint)}</p>`
      : "";

  return `${head}
    <div class="form-report__block">
      <h4 class="form-report__heading">Rep by rep</h4>
      <div class="form-report__reps" role="list" aria-label="Rep-by-rep results">${chips}</div>
    </div>
    ${findings}
    ${tipsBlock}
    ${lowJudged}
    <p class="form-report__note">Estimated from a single camera — a mirror, not a judge. Nothing was uploaded.</p>`;
}
