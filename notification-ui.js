import { trackFunnel } from "./analytics.js";
import {
  deleteNotificationSubscription,
  getNotificationConfiguration,
  hasNotificationCredential,
  hasPendingNotificationRegistration,
  hasNotificationSubscription,
  loadNotificationPreferences,
  NOTIFICATION_OFFERED_PLAN_KEY,
  notificationCapability,
  prepareNotificationSubscription,
  renewNotificationAuthorizationIfNeeded,
  subscribeToNotifications,
  updateNotificationPreferences,
} from "./notification-client.js";
import {
  notificationTimezoneMigration,
  prefillNotificationPreferences,
  validateNotificationPreferences,
} from "./notifications.js";
import { notificationDeniedGuidance } from "./notification-guidance.js";
import { store } from "./store.js";

const WEEKDAYS = Object.freeze([
  [1, "Monday"], [2, "Tuesday"], [3, "Wednesday"], [4, "Thursday"],
  [5, "Friday"], [6, "Saturday"], [7, "Sunday"],
]);
const CATEGORIES = Object.freeze([
  ["workout", "Planned workout reminder"],
  ["followUp", "Follow-up if still unlogged"],
  ["streak", "Streak-protection reminder"],
  ["recovery", "Next-morning recovery check-in"],
]);

const INSTALL_GUIDANCE = Object.freeze({
  install_required_ios: "On iPhone, open SpotterAI in Safari → Share → Add to Home Screen, then open it from your Home Screen.",
  install_required_android: "On Android, install or add SpotterAI to your Home screen, then open the installed app.",
  unsupported_platform: "Notifications are available only in the installed SpotterAI app on iPhone or Android.",
  insecure_context: "Notifications require SpotterAI's secure installed app.",
  service_worker_unavailable: "This installed app cannot receive push notifications.",
  notifications_unavailable: "This installed app cannot receive notifications.",
  push_unavailable: "Push notifications are unavailable in this installed app.",
});

let initialized = false;
let availability = { state: "loading", config: null };
let planOfferPending = false;
let offerTracked = false;
let accountMutationController = null;

function localTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function initialPreferences() {
  const stored = loadNotificationPreferences();
  if (stored) return notificationTimezoneMigration(stored, localTimezone()) || stored;
  return prefillNotificationPreferences(Number(store.inputs?.daysPerWeek), localTimezone());
}

export function evaluatePlanOffer({
  markerPresent,
  configurationState,
  capabilitySupported,
  subscribed,
}) {
  if (markerPresent || subscribed) return { show: false, eligible: false };
  const eligible = configurationState === "ready" && capabilitySupported === true;
  return { show: true, eligible };
}

export function evaluateAccountNotificationState({ hasPlan, available, capabilitySupported, subscribed }) {
  const needsPlan = subscribed === false && hasPlan === false;
  const unavailable = available === false || capabilitySupported === false;
  return {
    editorDisabled: unavailable || needsPlan,
    enableDisabled: subscribed || unavailable || needsPlan,
    needsPlan,
  };
}

export function preferenceValidationMessage(result) {
  return result?.errors?.schedule
    ? "Choose at least one workout day and time."
    : "Check each notification time and try again.";
}

export function notificationDeletionFailureState(hasRetryCredential) {
  return hasRetryCredential
    ? {
        retryable: true,
        message: "Server deletion was not confirmed. Choose Delete again to retry; notifications remain paused only if you paused them separately.",
      }
    : {
        retryable: false,
        message: "The server record was deleted, but browser subscription cleanup was incomplete.",
      };
}

export function notificationDeleteAvailable({ credentialed, browserSubscribed }) {
  return credentialed === true || browserSubscribed === true;
}

export function notificationEnableFailure(code, fallbackMessage) {
  if (code === "configuration_stale") {
    return {
      refreshAvailability: true,
      message: "Notification setup changed. Refreshing it now; choose Enable notifications again when it is ready.",
    };
  }
  if (code === "registration_failed") {
    return {
      refreshAvailability: true,
      message: "Notification setup was not completed. Refreshing it now; choose Enable notifications again when it is ready.",
    };
  }
  return { refreshAvailability: false, message: fallbackMessage };
}

