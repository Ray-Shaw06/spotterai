import { normalizeNotificationPreferences, validateNotificationPreferences } from "./notifications.js";

export const NOTIFICATION_TOKEN_KEY = "spotterai.notifications.token";
export const NOTIFICATION_PREFERENCES_KEY = "spotterai.notifications.preferences";
export const NOTIFICATION_OFFERED_PLAN_KEY = "spotterai.notifications.offeredPlanAt";
export const NOTIFICATION_PENDING_KEY = "spotterai.notifications.pending";
export const NOTIFICATION_CONFIGURATION_ID_KEY = "spotterai.notifications.configurationId";

const API_PATH = "/api/notifications";
const DATE_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const CONFIGURATION_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const AUTHORIZATION_RENEWAL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const PREPARED_SUBSCRIPTION_LIFETIME_MS = 5 * 60 * 1000;

const ERROR_COPY = Object.freeze({
  insecure_context: "Notifications require a secure installed app.",
  install_required_ios: "Install SpotterAI on your iPhone Home Screen first.",
  install_required_android: "Install SpotterAI on Android first.",
  unsupported_platform: "Notifications are not supported in this browser.",
  service_worker_unavailable: "Notifications are unavailable in this browser.",
  notifications_unavailable: "Notifications are unavailable in this browser.",
  push_unavailable: "Push notifications are unavailable in this installed app.",
  permission_denied: "Notification permission is blocked in browser settings.",
  invalid_public_key: "Notification setup is unavailable.",
  config_unavailable: "Notification setup could not be checked.",
  configuration_stale: "Notification setup changed. Wait for it to refresh, then try enabling again.",
  registration_unavailable: "Notifications are not available yet.",
  invalid_preferences: "Check the notification schedule and try again.",
  registration_failed: "Notifications could not be enabled.",
  activation_failed: "Notification setup is pending. Try enabling again or delete this device's notification setup.",
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

function readConfigurationId() {
  try {
    const value = runtimeStorage()?.getItem(NOTIFICATION_CONFIGURATION_ID_KEY) || "";
    return CONFIGURATION_ID_PATTERN.test(value) ? value : "";
  } catch {
    return "";
  }
}

function storePendingRegistration(token, preferences, configurationId) {
  if (!CONFIGURATION_ID_PATTERN.test(configurationId)) throw safeError("registration_failed");
  const storage = runtimeStorage();
  if (!storage) throw safeError("registration_failed");
  let previousToken;
  let previousPreferences;
  let previousPending;
  let previousConfigurationId;
  try {
    previousToken = storage.getItem(NOTIFICATION_TOKEN_KEY);
    previousPreferences = storage.getItem(NOTIFICATION_PREFERENCES_KEY);
    previousPending = storage.getItem(NOTIFICATION_PENDING_KEY);
    previousConfigurationId = storage.getItem(NOTIFICATION_CONFIGURATION_ID_KEY);
  } catch {
    throw safeError("registration_failed");
  }
  try {
    storage.setItem(NOTIFICATION_TOKEN_KEY, token);
    storage.setItem(NOTIFICATION_PREFERENCES_KEY, JSON.stringify(preferences));
    storage.setItem(NOTIFICATION_PENDING_KEY, "true");
    storage.setItem(NOTIFICATION_CONFIGURATION_ID_KEY, configurationId);
  } catch {
    try {
      if (previousToken === null) storage.removeItem(NOTIFICATION_TOKEN_KEY);
      else storage.setItem(NOTIFICATION_TOKEN_KEY, previousToken);
      if (previousPreferences === null) storage.removeItem(NOTIFICATION_PREFERENCES_KEY);
      else storage.setItem(NOTIFICATION_PREFERENCES_KEY, previousPreferences);
      if (previousPending === null) storage.removeItem(NOTIFICATION_PENDING_KEY);
      else storage.setItem(NOTIFICATION_PENDING_KEY, previousPending);
      if (previousConfigurationId === null) storage.removeItem(NOTIFICATION_CONFIGURATION_ID_KEY);
      else storage.setItem(NOTIFICATION_CONFIGURATION_ID_KEY, previousConfigurationId);
    } catch {}
    throw safeError("registration_failed");
  }
}

function completeStoredRegistration(preferences) {
  const storage = runtimeStorage();
  if (!storage) throw safeError("activation_failed");
  try {
    storage.setItem(NOTIFICATION_PREFERENCES_KEY, JSON.stringify(preferences));
    storage.removeItem(NOTIFICATION_PENDING_KEY);
  } catch {
    throw safeError("activation_failed");
  }
}

function clearRegistration() {
  try {
    const storage = runtimeStorage();
    storage?.removeItem(NOTIFICATION_TOKEN_KEY);
    storage?.removeItem(NOTIFICATION_PREFERENCES_KEY);
    storage?.removeItem(NOTIFICATION_OFFERED_PLAN_KEY);
    storage?.removeItem(NOTIFICATION_PENDING_KEY);
    storage?.removeItem(NOTIFICATION_CONFIGURATION_ID_KEY);
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

export async function prepareNotificationSubscription(publicKey, configurationId) {
  const capability = notificationCapability(globalThis);
  if (!capability.supported) throw safeError(capability.reason);
  if (!CONFIGURATION_ID_PATTERN.test(configurationId)) throw safeError("registration_unavailable");

  let applicationServerKey;
  let registration;
  try {
    [applicationServerKey, registration] = await Promise.all([
      validateApplicationServerKey(publicKey),
      globalThis.navigator.serviceWorker.ready,
    ]);
  } catch (error) {
    if (error instanceof NotificationClientError) throw error;
    throw safeError("service_worker_unavailable");
  }
  if (typeof registration?.pushManager?.getSubscription !== "function"
    || typeof registration?.pushManager?.subscribe !== "function") {
    throw safeError("push_unavailable");
  }

  let existingSubscription;
  try {
    existingSubscription = await registration.pushManager.getSubscription();
  } catch {
    throw safeError("subscription_failed");
  }
  return Object.freeze({
    applicationServerKey,
    configurationId,
    existingSubscription: existingSubscription || null,
    preparedAt: Date.now(),
    registration,
  });
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
    configurationId: typeof value.configurationId === "string" && CONFIGURATION_ID_PATTERN.test(value.configurationId)
      ? value.configurationId
      : null,
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

async function silentlyReauthorize({ activate = true } = {}) {
  const preferences = loadNotificationPreferences();
  if (!preferences || globalThis.Notification?.permission !== "granted") {
    throw safeError("authorization_refresh_failed");
  }
  const capability = notificationCapability(globalThis);
  if (!capability.supported) throw safeError("authorization_refresh_failed");

  try {
    const configurationId = readConfigurationId();
    if (!configurationId) throw new Error("missing configuration");
    const registration = await globalThis.navigator?.serviceWorker?.ready;
    const subscription = await registration?.pushManager?.getSubscription?.();
    if (!subscription) throw new Error("missing subscription");
    const value = await apiRequest("POST", {
      configurationId,
      subscription: subscriptionJson(subscription),
      preferences,
    }, { errorCode: "authorization_refresh_failed" });
    if (typeof value.deviceToken !== "string" || !value.deviceToken || value.deviceToken.length > 4096) {
      throw new Error("invalid token");
    }
    const saved = checkedPreferences(value.preferences);
    storePendingRegistration(value.deviceToken, saved, configurationId);
    if (!activate) return { preferences: saved, pending: true };
    const activated = await apiRequest("PATCH", {
      activate: true,
      preferences: saved,
    }, { token: value.deviceToken, errorCode: "authorization_refresh_failed" });
    const activePreferences = checkedPreferences(activated.preferences || saved);
    completeStoredRegistration(activePreferences);
    return { preferences: activePreferences };
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
    const pending = hasPendingNotificationRegistration();
    if (pending && method !== "DELETE") throw error;
    try {
      await silentlyReauthorize({
        activate: !pending,
      });
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
  if (hasPendingNotificationRegistration()) return { state: "pending" };
  if (!Number.isSafeInteger(now) || now < 0) throw safeError("authorization_refresh_failed");
  const expiresAt = tokenExpiration(token);
  if (expiresAt !== null && expiresAt > now + AUTHORIZATION_RENEWAL_WINDOW_MS) {
    return { state: "current" };
  }
  const result = await silentlyReauthorize();
  return { state: "renewed", preferences: result.preferences };
}

export async function subscribeToNotifications(preferences, { onPermissionPrompt, prepared = null } = {}) {
  const normalized = checkedPreferences(preferences);
  const capability = notificationCapability(globalThis);
  if (!capability.supported) throw safeError(capability.reason);
  const pendingToken = readToken();
  if (pendingToken && hasPendingNotificationRegistration()) {
    let value;
    try {
      value = await apiRequest("PATCH", {
        activate: true,
        preferences: normalized,
      }, { token: pendingToken, errorCode: "activation_failed" });
    } catch (error) {
      if (!(error instanceof NotificationClientError) || error.status !== 401) throw error;
      try {
        await silentlyReauthorize({ activate: false });
      } catch {
        throw error;
      }
      const renewedToken = readToken();
      if (!renewedToken) throw error;
      value = await apiRequest("PATCH", {
        activate: true,
        preferences: normalized,
      }, { token: renewedToken, errorCode: "activation_failed" });
    }
    const saved = checkedPreferences(value.preferences || normalized);
    completeStoredRegistration(saved);
    return { preferences: saved };
  }
  const applicationServerKey = prepared?.applicationServerKey;
  const configurationId = prepared?.configurationId;
  const preparedAt = prepared?.preparedAt;
  const registration = prepared?.registration;
  if (!(applicationServerKey instanceof Uint8Array)
    || applicationServerKey.length !== 65
    || applicationServerKey[0] !== 4
    || !CONFIGURATION_ID_PATTERN.test(configurationId)
    || typeof registration?.pushManager?.subscribe !== "function") {
    throw safeError("registration_unavailable");
  }
  const preparedAge = Date.now() - preparedAt;
  if (!Number.isSafeInteger(preparedAt)
    || preparedAge < 0
    || preparedAge > PREPARED_SUBSCRIPTION_LIFETIME_MS) {
    throw safeError("configuration_stale");
  }

  if (globalThis.Notification.permission === "default") {
    try { onPermissionPrompt?.(); } catch {}
  }
  let subscriptionPromise;
  try {
    subscriptionPromise = registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });
  } catch {
    throw safeError(globalThis.Notification.permission === "denied" ? "permission_denied" : "registration_failed");
  }
  let subscription;
  try {
    subscription = await subscriptionPromise;
  } catch {
    throw safeError(globalThis.Notification.permission === "denied" ? "permission_denied" : "registration_failed");
  }

  let issuedToken = "";
  let storedPending = false;
  try {
    const value = await apiRequest("POST", {
      configurationId,
      subscription: subscriptionJson(subscription),
      preferences: normalized,
    }, { errorCode: "registration_failed" });
    if (typeof value.deviceToken !== "string" || !value.deviceToken || value.deviceToken.length > 4096) throw safeError("registration_failed");
    issuedToken = value.deviceToken;
    const saved = checkedPreferences(value.preferences);
    storePendingRegistration(issuedToken, saved, configurationId);
    storedPending = true;
    const activated = await apiRequest("PATCH", {
      activate: true,
      preferences: saved,
    }, { token: issuedToken, errorCode: "activation_failed" });
    const activePreferences = checkedPreferences(activated.preferences || saved);
    completeStoredRegistration(activePreferences);
    return { preferences: activePreferences };
  } catch (error) {
    if (issuedToken && !storedPending) {
      try {
        await apiRequest("DELETE", undefined, { token: issuedToken, errorCode: "delete_failed" });
      } catch {}
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
  return Boolean(readToken()) && !hasPendingNotificationRegistration();
}

export function hasNotificationCredential() {
  return Boolean(readToken());
}

export function hasPendingNotificationRegistration() {
  try {
    return runtimeStorage()?.getItem(NOTIFICATION_PENDING_KEY) === "true";
  } catch {
    return false;
  }
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
  if (!hasNotificationSubscription()) return false;
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
