import { normalizeNotificationPreferences, validateNotificationPreferences } from "./notifications.js";

export const NOTIFICATION_TOKEN_KEY = "spotterai.notifications.token";
export const NOTIFICATION_PREFERENCES_KEY = "spotterai.notifications.preferences";
export const NOTIFICATION_OFFERED_PLAN_KEY = "spotterai.notifications.offeredPlanAt";

const API_PATH = "/api/notifications";
const DATE_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const AUTHORIZATION_RENEWAL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const ERROR_COPY = Object.freeze({
  insecure_context: "Notifications require a secure installed app.",
  install_required_ios: "Install SpotterAI on your iPhone Home Screen first.",
  install_required_android: "Install SpotterAI on Android first.",
  unsupported_platform: "Notifications are not supported in this browser.",
  service_worker_unavailable: "Notifications are unavailable in this browser.",
  notifications_unavailable: "Notifications are unavailable in this browser.",
  push_unavailable: "Push notifications are unavailable in this installed app.",
  permission_denied: "Notification permission is blocked in browser settings.",
  permission_failed: "Notification permission could not be checked.",
  invalid_public_key: "Notification setup is unavailable.",
  config_unavailable: "Notification setup could not be checked.",
  registration_unavailable: "Notifications are not available yet.",
  invalid_preferences: "Check the notification schedule and try again.",
  registration_failed: "Notifications could not be enabled.",
  subscription_failed: "The browser notification subscription is unavailable.",
  authorization_missing: "This device is not subscribed to notifications.",
  authorization_refresh_failed: "Notification authorization could not be renewed.",
  update_failed: "Notification changes could not be saved.",
  invalid_completion_date: "The workout completion date is invalid.",
  sync_failed: "Workout completion could not be synced.",
  delete_failed: "The notification subscription could not be fully deleted.",
});

export class NotificationClientError extends Error {
  constructor(code, status) {
    super(ERROR_COPY[code] || "Notification setup could not be completed.");
    this.name = "NotificationClientError";
    this.code = code;
    if (Number.isInteger(status) && status >= 400 && status <= 599) this.status = status;
  }
}

function safeError(code, status) {
  return new NotificationClientError(code, status);
}

function runtimeStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function readToken() {
  try {
    return runtimeStorage()?.getItem(NOTIFICATION_TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

function storeRegistration(token, preferences) {
  const storage = runtimeStorage();
  if (!storage) throw safeError("registration_failed");
  let previousToken;
  let previousPreferences;
  try {
    previousToken = storage.getItem(NOTIFICATION_TOKEN_KEY);
    previousPreferences = storage.getItem(NOTIFICATION_PREFERENCES_KEY);
  } catch {
    throw safeError("registration_failed");
  }
  try {
    storage.setItem(NOTIFICATION_TOKEN_KEY, token);
    storage.setItem(NOTIFICATION_PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    try {
      if (previousToken === null) storage.removeItem(NOTIFICATION_TOKEN_KEY);
      else storage.setItem(NOTIFICATION_TOKEN_KEY, previousToken);
      if (previousPreferences === null) storage.removeItem(NOTIFICATION_PREFERENCES_KEY);
      else storage.setItem(NOTIFICATION_PREFERENCES_KEY, previousPreferences);
    } catch {}
    throw safeError("registration_failed");
  }
}

function clearRegistration() {
  try {
    const storage = runtimeStorage();
    storage?.removeItem(NOTIFICATION_TOKEN_KEY);
    storage?.removeItem(NOTIFICATION_PREFERENCES_KEY);
    storage?.removeItem(NOTIFICATION_OFFERED_PLAN_KEY);
  } catch {}
}

function platformDetails(env) {
  const navigatorValue = env?.navigator || {};
  const userAgent = String(navigatorValue.userAgent || "");
  const ios = /iPhone|iPad|iPod/i.test(userAgent);
  const android = /Android/i.test(userAgent);
  const displayStandalone = typeof env?.matchMedia === "function"
    && env.matchMedia("(display-mode: standalone)").matches === true;

  if (ios) return { platformGroup: "ios_pwa", installed: navigatorValue.standalone === true, installReason: "install_required_ios" };
  if (android) return { platformGroup: "android_pwa", installed: displayStandalone, installReason: "install_required_android" };
  return { platformGroup: "unsupported", installed: false, installReason: "unsupported_platform" };
}

export function notificationCapability(env = globalThis) {
  const platform = platformDetails(env);
  if (env?.isSecureContext !== true) return { supported: false, platformGroup: "unsupported", reason: "insecure_context" };
  if (platform.platformGroup === "unsupported") return { supported: false, platformGroup: "unsupported", reason: "unsupported_platform" };
  if (!platform.installed) return { supported: false, platformGroup: "unsupported", reason: platform.installReason };
  if (!env.navigator?.serviceWorker) return { supported: false, platformGroup: platform.platformGroup, reason: "service_worker_unavailable" };
  if (!env.Notification) return { supported: false, platformGroup: platform.platformGroup, reason: "notifications_unavailable" };
  if (!env.PushManager) return { supported: false, platformGroup: platform.platformGroup, reason: "push_unavailable" };
  if (env.Notification.permission === "denied") return { supported: false, platformGroup: platform.platformGroup, reason: "permission_denied" };
  return { supported: true, platformGroup: platform.platformGroup, reason: "ready" };
}

export function vapidKeyToUint8Array(value) {
  if (typeof value !== "string" || !value || !BASE64URL_PATTERN.test(value)) throw safeError("invalid_public_key");
  try {
    const padding = "=".repeat((4 - (value.length % 4)) % 4);
    const base64 = `${value.replace(/-/g, "+").replace(/_/g, "/")}${padding}`;
    const binary = typeof atob === "function" ? atob(base64) : Buffer.from(base64, "base64").toString("binary");
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const canonical = (typeof btoa === "function" ? btoa(binary) : Buffer.from(bytes).toString("base64"))
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    if (bytes.length !== 65 || bytes[0] !== 4 || canonical !== value) throw new Error("invalid");
    return bytes;
  } catch {
    throw safeError("invalid_public_key");
  }
}

export async function validateApplicationServerKey(value) {
  const bytes = vapidKeyToUint8Array(value);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle?.importKey) throw safeError("invalid_public_key");
  try {
    await subtle.importKey("raw", bytes, { name: "ECDH", namedCurve: "P-256" }, false, []);
    return bytes;
  } catch {
    throw safeError("invalid_public_key");
  }
}

async function readJson(response, errorCode) {
  if (!response?.ok) throw safeError(errorCode, response?.status);
  try {
    const value = await response.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid");
    return value;
  } catch (error) {
    if (error instanceof NotificationClientError) throw error;
    throw safeError(errorCode);
  }
}

async function apiRequest(method, body, { token = "", errorCode }) {
  const headers = { Accept: "application/json" };
  if (body !== undefined || ["POST", "PATCH", "DELETE"].includes(method)) {
    headers["Content-Type"] = "application/json";
  }
  if (token) headers.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(API_PATH, {
      method,
      credentials: "same-origin",
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw safeError(errorCode);
  }
  return readJson(response, errorCode);
}

export async function getNotificationConfiguration() {
  const value = await apiRequest("GET", undefined, { errorCode: "config_unavailable" });
  return {
    enabled: value.enabled === true,
    publicKey: typeof value.publicKey === "string" && value.publicKey ? value.publicKey : null,
  };
}

function checkedPreferences(preferences) {
  const result = validateNotificationPreferences(preferences);
  if (!result.valid) throw safeError("invalid_preferences");
  return result.value;
}

function subscriptionJson(subscription) {
  try {
    const value = subscription?.toJSON?.();
    if (!value || typeof value !== "object") throw new Error("invalid");
    return value;
  } catch {
    throw safeError("registration_failed");
  }
}

function tokenExpiration(token) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !BASE64URL_PATTERN.test(parts[0])) return null;
  try {
    const padding = "=".repeat((4 - (parts[0].length % 4)) % 4);
    const base64 = `${parts[0].replace(/-/g, "+").replace(/_/g, "/")}${padding}`;
    const json = typeof atob === "function"
      ? atob(base64)
      : Buffer.from(base64, "base64").toString("utf8");
    const payload = JSON.parse(json);
    return Number.isSafeInteger(payload?.exp) && payload.exp >= 0 ? payload.exp : null;
  } catch {
    return null;
  }
}

async function silentlyReauthorize() {
  const preferences = loadNotificationPreferences();
  if (!preferences || globalThis.Notification?.permission !== "granted") {
    throw safeError("authorization_refresh_failed");
  }
  const capability = notificationCapability(globalThis);
  if (!capability.supported) throw safeError("authorization_refresh_failed");

  try {
    const registration = await globalThis.navigator?.serviceWorker?.ready;
    const subscription = await registration?.pushManager?.getSubscription?.();
    if (!subscription) throw new Error("missing subscription");
    const value = await apiRequest("POST", {
      subscription: subscriptionJson(subscription),
      preferences,
    }, { errorCode: "authorization_refresh_failed" });
    if (typeof value.deviceToken !== "string" || !value.deviceToken || value.deviceToken.length > 4096) {
      throw new Error("invalid token");
    }
    const saved = checkedPreferences(value.preferences);
    storeRegistration(value.deviceToken, saved);
    return { preferences: saved };
  } catch {
    throw safeError("authorization_refresh_failed");
  }
}

async function authenticatedRequest(method, body, { errorCode }) {
  const token = readToken();
  if (!token) throw safeError("authorization_missing");
  try {
    return await apiRequest(method, body, { token, errorCode });
  } catch (error) {
    if (!(error instanceof NotificationClientError) || error.status !== 401) throw error;
    try {
      await silentlyReauthorize();
    } catch {
      throw error;
    }
    const renewedToken = readToken();
    if (!renewedToken) throw error;
    return apiRequest(method, body, { token: renewedToken, errorCode });
  }
}

export async function renewNotificationAuthorizationIfNeeded({ now = Date.now() } = {}) {
  const token = readToken();
  if (!token) return { state: "not_subscribed" };
  if (!Number.isSafeInteger(now) || now < 0) throw safeError("authorization_refresh_failed");
  const expiresAt = tokenExpiration(token);
  if (expiresAt !== null && expiresAt > now + AUTHORIZATION_RENEWAL_WINDOW_MS) {
    return { state: "current" };
  }
  const result = await silentlyReauthorize();
  return { state: "renewed", preferences: result.preferences };
}

export async function subscribeToNotifications(preferences, { onPermissionPrompt } = {}) {
  const normalized = checkedPreferences(preferences);
  const config = await getNotificationConfiguration();
  if (!config.enabled || !config.publicKey) throw safeError("registration_unavailable");
  const applicationServerKey = await validateApplicationServerKey(config.publicKey);

  const capability = notificationCapability(globalThis);
  if (!capability.supported) throw safeError(capability.reason);

  let permission = globalThis.Notification.permission;
  if (permission === "default") {
    try {
      try { onPermissionPrompt?.(); } catch {}
      permission = await globalThis.Notification.requestPermission();
    } catch {
      throw safeError("permission_failed");
    }
  }
  if (permission !== "granted") throw safeError("permission_denied");

  let registration;
  try {
    registration = await globalThis.navigator.serviceWorker.ready;
  } catch {
    throw safeError("service_worker_unavailable");
  }
  if (!registration?.pushManager) throw safeError("push_unavailable");
  let subscription;
  try {
    subscription = await registration.pushManager.getSubscription();
  } catch {
    throw safeError("subscription_failed");
  }
  let created = false;
  if (!subscription) {
    try {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
      created = true;
    } catch (error) {
      if (error instanceof NotificationClientError) throw error;
      throw safeError("registration_failed");
    }
  }

  let issuedToken = "";
  try {
    const value = await apiRequest("POST", {
      subscription: subscriptionJson(subscription),
      preferences: normalized,
    }, { errorCode: "registration_failed" });
    if (typeof value.deviceToken !== "string" || !value.deviceToken || value.deviceToken.length > 4096) throw safeError("registration_failed");
    issuedToken = value.deviceToken;
    const saved = checkedPreferences(value.preferences);
    storeRegistration(issuedToken, saved);
    return { preferences: saved };
  } catch (error) {
    if (issuedToken) {
      try {
        await apiRequest("DELETE", undefined, { token: issuedToken, errorCode: "delete_failed" });
      } catch {}
    }
    if (created) {
      try { await subscription?.unsubscribe?.(); } catch {}
    }
    if (error instanceof NotificationClientError) throw error;
    throw safeError("registration_failed");
  }
}

export function loadNotificationPreferences() {
  try {
    const raw = runtimeStorage()?.getItem(NOTIFICATION_PREFERENCES_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const result = validateNotificationPreferences(parsed);
    return result.valid ? result.value : null;
  } catch {
    return null;
  }
}

export function hasNotificationSubscription() {
  return Boolean(readToken());
}

export async function updateNotificationPreferences(preferences) {
  const normalized = checkedPreferences(preferences);
  const value = await authenticatedRequest("PATCH", { preferences: normalized }, { errorCode: "update_failed" });
  const saved = checkedPreferences(value.preferences || normalized);
  try { runtimeStorage()?.setItem(NOTIFICATION_PREFERENCES_KEY, JSON.stringify(saved)); } catch { throw safeError("update_failed"); }
  return { preferences: saved };
}

export async function syncWorkoutCompletion(localDate) {
  if (typeof localDate !== "string" || !DATE_PATTERN.test(localDate)) throw safeError("invalid_completion_date");
  const [year, month, day] = localDate.split("-").map(Number);
  const value = new Date(year, month - 1, day);
  if (value.getFullYear() !== year || value.getMonth() !== month - 1 || value.getDate() !== day) throw safeError("invalid_completion_date");
  if (!readToken()) return false;
  await authenticatedRequest("PATCH", { lastWorkoutCompletionDate: localDate }, { errorCode: "sync_failed" });
  return true;
}

export async function deleteNotificationSubscription() {
  const token = readToken();
  let serverError = null;
  let browserFailed = false;
  let serverConfirmed = !token;
  try {
    if (token) {
      await authenticatedRequest("DELETE", undefined, { errorCode: "delete_failed" });
      serverConfirmed = true;
    }
  } catch (error) {
    serverError = error instanceof NotificationClientError ? error : safeError("delete_failed");
  }

  if (serverError?.status !== 401) {
    try {
      const registration = await globalThis.navigator?.serviceWorker?.ready;
      const subscription = await registration?.pushManager?.getSubscription?.();
      await subscription?.unsubscribe?.();
    } catch {
      browserFailed = true;
    }
  }
  if (serverConfirmed) clearRegistration();

  if (serverError) throw serverError;
  if (browserFailed) throw safeError("delete_failed");
  return true;
}

export function normalizedStoredNotificationPreferences() {
  const stored = loadNotificationPreferences();
  return stored ? normalizeNotificationPreferences(stored) : null;
}
