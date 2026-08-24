/**
 * SpotterAI — serverless error reporting
 * ============================================================================
 * The Node half of lib/sentry.js. Kept in its own file because it reads
 * process.env, and lib/sentry.js is imported by the browser.
 *
 * The one thing that makes this different from the browser side: delivery has
 * to be AWAITED. A Vercel function's execution is frozen the moment its
 * response is sent, so a fire-and-forget POST is simply lost. Every capture
 * here therefore blocks on the request, with a short timeout so a slow Sentry
 * can never become a slow API.
 */

import { createReporter } from "./sentry.js";

/** Long enough for a normal ingest round trip, short enough to never be felt. */
const SEND_TIMEOUT_MS = 2000;

async function awaitedTransport(endpoint, body) {
  try {
    await fetch(endpoint, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/x-sentry-envelope" },
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    return true;
  } catch {
    return false;
  }
}

export function createServerReporter(env = process.env, transport = awaitedTransport) {
  return createReporter({
    dsn: env.SENTRY_DSN || "",
    // Vercel sets these; locally they are absent and the fields are omitted.
    release: env.VERCEL_GIT_COMMIT_SHA || undefined,
    environment: env.VERCEL_ENV || "development",
    platform: "node",
    tags: { surface: "api" },
    transport,
  });
}

let shared;
function sharedReporter() {
  if (!shared) shared = createServerReporter();
  return shared;
}

/**
 * Wrap a Vercel handler so an unhandled throw is reported before it surfaces.
 *
 * The response contract is unchanged: the error is re-thrown after reporting,
 * so the platform still produces its own 500 and no handler's own error
 * handling is bypassed. Reporting failure is swallowed — an outage at Sentry
 * must not turn a working endpoint into a broken one.
 */
export function withSentry(handler, options = {}) {
  const { reporter = null, route } = options;
  return async function sentryWrappedHandler(req, res) {
    try {
      return await handler(req, res);
    } catch (error) {
      try {
        await (reporter || sharedReporter()).captureException(error, {
          tags: { route: route || "unknown", method: req?.method || "unknown" },
        });
      } catch {
        // Reporting is best-effort; the throw below is the real contract.
      }
      throw error;
    }
  };
}
