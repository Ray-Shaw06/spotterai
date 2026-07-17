import { randomBytes as secureRandomBytes } from "node:crypto";
import {
  createDeviceToken,
  createEndpointFingerprint,
  verifyDeviceToken,
} from "../lib/notification-auth.js";
import {
  createNotificationStore,
  NotificationLeaseConflictError,
  RegistrationCapError,
  RegistrationUnavailableError,
} from "../lib/notification-store.js";
import {
  hasOwn,
  isCompletionDate,
  isRecord,
  validateNotificationConfig,
  validatePreferences,
  validatePushSubscription,
} from "../lib/notification-validation.js";

const ROUTE = "/api/notifications";
const ALLOWED_METHODS = Object.freeze(["GET", "POST", "PATCH", "DELETE"]);
const MAX_BODY_BYTES = 32 * 1024;
const AUTHORIZATION_LIFETIME_MS = 180 * 24 * 60 * 60 * 1000;

function getHeader(req, name) {
  const headers = req?.headers;
  if (!headers || typeof headers !== "object") return undefined;
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
}

function bodyByteLength(body) {
  if (body === undefined || body === null) return 0;
  if (Buffer.isBuffer(body)) return body.length;
  if (typeof body === "string") return Buffer.byteLength(body, "utf8");
  try {
    return Buffer.byteLength(JSON.stringify(body), "utf8");
  } catch {
    return Infinity;
  }
}

function parseBody(body) {
  if (body === undefined || body === null || body === "") return {};
  if (Buffer.isBuffer(body)) body = body.toString("utf8");
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return null;
    }
  }
  return isRecord(body) ? body : null;
}

function bearerToken(req) {
  const authorization = getHeader(req, "authorization");
  if (typeof authorization !== "string") return null;
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(authorization);
  return match?.[1] || null;
}

function safeLog(logger, level, entry) {
  try {
    logger?.[level]?.(entry);
  } catch {
    // Logging must never interrupt notification subscription management.
  }
}

function timestamp(now) {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Clock unavailable.");
  return value;
}

