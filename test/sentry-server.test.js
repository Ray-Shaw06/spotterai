import test from "node:test";
import assert from "node:assert/strict";
import { createServerReporter, withSentry } from "../lib/sentry-server.js";

const DSN = "https://abc123@o4507.ingest.us.sentry.io/4509";

test("a handler that succeeds is untouched and reports nothing", async () => {
  const calls = [];
  const reporter = createServerReporter({ SENTRY_DSN: DSN }, (...a) => { calls.push(a); return true; });
  const wrapped = withSentry(async (req, res) => { res.sent = req.method; return "ok"; }, { reporter });
  const res = {};
  assert.equal(await wrapped({ method: "POST" }, res), "ok");
  assert.equal(res.sent, "POST");
  assert.equal(calls.length, 0);
});

test("a throwing handler is reported and the error still propagates", async () => {
  const calls = [];
  const reporter = createServerReporter({ SENTRY_DSN: DSN }, (endpoint, body) => { calls.push({ endpoint, body }); return true; });
  const wrapped = withSentry(async () => { throw new Error("gemini exploded"); }, { reporter, route: "generate" });

  // The platform's own 500 depends on this rethrow, so it is the contract.
  await assert.rejects(() => wrapped({ method: "POST" }, {}), /gemini exploded/);

  assert.equal(calls.length, 1);
  const event = JSON.parse(calls[0].body.split("\n")[2]);
  assert.equal(event.exception.values[0].value, "gemini exploded");
  assert.deepEqual(event.tags, { surface: "api", route: "generate", method: "POST" });
  assert.equal(event.platform, "node");
});

test("delivery is awaited, because a returned function stops executing", async () => {
  let resolved = false;
  const reporter = createServerReporter({ SENTRY_DSN: DSN }, async () => {
    await new Promise((r) => setTimeout(r, 10));
    resolved = true;
    return true;
  });
  const wrapped = withSentry(async () => { throw new Error("boom"); }, { reporter });
  await assert.rejects(() => wrapped({ method: "GET" }, {}));
  assert.equal(resolved, true, "the wrapper must not return before the event is sent");
});

test("a Sentry outage does not change what the endpoint does", async () => {
  const reporter = createServerReporter({ SENTRY_DSN: DSN }, async () => { throw new Error("ingest down"); });
  const wrapped = withSentry(async () => { throw new Error("original"); }, { reporter });
  // The caller must see the ORIGINAL error, never the reporting one.
  await assert.rejects(() => wrapped({ method: "POST" }, {}), /original/);
});

test("with no SENTRY_DSN the wrapper is a pass-through", async () => {
  const calls = [];
  const reporter = createServerReporter({}, (...a) => { calls.push(a); return true; });
  assert.equal(reporter.enabled, false);
  const wrapped = withSentry(async () => { throw new Error("boom"); }, { reporter });
  await assert.rejects(() => wrapped({ method: "POST" }, {}), /boom/);
  assert.equal(calls.length, 0);
});

test("Vercel's build vars become release and environment", async () => {
  const calls = [];
  const reporter = createServerReporter(
    { SENTRY_DSN: DSN, VERCEL_GIT_COMMIT_SHA: "abc1234", VERCEL_ENV: "production" },
    (endpoint, body) => { calls.push(body); return true; },
  );
  await withSentry(async () => { throw new Error("boom"); }, { reporter })({ method: "GET" }, {}).catch(() => {});
  const event = JSON.parse(calls[0].split("\n")[2]);
  assert.equal(event.release, "abc1234");
  assert.equal(event.environment, "production");
});
