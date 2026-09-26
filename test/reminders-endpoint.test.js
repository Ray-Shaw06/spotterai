/**
 * /api/reminders: workout, meal and water pushes booked through the same
 * QStash + Web Push path as rest push. See
 * docs/superpowers/specs/2026-09-25-reminders-design.md.
 */

import test from "node:test";
import assert from "node:assert/strict";

import handler, {
  __setDepsForTests,
  __resetDailyCapForTests,
  callbackUrl,
  validReminder,
  DAILY_REMINDER_CAP,
} from "../api/reminders.js";
import restPush, {
  __setDepsForTests as setRestDeps,
  __resetDailyCapForTests as resetRestCap,
} from "../api/rest-push.js";
import { seal, signUpstashJwt, verifyCancelToken } from "../lib/rest-push.js";
import { __resetRateLimitForTests } from "../lib/rate-limit.js";

const ENV = {
  WEB_PUSH_PUBLIC_KEY: "BPublicKey",
  WEB_PUSH_PRIVATE_KEY: "private-key-material",
  WEB_PUSH_SUBJECT: "mailto:ops@example.com",
  QSTASH_TOKEN: "qstash-token",
  QSTASH_CURRENT_SIGNING_KEY: "sig_current",
  VERCEL_PROJECT_PRODUCTION_URL: "spotterai.example",
};

const SUB = {
  endpoint: "https://web.push.apple.com/QAbCdEf123",
  expirationTime: null,
  keys: {
    p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
    auth: "tBHItJI5svbpez7KI4CCXg",
  },
};

const CALLBACK = "https://spotterai.example/api/reminders";
const NOW = 1_790_000_000_000;
const DAY = 24 * 3600 * 1000;

function makeRes() {
  const res = { statusCode: null, body: null, ended: false, headers: {} };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; res.ended = true; return res; };
  res.end = () => { res.ended = true; return res; };
  res.setHeader = (key, value) => { res.headers[key] = value; return res; };
  return res;
}

function makeReq({ method = "POST", body, headers = {}, query = {}, url = "/api/reminders", ip = "203.0.113.7" } = {}) {
  return { method, body, query, url, headers: { host: "spotterai.example", "x-forwarded-for": ip, ...headers }, socket: { remoteAddress: ip } };
}

function wire({ publishStatus = 201, env = ENV, now = NOW, sendError = null } = {}) {
  const calls = { qstash: [], sends: [] };
  const deps = {
    env,
    now: () => now,
    fetch: async (url, init) => {
      calls.qstash.push({ url, init });
      if (init.method === "DELETE") return new Response("", { status: 200 });
      return new Response(JSON.stringify({ messageId: "msg_abc" }), { status: publishStatus });
    },
    webpush: {
      setVapidDetails: () => {},
      sendNotification: async (subscription, payload, options) => {
        calls.sends.push({ subscription, payload, options });
        if (sendError) throw sendError;
        return { statusCode: 201 };
      },
    },
  };
  __setDepsForTests(deps);
  return calls;
}

const book = (fields = {}) => makeReq({ body: { subscription: SUB, kind: "meal", detail: "lunch", at: NOW + 2 * DAY, now: NOW, ...fields } });

function signedFire(payload) {
  const raw = JSON.stringify({ v: 1, s: seal({ endpoint: SUB.endpoint, keys: SUB.keys }, ENV.WEB_PUSH_PRIVATE_KEY), ...payload });
  const jwt = signUpstashJwt({ key: "sig_current", body: raw, url: CALLBACK, now: NOW / 1000 });
  return makeReq({ body: raw, headers: { "content-type": "text/plain", "upstash-signature": jwt } });
}

test.beforeEach(() => {
  __resetRateLimitForTests();
  __resetDailyCapForTests();
  resetRestCap();
  __setDepsForTests(null);
  setRestDeps(null);
});

test.after(() => {
  __setDepsForTests(null);
  setRestDeps(null);
});

test("the callback is this route, on the server's own origin", () => {
  assert.equal(callbackUrl(ENV), CALLBACK);
});

test("only the three kinds, and meal slots only on meals", () => {
  assert.deepEqual(validReminder("meal", "lunch"), { kind: "meal", detail: "lunch" });
  assert.deepEqual(validReminder("water", ""), { kind: "water", detail: "" });
  assert.deepEqual(validReminder("workout", undefined), { kind: "workout", detail: "" });
  assert.equal(validReminder("meal", "brunch"), null);
  assert.equal(validReminder("water", "lunch"), null);
  assert.equal(validReminder("rest", ""), null);
  assert.equal(validReminder("constructor", ""), null);
});

