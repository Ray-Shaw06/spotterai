import test from "node:test";
import assert from "node:assert/strict";

import handler, { __setDepsForTests, __resetDailyCapForTests, callbackUrl, rawBody, DAILY_PUBLISH_CAP } from "../api/rest-push.js";
import { seal, signCancelToken, signUpstashJwt, verifyCancelToken, open, MAX_LATE_SEC } from "../lib/rest-push.js";
import { __resetRateLimitForTests, LIMITS } from "../lib/rate-limit.js";

const ENV = {
  WEB_PUSH_PUBLIC_KEY: "BPublicKey",
  WEB_PUSH_PRIVATE_KEY: "private-key-material",
  WEB_PUSH_SUBJECT: "mailto:ops@example.com",
  QSTASH_TOKEN: "qstash-token",
  QSTASH_CURRENT_SIGNING_KEY: "sig_current",
  QSTASH_NEXT_SIGNING_KEY: "sig_next",
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

const HOST = "spotterai.example";
const CALLBACK = `https://${HOST}/api/rest-push`;
const NOW = 1_700_000_000_000;

function makeRes() {
  const res = { statusCode: null, body: null, ended: false, headers: {} };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; res.ended = true; return res; };
  res.end = () => { res.ended = true; return res; };
  res.setHeader = (key, value) => { res.headers[key] = value; return res; };
  return res;
}

function makeReq({ method = "POST", body, headers = {}, query = {}, url = "/api/rest-push", ip = "203.0.113.7" } = {}) {
  return {
    method,
    body,
    query,
    url,
    headers: { host: HOST, "x-forwarded-for": ip, ...headers },
    socket: { remoteAddress: ip },
  };
}

/** The deps object wire() installed, so a test can re-install it with a new clock. */
let lastDeps = null;
function depsFor() {
  return lastDeps;
}

/** A QStash + push-service double. Records every outbound call. */
function wire({ publishStatus = 201, cancelStatus = 200, sendError = null, env = ENV, now = NOW } = {}) {
  const calls = { qstash: [], sends: [], vapid: null };
  lastDeps = {
    env,
    now: () => now,
    fetch: async (url, init) => {
      calls.qstash.push({ url, init });
      if (init.method === "DELETE") return new Response("", { status: cancelStatus });
      return new Response(JSON.stringify({ messageId: "msg_abc" }), { status: publishStatus });
    },
    webpush: {
      setVapidDetails: (subject, pub, priv) => { calls.vapid = { subject, pub, priv }; },
      sendNotification: async (subscription, payload, options) => {
        calls.sends.push({ subscription, payload, options });
        if (sendError) throw sendError;
        return { statusCode: 201 };
      },
    },
  };
  __setDepsForTests(lastDeps);
  return calls;
}

test.beforeEach(() => {
  __resetRateLimitForTests();
  __resetDailyCapForTests();
  __setDepsForTests(null);
});

test.after(() => __setDepsForTests(null));

test("the callback URL comes from the server's own environment, never from a request header", () => {
  assert.equal(callbackUrl(ENV), CALLBACK);
  assert.equal(callbackUrl({ VERCEL_URL: "preview-abc.vercel.app" }), "https://preview-abc.vercel.app/api/rest-push");
  assert.equal(callbackUrl({ REST_PUSH_ORIGIN: "https://spotterai.xyz" }), "https://spotterai.xyz/api/rest-push");
  // An explicit origin wins over the platform's, and a path on it is ignored.
  assert.equal(callbackUrl({ REST_PUSH_ORIGIN: "https://custom.example/ignored", VERCEL_URL: "x.vercel.app" }), "https://custom.example/api/rest-push");
  // Nothing to go on, or something that is not an https origin.
  assert.equal(callbackUrl({}), null);
  assert.equal(callbackUrl({ REST_PUSH_ORIGIN: "http://insecure.example" }), null);
  assert.equal(callbackUrl({ REST_PUSH_ORIGIN: "spaces are bad" }), null);
});

