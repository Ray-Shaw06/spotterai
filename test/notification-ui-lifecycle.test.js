import test from "node:test";
import assert from "node:assert/strict";
import { prefillNotificationPreferences } from "../notifications.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });
  return { promise, resolve, reject };
}

function eventTarget() {
  const handlers = new Map();
  return {
    addEventListener(name, handler) {
      const current = handlers.get(name) || [];
      handlers.set(name, [...current, handler]);
    },
    emit(name, event = {}) {
      return (handlers.get(name) || []).map((handler) => handler(event));
    },
  };
}

async function uiModule() {
  globalThis.localStorage ||= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.window ||= { addEventListener: () => {}, dispatchEvent: () => {} };
  return import("../notification-ui.js");
}

test("offer lifecycle shows guidance without consuming the marker while rendering", async () => {
  const { evaluatePlanOffer } = await uiModule();
  assert.equal(typeof evaluatePlanOffer, "function");

  assert.deepEqual(evaluatePlanOffer({
    markerPresent: false,
    configurationState: "ready",
    capabilitySupported: true,
    subscribed: false,
  }), { show: true, eligible: true });
  assert.deepEqual(evaluatePlanOffer({
    markerPresent: false,
    configurationState: "unsupported",
    configurationEnabled: false,
    capabilitySupported: false,
    subscribed: false,
  }), { show: true, eligible: false });
  assert.deepEqual(evaluatePlanOffer({
    markerPresent: true,
    configurationState: "ready",
    capabilitySupported: true,
    subscribed: false,
  }), { show: false, eligible: false });
});

test("real lifecycle binding rerenders Account for every general plan event without offering", async () => {
  const { createNotificationLifecycleController } = await uiModule();
  assert.equal(typeof createNotificationLifecycleController, "function");
  const events = eventTarget();
  const visibility = eventTarget();
  const enable = eventTarget();
  let plan = null;
  let inputs = null;
  const renders = [];
  let offers = 0;
  let enables = 0;
  const controller = createNotificationLifecycleController({
    eventTarget: events,
    documentTarget: visibility,
    accountEnable: enable,
    getPlan: () => plan,
    getInputs: () => inputs,
    renderAccount: () => renders.push({ plan, inputs }),
    showPlanOffer: () => { offers += 1; },
    refreshAvailability: async () => {},
    enableAccount: async () => { enables += 1; },
  });
  controller.bind();

  plan = { program_name: "Fallback" };
  inputs = { daysPerWeek: 3 };
  events.emit("spotter:plan", { detail: { plan, inputs } });
  assert.deepEqual(renders.at(-1), { plan, inputs });
  assert.equal(offers, 0);

  events.emit("spotter:plan-generated");
  assert.equal(offers, 1);

  plan = null;
  inputs = null;
  events.emit("spotter:plan", { detail: { plan, inputs } });
  assert.deepEqual(renders.at(-1), { plan: null, inputs: null });
  assert.equal(offers, 1);

  enable.emit("click");
  await Promise.resolve();
  assert.equal(enables, 0, "a stale enabled control cannot subscribe after switching to a no-plan profile");
  assert.deepEqual(renders.at(-1), { plan: null, inputs: null });

  plan = { program_name: "Restored" };
  inputs = { daysPerWeek: 4 };
  enable.emit("click");
  await Promise.resolve();
  assert.equal(enables, 1);
});

test("shared Account mutation lock blocks stale Save and serializes Delete after migration", async () => {
  const { createAccountMutationController } = await uiModule();
  assert.equal(typeof createAccountMutationController, "function");
  const busy = [];
  const order = [];
  const migrationGate = deferred();
  const controller = createAccountMutationController({ setBusy: (value) => busy.push(value) });

  const migration = controller.run("availability", async () => {
    order.push("migration:start");
    await migrationGate.promise;
    order.push("migration:end");
  }, { dedupe: true });
  const resume = controller.run("availability", async () => { order.push("duplicate"); }, { dedupe: true });
  assert.strictEqual(resume, migration, "concurrent visible resumes share the active refresh");

  assert.deepEqual(await controller.run("save", async () => { order.push("save"); }), { state: "blocked" });
  assert.deepEqual(await controller.run("delete", async () => { order.push("delete:early"); }), { state: "blocked" });
  assert.deepEqual(order, ["migration:start"]);

  migrationGate.resolve();
  await migration;
  await controller.run("delete", async () => { order.push("delete"); });
  assert.deepEqual(order, ["migration:start", "migration:end", "delete"]);
  assert.deepEqual(busy, [true, false, true, false]);
});

