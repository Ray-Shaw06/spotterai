import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_EVENTS_PER_SESSION,
  buildEnvelope,
  buildEvent,
  createReporter,
  fingerprint,
  parseDsn,
  parseStack,
  scrubUrl,
} from "../lib/sentry.js";

const DSN = "https://abc123@o4507.ingest.us.sentry.io/4509";

test("a DSN splits into the pieces the envelope endpoint needs", () => {
  assert.deepEqual(parseDsn(DSN), {
    publicKey: "abc123",
    projectId: "4509",
    endpoint: "https://o4507.ingest.us.sentry.io/api/4509/envelope/?sentry_key=abc123&sentry_version=7",
  });
});

test("an absent or malformed DSN parses to null rather than throwing", () => {
  // Each of these is a real way a DSN arrives wrong: unset env var, empty meta
  // tag, pasted without the key, pasted without the project id, or not a URL.
  for (const bad of [undefined, null, "", "   ", "https://o4507.ingest.us.sentry.io/4509", "https://abc123@o4507.ingest.us.sentry.io/", "https://abc123@host/not-a-number", "not a url"]) {
    assert.equal(parseDsn(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test("URLs are reduced to origin, path, and hash route", () => {
  assert.equal(scrubUrl("https://spotterai.xyz/#/import"), "https://spotterai.xyz/#/import");
  assert.equal(scrubUrl("https://spotterai.xyz/index.html?token=secret"), "https://spotterai.xyz/index.html");
  assert.equal(scrubUrl("https://spotterai.xyz/#/plan?share=abc"), "https://spotterai.xyz/#/plan");
  assert.equal(scrubUrl("gibberish"), undefined);
  assert.equal(scrubUrl(""), undefined);
});

test("V8 stacks parse to frames, oldest first", () => {
  const stack = [
    "TypeError: x is not a function",
    "    at audit (https://spotterai.xyz/evaluator.js:12:3)",
    "    at https://spotterai.xyz/app.js:99:1",
  ].join("\n");
  assert.deepEqual(parseStack(stack), [
    { filename: "https://spotterai.xyz/app.js", lineno: 99, colno: 1 },
    { function: "audit", filename: "https://spotterai.xyz/evaluator.js", lineno: 12, colno: 3 },
  ]);
});

test("an unparseable stack yields no frames and is kept raw in extra", () => {
  assert.deepEqual(parseStack("Error: boom\n  <anonymous>"), []);
  const event = buildEvent(Object.assign(new Error("boom"), { stack: "Error: boom\n  <anonymous>" }), { eventId: "a".repeat(32) });
  assert.equal(event.exception.values[0].stacktrace, undefined);
  assert.match(event.extra.stack, /<anonymous>/);
});

test("anything throwable becomes an event, not an exception", () => {
  for (const thrown of ["a string", 42, null, undefined, { code: "E" }, new TypeError("bad")]) {
    const event = buildEvent(thrown, { eventId: "b".repeat(32) });
    assert.equal(typeof event.exception.values[0].value, "string");
    assert.equal(event.level, "error");
  }
});

test("the envelope is three newline-delimited JSON lines", () => {
  const event = buildEvent(new Error("boom"), { eventId: "c".repeat(32), timestamp: "2026-08-23T00:00:00.000Z" });
  const lines = buildEnvelope(event, "2026-08-23T00:00:01.000Z").split("\n");
  assert.equal(lines.length, 3);
  assert.deepEqual(JSON.parse(lines[0]), { event_id: "c".repeat(32), sent_at: "2026-08-23T00:00:01.000Z" });
  assert.deepEqual(JSON.parse(lines[1]), { type: "event" });
  assert.equal(JSON.parse(lines[2]).exception.values[0].value, "boom");
});

test("no DSN means nothing is sent and nothing throws", () => {
  const calls = [];
  const reporter = createReporter({ dsn: "", transport: (...a) => calls.push(a) });
  assert.equal(reporter.enabled, false);
  assert.equal(reporter.captureException(new Error("boom")), false);
  assert.equal(calls.length, 0);
});

test("the same error twice in one session is sent once", () => {
  const calls = [];
  const reporter = createReporter({ dsn: DSN, transport: (...a) => calls.push(a) });
  const boom = () => { throw new Error("boom"); };
  for (let i = 0; i < 5; i += 1) {
    try { boom(); } catch (error) { reporter.captureException(error); }
  }
  assert.equal(calls.length, 1, "identical errors should collapse to one event");
});

test("a runaway loop cannot burn the yearly event quota", () => {
  const calls = [];
  const reporter = createReporter({ dsn: DSN, transport: (...a) => calls.push(a) });
  // Distinct messages, so dedupe does not do the work the cap is here to do.
  for (let i = 0; i < 500; i += 1) reporter.captureException(new Error(`boom ${i}`));
  assert.equal(calls.length, MAX_EVENTS_PER_SESSION);
});

test("a transport that throws is swallowed", () => {
  const reporter = createReporter({ dsn: DSN, transport: () => { throw new Error("network down"); } });
  assert.equal(reporter.captureException(new Error("boom")), false);
});

test("release, environment, tags, and a scrubbed URL ride along", () => {
  const calls = [];
  const reporter = createReporter({
    dsn: DSN,
    release: "spotterai@1.0.0",
    environment: "production",
    tags: { surface: "browser" },
    transport: (endpoint, body) => calls.push({ endpoint, body }),
  });
  reporter.captureException(new Error("boom"), {
    url: "https://spotterai.xyz/#/plan?share=abc",
    tags: { route: "plan" },
  });
  const event = JSON.parse(calls[0].body.split("\n")[2]);
  assert.equal(event.release, "spotterai@1.0.0");
  assert.equal(event.environment, "production");
  assert.deepEqual(event.tags, { surface: "browser", route: "plan" });
  assert.equal(event.request.url, "https://spotterai.xyz/#/plan");
  assert.equal(calls[0].endpoint, parseDsn(DSN).endpoint);
});

test("fingerprints unite the same throw site and separate different ones", () => {
  // The throw SITE is part of the identity, deliberately: the same message
  // raised from two different files is two different bugs. So both of these
  // have to come from one call site to be the same error.
  const raise = (message) => { throw new Error(message); };
  const capture = (message, eventId) => {
    try { raise(message); } catch (error) { return buildEvent(error, { eventId }); }
  };
  const one = capture("a", "d".repeat(32));
  const two = capture("a", "e".repeat(32));
  const three = capture("b", "f".repeat(32));
  assert.equal(fingerprint(one), fingerprint(two));
  assert.notEqual(fingerprint(one), fingerprint(three));
});
