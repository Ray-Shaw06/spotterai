/**
 * SpotterAI — /api/csp-report
 * ============================================================================
 * Where the browser sends Content-Security-Policy violations. The policy ships
 * report-only (vercel.json) and `test/pwa.test.js` refuses to enforce it until
 * violations have been observed. Until this existed nothing was listening, so
 * "observed" was impossible. This is the listener.
 *
 * Delivery is Sentry, not Vercel logs and not Firestore: Vercel's log
 * retention is too short to cover the week the policy needs to be watched, and
 * Firestore Spark's write quota is shared with user sync. The reporter dedupes
 * on the message, so one noisy violation is one Sentry event, not thousands.
 *
 * Properties, in priority order:
 *   1. It cannot hurt a user. Every path answers 204, so a bad report or a
 *      Sentry outage is invisible.
 *   2. It stores nothing personal. URLs are cut to origin + path (no query, so
 *      no token rides along) and only a fixed set of fields is read.
 *   3. It cannot be used to drain anything. Public and unauthenticated by
 *      necessity (the browser sends it), so it is rate limited per IP and the
 *      body is size-capped before parsing.
 *
 * Browser extensions inject scripts into every page and trip CSP constantly.
 * Their reports say nothing about this app, so they are dropped.
 */

import { enforceRateLimit } from "../lib/rate-limit.js";
import { createServerReporter } from "../lib/sentry-server.js";
import { scrubUrl } from "../lib/sentry.js";

const MAX_BODY_CHARS = 8_000;
const MAX_REPORTS_PER_REQUEST = 10;
const FIELD_CHARS = 200;

const EXTENSION_SCHEME = /^(chrome|moz|safari|safari-web|ms-browser)-extension:/i;

let reporter;
const sharedReporter = () => (reporter ||= createServerReporter());
/** Test seam: swap the Sentry reporter for a fake. */
export function __setReporterForTests(r) {
  reporter = r;
}

const clip = (v) => (typeof v === "string" ? v.slice(0, FIELD_CHARS) : "");

/** A blocked resource as a URL we may keep, or the bare keyword ("inline", "eval"). */
function describeBlocked(raw) {
  const s = clip(raw);
  if (!s) return "";
  if (EXTENSION_SCHEME.test(s)) return "extension";
  // data: and blob: URIs can be huge or carry content; the scheme is the signal.
  if (/^(data|blob):/i.test(s)) return s.split(":")[0].toLowerCase();
  return scrubUrl(s) || s.replace(/[?#].*$/, "");
}

/**
 * Normalise both wire formats into one list of plain violations.
 *   - `application/csp-report`:  { "csp-report": { "violated-directive": ... } }
 *   - `application/reports+json`: [ { type: "csp-violation", body: { effectiveDirective: ... } } ]
 * Returns [] for anything unrecognised.
 */
export function parseReports(raw) {
  let body = raw;
  if (Buffer.isBuffer(body)) body = body.toString("utf8");
  if (typeof body === "string") {
    if (body.length > MAX_BODY_CHARS) return [];
    try {
      body = JSON.parse(body);
    } catch {
      return [];
    }
  }
  if (!body || typeof body !== "object") return [];

  const out = [];
  const add = (r) => {
    if (!r || typeof r !== "object") return;
    const directive = clip(r.effectiveDirective || r["effective-directive"] || r.violatedDirective || r["violated-directive"]);
    if (!directive) return;
    const blocked = describeBlocked(r.blockedURL ?? r.blockedUri ?? r["blocked-uri"]);
    if (blocked === "extension") return;
    const source = clip(r.sourceFile ?? r["source-file"]);
    if (EXTENSION_SCHEME.test(source)) return;
    out.push({
      directive: directive.split(/\s+/)[0],
      blocked: blocked || "(none)",
      page: scrubUrl(clip(r.documentURL ?? r.documentUri ?? r["document-uri"])) || "",
      source: source ? describeBlocked(source) : "",
      line: Number.isFinite(Number(r.lineNumber ?? r["line-number"])) ? Number(r.lineNumber ?? r["line-number"]) : undefined,
      disposition: clip(r.disposition) || "report",
    });
  };

  if (Array.isArray(body)) {
    for (const item of body) if (item?.type === "csp-violation") add(item.body);
  } else if (body["csp-report"]) {
    add(body["csp-report"]);
  } else if (body.type === "csp-violation") {
    add(body.body);
  }
  return out.slice(0, MAX_REPORTS_PER_REQUEST);
}

async function handler(req, res) {
  const method = String(req.method || "GET").toUpperCase();
  if (method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }
  if (enforceRateLimit("cspReport", req, res)) return;

  for (const v of parseReports(req.body)) {
    // The message is the dedupe key: the same blocked thing on the same page is
    // one event however many browsers report it.
    await sharedReporter().captureException(`CSP ${v.directive} blocked ${v.blocked} on ${v.page || "?"}`, {
      tags: { route: "csp-report", directive: v.directive },
      extra: v,
    });
  }
  return res.status(204).end();
}

export { handler as __handlerForTests };
export default handler;
