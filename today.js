/**
 * SpotterAI — Today screen logic (pure)
 * ============================================================================
 * The decision logic behind the Today home base, extracted from today-ui.js so
 * it's unit-testable without a DOM: which workout is "today's", and the
 * plain-English coach note derived from real logs + limitations.
 */

export const isRestDay = (d) => /\b(rest|recovery|off day|day off)\b/i.test(`${d?.day || ""} ${d?.focus || ""}`);
export const trainingDays = (plan) => (plan?.days || []).filter((d) => !isRestDay(d));

/**
 * The next recommended workout in the plan's rotation (by sessions logged this
 * week) — or null once the week's training days are DONE. Honest rest beats
 * prescribing a 5th session in a 4-day plan.
 */
export function todaysWorkout(plan, sessionsThisWeek = 0) {
  const days = trainingDays(plan);
  if (!days.length) return null;
  if (sessionsThisWeek >= days.length) return null; // week complete → rest
  return days[sessionsThisWeek % days.length];
}

/**
 * Week-at-a-glance: one chip per planned training session, in order, marked
 * done / today / upcoming. Pure data for the Today strip.
 */
export function weekStrip(plan, sessionsThisWeek = 0) {
  const days = trainingDays(plan);
  return days.map((d, i) => ({
    label: d.focus || d.day || `Session ${i + 1}`,
    state: i < sessionsThisWeek ? "done" : i === sessionsThisWeek ? "today" : "upcoming",
  }));
}

/**
 * A supportive, non-shaming coach note. Conservative + limitation-aware: an
 * active injury caps volume; otherwise it nudges consistency or a small
 * progression based on real session counts. Never shames a missed day.
 */
export function coachNote({ sessions = 0, target = 0, lastWeekSessions = 0, injuries = [] } = {}) {
  const inj = (injuries || []).filter((v) => v && v !== "none");
  if (inj.length) {
    return { tone: "warn", text: `Your ${inj.join(" / ")} limitation is active, so SpotterAI caps related volume today and offers joint-friendly swaps. Stop and check in if anything hurts.` };
  }
  if (target && sessions >= target) {
    return { tone: "ok", text: `You've hit ${sessions}/${target} sessions this week: strong consistency. Keep intensity controlled and prioritise recovery.` };
  }
  if (target && lastWeekSessions >= target) {
    return { tone: "ok", text: "You completed last week's sessions, so SpotterAI suggests a small, gradual progression rather than a big jump." };
  }
  if (target && sessions < target) {
    return { tone: "info", text: `${sessions}/${target} sessions done this week. Today's workout keeps you on track: short and consistent beats heroic and sporadic.` };
  }
  return { tone: "info", text: "Log today's session to start building the habit. Consistency is the goal, not perfection." };
}
