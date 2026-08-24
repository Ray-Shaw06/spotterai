/**
 * SpotterAI — browser error reporting
 * ============================================================================
 * Wires lib/sentry.js to the two events that catch what nothing else does:
 * an uncaught error and an unhandled promise rejection.
 *
 * The DSN is read from a <meta> tag rather than an env var, because there is
 * no build step to substitute one in. A Sentry DSN's public key is designed to
 * be public — it ships in the client of every Sentry install — so committing
 * it is normal. Leave the tag empty and nothing is sent.
 *
 * This module is loaded FIRST in index.html so that an error thrown while a
 * later module is still evaluating is still caught.
 */

import { createReporter } from "./lib/sentry.js";

function readDsn() {
  return document.querySelector('meta[name="sentry-dsn"]')?.content?.trim() || "";
}

/** localhost and 127.0.0.1 are the developer's own console, not an incident. */
function isProduction() {
  return !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
}

export const reporter = createReporter({
  dsn: isProduction() ? readDsn() : "",
  environment: "production",
  platform: "javascript",
  tags: { surface: "browser" },
});

export function captureException(error, context = {}) {
  return reporter.captureException(error, { url: location.href, ...context });
}

if (reporter.enabled) {
  window.addEventListener("error", (event) => {
    // event.error is absent for cross-origin script errors, where the browser
    // gives us only "Script error." — noise, and not ours to fix.
    if (event.error) captureException(event.error, { tags: { kind: "onerror" } });
  });

  window.addEventListener("unhandledrejection", (event) => {
    captureException(event.reason, { tags: { kind: "unhandledrejection" } });
  });
}