test("shared Account mutation lock restores controls after a failed refresh", async () => {
  const { createAccountMutationController } = await uiModule();
  const busy = [];
  const controller = createAccountMutationController({ setBusy: (value) => busy.push(value) });
  await assert.rejects(controller.run("availability", async () => { throw new Error("refresh failed"); }), /refresh failed/);
  assert.deepEqual(busy, [true, false]);
  assert.equal(controller.isBusy(), false);
  assert.equal(await controller.run("save", async () => "saved"), "saved");
});

test("a retained deletion credential produces an explicit Account retry state", async () => {
  const { notificationDeletionFailureState } = await uiModule();
  assert.deepEqual(notificationDeletionFailureState(true), {
    retryable: true,
    message: "Server deletion was not confirmed. Choose Delete again to retry; notifications remain paused only if you paused them separately.",
  });
  assert.deepEqual(notificationDeletionFailureState(false), {
    retryable: false,
    message: "The server record was deleted, but browser subscription cleanup was incomplete.",
  });
});

test("Account Delete remains available for a browser-only notification subscription", async () => {
  const { notificationDeleteAvailable } = await uiModule();
  assert.equal(notificationDeleteAvailable({ credentialed: false, browserSubscribed: false }), false);
  assert.equal(notificationDeleteAvailable({ credentialed: true, browserSubscribed: false }), true);
  assert.equal(notificationDeleteAvailable({ credentialed: false, browserSubscribed: true }), true);
});

test("permission recovery shown by the notification UI is platform-specific", async () => {
  const { guidanceFor } = await uiModule();

  const iphone = guidanceFor({ reason: "permission_denied", platformGroup: "ios_pwa" });
  const android = guidanceFor({ reason: "permission_denied", platformGroup: "android_pwa" });

  assert.match(iphone, /iPhone/);
  assert.match(iphone, /Settings app/);
  assert.doesNotMatch(iphone, /browser settings/i);
  assert.match(android, /Android/);
  assert.match(android, /Settings/);
});

test("stale prepared configuration is refreshed before asking the user to tap again", async () => {
  const { notificationEnableFailure } = await uiModule();
  assert.deepEqual(notificationEnableFailure("configuration_stale", "fallback"), {
    refreshAvailability: true,
    message: "Notification setup changed. Refreshing it now; choose Enable notifications again when it is ready.",
  });
  assert.deepEqual(notificationEnableFailure("registration_failed", "fallback"), {
    refreshAvailability: true,
    message: "Notification setup was not completed. Refreshing it now; choose Enable notifications again when it is ready.",
  });
  assert.deepEqual(notificationEnableFailure("permission_denied", "fallback"), {
    refreshAvailability: false,
    message: "fallback",
  });
});

test("actionable availability requires enabled configuration and browser subscription preflight", async () => {
  const { resolveActionableNotificationConfiguration } = await uiModule();
  assert.equal(typeof resolveActionableNotificationConfiguration, "function");
  const accepted = [];
  const validateKey = async (key, configurationId) => {
    accepted.push([key, configurationId]);
    if (key !== "valid") throw new Error("invalid");
    return { preparedFor: key };
  };

  assert.equal(await resolveActionableNotificationConfiguration({ enabled: false, publicKey: "valid", configurationId: "config" }, validateKey), null);
  assert.equal(await resolveActionableNotificationConfiguration({ enabled: true, publicKey: null, configurationId: "config" }, validateKey), null);
  assert.equal(await resolveActionableNotificationConfiguration({ enabled: true, publicKey: "invalid", configurationId: "config" }, validateKey), null);
  assert.deepEqual(await resolveActionableNotificationConfiguration({ enabled: true, publicKey: "valid", configurationId: "config" }, validateKey), {
    enabled: true,
    publicKey: "valid",
    configurationId: "config",
    prepared: { preparedFor: "valid" },
  });
  assert.deepEqual(accepted, [["invalid", "config"], ["valid", "config"]]);
});

test("actionable availability retains the prepared browser subscription context", async () => {
  const { resolveActionableNotificationConfiguration } = await uiModule();
  const prepared = {
    applicationServerKey: new Uint8Array([4, 1]),
    existingSubscription: null,
    registration: { pushManager: {} },
  };
  const prepare = async (publicKey, configurationId) => {
    assert.equal(publicKey, "valid");
    assert.equal(configurationId, "config");
    return prepared;
  };

  assert.deepEqual(await resolveActionableNotificationConfiguration({
    enabled: true,
    publicKey: "valid",
    configurationId: "config",
  }, prepare), {
    enabled: true,
    publicKey: "valid",
    configurationId: "config",
    prepared,
  });
});