export function createAccountMutationController({ setBusy }) {
  let active = null;
  return {
    isBusy: () => active !== null,
    run(kind, operation, { dedupe = false } = {}) {
      if (active) {
        if (dedupe && active.kind === kind) return active.promise;
        return Promise.resolve({ state: "blocked" });
      }
      const token = { kind, promise: null };
      active = token;
      setBusy(true);
      let result;
      try {
        result = operation();
      } catch (error) {
        active = null;
        setBusy(false);
        return Promise.reject(error);
      }
      token.promise = Promise.resolve(result).finally(() => {
        if (active === token) {
          active = null;
          setBusy(false);
        }
      });
      return token.promise;
    },
  };
}

export function createNotificationLifecycleController({
  eventTarget,
  documentTarget,
  accountEnable,
  getPlan,
  getInputs,
  renderAccount,
  showPlanOffer,
  refreshAvailability,
  enableAccount,
}) {
  let bound = false;
  const handlePlan = () => renderAccount(getPlan(), getInputs());
  const handlePlanGenerated = () => showPlanOffer();
  const handleVisibility = () => {
    if (documentTarget.visibilityState === "visible") return refreshAvailability();
    return undefined;
  };
  const handleAccountEnable = () => {
    if (!getPlan()) {
      renderAccount(getPlan(), getInputs());
      return Promise.resolve({ state: "blocked_no_plan" });
    }
    return enableAccount();
  };
  return {
    handleAccountEnable,
    bind() {
      if (bound) return;
      bound = true;
      eventTarget.addEventListener("spotter:plan", handlePlan);
      eventTarget.addEventListener("spotter:plan-generated", handlePlanGenerated);
      documentTarget.addEventListener("visibilitychange", handleVisibility);
      accountEnable?.addEventListener("click", handleAccountEnable);
    },
  };
}

export async function resolveActionableNotificationConfiguration(
  config,
  prepareSubscription = prepareNotificationSubscription,
) {
  if (config?.enabled !== true
    || typeof config.publicKey !== "string"
    || !config.publicKey
    || typeof config.configurationId !== "string"
    || !config.configurationId) return null;
  try {
    const prepared = await prepareSubscription(config.publicKey, config.configurationId);
    return {
      enabled: true,
      publicKey: config.publicKey,
      configurationId: config.configurationId,
      prepared,
    };
  } catch {
    return null;
  }
}

export async function executeNotificationEnableAttempt({
  preferences,
  prepared,
  subscribe,
  setStatus,
  consumeOffer,
  onPermissionPrompt,
}) {
  let prompted = false;
  setStatus("Checking notification setup…");
  const value = await subscribe(preferences, {
    prepared,
    onPermissionPrompt: () => {
      if (prompted) return;
      prompted = true;
      try { consumeOffer(); } catch {}
      setStatus("Waiting for your browser permission…");
      try { onPermissionPrompt(); } catch {}
    },
  });
  if (!prompted) {
    try { consumeOffer(); } catch {}
  }
  return value;
}

