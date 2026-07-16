# Single Plan Entry Design

## Goal

Make guided onboarding the only plan-building experience. Remove the duplicate inline “Build your program” form while preserving plan generation, fallback behavior, audits, saved plans, adaptation, Firebase sync, the PWA, and Vercel deployment.

## User flow

1. Every “Build my plan” entry point opens the existing guided onboarding dialog.
2. Closing onboarding before completion leaves the landing page unchanged.
3. Completing onboarding closes the dialog, reveals the results section in its loading state, and scrolls it into view.
4. Successful generation renders and focuses the audit/results as it does today. A failed live request still uses the saved-plan fallback; a terminal failure shows the existing error state.
5. “Try again” resubmits the last onboarding inputs. “Start over” clears the visible result state and reopens onboarding.
6. A saved plan restored on page load reveals the results section without moving the user’s scroll position.

## Interface changes

- Delete the inline `#plan-form` and its “Build your program” copy from the home page.
- Keep `#generator` as the stable results anchor, but hide the section until generation starts or a saved plan is restored.
- Present the results column as a centered, full-width results surface rather than one side of a form/results grid.
- Retarget the skip link to the main content because the results anchor may initially be hidden.
- Make generation accept onboarding inputs only; retries use the cached last submission instead of reading removed form controls.
- Keep all existing `data-onboard` entry points and the guided onboarding fields unchanged.

## Accessibility and failure handling

- Move keyboard focus to the results region after a completed generation, preserving reduced-motion behavior.
- Reveal and scroll to the loading state immediately after onboarding so users receive feedback during the network wait.
- Keep the existing polite live region, fallback notice, safety boundary, and error messaging.
- Do not expose a blank or empty audit panel before a user starts onboarding.

## Verification

- Add a regression test proving the inline builder and `#plan-form` are absent and guided onboarding is the only builder.
- Test that the results section is initially hidden and all plan CTAs still use `data-onboard`.
- Run the complete Node test suite.
- Verify in a browser that the hero CTA opens onboarding, completion reveals and scrolls to loading/results, retry preserves the prior inputs, start-over reopens onboarding, and saved-plan restoration does not force a scroll.
- Check desktop and mobile layouts for a centered results surface with no leftover empty column.

## Constraints

- No framework or hosting migration.
- No changes to serverless APIs, prompt construction, evaluator behavior, Firebase, service worker, manifest, or persistence schemas.
- Preserve unrelated working-tree changes.
