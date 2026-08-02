/**
 * UI copy / label guardrails — read index.html as text and assert the
 * user-facing positioning and navigation stay consistent. These are cheap
 * regression guards, not a DOM test.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "index.html"), "utf8");
const app = readFileSync(join(root, "app.js"), "utf8");
const nutritionUi = readFileSync(join(root, "nutrition-ui.js"), "utf8");
const router = readFileSync(join(root, "router.js"), "utf8");
const onboardingUi = readFileSync(join(root, "onboarding-ui.js"), "utf8");
const reminders = readFileSync(join(root, "reminders.js"), "utf8");
const calendarExport = readFileSync(join(root, "calendar-export.js"), "utf8");
const workoutAlerts = readFileSync(join(root, "workout-alerts.js"), "utf8");
const workoutUi = readFileSync(join(root, "workout-ui.js"), "utf8");
const quickLog = readFileSync(join(root, "quick-log.js"), "utf8");
const demoData = readFileSync(join(root, "demo-data.js"), "utf8");
const safetyLab = readFileSync(join(root, "safety-lab.js"), "utf8");

// Imported, not read as text: the landing page advertises a check count and
// shows a mock audit, and both must agree with what the evaluator really does.
const { evaluatePlan } = await import("../evaluator.js");

// ============================================================================
// The landing page makes two numeric claims about the evaluator. Found live on
// spotterai.xyz by /qa on 2026-08-02: the hero mock read "0 critical, 2
// warnings, 3 suggestions, 5/7 passed" (the parts sum to 10, not 7) and the
// facts line advertised 6 checks while the evaluator ran 10. On a page whose
// entire claim is a deterministic auditor you can check, marketing numbers that
// contradict the code are the most expensive kind of typo. Derived from
// evaluatePlan so they cannot drift again.
// ============================================================================

/** A plain, valid week. Enough to make the evaluator emit its full check set. */
function samplePlan() {
  const ex = (name, sets, reps) => ({ name, sets, reps, rpe: 8, notes: "" });
  return {
    program_name: "Sample",
    goal: "Hypertrophy",
    days_per_week: 4,
    progression: "Add 2.5kg to the main lift when you hit the top of the rep range on every set.",
    general_notes: "",
    days: [
      { day: "Day", focus: "Push", exercises: [ex("Barbell Bench Press", 4, "6-8"), ex("Overhead Press", 3, "8-10")] },
      { day: "Day", focus: "Pull", exercises: [ex("Barbell Row", 4, "6-8"), ex("Lat Pulldown", 3, "10-12")] },
      { day: "Day", focus: "Legs", exercises: [ex("Back Squat", 4, "6-8"), ex("Romanian Deadlift", 3, "8-10")] },
      { day: "Rest", focus: "Rest", exercises: [] },
    ],
  };
}

test("the advertised check count matches how many checks the evaluator runs", () => {
  const advertised = Number(html.match(/<strong>(\d+)<\/strong>\s*automated safety/)?.[1]);
  assert.ok(Number.isInteger(advertised), "could not read the advertised check count from index.html");

  // No injuries declared, so checkInjuries contributes nothing: this is the
  // count every plan gets, which is what the landing page is claiming.
  const audit = evaluatePlan(samplePlan(), { goal: "Hypertrophy", experience: "Intermediate" });
  assert.equal(
    advertised,
    audit.checks.length,
    `index.html advertises ${advertised} checks but evaluatePlan returns ${audit.checks.length}`
  );
});