test("enable attempt consumes the offer only at prompt time or granted success", async () => {
  const { executeNotificationEnableAttempt } = await uiModule();
  assert.equal(typeof executeNotificationEnableAttempt, "function");
  const preferences = prefillNotificationPreferences(3, "UTC");

  for (const code of ["registration_unavailable", "invalid_public_key"]) {
    const statuses = [];
    let consumed = 0;
    await assert.rejects(executeNotificationEnableAttempt({
      preferences,
      subscribe: async () => { throw Object.assign(new Error(code), { code }); },
      setStatus: (value) => statuses.push(value),
      consumeOffer: () => { consumed += 1; },
      onPermissionPrompt: () => statuses.push("prompted"),
    }), (error) => error?.code === code);
    assert.deepEqual(statuses, ["Checking notification setup…"]);
    assert.equal(consumed, 0, `${code} must leave the offer marker clear`);
  }

  const deniedStatuses = [];
  let deniedConsumed = 0;
  await assert.rejects(executeNotificationEnableAttempt({
    preferences,
    subscribe: async (_value, { onPermissionPrompt }) => {
      onPermissionPrompt();
      throw Object.assign(new Error("denied"), { code: "permission_denied" });
    },
    setStatus: (value) => deniedStatuses.push(value),
    consumeOffer: () => { deniedConsumed += 1; },
    onPermissionPrompt: () => deniedStatuses.push("tracked"),
  }), (error) => error?.code === "permission_denied");
  assert.deepEqual(deniedStatuses, ["Checking notification setup…", "Waiting for your browser permission…", "tracked"]);
  assert.equal(deniedConsumed, 1, "an actual prompt consumes the offer even when permission is denied");

  const grantedStatuses = [];
  let grantedConsumed = 0;
  const enabled = await executeNotificationEnableAttempt({
    preferences,
    subscribe: async () => ({ preferences }),
    setStatus: (value) => grantedStatuses.push(value),
    consumeOffer: () => { grantedConsumed += 1; },
    onPermissionPrompt: () => grantedStatuses.push("unexpected prompt"),
  });
  assert.deepEqual(enabled, { preferences });
  assert.deepEqual(grantedStatuses, ["Checking notification setup…"]);
  assert.equal(grantedConsumed, 1, "already-granted permission consumes only after successful subscription");
});

test("enable attempt forwards prepared subscription state into the tap-time subscriber", async () => {
  const { executeNotificationEnableAttempt } = await uiModule();
  const preferences = prefillNotificationPreferences(3, "UTC");
  const prepared = { registration: { pushManager: {} } };
  let received;

  await executeNotificationEnableAttempt({
    preferences,
    prepared,
    subscribe: async (_preferences, options) => {
      received = options.prepared;
      return { preferences };
    },
    setStatus: () => {},
    consumeOffer: () => {},
    onPermissionPrompt: () => {},
  });

  assert.strictEqual(received, prepared);
});

test("the mutation and enable helpers reach PushManager subscription work in the original tap task", async () => {
  const {
    createAccountMutationController,
    executeNotificationEnableAttempt,
  } = await uiModule();
  const preferences = prefillNotificationPreferences(3, "UTC");
  const prepared = { registration: { pushManager: {} } };
  let tapTaskActive = true;
  const controller = createAccountMutationController({ setBusy: () => {} });

  queueMicrotask(() => { tapTaskActive = false; });
  const attempt = controller.run("enable:account", () => executeNotificationEnableAttempt({
    preferences,
    prepared,
    subscribe: (_preferences, options) => {
      assert.equal(tapTaskActive, true, "subscription work must start before the first microtask boundary");
      assert.strictEqual(options.prepared, prepared);
      return Promise.resolve({ preferences });
    },
    setStatus: () => {},
    consumeOffer: () => {},
    onPermissionPrompt: () => {},
  }));

  assert.deepEqual(await attempt, { preferences });
});

test("unsubscribed Account proposal is expanded before permission", async () => {
  const { renderPreferenceEditor } = await uiModule();
  const mount = {
    innerHTML: "",
    querySelectorAll: () => [],
  };
  renderPreferenceEditor(mount, {
    prefix: "account-notification",
    preferences: prefillNotificationPreferences(3, "UTC"),
    disclosure: false,
  });
  assert.match(mount.innerHTML, /Workout days and reminder times/);
  assert.doesNotMatch(mount.innerHTML, /<details/);
});

