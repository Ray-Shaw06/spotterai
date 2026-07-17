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
const notificationUi = readFileSync(join(root, "notification-ui.js"), "utf8");
const notificationGuidance = readFileSync(join(root, "notification-guidance.js"), "utf8");
const reminders = readFileSync(join(root, "reminders.js"), "utf8");
const workoutUi = readFileSync(join(root, "workout-ui.js"), "utf8");
const quickLog = readFileSync(join(root, "quick-log.js"), "utf8");
const demoData = readFileSync(join(root, "demo-data.js"), "utf8");

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

test("results offer notifications inline only beside the first-workout action", () => {
  const firstWorkout = html.indexOf('id="start-first-workout"');
  const offer = html.indexOf('id="notification-offer"');
  const adapt = html.indexOf('id="adapt-card"');
  assert.ok(firstWorkout >= 0 && offer > firstWorkout && offer < adapt);
  assert.equal((html.match(/id="notification-offer"/g) || []).length, 1);
  assert.match(html, /Enable notifications/);
  assert.doesNotMatch(html, /id="reminders-toggle"|local notification when you open/i);
});

test("the notification offer listens only to a genuinely new live plan event", () => {
  assert.match(app, /if \(!usedFallback\) window\.dispatchEvent\(new CustomEvent\("spotter:plan-generated"\)\);/);
  assert.match(notificationUi, /addEventListener\("spotter:plan-generated"/);
  assert.match(notificationUi, /addEventListener\("spotter:plan"/);
  assert.match(notificationUi, /spotter:plan"[^\n]+renderAccount|onPlan[^\n]+renderAccount|handlePlan/);
});

test("shared notification editor covers schedule, quiet hours, categories, and account actions", () => {
  assert.match(notificationUi, /renderPreferenceEditor/);
  for (const copy of [
    "Planned workout reminder",
    "Follow-up if still unlogged",
    "Streak-protection reminder",
    "Next-morning recovery check-in",
    "Quiet hours start",
    "Quiet hours end",
  ]) assert.ok(notificationUi.includes(copy), copy);
  for (const copy of ["Enable notifications", "Save changes", "Pause notifications", "Delete notifications"]) assert.ok(html.includes(copy), copy);
  assert.match(reminders, /initNotificationUI/);
});

test("Account provides a deliberate enable path for an unsubscribed eligible device", () => {
  assert.match(html, /id="notification-account-enable"[^>]*>Enable notifications</);
  assert.match(notificationUi, /accountEnable\?\.addEventListener\("click", handleAccountEnable\)/);
  assert.match(notificationUi, /accountEnable:\s*account\.enable/);
  assert.match(notificationUi, /hasPlan:\s*Boolean\(store\.plan\)/);
  assert.match(notificationUi, /spotter:plan-generated/);
  assert.match(notificationUi, /getPlan:\s*\(\) => store\.plan/);
});

test("a successful offer becomes an enabled state and cannot re-register", () => {
  assert.match(notificationUi, /elements\.enable\.disabled = surface === "account" \? accountState\.enableDisabled : subscribed \|\| editorDisabled/);
  assert.match(notificationUi, /Notifications are enabled\. Manage the schedule in Account\./);
});

test("denial and save errors restore a usable, capability-aware control state", () => {
  assert.match(notificationUi, /catch \(error\) \{\s*renderSurface\(surface, result\.value\);/);
  assert.match(notificationUi, /catch \(error\) \{\s*renderSurface\("account", current\);/);
  assert.match(notificationUi, /function surfaceControlState\([\s\S]{0,500}notificationCapability\(globalThis\)/);
  assert.match(notificationUi, /setSurfaceBusy\("offer", false\)/);
});

test("prompt analytics is emitted only by the client permission callback", () => {
  assert.match(notificationUi, /onPermissionPrompt:\s*\(\) => trackFunnel\("notification_prompted"/);
  assert.doesNotMatch(notificationUi, /if \(willPrompt\) trackFunnel\("notification_prompted"/);
});

test("Account proposal is expanded until subscribed and preflight status is neutral", () => {
  assert.match(notificationUi, /disclosure:\s*surface === "account" && subscribed/);
  assert.match(notificationUi, /Checking notification setup…/);
  assert.match(notificationUi, /Waiting for your browser permission…/);
});

test("boot and visible resume recheck availability, renew authorization, and retry time-zone migration", () => {
  assert.match(notificationUi, /visibilitychange/);
  assert.match(notificationUi, /documentTarget\.visibilityState === "visible"/);
  assert.match(notificationUi, /renewNotificationAuthorizationIfNeeded\(\)/);
  assert.match(notificationUi, /Notification authorization could not be renewed\. Return to the app to retry\./);
  assert.match(notificationUi, /timezoneMigrationController\.run\(\)/);
});

test("notification mutations share a centralized busy-state cleanup", () => {
  assert.match(notificationUi, /createAccountMutationController\(\{ setBusy \}\)/);
  assert.match(notificationUi, /Promise\.resolve\(result\)\.finally\(\(\) => \{/);
  assert.match(notificationUi, /elements\.section\.setAttribute\("aria-busy", String\(value\)\)/);
  assert.match(notificationUi, /setBusy:\s*\(value\) => \{[\s\S]{0,160}setSurfaceBusy\("account", value\);[\s\S]{0,100}setSurfaceBusy\("offer", value\);/);
  assert.match(notificationUi, /if \(accountMutationController\.isBusy\(\)\) setSurfaceBusy\(surface, true\);/);
  for (const kind of ["availability", "save", "delete"]) {
    assert.match(notificationUi, new RegExp(`accountMutationController\\.run\\("${kind}"`));
  }
});

test("unsupported and denied notification copy gives exact recovery guidance", () => {
  assert.match(notificationUi, /Safari → Share → Add to Home Screen/);
  assert.match(notificationUi, /install or add SpotterAI[^.]*then open the installed app/i);
  assert.match(notificationGuidance, /iPhone[^.]*Settings app[^.]*SpotterAI[^.]*Allow Notifications/i);
  assert.match(notificationGuidance, /Android[^.]*Settings[^.]*Apps[^.]*SpotterAI[^.]*Notifications/i);
  assert.doesNotMatch(notificationGuidance, /browser settings/i);
});

test("notification opens and workout completion cross only privacy-safe boundaries", () => {
  assert.match(notificationUi, /notification_opened/);
  assert.match(notificationUi, /history\.replaceState/);
  assert.match(workoutUi, /syncWorkoutCompletion\(workout\.date\)\.catch\(\(\) => \{\}\)/);
  assert.match(quickLog, /syncWorkoutCompletion\(workout\.date\)\.catch\(\(\) => \{\}\)/);
  assert.doesNotMatch(workoutUi, /updateWorkout\([^;]+;[\s\S]{0,240}syncWorkoutCompletion/);
  assert.doesNotMatch(demoData, /syncWorkoutCompletion|notification-client/);
  assert.doesNotMatch(`${workoutUi}\n${quickLog}`, /syncWorkoutCompletion\((?:workout\b(?!\.date)|exercises|durationSec|session|painToday|store)/);
});