export function createNotificationTimezoneMigrationController({
  getCurrentTimezone,
  canMigrate,
  loadPreferences,
  updatePreferences,
  onSuccess = () => {},
  onError = () => {},
}) {
  let inFlight = null;
  return {
    run() {
      if (inFlight) return inFlight;
      if (!canMigrate()) return Promise.resolve({ state: "skipped" });
      const next = notificationTimezoneMigration(loadPreferences(), getCurrentTimezone());
      if (!next) return Promise.resolve({ state: "skipped" });
      inFlight = (async () => {
        try {
          const result = await updatePreferences(next);
          const preferences = result?.preferences || next;
          onSuccess(preferences);
          return { state: "updated", preferences };
        } catch (error) {
          onError(error, next);
          return { state: "error" };
        } finally {
          inFlight = null;
        }
      })();
      return inFlight;
    },
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function scheduleRows(prefix, preferences, disabled) {
  const selected = new Map(preferences.schedule.map((row) => [row.weekday, row.time]));
  return WEEKDAYS.map(([weekday, label]) => {
    const checked = selected.has(weekday);
    const time = selected.get(weekday) || "18:00";
    return `
      <div class="notification-schedule__row">
        <label class="notification-control" for="${prefix}-day-${weekday}">
          <input id="${prefix}-day-${weekday}" type="checkbox" data-notification-day="${weekday}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""} />
          <span>${label}</span>
        </label>
        <label class="notification-time" for="${prefix}-time-${weekday}">
          <span class="sr-only">${label} reminder time</span>
          <input id="${prefix}-time-${weekday}" class="input" type="time" value="${escapeHtml(time)}" data-notification-time="${weekday}" ${!checked || disabled ? "disabled" : ""} />
        </label>
      </div>`;
  }).join("");
}

/** Shared schedule/category editor used by both the post-plan offer and Account. */
export function renderPreferenceEditor(mount, { prefix, preferences, disabled = false, disclosure = false }) {
  if (!mount) return;
  const categoryControls = CATEGORIES.map(([key, label]) => `
    <label class="notification-control" for="${prefix}-category-${key}">
      <input id="${prefix}-category-${key}" type="checkbox" data-notification-category="${key}" ${preferences.categories[key] ? "checked" : ""} ${disabled ? "disabled" : ""} />
      <span>${label}</span>
    </label>`).join("");
  const editor = `
    <div class="notification-editor" data-notification-editor data-timezone="${escapeHtml(preferences.timezone)}">
      <p class="notification-timezone">Times use <strong title="${escapeHtml(preferences.timezone)}">${escapeHtml(preferences.timezone)}</strong>.</p>
      <fieldset class="notification-fieldset">
        <legend>Workout days and reminder times</legend>
        <div class="notification-schedule">${scheduleRows(prefix, preferences, disabled)}</div>
      </fieldset>
      <fieldset class="notification-fieldset">
        <legend>Quiet hours</legend>
        <div class="notification-quiet">
          <label for="${prefix}-quiet-start">Quiet hours start<input id="${prefix}-quiet-start" class="input" type="time" data-notification-quiet="start" value="${escapeHtml(preferences.quietHours.start)}" ${disabled ? "disabled" : ""} /></label>
          <label for="${prefix}-quiet-end">Quiet hours end<input id="${prefix}-quiet-end" class="input" type="time" data-notification-quiet="end" value="${escapeHtml(preferences.quietHours.end)}" ${disabled ? "disabled" : ""} /></label>
        </div>
      </fieldset>
      <fieldset class="notification-fieldset">
        <legend>Notification types</legend>
        <div class="notification-categories">${categoryControls}</div>
      </fieldset>
    </div>`;
  mount.innerHTML = disclosure
    ? `<details class="notification-details"><summary>Schedule and notification types</summary>${editor}</details>`
    : editor;

  mount.querySelectorAll("[data-notification-day]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const time = mount.querySelector(`[data-notification-time="${checkbox.dataset.notificationDay}"]`);
      if (time) time.disabled = disabled || !checkbox.checked;
    });
  });
}

export function readPreferenceEditor(mount, paused) {
  const editor = mount?.querySelector("[data-notification-editor]");
  if (!editor) return { valid: false, errors: { schedule: "Notification controls are unavailable." } };
  const schedule = [...editor.querySelectorAll("[data-notification-day]:checked")].map((checkbox) => ({
    weekday: Number(checkbox.dataset.notificationDay),
    time: editor.querySelector(`[data-notification-time="${checkbox.dataset.notificationDay}"]`)?.value || "",
  }));
  const categories = Object.fromEntries(CATEGORIES.map(([key]) => [
    key,
    editor.querySelector(`[data-notification-category="${key}"]`)?.checked === true,
  ]));
  return validateNotificationPreferences({
    timezone: editor.dataset.timezone,
    schedule,
    quietHours: {
      start: editor.querySelector('[data-notification-quiet="start"]')?.value || "",
      end: editor.querySelector('[data-notification-quiet="end"]')?.value || "",
    },
    categories,
    paused,
  });
}

function surfaceElements(surface) {
  if (surface === "offer") {
    return {
      section: document.getElementById("notification-offer"),
      mount: document.getElementById("notification-offer-editor"),
      status: document.getElementById("notification-offer-status"),
      error: document.getElementById("notification-offer-error"),
      enable: document.getElementById("notification-enable"),
    };
  }
  return {
    section: document.getElementById("account-notifications"),
    mount: document.getElementById("account-notification-editor"),
    status: document.getElementById("account-notification-status"),
    error: document.getElementById("account-notification-error"),
    save: document.getElementById("notification-save"),
    enable: document.getElementById("notification-account-enable"),
    pause: document.getElementById("notification-pause"),
    delete: document.getElementById("notification-delete"),
  };
}

function setMessage(elements, message, { error = false } = {}) {
  if (elements.status) {
    elements.status.textContent = error ? "" : message;
    elements.status.hidden = error || !message;
  }
  if (elements.error) {
    elements.error.textContent = error ? message : "";
    elements.error.hidden = !error || !message;
  }
}

export function guidanceFor(capability) {
  if (capability.reason === "permission_denied") {
    return notificationDeniedGuidance(capability.platformGroup);
  }
  return INSTALL_GUIDANCE[capability.reason] || "Notifications are unavailable on this device.";
}