test("Account enablement requires a current or restored plan", async () => {
  const { evaluateAccountNotificationState } = await uiModule();
  assert.equal(typeof evaluateAccountNotificationState, "function");
  assert.deepEqual(evaluateAccountNotificationState({
    hasPlan: false,
    available: true,
    capabilitySupported: true,
    subscribed: false,
  }), { editorDisabled: true, enableDisabled: true, needsPlan: true });
  assert.deepEqual(evaluateAccountNotificationState({
    hasPlan: true,
    available: true,
    capabilitySupported: true,
    subscribed: false,
  }), { editorDisabled: false, enableDisabled: false, needsPlan: false });
});

test("UI read path rejects an empty schedule with an actionable error", async () => {
  const { readPreferenceEditor, preferenceValidationMessage } = await uiModule();
  assert.equal(typeof readPreferenceEditor, "function");
  assert.equal(typeof preferenceValidationMessage, "function");
  const values = {
    '[data-notification-quiet="start"]': { value: "22:00" },
    '[data-notification-quiet="end"]': { value: "08:00" },
    '[data-notification-category="workout"]': { checked: true },
    '[data-notification-category="followUp"]': { checked: true },
    '[data-notification-category="streak"]': { checked: true },
    '[data-notification-category="recovery"]': { checked: true },
  };
  const editor = {
    dataset: { timezone: "UTC" },
    querySelectorAll: () => [],
    querySelector: (selector) => values[selector] || null,
  };
  const result = readPreferenceEditor({ querySelector: () => editor }, false);

  assert.equal(result.valid, false);
  assert.ok(result.errors.schedule);
  assert.match(preferenceValidationMessage(result), /choose at least one workout day and time/i);
});

test("time-zone migration skips same-zone and unsubscribed records", async () => {
  const { createNotificationTimezoneMigrationController } = await uiModule();
  assert.equal(typeof createNotificationTimezoneMigrationController, "function");
  const preferences = prefillNotificationPreferences(3, "Asia/Kolkata");
  let updates = 0;
  let subscribed = true;
  let currentTimezone = "Asia/Kolkata";
  const controller = createNotificationTimezoneMigrationController({
    getCurrentTimezone: () => currentTimezone,
    canMigrate: () => subscribed,
    loadPreferences: () => preferences,
    updatePreferences: async () => { updates += 1; },
  });

  assert.deepEqual(await controller.run(), { state: "skipped" });
  currentTimezone = "America/New_York";
  subscribed = false;
  assert.deepEqual(await controller.run(), { state: "skipped" });
  assert.equal(updates, 0);
});

test("changed-zone migration preserves controls, deduplicates resume races, and persists success", async () => {
  const { createNotificationTimezoneMigrationController } = await uiModule();
  const preferences = prefillNotificationPreferences(4, "Asia/Kolkata");
  let resolveUpdate;
  const updates = [];
  const successes = [];
  const controller = createNotificationTimezoneMigrationController({
    getCurrentTimezone: () => "America/New_York",
    canMigrate: () => true,
    loadPreferences: () => preferences,
    updatePreferences: (next) => {
      updates.push(next);
      return new Promise((resolve) => { resolveUpdate = resolve; });
    },
    onSuccess: (saved) => successes.push(saved),
  });

  const boot = controller.run();
  const resume = controller.run();
  assert.strictEqual(resume, boot);
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0], { ...preferences, timezone: "America/New_York" });
  resolveUpdate({ preferences: updates[0] });
  assert.deepEqual(await boot, { state: "updated", preferences: updates[0] });
  assert.deepEqual(successes, [updates[0]]);
});

test("failed time-zone migration surfaces safe retry state and a later resume retries", async () => {
  const { createNotificationTimezoneMigrationController } = await uiModule();
  const preferences = prefillNotificationPreferences(3, "Asia/Kolkata");
  const failures = [];
  let attempts = 0;
  const controller = createNotificationTimezoneMigrationController({
    getCurrentTimezone: () => "Europe/London",
    canMigrate: () => true,
    loadPreferences: () => preferences,
    updatePreferences: async (next) => {
      attempts += 1;
      if (attempts === 1) throw new Error("private backend detail");
      return { preferences: next };
    },
    onError: (_error, attempted) => failures.push(attempted),
  });

  assert.deepEqual(await controller.run(), { state: "error" });
  assert.deepEqual(failures, [{ ...preferences, timezone: "Europe/London" }]);
  assert.deepEqual(await controller.run(), {
    state: "updated",
    preferences: { ...preferences, timezone: "Europe/London" },
  });
  assert.equal(attempts, 2);
});