export function createNotificationHandler({
  store,
  env = process.env,
  now = Date.now,
  randomBytes = secureRandomBytes,
  logger = console,
} = {}) {
  if (!store || typeof store.create !== "function" || typeof store.update !== "function" || typeof store.remove !== "function") {
    throw new Error("Notification store configuration is invalid.");
  }

  return async function notificationHandler(req, res) {
    const startedAt = timestamp(now);
    const requestId = randomBytes(12).toString("base64url");
    const method = typeof req?.method === "string" ? req.method.toUpperCase() : "UNKNOWN";

    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Request-Id", requestId);
    safeLog(logger, "info", {
      event: "notification_request_start",
      route: ROUTE,
      method,
      requestId,
      status: 0,
      durationMs: 0,
    });

    const logResult = (event, status, failureClass) => {
      const entry = {
        event,
        route: ROUTE,
        method,
        requestId,
        status,
        durationMs: Math.max(0, timestamp(now) - startedAt),
      };
      if (failureClass) entry.failureClass = failureClass;
      safeLog(logger, event === "notification_request_failure" ? "error" : "info", entry);
    };
    const succeed = (status, body) => {
      logResult("notification_request_done", status);
      return res.status(status).json(body);
    };
    const fail = (status, body, failureClass) => {
      logResult("notification_request_failure", status, failureClass);
      return res.status(status).json(body);
    };

    if (!ALLOWED_METHODS.includes(method)) {
      res.setHeader("Allow", ALLOWED_METHODS.join(", "));
      return fail(405, { error: "Method not allowed." }, "method");
    }

    const config = validateNotificationConfig(env);
    if (!config.valid) return fail(503, { error: "Service unavailable." }, "configuration");

    if (method === "GET") {
      if (!config.enabled) return succeed(200, { enabled: false });
      return succeed(200, { enabled: true, publicKey: config.publicKey });
    }

    if (!config.enabled) return fail(503, { error: "Service unavailable." }, "configuration");

    const contentType = getHeader(req, "content-type");
    if (typeof contentType !== "string" || contentType.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
      return fail(415, { error: "Unsupported media type." }, "content_type");
    }
    const fetchSite = getHeader(req, "sec-fetch-site");
    if (getHeader(req, "origin") !== config.allowedOrigin
      || (typeof fetchSite === "string" && fetchSite.toLowerCase() === "cross-site")) {
      return fail(403, { error: "Forbidden." }, "origin");
    }

    const contentLength = Number(getHeader(req, "content-length"));
    if (req?.rawBodyTooLarge === true
      || (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES)
      || bodyByteLength(req?.body) > MAX_BODY_BYTES) {
      return fail(413, { error: "Request too large." }, "size");
    }

    if (method === "POST") {
      const body = parseBody(req?.body);
      if (!body || !hasOwn(body, "subscription") || !hasOwn(body, "preferences")) {
        return fail(400, { error: "Invalid request." }, "validation");
      }
      const subscription = validatePushSubscription(body.subscription);
      const preferences = validatePreferences(body.preferences);
      if (!subscription.valid || !preferences.valid) {
        return fail(400, { error: "Invalid request." }, "validation");
      }

      const deviceId = randomBytes(32).toString("base64url");
      const currentMs = timestamp(now);
      const currentDate = new Date(currentMs);
      const endpointFingerprint = createEndpointFingerprint(subscription.value.endpoint, config.dedupSecret);
      const authorizationExpiresAt = new Date(currentMs + AUTHORIZATION_LIFETIME_MS);
      const record = {
        ...subscription.value,
        ...preferences.value,
        enabled: true,
        lastWorkoutCompletionDate: null,
        nextNotificationAt: currentDate,
        dailyDeliveryDate: null,
        dailyDeliveryCount: 0,
        lastSentByCategory: {},
        leaseUntil: null,
        leaseId: null,
        subscriptionRevision: 1,
        endpointFingerprint,
        authorizationExpiresAt,
        createdAt: currentDate,
        updatedAt: currentDate,
      };

      let effectiveDeviceId;
      try {
        effectiveDeviceId = await store.create(deviceId, record, {
          endpointFingerprint,
          registrationDate: currentDate.toISOString().slice(0, 10),
          dailyCap: config.dailyCap,
          now: currentDate,
        });
      } catch (error) {
        if (error instanceof RegistrationCapError) {
          return fail(429, { error: "Registration unavailable." }, "capacity");
        }
        if (error instanceof RegistrationUnavailableError || error?.name === "RegistrationUnavailableError") {
          return fail(409, { error: "Registration unavailable." }, "conflict");
        }
        return fail(500, { error: "Request failed." }, "storage");
      }
      let deviceToken;
      try {
        deviceToken = createDeviceToken(effectiveDeviceId, config.secret, currentMs);
      } catch {
        return fail(500, { error: "Request failed." }, "storage");
      }
      return succeed(201, { ok: true, deviceToken, preferences: preferences.value });
    }

    const token = bearerToken(req);
    let deviceId;
    try {
      if (!token) throw new Error("Unauthorized.");
      ({ deviceId } = verifyDeviceToken(token, config.secret, timestamp(now)));
    } catch {
      return fail(401, { error: "Unauthorized." }, "auth");
    }

    if (method === "DELETE") {
      try {
        await store.remove(deviceId, { now: new Date(timestamp(now)) });
      } catch (error) {
        if (error instanceof NotificationLeaseConflictError || error?.name === "NotificationLeaseConflictError") {
          return fail(409, { error: "Request conflict." }, "conflict");
        }
        return fail(500, { error: "Request failed." }, "storage");
      }
      return succeed(200, { ok: true });
    }

    const body = parseBody(req?.body);
    if (!body) return fail(400, { error: "Invalid request." }, "validation");
    const hasPreferences = hasOwn(body, "preferences");
    const hasCompletionDate = hasOwn(body, "lastWorkoutCompletionDate");
    if (hasPreferences === hasCompletionDate) {
      return fail(400, { error: "Invalid request." }, "validation");
    }

    const currentDate = new Date(timestamp(now));
    let patch;
    let response = { ok: true };
    if (hasPreferences) {
      const preferences = validatePreferences(body.preferences);
      if (!preferences.valid) return fail(400, { error: "Invalid request." }, "validation");
      patch = { ...preferences.value, nextNotificationAt: currentDate, updatedAt: currentDate };
      response = { ...response, preferences: preferences.value };
    } else {
      if (!isCompletionDate(body.lastWorkoutCompletionDate)) {
        return fail(400, { error: "Invalid request." }, "validation");
      }
      patch = {
        lastWorkoutCompletionDate: body.lastWorkoutCompletionDate,
        nextNotificationAt: currentDate,
        updatedAt: currentDate,
      };
    }

    try {
      await store.update(deviceId, patch, { now: currentDate });
    } catch (error) {
      if (error instanceof NotificationLeaseConflictError || error?.name === "NotificationLeaseConflictError") {
        return fail(409, { error: "Request conflict." }, "conflict");
      }
      return fail(500, { error: "Request failed." }, "storage");
    }
    return succeed(200, response);
  };
}

async function readRawBody(request) {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return { tooLarge: true, body: "" };
  }
  if (!request.body) return { tooLarge: false, body: "" };

  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      return { tooLarge: true, body: "" };
    }
    chunks.push(Buffer.from(value));
  }
  return { tooLarge: false, body: Buffer.concat(chunks, size) };
}

export function createNotificationFetchHandler({ coreHandler } = {}) {
  if (typeof coreHandler !== "function") throw new Error("Notification handler configuration is invalid.");
  return Object.freeze({
    async fetch(request) {
      const { tooLarge, body } = await readRawBody(request);
      const responseState = {
        statusCode: 200,
        body: undefined,
        headers: new Map(),
        setHeader(name, value) {
          this.headers.set(String(name), String(value));
          return this;
        },
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(value) {
          this.body = value;
          return this;
        },
      };
      await coreHandler({
        method: request.method,
        url: new URL(request.url).pathname,
        headers: Object.fromEntries(request.headers.entries()),
        body,
        rawBodyTooLarge: tooLarge,
      }, responseState);
      const headers = new Headers(responseState.headers);
      headers.set("Content-Type", "application/json; charset=utf-8");
      return new Response(JSON.stringify(responseState.body), {
        status: responseState.statusCode,
        headers,
      });
    },
  });
}

const coreHandler = createNotificationHandler({ store: createNotificationStore() });
export default createNotificationFetchHandler({ coreHandler });