function actionButtons(elements) {
  return [elements.enable, elements.save, elements.pause, elements.delete].filter(Boolean);
}

function surfaceControlState(surface) {
  const capability = notificationCapability(globalThis);
  const subscribed = hasNotificationSubscription();
  const credentialed = hasNotificationCredential();
  const pending = hasPendingNotificationRegistration();
  const available = availability.state === "ready";
  const browserSubscribed = Boolean(availability.config?.prepared?.existingSubscription);
  const accountState = evaluateAccountNotificationState({
    hasPlan: Boolean(store.plan),
    available,
    capabilitySupported: capability.supported,
    subscribed,
  });
  const editorDisabled = surface === "account"
    ? accountState.editorDisabled
    : (!available || !capability.supported || subscribed);
  return {
    capability,
    subscribed,
    credentialed,
    browserSubscribed,
    pending,
    available,
    accountState,
    editorDisabled,
  };
}

function applySurfaceControls(surface, elements = surfaceElements(surface)) {
  if (!elements.section || !elements.mount) return;
  const {
    subscribed,
    credentialed,
    browserSubscribed,
    accountState,
    editorDisabled,
  } = surfaceControlState(surface);
  elements.mount.querySelectorAll("[data-notification-day]").forEach((checkbox) => {
    checkbox.disabled = editorDisabled;
    const time = elements.mount.querySelector(`[data-notification-time="${checkbox.dataset.notificationDay}"]`);
    if (time) time.disabled = editorDisabled || !checkbox.checked;
  });
  elements.mount.querySelectorAll("[data-notification-quiet], [data-notification-category]").forEach((control) => {
    control.disabled = editorDisabled;
  });
  actionButtons(elements).forEach((button) => { button.disabled = editorDisabled; });
  if (elements.enable) elements.enable.disabled = surface === "account" ? accountState.enableDisabled : subscribed || editorDisabled;
  if (elements.save) elements.save.disabled = !subscribed || editorDisabled;
  if (elements.delete) {
    elements.delete.disabled = !notificationDeleteAvailable({ credentialed, browserSubscribed });
  }
  if (elements.pause) elements.pause.disabled = !subscribed || editorDisabled;
}

function setSurfaceBusy(surface, value) {
  const elements = surfaceElements(surface);
  if (!elements.section || !elements.mount) return;
  if (value) {
    elements.mount.querySelectorAll("input").forEach((control) => { control.disabled = true; });
    actionButtons(elements).forEach((button) => { button.disabled = true; });
  } else {
    applySurfaceControls(surface, elements);
  }
  elements.section.setAttribute("aria-busy", String(value));
}

accountMutationController = createAccountMutationController({
  setBusy: (value) => {
    setSurfaceBusy("account", value);
    setSurfaceBusy("offer", value);
  },
});

function renderSurface(surface, preferences = initialPreferences()) {
  const elements = surfaceElements(surface);
  if (!elements.section || !elements.mount) return;
  const {
    capability,
    subscribed,
    browserSubscribed,
    pending,
    available,
    accountState,
    editorDisabled,
  } = surfaceControlState(surface);
  renderPreferenceEditor(elements.mount, {
    prefix: surface === "offer" ? "notification-offer" : "account-notification",
    preferences,
    disabled: editorDisabled,
    disclosure: surface === "account" && subscribed,
  });

  applySurfaceControls(surface, elements);
  if (elements.pause) {
    elements.pause.textContent = preferences.paused ? "Resume notifications" : "Pause notifications";
  }

  if (!capability.supported) setMessage(elements, guidanceFor(capability));
  else if (availability.state === "loading") setMessage(elements, "Checking notification availability…");
  else if (!available) setMessage(elements, "Notifications are not available yet. SpotterAI will not ask for browser permission.");
  else if (surface === "offer" && subscribed) setMessage(elements, "Notifications are enabled. Manage the schedule in Account.");
  else if (surface === "account" && pending) setMessage(elements, "Notification setup is pending. Choose Enable notifications to retry, or Delete to remove this device.");
  else if (surface === "account" && browserSubscribed && !subscribed) setMessage(elements, "This device has an unfinished browser notification setup. Choose Enable notifications to retry, or Delete to remove it.");
  else if (surface === "account" && accountState.needsPlan) setMessage(elements, "Create a plan first, then return here to review a reminder schedule.");
  else if (surface === "account" && !subscribed) setMessage(elements, "Review this schedule, then choose Enable notifications when you're ready.");
  else if (surface === "account") setMessage(elements, preferences.paused ? "Notifications are paused." : "Notifications are active on this device.");
  else setMessage(elements, "Review this schedule before enabling. Your browser will ask only after you choose Enable notifications.");

  if (accountMutationController.isBusy()) setSurfaceBusy(surface, true);
}