test("booking seals the subscription into a QStash message for the reminder's time", async () => {
  const calls = wire();
  const res = makeRes();
  await handler(book(), res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(verifyCancelToken(res.body.token, ENV.WEB_PUSH_PRIVATE_KEY), "msg_abc");
  assert.equal(calls.qstash.length, 1);
  const { url, init } = calls.qstash[0];
  assert.equal(url, `https://qstash.upstash.io/v2/publish/${CALLBACK}`);
  assert.equal(init.headers["Upstash-Not-Before"], String(Math.floor((NOW + 2 * DAY) / 1000)));
  const message = JSON.parse(init.body);
  assert.equal(message.kind, "meal");
  assert.equal(message.detail, "lunch");
  assert.equal(message.at, NOW + 2 * DAY);
  assert.equal(init.body.includes(SUB.endpoint), false, "the raw endpoint must not travel through QStash");
});

test("bad kinds, slots, times and subscriptions are 400s that never reach QStash", async () => {
  const calls = wire();
  const cases = [
    [{ kind: "snack", detail: "" }, "unknown kind"],
    [{ kind: "meal", detail: "brunch" }, "unknown slot"],
    [{ kind: "water", detail: "lunch" }, "slot on a non-meal"],
    [{ at: NOW - 60_000 }, "in the past"],
    [{ at: NOW + 8 * DAY }, "past QStash's 7-day limit"],
    [{ at: undefined }, "no time"],
    [{ subscription: { endpoint: "http://x" } }, "bad subscription"],
  ];
  for (const [fields, why] of cases) {
    const res = makeRes();
    await handler(book(fields), res);
    assert.equal(res.statusCode, 400, why);
  }
  assert.equal(calls.qstash.length, 0);
});

test("unconfigured is a marked 503, so the client can tell it from an outage", async () => {
  __setDepsForTests({ env: {} });
  const res = makeRes();
  await handler(book(), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.configured, false);
});

test("the daily reminder budget is its own, and never spends rest push's", async () => {
  const calls = wire();
  for (let i = 0; i < DAILY_REMINDER_CAP; i++) {
    __resetRateLimitForTests();
    const res = makeRes();
    await handler(book({ at: NOW + DAY + i * 60_000 }), res);
    assert.equal(res.statusCode, 200, `booking ${i + 1}`);
  }
  __resetRateLimitForTests();
  const over = makeRes();
  await handler(book(), over);
  assert.equal(over.statusCode, 503);
  assert.equal(over.body.configured, true);
  assert.equal(calls.qstash.length, DAILY_REMINDER_CAP);

  setRestDeps({ env: ENV, now: () => NOW, fetch: async () => new Response(JSON.stringify({ messageId: "msg_rest" }), { status: 201 }) });
  const rest = makeRes();
  await restPush(makeReq({ url: "/api/rest-push", body: { subscription: SUB, endsAt: NOW + 90_000, now: NOW } }), rest);
  assert.equal(rest.statusCode, 200, "rest push still books after reminders spent their budget");
});

test("cancel deletes the QStash message for a real token and refuses a forged one", async () => {
  const calls = wire();
  const booked = makeRes();
  await handler(book(), booked);
  const res = makeRes();
  await handler(makeReq({ method: "DELETE", query: { token: booked.body.token } }), res);
  assert.equal(res.statusCode, 204);
  assert.equal(calls.qstash.at(-1).init.method, "DELETE");
  assert.match(calls.qstash.at(-1).url, /\/v2\/messages\/msg_abc$/);

  const forged = makeRes();
  await handler(makeReq({ method: "DELETE", query: { token: "nope" } }), forged);
  assert.equal(forged.statusCode, 400);
});

test("a signed callback sends only kind, detail and time, with a topic per kind", async () => {
  const calls = wire();
  const res = makeRes();
  await handler(signedFire({ kind: "meal", detail: "lunch", at: NOW - 60_000 }), res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, { outcome: "sent" });
  const { subscription, payload, options } = calls.sends[0];
  assert.deepEqual(subscription, { endpoint: SUB.endpoint, keys: SUB.keys });
  assert.deepEqual(JSON.parse(payload), { kind: "meal", detail: "lunch", at: NOW - 60_000 });
  assert.equal(options.TTL, 3600);
  assert.equal(options.urgency, "normal");
  assert.equal(options.topic, "spotterai-meal");
});

test("a reminder more than 30 minutes late, or not ours, is acknowledged and not sent", async () => {
  const calls = wire();
  const stale = makeRes();
  await handler(signedFire({ kind: "water", detail: "", at: NOW - 31 * 60_000 }), stale);
  assert.deepEqual(stale.body, { outcome: "stale" });

  const foreign = makeRes();
  await handler(signedFire({ kind: "rest", detail: "", at: NOW }), foreign);
  assert.deepEqual(foreign.body, { outcome: "unsealable" });

  const late = makeRes();
  await handler(signedFire({ kind: "workout", detail: "", at: NOW - 20 * 60_000 }), late);
  assert.deepEqual(late.body, { outcome: "sent" }, "twenty minutes late is still worth showing");
  assert.equal(calls.sends.length, 1);
});

test("a forged callback signature is a 401 and sends nothing", async () => {
  const calls = wire();
  const req = signedFire({ kind: "water", detail: "", at: NOW });
  req.headers["upstash-signature"] = "junk";
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(calls.sends.length, 0);
});

test("a dead subscription is 200 so QStash stops; a push-service hiccup is 502 so it retries", async () => {
  wire({ sendError: Object.assign(new Error("gone"), { statusCode: 410 }) });
  const gone = makeRes();
  await handler(signedFire({ kind: "water", detail: "", at: NOW }), gone);
  assert.deepEqual(gone.body, { outcome: "gone" });

  wire({ sendError: Object.assign(new Error("boom"), { statusCode: 503 }) });
  const hiccup = makeRes();
  await handler(signedFire({ kind: "water", detail: "", at: NOW }), hiccup);
  assert.equal(hiccup.statusCode, 502);
});

test("GET and other methods are refused; config lives on /api/rest-push", async () => {
  wire();
  const res = makeRes();
  await handler(makeReq({ method: "GET" }), res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, "POST, DELETE");
});
