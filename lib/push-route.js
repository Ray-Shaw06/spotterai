/**
 * HTTP helpers shared by the two push routes, api/rest-push.js and
 * api/reminders.js. Moved out of api/rest-push.js unchanged, apart from
 * callbackUrl taking the route's path, so both routes read bodies, headers and
 * their own callback address the same way.
 */

/**
 * The URL QStash must call back.
 *
 * Read from the SERVER's own environment, never from a request header. A
 * header-derived origin is an open relay: a POST carrying
 * `X-Forwarded-Host: attacker.example` would have this server book a delayed,
 * Upstash-signed POST to a host the operator never chose, on the operator's
 * quota. It also defeats the callback's audience check, since an attacker who
 * controls the header controls what `sub` is compared against.
 *
 * `VERCEL_PROJECT_PRODUCTION_URL` and `VERCEL_URL` are set by the platform, not
 * by the caller. `REST_PUSH_ORIGIN` is the escape hatch for a custom domain or
 * for running this anywhere else. Null means we cannot name ourselves, and
 * every path that needs a callback refuses rather than guessing.
 */
export function callbackUrl(path, env = process.env) {
  const explicit = String(env.REST_PUSH_ORIGIN || "").trim();
  const platform = String(env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL || "").trim();
  const raw = explicit || (platform ? `https://${platform}` : "");
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  return `${url.origin}${path}`;
}

/** The raw body as a string. text/plain arrives as-is; JSON arrives parsed. */
export function rawBody(raw) {
  if (raw == null) return "";
  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  if (typeof raw === "string") return raw;
  try {
    return JSON.stringify(raw);
  } catch {
    return "";
  }
}

export function parseJson(raw) {
  const text = rawBody(raw);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function queryParam(req, name) {
  const fromQuery = req.query?.[name];
  if (typeof fromQuery === "string") return fromQuery;
  try {
    return new URL(String(req.url || ""), "https://localhost").searchParams.get(name);
  } catch {
    return null;
  }
}

export function header(req, name) {
  const value = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Publishes allowed per UTC day, per serverless instance. See DAILY_PUBLISH_CAP
 * in api/rest-push.js for why a per-instance count is still worth having.
 */
export function dailyCap(limit) {
  let day = "";
  let count = 0;
  return {
    claim(nowMs) {
      const today = new Date(nowMs).toISOString().slice(0, 10);
      if (today !== day) {
        day = today;
        count = 0;
      }
      if (count >= limit) return false;
      count += 1;
      return true;
    },
    reset() {
      day = "";
      count = 0;
    },
  };
}