const timezoneMigrationController = createNotificationTimezoneMigrationController({
  getCurrentTimezone: localTimezone,
  canMigrate: () => hasNotificationSubscription()
    && availability.state === "ready"
    && availability.config?.enabled === true,
  loadPreferences: loadNotificationPreferences,
  updatePreferences: updateNotificationPreferences,
  onSuccess: (preferences) => {
    const elements = surfaceElements("account");
    renderSurface("account", preferences);
    setMessage(elements, `Reminder time zone updated to ${preferences.timezone}.`);
  },
  onError: (_error, attempted) => {
    const elements = surfaceElements("account");
    renderSurface("account", attempted);
    setMessage(elements, "Your time zone changed, but reminder times could not be updated yet. Return to the app to retry.", { error: true });
  },
});

function readOfferMarker() {
  try { return Boolean(localStorage.getItem(NOTIFICATION_OFFERED_PLAN_KEY)); } catch { return false; }
}

function maybeShowPlanOffer() {
  if (!planOfferPending) return;
  const elements = surfaceElements("offer");
  if (!elements.section) return;
  const capability = notificationCapability(globalThis);
  const decision = evaluatePlanOffer({
    markerPresent: readOfferMarker(),
    configurationState: availability.state,
    capabilitySupported: capability.supported,
    subscribed: hasNotificationSubscription(),
  });
  if (!decision.show) {
    elements.section.hidden = true;
    planOfferPending = false;
    return;
  }
  elements.section.hidden = false;
  if (!offerTracked) {
    trackFunnel("notification_offer_shown", { platform_group: capability.platformGroup });
    offerTracked = true;
  }
  renderSurface("offer", prefillNotificationPreferences(Number(store.inputs?.daysPerWeek), localTimezone()));
}

function consumePlanOffer() {
  try { localStorage.setItem(NOTIFICATION_OFFERED_PLAN_KEY, String(Date.now())); } catch {}
  planOfferPending = false;
}

function loadAvailability() {
  return accountMutationController.run("availability", async () => {
    const capability = notificationCapability(globalThis);
    let renewalFailed = false;
    if (!capability.supported) {
      availability = { state: "unsupported", config: null };
    } else {
      try {
        const config = await getNotificationConfiguration();
        const actionable = await resolveActionableNotificationConfiguration(config);
        availability = actionable
          ? { state: "ready", config: actionable }
          : { state: "unavailable", config: null };
        if (actionable && hasNotificationSubscription()) {
          try {
            await renewNotificationAuthorizationIfNeeded();
          } catch {
            renewalFailed = true;
          }
        }
      } catch {
        availability = { state: "error", config: null };
      }
    }
    renderSurface("account");
    maybeShowPlanOffer();
    if (renewalFailed) {
      setMessage(
        surfaceElements("account"),
        "Notification authorization could not be renewed. Return to the app to retry.",
        { error: true },
      );
      return { state: "refreshed", renewal: "error", migration: { state: "skipped" } };
    }
    const migration = await timezoneMigrationController.run();
    return { state: "refreshed", migration };
  }, { dedupe: true });
}

function enableNotifications(surface) {
  return accountMutationController.run(`enable:${surface}`, async () => {
    const elements = surfaceElements(surface);
    if (!store.plan) {
      renderSurface("account");
      setMessage(elements, "Create a plan first, then review its reminder schedule before enabling notifications.", { error: true });
      return { state: "blocked_no_plan" };
    }
    const result = readPreferenceEditor(elements.mount, false);
    if (!result.valid) {
      setMessage(elements, preferenceValidationMessage(result), { error: true });
      return { state: "invalid" };
    }
    const capability = notificationCapability(globalThis);
    if (surface === "offer") setSurfaceBusy("offer", true);
    try {
      const value = await executeNotificationEnableAttempt({
        preferences: result.value,
        prepared: availability.config?.prepared,
        subscribe: subscribeToNotifications,
        setStatus: (message) => setMessage(elements, message),
        consumeOffer: consumePlanOffer,
        onPermissionPrompt: () => trackFunnel("notification_prompted", { platform_group: capability.platformGroup }),
      });
      trackFunnel("notification_allowed", { platform_group: capability.platformGroup });
      renderSurface("offer", value.preferences);
      renderSurface("account", value.preferences);
      return { state: "enabled", preferences: value.preferences };
    } catch (error) {
      const failure = notificationEnableFailure(
        error?.code,
        error?.message || "Notifications could not be enabled.",
      );
      if (failure.refreshAvailability) availability = { state: "loading", config: null };
      renderSurface(surface, result.value);
      if (error?.code === "permission_denied") {
        trackFunnel("notification_denied", { platform_group: capability.platformGroup });
        setMessage(elements, notificationDeniedGuidance(capability.platformGroup), { error: true });
      } else {
        setMessage(elements, failure.message, { error: true });
      }
      if (failure.refreshAvailability) setTimeout(() => { void loadAvailability(); }, 0);
      return { state: "error", code: error?.code || "unknown" };
    } finally {
      if (surface === "offer") setSurfaceBusy("offer", false);
    }
  });
}

