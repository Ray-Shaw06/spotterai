# Single Plan Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the guided “Build my plan” onboarding the only plan-building entry point, while revealing the existing audit/results area only after generation starts or a saved plan is restored.

**Architecture:** Keep the existing static single-page application and event boundary between `onboarding-ui.js` and `app.js`. Remove the duplicate inline form from `index.html`, let `spotter:generate` remain the sole source of new generator inputs, cache those inputs in `app.js` for retries, and use the existing `#generator` section only as a hidden-until-needed results destination. Do not change the Vercel APIs, evaluator, Firebase/profile storage, persistence schema, router, PWA service worker, or hosting.

**Tech Stack:** HTML, CSS, native browser JavaScript modules, Node.js built-in test runner, Vercel local development server.

## Global Constraints

- Preserve the current guided onboarding fields, mappings, validation, and `spotter:generate` contract.
- Preserve all AI endpoints and fallback behavior, evaluator/repair behavior, Firebase sync, profile switching, saved-plan restore, PWA registration/offline behavior, and Vercel deployment.
- Do not migrate frameworks, add dependencies, or change hosting.
- Preserve unrelated user changes in `package.json` and `package-lock.json`.
- Follow test-driven development: add and run a failing regression test before changing production files.
- Keep `#generator` as the stable results anchor, but never show a blank audit/results panel before the user starts generation.
- Respect reduced-motion settings for all programmatic scrolling.

---

### Task 1: Lock the single-entry experience with a failing regression test

**Files:**

- Modify: `test/ui-copy.test.js`
- Test: `test/ui-copy.test.js`

- [ ] **Step 1: Add the failing static regression test**

  Append a test that makes the intended HTML contract explicit:

  ```js
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
  ```

- [ ] **Step 2: Run the focused test and confirm it fails for the expected reason**

  Run: `node --test test/ui-copy.test.js`

  Expected: FAIL because `index.html` still contains `id="plan-form"`, “Build your program,” and an initially visible `#generator` section.

---

### Task 2: Remove the duplicate form and make the generator results-only

**Files:**

- Modify: `index.html:53`
- Modify: `index.html:111`
- Modify: `index.html:282-394`
- Modify: `style.css:2005-2020`
- Test: `test/ui-copy.test.js`

- [ ] **Step 1: Give the skip link a destination that is always present**

  Change the skip link to target the main content and add the matching ID:

  ```html
  <a class="skip-link" href="#main-content">Skip to main content</a>
  ...
  <main id="main-content">
  ```

  This prevents keyboard users from landing on a section that is intentionally hidden before generation.

- [ ] **Step 2: Remove the inline plan form and hide the results section initially**

  Replace the generator opening and duplicate form block with:

  ```html
  <!-- ===================== PLAN RESULTS ===================== -->
  <section id="generator" class="section" hidden>
    <div class="container generator generator--results-only">
      <!-- Results area (swaps between empty / loading / error / results) -->
  ```

  Keep the existing `#results` element and all empty/loading/error/success descendants intact. The section-level `hidden` attribute ensures none of those panels appear before onboarding starts.

- [ ] **Step 3: Update the dormant empty-state copy**

  Change the empty-state instruction from “Fill in the form and hit generate” to language that matches the remaining entry point:

  ```html
  Choose “Build my plan” to answer a few quick questions. You'll get a full weekly program plus a transparent safety score with every flagged concern explained.
  ```

  The state remains useful as an internal reset state, even though the enclosing section is hidden during reset.

- [ ] **Step 4: Center the results-only layout**

  Keep the existing `.generator` rule for compatibility and add a narrow override immediately after it:

  ```css
  .generator--results-only {
    display: block;
    max-width: 1080px;
  }
  ```

  Do not broadly remove form/chip styles: the application has other forms and the onboarding uses shared input primitives.

- [ ] **Step 5: Run the focused regression test**

  Run: `node --test test/ui-copy.test.js`

  Expected: PASS.

- [ ] **Step 6: Commit the regression guard with the markup and layout change**

  Stage only `test/ui-copy.test.js`, `index.html`, and `style.css`, then commit with:

  ```text
  feat: make onboarding the only plan builder
  ```

---

### Task 3: Drive generation and reset behavior entirely from onboarding

**Files:**

- Modify: `app.js:1-13`
- Modify: `app.js:27-40`
- Modify: `app.js:92-133`
- Modify: `app.js:183-239`
- Modify: `app.js:248-281`
- Modify: `app.js:667-707`
- Modify: `app.js:794-798`
- Test: `test/ui-copy.test.js`

- [ ] **Step 1: Remove inline-form dependencies**

  Delete the `form` and `generateBtn` element references, `getFormData()`, `wireInjuryExclusivity()`, the form submit listener, and the final `wireInjuryExclusivity()` call. Update the file header so the documented flow starts with guided onboarding rather than form submission.

- [ ] **Step 2: Add results-section visibility helpers**

  Add a reference beside the state elements:

  ```js
  const generatorSection = document.getElementById("generator");
  ```

  Add helpers after `showState`:

  ```js
  function revealGenerator({ scroll = false } = {}) {
    generatorSection.hidden = false;
    if (scroll) {
      generatorSection.scrollIntoView({
        behavior: prefersReducedMotion ? "auto" : "smooth",
        block: "start",
      });
    }
  }

  function hideGenerator() {
    generatorSection.hidden = true;
  }
  ```