test("the hero audit mock obeys the evaluator's own summary invariant", () => {
  const num = (label) => {
    const m = html.match(new RegExp(`<strong>([\\d/]+)</strong>\\s*${label}`));
    assert.ok(m, `could not read "${label}" from the hero audit card`);
    return m[1];
  };
  const critical = Number(num("critical"));
  const warnings = Number(num("warnings"));
  const suggestions = Number(num("suggestions?"));
  const [passed, total] = num("passed").split("/").map(Number);

  // Exactly the invariant asserted against real audits in evaluator.test.js.
  assert.equal(
    critical + warnings + suggestions + passed,
    total,
    `hero mock: ${critical}+${warnings}+${suggestions}+${passed} != ${total}`
  );

  // And the verdict line must be the one auditVerdictText would actually
  // produce for those counts: warnings lead when there are no criticals.
  const verdict = html.match(/audit-card__verdict-line">([^<]+)</)?.[1] || "";
  assert.equal(critical, 0, "mock assumes a no-critical audit");
  assert.match(verdict, new RegExp(`^${warnings} issues? to review before training`));
});

test("nav uses 'Safety Lab', not the old 'Evals' label", () => {
  assert.ok(html.includes("<span>Safety Lab</span>"), "Safety Lab nav label present");
  assert.ok(!html.includes("<span>Evals</span>"), "old Evals nav label gone");
  assert.ok(router.includes("Safety Lab · SpotterAI"));
});

test("a 'Today' daily home base exists in the nav and routes", () => {
  assert.ok(html.includes("<span>Today</span>"), "Today nav label present");
  assert.ok(/data-view="today"/.test(html), "Today view present");
  assert.ok(router.includes('"today"'), "today route registered");
});

test("a Pain Mode modal exists", () => {
  assert.ok(/id="pain-modal"/.test(html));
});

test("privacy copy discloses configured cloud, analytics, and AI data paths", () => {
  assert.doesNotMatch(safetyLab, /there are no third-party trackers/i);
  assert.match(safetyLab, /Firebase/i);
  assert.match(safetyLab, /Vercel (Web )?Analytics/i);
  assert.match(safetyLab, /Gemini/i);
  assert.match(safetyLab, /Groq/i);
  assert.match(safetyLab, /meal photo|food description/i);
  assert.match(safetyLab, /quick.log|plain.language log/i);
});

test("an Exercise Library exists in the nav, routes, and has a detail modal", () => {
  assert.ok(html.includes("<span>Library</span>"), "Library nav label present");
  assert.ok(/data-view="library"/.test(html), "Library view present");
  assert.ok(router.includes('"library"'), "library route registered");
  assert.ok(/id="exercise-modal"/.test(html), "exercise detail modal present");
});

test("positioning is the AI fitness copilot promise, not the old coach line", () => {
  assert.ok(/AI fitness copilot/i.test(html), "copilot positioning present");
  // The old tagline must be gone from user-facing copy (title + footer).
  assert.ok(!/coach that audits its own safety/i.test(html), "old tagline removed");
});

test("footer carries the full copilot description", () => {
  assert.ok(/AI fitness copilot that helps you build plans/i.test(html));
});

test("homepage has the three user scenario cards", () => {
  assert.ok(/See how SpotterAI handles real training situations/i.test(html));
  for (const t of ["Healthy beginner", "Knee limitation", "Inconsistent training logs"]) {
    assert.ok(html.includes(t), `scenario card present: ${t}`);
  }
});

test("homepage has the 'What not to trust SpotterAI for' limitations section", () => {
  assert.ok(/What not to trust SpotterAI for/i.test(html));
  assert.ok(/Diagnosing pain or injuries/i.test(html));
  assert.ok(/still help you create a more conservative general plan/i.test(html));
});

test("guided onboarding is the only plan builder on the landing page", () => {
  assert.ok(!/id="plan-form"/.test(html), "duplicate inline plan form removed");
  assert.ok(!/Build your program/i.test(html), "duplicate builder heading removed");
  assert.match(
    html,
    /<section id="generator" class="section" hidden>/,
    "results section starts hidden"
  );

  const buildPlanLinks = [...html.matchAll(/<a\b([^>]*)>Build my plan<\/a>/g)];
  assert.ok(buildPlanLinks.length >= 2, "hero and final plan CTAs remain present");
  for (const [, attributes] of buildPlanLinks) {
    assert.match(attributes, /data-onboard/, "every Build my plan CTA opens onboarding");
  }
});

test("the plan controller reveals results and returns Start over to onboarding", () => {
  assert.ok(!/getElementById\("plan-form"\)/.test(app), "controller no longer depends on the removed form");
  assert.ok(!/getElementById\("generate-btn"\)/.test(app), "controller no longer depends on the removed form button");
  assert.match(app, /const inputs = inputsOverride \|\| lastInputs;/, "retry reuses the last onboarding inputs");
  assert.match(app, /generatorSection\.hidden = false;/, "generation reveals the results section");
  assert.match(app, /generatorSection\.hidden = true;/, "reset hides the results section");
  assert.match(app, /new CustomEvent\("spotter:onboarding"\)/, "Start over reopens guided onboarding");
});

test("AI recovery keeps retries user-actionable without provider error copy", () => {
  assert.match(html, /id="fallback-retry-btn"[^>]*>Try live generation again</);
  assert.match(app, /fetchWithTimeout\("api\/generate"/);
  assert.match(app, /assertPlanShape\(data\?\.plan\)/);
  assert.match(app, /aiFailureMessage\("plan", failureClass, \{ fallback: true \}\)/);
  assert.match(nutritionUi, /Try this photo again/);
  assert.match(nutritionUi, /lastPhotoFile/);
});

test("onboarding labels measurement systems and explains optional measurement use", () => {
  assert.ok(onboardingUi.includes('label: "Metric"'));
  assert.ok(onboardingUi.includes('label: "Imperial"'));
  assert.ok(onboardingUi.includes("Optional. Weight can help set a starting nutrition range; height is saved only while you complete setup."));
});

test("invalid optional measurements also disable the About You skip control", () => {
  assert.match(onboardingUi, /skipBtn\.disabled = !canAdvance\(\);/);
});

test("plan results offer a calendar export beside the first-workout action, not remote notifications", () => {
  const firstWorkout = html.indexOf('id="start-first-workout"');
  const calendar = html.indexOf('id="calendar-export"');
  const adapt = html.indexOf('id="adapt-card"');
  assert.ok(firstWorkout >= 0 && calendar > firstWorkout && calendar < adapt);
  assert.match(html, /Add workouts to calendar/);
  // The retired Web Push offer copy and IDs are gone.
  assert.doesNotMatch(html, /id="notification-offer"|Enable notifications|Pause notifications|Delete notifications/);
});

test("calendar export copy is honest: the user's own calendar owns reminders, nothing is sent", () => {
  assert.match(html, /own calendar app owns the reminders/i);
  assert.match(html, /SpotterAI sends nothing and stores nothing/i);
  assert.match(calendarExport, /BEGIN:VCALENDAR/);
  assert.match(calendarExport, /RRULE:FREQ=WEEKLY/);
});

test("Account exposes a local on-device rest-alert toggle, not a remote schedule editor", () => {
  assert.match(html, /id="account-workout-alerts"/);
  assert.match(html, /Enable rest-timer alerts/);
  assert.match(html, /nothing is sent when the app is closed/i);
  // No leftover schedule/quiet-hours/category editor copy.
  assert.doesNotMatch(html, /Quiet hours|Streak-protection reminder|id="notification-account-enable"/);
});

test("workout alerts make no closed-app promise and stay fully on-device", () => {
  assert.match(workoutAlerts, /notifyRestComplete/);
  assert.doesNotMatch(workoutAlerts, /PushManager|VAPID|subscribe|fetch\(/i);
  assert.match(reminders, /initWorkoutAlertsUI/);
  assert.match(reminders, /initCalendarExport/);
});

test("workout completion no longer syncs to any notification backend", () => {
  assert.doesNotMatch(`${workoutUi}\n${quickLog}`, /syncWorkoutCompletion|notification-client/);
  assert.doesNotMatch(demoData, /syncWorkoutCompletion|notification-client/);
  // Rest-timer completion routes to the local alert helper instead.
  assert.match(workoutUi, /notifyRestComplete\(\)\.catch\(\(\) => \{\}\)/);
});
