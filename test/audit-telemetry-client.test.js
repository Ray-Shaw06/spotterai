import test from "node:test";
import assert from "node:assert/strict";
import { buildTelemetryPayload, sendAuditTelemetry } from "../audit-telemetry-client.js";
import { sanitizeTelemetry } from "../lib/telemetry-schema.js";
import { evaluatePlan } from "../evaluator.js";

const plan = {
  program_name: "My Secret Program",
  goal: "Hypertrophy",
  days_per_week: 2,
  progression: "Add 2.5kg when you hit the top of the range.",
  general_notes: "private note",
  days: [
    { day: "Day", focus: "Upper", exercises: [
      { name: "Barbell Bench Press", sets: 4, reps: "6-8", rpe: 8, notes: "keep elbows tucked" },
      { name: "Barbell Row", sets: 4, reps: "6-8", rpe: 8, notes: "" },
    ] },
    { day: "Rest", focus: "Rest", exercises: [] },
  ],
};
const inputs = { goal: "Hypertrophy", experience: "Intermediate" };

test("a real audit produces a payload the server-side sanitizer accepts", () => {
  const audit = evaluatePlan(plan, inputs);
  const payload = buildTelemetryPayload(audit, plan, inputs, "generate");
  assert.notEqual(payload, null);
  assert.deepEqual(sanitizeTelemetry(payload), payload);
});

test("the payload carries no plan content of any kind", () => {
  const audit = evaluatePlan(plan, inputs);
  const serialized = JSON.stringify(buildTelemetryPayload(audit, plan, inputs, "generate"));
  assert.doesNotMatch(serialized, /My Secret Program|Barbell Bench Press|Barbell Row|private note|elbows|2\.5kg/);
});

test("the raw score never leaves the browser, only its bucket", () => {
  const audit = evaluatePlan(plan, inputs);
  const payload = buildTelemetryPayload(audit, plan, inputs, "generate");
  assert.equal("score" in payload, false);
  assert.ok(["0-59", "60-74", "75-84", "85-100"].includes(payload.scoreBucket));
});

test("counts describe shape only", () => {
  const audit = evaluatePlan(plan, inputs);
  const payload = buildTelemetryPayload(audit, plan, inputs, "generate");
  assert.equal(payload.daysCount, 2);
  assert.equal(payload.exerciseCount, 2);
});

test("missing profile inputs fall back to the General/Beginner defaults rather than dropping the audit", () => {
  const audit = evaluatePlan(plan, {});
  const payload = buildTelemetryPayload(audit, plan, {}, "import");
  assert.notEqual(payload, null);
  assert.equal(payload.goal, "General");
  assert.equal(payload.experience, "Beginner");
  assert.equal(payload.source, "import");
});

test("an unknown source is refused", () => {
  const audit = evaluatePlan(plan, inputs);
  assert.equal(buildTelemetryPayload(audit, plan, inputs, "somewhere"), null);
});

test("a malformed audit yields null instead of throwing", () => {
  assert.equal(buildTelemetryPayload(null, plan, inputs, "generate"), null);
  assert.equal(buildTelemetryPayload({ checks: [] }, plan, inputs, "generate"), null);
});

test("sending uses sendBeacon and never throws when the transport fails", () => {
  const audit = evaluatePlan(plan, inputs);

  // Node 22 defines a global `navigator` (a real Navigator instance) as a
  // getter-only accessor property. In this file's strict-mode ESM context,
  // a plain `globalThis.navigator = {...}` throws
  // "TypeError: Cannot set property navigator of #<Object> which has only a
  // getter" instead of shadowing it. Object.defineProperty replaces the
  // accessor with a normal, writable, configurable data property so it can
  // be stubbed and later deleted, matching how a browser's `navigator`
  // behaves when a test stubs it directly.
  const setNavigator = (value) => {
    Object.defineProperty(globalThis, "navigator", {
      value, configurable: true, writable: true, enumerable: true,
    });
  };

  const calls = [];
  setNavigator({ sendBeacon: (url, blob) => { calls.push(url); return true; } });
  assert.equal(sendAuditTelemetry(audit, plan, inputs, "generate"), true);
  assert.deepEqual(calls, ["/api/audit-telemetry"]);

  setNavigator({ sendBeacon: () => { throw new Error("blocked"); } });
  assert.equal(sendAuditTelemetry(audit, plan, inputs, "generate"), false);

  // With the property now a normal configurable data property (set up by
  // setNavigator above), delete actually removes it — verified separately:
  // in Node 22 this makes bare `navigator` an unresolved reference, so code
  // that reads `navigator.sendBeacon` throws a ReferenceError. The transport
  // call inside sendAuditTelemetry must catch that too, not just a rejected
  // sendBeacon, so this proves the real "no transport" path, not a rewritten
  // stand-in for it.
  delete globalThis.navigator;
  assert.equal(sendAuditTelemetry(audit, plan, inputs, "generate"), false);
});
