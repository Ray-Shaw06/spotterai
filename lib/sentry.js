/**
 * SpotterAI — Sentry reporter
 * ============================================================================
 * A zero-dependency client for Sentry's envelope endpoint, shared by the
 * browser modules and the serverless functions.
 *
 * Why not @sentry/browser: the app is served as raw ES modules with no build
 * step, so an npm SDK could not reach the browser without introducing a
 * bundler — which is the one thing the README promises this project does not
 * have. The envelope API is a documented HTTP endpoint and the useful part of
 * it fits in this file. No source maps are needed either, because there is no
 * transform: the frames Sentry shows are the files in this repo.
 *
 * Three properties, in priority order — the same ones api/audit-telemetry.js
 * holds to, for the same reasons:
 *
 *   1. It cannot hurt a user. Every path is fire-and-forget and every failure
 *      is swallowed. A Sentry outage, a bad DSN, or a blocked request must be
 *      invisible in the UI.
 *   2. It cannot leak anything personal. This app has no accounts and keeps
 *      training data on-device, so an error report is the one thing that
 *      leaves the machine. URLs are stripped to origin + path, and nothing
 *      reads localStorage, cookies, or the profile.
 *   3. It cannot exhaust the free tier. The student plan is 50k events for the
 *      YEAR, and one render loop can produce that in a minute. Hence the
 *      per-fingerprint dedupe and the hard per-session cap below.
 *
 * With no DSN configured every entry point returns false and sends nothing, so
 * this is inert until someone opts in.
 */

/** Sentry accepts up to 200; a UI bug that fires more is a bug, not telemetry. */
export const MAX_EVENTS_PER_SESSION = 20;
const MAX_VALUE_CHARS = 1000;
const MAX_FRAMES = 50;

/**
 * Split a DSN into the pieces the envelope endpoint needs.
 * Shape: https://<publicKey>@<host>/<projectId>
 * Returns null for anything unparseable, which is what makes a typo'd DSN
 * degrade to "off" rather than to an exception on startup.
 */
export function parseDsn(dsn) {
  if (typeof dsn !== "string" || dsn.trim() === "") return null;
  let url;
  try {
    url = new URL(dsn.trim());
  } catch {
    return null;
  }
  const publicKey = url.username;
  const projectId = url.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!publicKey || !projectId || !/^\d+$/.test(projectId)) return null;
  return {
    publicKey,
    projectId,
    endpoint: `${url.protocol}//${url.host}/api/${projectId}/envelope/` +
      `?sentry_key=${encodeURIComponent(publicKey)}&sentry_version=7`,
  };
}

/**
 * Origin + pathname only. The app routes on the hash (#/import, #/evals), so
 * the hash is kept — it is the page name — but any query string on either side
 * of it is dropped, because that is where an id or a token would ride.
 */
export function scrubUrl(raw) {
  if (typeof raw !== "string" || raw === "") return undefined;
  try {
    const url = new URL(raw);
    const hash = url.hash.split("?")[0];
    return `${url.origin}${url.pathname}${hash}`;
  } catch {
    return undefined;
  }
}

/**
 * Parse a V8 stack string into Sentry frames.
 *
 * Both runtimes this ships to are V8 (Chrome and Node), so the two V8 shapes
 * are all that is handled: "at fn (file:line:col)" and "at file:line:col".
 * Anything else yields no frames and the raw stack is kept in extra instead —
 * a worse UI, but never a wrong one.
 *
 * Sentry renders frames oldest-first, which is the reverse of how V8 prints.
 */
export function parseStack(stack) {
  if (typeof stack !== "string" || stack === "") return [];
  const frames = [];
  for (const line of stack.split("\n")) {
    const text = line.trim();
    if (!text.startsWith("at ")) continue;
    const withFn = text.match(/^at\s+(.+?)\s+\((.+):(\d+):(\d+)\)$/);
    const bare = text.match(/^at\s+(.+):(\d+):(\d+)$/);
    if (withFn) {
      frames.push({
        function: withFn[1],
        filename: withFn[2],
        lineno: Number(withFn[3]),
        colno: Number(withFn[4]),
      });
    } else if (bare) {
      frames.push({ filename: bare[1], lineno: Number(bare[2]), colno: Number(bare[3]) });
    }
  }
  return frames.reverse().slice(-MAX_FRAMES);
}