const enableFromOffer = () => enableNotifications("offer");

function saveAccountPreferences({ paused } = {}) {
  return accountMutationController.run("save", async () => {
    const elements = surfaceElements("account");
    const current = loadNotificationPreferences() || initialPreferences();
    const result = readPreferenceEditor(elements.mount, paused ?? current.paused);
    if (!result.valid) {
      setMessage(elements, preferenceValidationMessage(result), { error: true });
      return { state: "invalid" };
    }
    setMessage(elements, paused === undefined ? "Saving notification changes…" : (paused ? "Pausing notifications…" : "Resuming notifications…"));
    try {
      const value = await updateNotificationPreferences(result.value);
      renderSurface("account", value.preferences);
      setMessage(elements, value.preferences.paused ? "Notifications are paused." : "Notification changes saved.");
      return { state: "saved", preferences: value.preferences };
    } catch (error) {
      renderSurface("account", current);
      setMessage(elements, error?.message || "Notification changes could not be saved.", { error: true });
      return { state: "error" };
    }
  });
}

function deleteFromAccount() {
  return accountMutationController.run("delete", async () => {
    if (!globalThis.confirm("Delete notifications from this device? Your workout data will not be affected.")) return { state: "cancelled" };
    const elements = surfaceElements("account");
    setMessage(elements, "Deleting this device's notification subscription…");
    try {
      await deleteNotificationSubscription();
      renderSurface("account", prefillNotificationPreferences(Number(store.inputs?.daysPerWeek), localTimezone()));
      setMessage(elements, "Notifications were deleted from this device.");
      setTimeout(() => { void loadAvailability(); }, 0);
      return { state: "deleted" };
    } catch (error) {
      const failure = notificationDeletionFailureState(hasNotificationCredential());
      renderSurface("account", loadNotificationPreferences()
        || prefillNotificationPreferences(Number(store.inputs?.daysPerWeek), localTimezone()));
      setMessage(elements, failure.message, { error: true });
      return { state: failure.retryable ? "retryable_error" : "error" };
    }
  });
}

function showPlanOffer() {
  planOfferPending = true;
  maybeShowPlanOffer();
}

function consumeNotificationOpen() {
  let url;
  try { url = new URL(globalThis.location.href); } catch { return; }
  const category = url.searchParams.get("notification");
  if (!["workout", "follow_up", "streak", "recovery"].includes(category)) return;
  trackFunnel("notification_opened", { notification_category: category });
  url.searchParams.delete("notification");
  const next = `${url.pathname}${url.search}${url.hash}`;
  globalThis.history.replaceState(globalThis.history.state, "", next);
}

export function initNotificationUI() {
  if (initialized) return;
  initialized = true;
  consumeNotificationOpen();
  renderSurface("account");
  loadAvailability();

  surfaceElements("offer").enable?.addEventListener("click", enableFromOffer);
  const account = surfaceElements("account");
  const lifecycle = createNotificationLifecycleController({
    eventTarget: globalThis,
    documentTarget: document,
    accountEnable: account.enable,
    getPlan: () => store.plan,
    getInputs: () => store.inputs,
    renderAccount: () => renderSurface("account"),
    showPlanOffer,
    refreshAvailability: loadAvailability,
    enableAccount: () => enableNotifications("account"),
  });
  lifecycle.bind();
  account.save?.addEventListener("click", () => saveAccountPreferences());
  account.pause?.addEventListener("click", () => {
    const current = loadNotificationPreferences();
    if (current) saveAccountPreferences({ paused: !current.paused });
  });
  account.delete?.addEventListener("click", deleteFromAccount);
}