test("a client cannot aim the callback anywhere by naming a host", async () => {
  // The whole attack this closes: with a header-derived origin, this request
  // would have booked a delayed, Upstash-signed POST to attacker.example on the
  // operator's quota, and defeated the callback's own audience check too.
  const calls = wire();
  const res = makeRes();
  await handler(makeReq({
    body: { subscription: SUB, endsAt: NOW + 90_000, now: NOW },
    headers: { "x-forwarded-host": "attacker.example", host: "attacker.example" },
  }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls.qstash[0].url, `https://qstash.upstash.io/v2/publish/${CALLBACK}`, "still our own origin");
});

test("a callback cannot skip the audience check by omitting the host header", async () => {
  const calls = wire();
  const raw = JSON.stringify({ v: 1, s: seal({ endpoint: SUB.endpoint, keys: SUB.keys }, ENV.WEB_PUSH_PRIVATE_KEY), endsAt: NOW });
  const jwt = signUpstashJwt({ key: "sig_current", body: raw, url: "https://preview-xyz.vercel.app/api/rest-push", now: NOW / 1000 });
  const res = makeRes();
  await handler({ method: "POST", url: "/api/rest-push", headers: { "upstash-signature": jwt }, body: raw, socket: {} }, res);
  assert.equal(res.statusCode, 401, "a JWT signed for another deployment is not ours");
  assert.equal(calls.sends.length, 0);
});

test("a deployment that cannot name itself refuses to send rather than skipping the check", async () => {
  const calls = wire({ env: { ...ENV, VERCEL_PROJECT_PRODUCTION_URL: "", VERCEL_URL: "" } });
  const res = makeRes();
  await handler(signedFire(), res);
  assert.equal(res.statusCode, 401);
  assert.equal(calls.sends.length, 0);
});

test("rawBody keeps a string or Buffer byte-for-byte and serialises an object", () => {
  assert.equal(rawBody("abc"), "abc");
  assert.equal(rawBody(Buffer.from("héllo", "utf8")), "héllo");
  assert.equal(rawBody({ a: 1 }), '{"a":1}');
  assert.equal(rawBody(null), "");
  assert.equal(rawBody(undefined), "");
});

test("GET reports disabled with no key when unconfigured, and the public key when configured", async () => {
  __setDepsForTests({ env: {} });
  let res = makeRes();
  await handler(makeReq({ method: "GET" }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { enabled: false });
  assert.match(res.headers["Cache-Control"], /max-age/);

  __setDepsForTests({ env: ENV });
  res = makeRes();
  await handler(makeReq({ method: "GET" }), res);
  assert.deepEqual(res.body, { enabled: true, publicKey: "BPublicKey" });
  assert.equal(JSON.stringify(res.body).includes("private"), false, "the private key must never leave the server");
});

test("unsupported methods are refused with an Allow header", async () => {
  const res = makeRes();
  await handler(makeReq({ method: "PUT" }), res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, "GET, POST, DELETE");
});

test("scheduling answers 503 when unconfigured, so the client falls back silently", async () => {
  __setDepsForTests({ env: {} });
  const res = makeRes();
  await handler(makeReq({ body: { subscription: SUB, endsAt: NOW + 90_000, now: NOW } }), res);
  assert.equal(res.statusCode, 503);
});

test("scheduling seals the subscription into a QStash message booked for the deadline", async () => {
  const calls = wire();
  const res = makeRes();
  await handler(makeReq({ body: { subscription: SUB, endsAt: NOW + 90_000, now: NOW } }), res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.headers["Cache-Control"], "no-store");
  assert.equal(verifyCancelToken(res.body.token, ENV.WEB_PUSH_PRIVATE_KEY), "msg_abc");
  assert.equal(res.body.endsAt, NOW + 90_000);

  assert.equal(calls.qstash.length, 1);
  const { url, init } = calls.qstash[0];
  assert.equal(url, `https://qstash.upstash.io/v2/publish/${CALLBACK}`);
  assert.equal(init.headers["Upstash-Not-Before"], String(Math.floor((NOW + 90_000) / 1000)));
  assert.equal(init.headers.Authorization, "Bearer qstash-token");

  const message = JSON.parse(init.body);
  assert.equal(message.v, 1);
  assert.equal(message.endsAt, NOW + 90_000);
  assert.equal(init.body.includes(SUB.endpoint), false, "the raw endpoint must not travel through QStash");
  assert.equal(init.body.includes(SUB.keys.auth), false);
  assert.deepEqual(open(message.s, ENV.WEB_PUSH_PRIVATE_KEY), { endpoint: SUB.endpoint, keys: SUB.keys });
});

test("scheduling accepts a JSON string body as Vercel may deliver it", async () => {
  const calls = wire();
  const res = makeRes();
  await handler(makeReq({ body: JSON.stringify({ subscription: SUB, endsAt: NOW + 30_000, now: NOW }) }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls.qstash.length, 1);
});

test("scheduling rejects a bad subscription or a bad deadline without calling QStash", async () => {
  const calls = wire();
  const cases = [
    { body: { subscription: { endpoint: "http://x" }, endsAt: NOW + 1000, now: NOW }, why: "insecure endpoint" },
    { body: { subscription: SUB, endsAt: NOW - 60_000, now: NOW }, why: "already a minute past" },
    { body: { subscription: SUB, endsAt: NOW + 2 * 3600 * 1000, now: NOW }, why: "two hours out" },
    { body: { subscription: SUB, now: NOW }, why: "no deadline" },
    { body: null, why: "no body" },
    { body: "not json", why: "unparseable" },
  ];
  for (const { body, why } of cases) {
    const res = makeRes();
    await handler(makeReq({ body }), res);
    assert.equal(res.statusCode, 400, why);
  }
  assert.equal(calls.qstash.length, 0);

  // A request with no host header at all is fine now: the callback origin never
  // came from the request in the first place.
  const res = makeRes();
  await handler({ method: "POST", headers: {}, body: { subscription: SUB, endsAt: NOW + 1000, now: NOW }, socket: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls.qstash.length, 1);
});

test("a QStash outage is a 502 with honest copy, never a throw", async () => {
  wire({ publishStatus: 500 });
  const res = makeRes();
  await handler(makeReq({ body: { subscription: SUB, endsAt: NOW + 90_000, now: NOW } }), res);
  assert.equal(res.statusCode, 502);
  assert.match(res.body.error, /timer and sound still work/);
});

test("scheduling is rate limited per device, so one phone cannot spend the free tier", async () => {
  wire();
  for (let i = 0; i < LIMITS.restPush.perMinute; i++) {
    const res = makeRes();
    await handler(makeReq({ body: { subscription: SUB, endsAt: NOW + 90_000, now: NOW } }), res);
    assert.equal(res.statusCode, 200, `call ${i + 1}`);
  }
  const res = makeRes();
  await handler(makeReq({ body: { subscription: SUB, endsAt: NOW + 90_000, now: NOW } }), res);
  assert.equal(res.statusCode, 429);

  // The lifter on the next rack, same gym wifi, same IP, is unaffected.
  const other = makeRes();
  const otherSub = { ...SUB, endpoint: "https://web.push.apple.com/AnotherDevice" };
  await handler(makeReq({ body: { subscription: otherSub, endsAt: NOW + 90_000, now: NOW } }), other);
  assert.equal(other.statusCode, 200);
});

test("cancel verifies the token, deletes the QStash message, and answers 204 whatever QStash says", async () => {
  const token = signCancelToken("msg_abc", ENV.WEB_PUSH_PRIVATE_KEY);
  for (const cancelStatus of [200, 404, 500]) {
    const calls = wire({ cancelStatus });
    const res = makeRes();
    await handler(makeReq({ method: "DELETE", query: { token } }), res);
    assert.equal(res.statusCode, 204, `QStash ${cancelStatus}`);
    assert.equal(calls.qstash.length, 1);
    assert.equal(calls.qstash[0].url, "https://qstash.upstash.io/v2/messages/msg_abc");
    assert.equal(calls.qstash[0].init.method, "DELETE");
  }
});

test("cancel reads the token from the URL when the platform gives no query object", async () => {
  const token = signCancelToken("msg_abc", ENV.WEB_PUSH_PRIVATE_KEY);
  const calls = wire();
  const res = makeRes();
  await handler(makeReq({ method: "DELETE", query: undefined, url: `/api/rest-push?token=${encodeURIComponent(token)}` }), res);
  assert.equal(res.statusCode, 204);
  assert.equal(calls.qstash.length, 1);
});

test("cancel with a forged or missing token never reaches QStash", async () => {
  const calls = wire();
  for (const token of [undefined, "", "msg_abc", "msg_abc." + "0".repeat(32), signCancelToken("msg_abc", "other-secret")]) {
    const res = makeRes();
    await handler(makeReq({ method: "DELETE", query: { token } }), res);
    assert.equal(res.statusCode, 400, String(token));
  }
  assert.equal(calls.qstash.length, 0);

  // Unconfigured: there is nothing to cancel, and nothing to leak about why.
  __setDepsForTests({ env: {} });
  const res = makeRes();
  await handler(makeReq({ method: "DELETE", query: { token: "anything" } }), res);
  assert.equal(res.statusCode, 204);
});

// --- The QStash callback --------------------------------------------------------

function signedFire({ endsAt = NOW, key = "sig_current", sealWith = ENV.WEB_PUSH_PRIVATE_KEY, subscription = SUB, url = CALLBACK, v = 1, body } = {}) {
  const raw = body ?? JSON.stringify({ v, s: seal({ endpoint: subscription.endpoint, keys: subscription.keys }, sealWith), endsAt });
  const jwt = signUpstashJwt({ key, body: raw, url, now: NOW / 1000 });
  return makeReq({ body: raw, headers: { "content-type": "text/plain", "upstash-signature": jwt } });
}

test("a signed callback unseals the subscription and sends the push with VAPID, a TTL and a topic", async () => {
  const calls = wire();
  const res = makeRes();
  await handler(signedFire({ endsAt: NOW - 1000 }), res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, { outcome: "sent" });
  assert.deepEqual(calls.vapid, { subject: ENV.WEB_PUSH_SUBJECT, pub: ENV.WEB_PUSH_PUBLIC_KEY, priv: ENV.WEB_PUSH_PRIVATE_KEY });
  assert.equal(calls.sends.length, 1);
  const { subscription, payload, options } = calls.sends[0];
  assert.deepEqual(subscription, { endpoint: SUB.endpoint, keys: SUB.keys });
  assert.deepEqual(JSON.parse(payload), { kind: "rest", endsAt: NOW - 1000 });
  assert.equal(options.TTL, 600);
  assert.equal(options.urgency, "high");
  assert.equal(options.topic, "spotterai-rest");
  // The callback path is not rate limited: it is authenticated, not anonymous.
  assert.equal(calls.qstash.length, 0);
});

test("the callback verifies under the NEXT signing key too, so key rotation cannot drop a rest", async () => {
  const calls = wire();
  const res = makeRes();
  await handler(signedFire({ key: "sig_next" }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls.sends.length, 1);
});

test("the callback body arriving as a Buffer still verifies (raw bytes are what was hashed)", async () => {
  const calls = wire();
  const req = signedFire();
  req.body = Buffer.from(req.body, "utf8");
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls.sends.length, 1);
});

test("a forged, replayed-elsewhere, or tampered callback is a 401 and sends nothing", async () => {
  const calls = wire();
  const cases = [
    { req: signedFire({ key: "attacker" }), why: "wrong key" },
    { req: signedFire({ url: "https://other.example/api/rest-push" }), why: "signed for another host" },
    { req: (() => { const r = signedFire(); r.body = r.body.replace('"v":1', '"v":1 '); return r; })(), why: "body changed after signing" },
    { req: makeReq({ body: "{}", headers: { "upstash-signature": "garbage" } }), why: "not a JWT" },
    { req: makeReq({ body: "{}", headers: { "upstash-signature": "" } }), why: "empty signature header" },
  ];
  for (const { req, why } of cases) {
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 401, why);
  }
  assert.equal(calls.sends.length, 0);
  assert.equal(calls.qstash.length, 0, "a forged signature must not fall through to booking either");
});

test("a valid signature over an unsealable, foreign-version, or stale message answers 200 with no send (no retry)", async () => {
  const calls = wire();
  const cases = [
    { req: signedFire({ sealWith: "some-other-server" }), outcome: "unsealable" },
    { req: signedFire({ v: 2 }), outcome: "unsealable" },
    { req: signedFire({ body: "not json at all" }), outcome: "unsealable" },
    { req: signedFire({ endsAt: NOW - (MAX_LATE_SEC + 5) * 1000 }), outcome: "stale" },
  ];
  for (const { req, outcome } of cases) {
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 200, outcome);
    assert.deepEqual(res.body, { outcome });
  }
  assert.equal(calls.sends.length, 0);
});

test("a dead subscription (404/410 from the push service) is 200 so QStash stops; a hiccup is 502 so it retries", async () => {
  for (const [statusCode, expectStatus, outcome] of [[410, 200, "gone"], [404, 200, "gone"], [500, 502, "failed"]]) {
    const err = new Error("push service"); err.statusCode = statusCode;
    const calls = wire({ sendError: err });
    const res = makeRes();
    await handler(signedFire(), res);
    assert.equal(res.statusCode, expectStatus, `push service ${statusCode}`);
    assert.deepEqual(res.body, { outcome });
    assert.equal(calls.sends.length, 1);
  }
});

test("a callback into an unconfigured deployment is acknowledged, not retried", async () => {
  __setDepsForTests({ env: {} });
  const res = makeRes();
  await handler(makeReq({ body: "{}", headers: { "upstash-signature": "x.y.z" } }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { outcome: "unconfigured" });
});

test("cancelling is rate limited on the same tier as scheduling", async () => {
  // The cancel path also spends a QStash API call, and it is the one a script
  // can hammer without ever producing a valid booking. Without this the whole
  // per-IP budget could be burned on DELETEs.
  const token = signCancelToken("msg_abc", ENV.WEB_PUSH_PRIVATE_KEY);
  const calls = wire();
  for (let i = 0; i < LIMITS.restPush.perMinute; i++) {
    const res = makeRes();
    await handler(makeReq({ method: "DELETE", query: { token } }), res);
    assert.equal(res.statusCode, 204, `call ${i + 1}`);
  }
  const res = makeRes();
  await handler(makeReq({ method: "DELETE", query: { token } }), res);
  assert.equal(res.statusCode, 429);
  assert.equal(calls.qstash.length, LIMITS.restPush.perMinute, "the refused call never reaches QStash");
});

test("a callback sealed by this server but holding something that is not a subscription sends nothing", async () => {
  // open() succeeding is not the same as the payload being safe to hand to
  // web-push: the shape is re-validated on the way out, not only on the way in.
  const calls = wire();
  for (const junk of [{ endpoint: "http://insecure.example/x", keys: SUB.keys }, { endpoint: SUB.endpoint }, "just a string", 42]) {
    const raw = JSON.stringify({ v: 1, s: seal(junk, ENV.WEB_PUSH_PRIVATE_KEY), endsAt: NOW });
    const jwt = signUpstashJwt({ key: "sig_current", body: raw, url: CALLBACK, now: NOW / 1000 });
    const res = makeRes();
    await handler(makeReq({ body: raw, headers: { "upstash-signature": jwt } }), res);
    assert.equal(res.statusCode, 200, JSON.stringify(junk));
    assert.deepEqual(res.body, { outcome: "unsealable" }, "200 so QStash does not retry a payload that can never work");
  }
  assert.equal(calls.sends.length, 0);
});

test("a body that cannot be serialised and a URL that cannot be parsed are answered, not thrown", async () => {
  // req.body is whatever the platform handed us. A shape JSON.stringify chokes
  // on must read as an empty body (a 400), never as an exception escaping into
  // the platform's own 500.
  const circular = { subscription: SUB };
  circular.self = circular;
  assert.equal(rawBody(circular), "");

  wire();
  let res = makeRes();
  await handler(makeReq({ body: circular }), res);
  assert.equal(res.statusCode, 400);

  // No query object and a url the URL parser rejects: the token is simply
  // unreadable, which is a 400 and not a crash.
  res = makeRes();
  await handler(makeReq({ method: "DELETE", query: undefined, url: "//[" }), res);
  assert.equal(res.statusCode, 400);
});

test("the daily publish budget is capped across everyone, not only per IP", async () => {
  // Per-IP limits alone do not defend a 1,000/day free tier on a public route:
  // an attacker rotating IPs would drain the day in minutes, and every real
  // user would silently lose the notification.
  const calls = wire();
  for (let i = 0; i < DAILY_PUBLISH_CAP + 20; i++) {
    __resetRateLimitForTests(); // isolate the daily cap from the per-IP one
    const res = makeRes();
    await handler(makeReq({ body: { subscription: SUB, endsAt: NOW + 90_000, now: NOW }, ip: `203.0.113.${i % 250}` }), res);
  }
  assert.equal(calls.qstash.length, DAILY_PUBLISH_CAP, "the cap holds however many addresses ask");

  // Over budget is a quiet degrade, not an error the user has to understand,
  // and it must not be mistaken for "the operator turned this off".
  __resetRateLimitForTests();
  const res = makeRes();
  await handler(makeReq({ body: { subscription: SUB, endsAt: NOW + 90_000, now: NOW } }), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.configured, true);

  // Tomorrow the budget is whole again.
  __setDepsForTests({ ...depsFor(calls), now: () => NOW + 24 * 3600 * 1000 });
  __resetRateLimitForTests();
  const fresh = makeRes();
  await handler(makeReq({ body: { subscription: SUB, endsAt: NOW + 24 * 3600 * 1000 + 90_000, now: NOW + 24 * 3600 * 1000 } }), fresh);
  assert.equal(fresh.statusCode, 200);
});

test("an unconfigured 503 is marked so the client can tell it from a platform 503", async () => {
  __setDepsForTests({ env: {} });
  const res = makeRes();
  await handler(makeReq({ body: { subscription: SUB, endsAt: NOW + 90_000, now: NOW } }), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.configured, false, "the client latches on this, never on the bare status");
});

test("an anonymous POST carrying a junk signature header is still rate limited", async () => {
  // The header is just a header. Without metering before the branch, attaching
  // one would step off the rate-limited path entirely.
  wire();
  let last;
  for (let i = 0; i <= LIMITS.restPush.perMinute; i++) {
    last = makeRes();
    await handler(makeReq({ body: "{}", headers: { "upstash-signature": "garbage" } }), last);
  }
  assert.equal(last.statusCode, 429);
});

test("a 4xx from the push service is terminal, so QStash stops paying for a send that cannot succeed", async () => {
  // 403 is the one that matters: a VAPID key the subscription no longer
  // matches. Retrying it spends three messages and delivers nothing.
  for (const [statusCode, expectStatus, outcome] of [[403, 200, "rejected"], [400, 200, "rejected"], [413, 200, "rejected"], [410, 200, "gone"], [404, 200, "gone"], [500, 502, "failed"], [503, 502, "failed"]]) {
    const err = new Error("push service"); err.statusCode = statusCode;
    const calls = wire({ sendError: err });
    const res = makeRes();
    await handler(signedFire(), res);
    assert.equal(res.statusCode, expectStatus, `push service ${statusCode}`);
    assert.equal(res.body.outcome, outcome, `push service ${statusCode}`);
    assert.equal(calls.sends.length, 1);
  }
});

test("the deadline QStash is given comes from this server's clock, not the phone's", async () => {
  const calls = wire();
  const res = makeRes();
  // A phone whose clock is 40s fast. Its rest is still 90s long.
  const clientNow = NOW + 40_000;
  await handler(makeReq({ body: { subscription: SUB, endsAt: clientNow + 90_000, now: clientNow } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.endsAt, NOW + 90_000, "90s from now on OUR clock");
  assert.equal(calls.qstash[0].init.headers["Upstash-Not-Before"], String(Math.floor((NOW + 90_000) / 1000)));
  assert.equal(JSON.parse(calls.qstash[0].init.body).endsAt, NOW + 90_000, "the sealed copy agrees, so staleness is judged on one clock");
});