/**
 * A stable identity for "the same error again": type, message, and the frame
 * it was thrown from. Used only to dedupe within one session.
 */
export function fingerprint(event) {
  const value = event?.exception?.values?.[0] || {};
  const frames = value.stacktrace?.frames || [];
  const top = frames[frames.length - 1];
  return [value.type, value.value, top?.filename, top?.lineno].join("|");
}

/** Normalize whatever was thrown into { type, value }. Anything can be thrown. */
function describeThrown(thrown) {
  if (thrown instanceof Error) {
    return { type: thrown.name || "Error", value: String(thrown.message).slice(0, MAX_VALUE_CHARS), stack: thrown.stack };
  }
  if (typeof thrown === "string") return { type: "Error", value: thrown.slice(0, MAX_VALUE_CHARS), stack: "" };
  let rendered;
  try {
    rendered = JSON.stringify(thrown);
  } catch {
    rendered = String(thrown);
  }
  return { type: "Error", value: String(rendered).slice(0, MAX_VALUE_CHARS), stack: "" };
}

/**
 * Build the event body. Pure: the caller supplies the id and the clock, so a
 * test can assert on the whole object.
 */
export function buildEvent(thrown, options = {}) {
  const { eventId, timestamp, platform = "javascript", release, environment, url, tags, extra } = options;
  const described = describeThrown(thrown);
  const frames = parseStack(described.stack);

  const value = { type: described.type, value: described.value };
  if (frames.length > 0) value.stacktrace = { frames };

  const event = {
    event_id: eventId,
    timestamp: timestamp ?? new Date().toISOString(),
    platform,
    level: "error",
    exception: { values: [value] },
  };
  if (release) event.release = release;
  if (environment) event.environment = environment;

  const scrubbed = scrubUrl(url);
  if (scrubbed) event.request = { url: scrubbed };
  if (tags && Object.keys(tags).length > 0) event.tags = tags;

  // When the stack could not be parsed the raw string is still worth having.
  const bag = { ...(extra || {}) };
  if (frames.length === 0 && described.stack) bag.stack = String(described.stack).slice(0, 4000);
  if (Object.keys(bag).length > 0) event.extra = bag;

  return event;
}

/** Newline-delimited envelope: envelope header, item header, item payload. */
export function buildEnvelope(event, sentAt = new Date().toISOString()) {
  return [
    JSON.stringify({ event_id: event.event_id, sent_at: sentAt }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(event),
  ].join("\n");
}

function newEventId() {
  try {
    return crypto.randomUUID().replace(/-/g, "");
  } catch {
    let out = "";
    for (let i = 0; i < 32; i += 1) out += Math.floor(Math.random() * 16).toString(16);
    return out;
  }
}

/**
 * Build a reporter bound to one DSN.
 *
 * `transport` and `now` are injected so the tests never touch the network, and
 * so the serverless side can await delivery while the browser side does not.
 */
export function createReporter(options = {}) {
  const { dsn, release, environment, platform = "javascript", tags, transport, maxEvents = MAX_EVENTS_PER_SESSION } = options;
  const parsed = parseDsn(dsn);
  const seen = new Set();
  let sent = 0;

  const send = transport || ((endpoint, body) => {
    // keepalive matters: an error thrown during unload is exactly the one worth
    // having, and without it the request dies with the page.
    fetch(endpoint, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/x-sentry-envelope" },
      keepalive: true,
      mode: "cors",
    }).catch(() => {});
  });

  function captureException(thrown, context = {}) {
    if (!parsed) return false;
    try {
      if (sent >= maxEvents) return false;
      const event = buildEvent(thrown, {
        eventId: newEventId(),
        platform,
        release,
        environment,
        url: context.url,
        tags: { ...(tags || {}), ...(context.tags || {}) },
        extra: context.extra,
      });
      const print = fingerprint(event);
      if (seen.has(print)) return false;
      seen.add(print);
      sent += 1;
      return send(parsed.endpoint, buildEnvelope(event)) ?? true;
    } catch {
      // A reporter that throws while reporting is strictly worse than one that
      // stays quiet, so this catch is the whole point of the function.
      return false;
    }
  }

  return { enabled: parsed !== null, captureException, endpoint: parsed?.endpoint };
}