- [ ] **Step 3: Require onboarding or cached inputs for generation**

  Refactor `generate` so it never tries to read a removed form:

  ```js
  async function generate(inputsOverride) {
    const inputs = inputsOverride || lastInputs;
    if (!inputs) {
      window.dispatchEvent(new CustomEvent("spotter:onboarding"));
      return;
    }

    lastInputs = inputs;
    revealGenerator({ scroll: true });
    showState("loading");
    startLoadingSteps();
    // Existing API, fallback, publish, and rendering logic stays unchanged.
  }
  ```

  Remove all `generateBtn.disabled` writes from success and error paths. Revealing and scrolling before the fetch gives immediate feedback when onboarding closes.

- [ ] **Step 4: Ensure every rendered plan reveals the results section**

  Call `revealGenerator()` at the start of `renderResults`. This covers successful generation, saved-plan restoration, profile switching, plan repair, plan editing, and adaptive re-renders. Keep the current `focus: false` option for restored/profile plans so background state restoration does not move the user.

- [ ] **Step 5: Make retry use cached inputs and Start over reopen onboarding**

  Keep retry as `generate()` so it uses `lastInputs`. Replace the existing regenerate handler with:

  ```js
  regenerateBtn.addEventListener("click", () => {
    if (adaptCard) adaptCard.hidden = true;
    showState("empty");
    hideGenerator();
    window.dispatchEvent(new CustomEvent("spotter:onboarding"));
  });
  ```

  This gives “Start over” one clear meaning: clear the visible result and return to the guided intake.

- [ ] **Step 6: Hide the section when switching to a profile with no plan**

  In the `spotter:plan` no-plan branch, call `hideGenerator()` after `showState("empty")`. Leave saved-plan restore unchanged apart from its new reveal through `renderResults`.

- [ ] **Step 7: Run focused and full automated tests**

  Run: `node --test test/ui-copy.test.js`

  Expected: PASS.

  Run: `npm test`

  Expected: all tests pass, including the new single-entry regression.

- [ ] **Step 8: Commit the controller change**

  Stage only `app.js`, then commit with:

  ```text
  refactor: generate plans from guided onboarding
  ```

---

### Task 4: Verify the complete user flow without changing deployment architecture

**Files:**

- Verify: `index.html`
- Verify: `app.js`
- Verify: `onboarding-ui.js`
- Verify: `style.css`
- Verify: `service-worker.js`

- [ ] **Step 1: Run the full regression suite from a clean command invocation**

  Run: `npm test`

  Expected: exit code 0 with every test passing.

- [ ] **Step 2: Start the existing Vercel development server**

  Run: `npm run dev`

  Use the local URL printed by Vercel. Do not replace Vercel with another hosting/runtime setup.

- [ ] **Step 3: Verify the fresh desktop flow in a browser**

  At a desktop viewport:

  1. Open the home page with no saved plan.
  2. Confirm “Build your program” and the inline form are absent.
  3. Confirm no blank audit/results card is visible.
  4. Activate the hero “Build my plan” CTA and confirm guided onboarding opens.
  5. Complete the required goal and safety acknowledgement; skip optional steps if desired.
  6. Confirm onboarding closes, the loading state is immediately revealed, and the page scrolls to it.
  7. Confirm a generated or saved-fallback plan renders with its deterministic audit.
  8. Activate “Start over” and confirm the results disappear and onboarding reopens.
  9. Close onboarding and confirm the page does not expose a blank results panel.

- [ ] **Step 4: Verify the mobile flow**

  Repeat the CTA → onboarding → loading/results → Start over flow at approximately 390 CSS pixels wide. Confirm the modal remains usable, results occupy the available width, and no duplicate builder appears.

- [ ] **Step 5: Verify persistence and preserved boundaries**

  1. Restore or generate a plan, reload, and confirm the saved plan appears without an automatic scroll/focus jump.
  2. Switch to a profile with no plan and confirm the results section hides.
  3. Confirm network requests still target the existing `api/generate` endpoint.
  4. Confirm `service-worker.js`, API files, Firebase modules/configuration, evaluator, and persistence schema have no diff.

- [ ] **Step 6: Review the final diff and status**

  Run: `git diff --check`

  Run: `git status --short`

  Expected: no whitespace errors; only the intended feature files plus the user’s pre-existing unrelated package changes are present.

- [ ] **Step 7: Commit any verification-only test adjustment if needed**

  If browser verification exposed a missing regression guard, add the smallest test-only change, rerun `npm test`, and commit it separately with:

  ```text
  test: cover plan entry interaction
  ```

  Otherwise, do not create an empty commit.

---

### Task 5: Final self-review and handoff

**Files:**

- Review: all changes since `92f0fcf`

- [ ] **Step 1: Compare the final implementation to the approved design**

  Confirm each requirement in `docs/superpowers/specs/2026-07-16-single-plan-entry-design.md` is satisfied, especially immediate loading feedback, cached retry inputs, no-scroll saved restoration, Start over behavior, and the hidden initial results area.

- [ ] **Step 2: Inspect the scoped diff**

  Run: `git diff 92f0fcf -- index.html app.js style.css test/ui-copy.test.js docs/superpowers/plans/2026-07-16-single-plan-entry.md`

  Check for accidental copy changes, dead element references, broadened architecture, or unrelated edits.

- [ ] **Step 3: Report the verified outcome**

  Summarize the user-visible change, automated test result, browser checks, and explicitly note that Vercel, APIs, Firebase sync, the evaluator, and PWA behavior were preserved.
