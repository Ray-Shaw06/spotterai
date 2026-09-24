import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  restPushEnv,
  validateSubscription,
  seal,
  open,
  signCancelToken,
  verifyCancelToken,
  verifyUpstashSignature,
  signUpstashJwt,
  deadlineFor,
  isPushServiceHost,
  isStale,
  publishQstashMessage,
  cancelQstashMessage,
  toBase64Url,
  MAX_LEAD_SEC,
  MAX_LATE_SEC,
} from "../lib/rest-push.js";

const FULL_ENV = {
  WEB_PUSH_PUBLIC_KEY: "BPublicKey",
  WEB_PUSH_PRIVATE_KEY: "private-key-material",
  WEB_PUSH_SUBJECT: "mailto:ops@example.com",
  QSTASH_TOKEN: "qstash-token",
  QSTASH_CURRENT_SIGNING_KEY: "sig_current",
  QSTASH_NEXT_SIGNING_KEY: "sig_next",
};

// The exact shape PushSubscription.toJSON() produces on a real device.
const SUB = {
  endpoint: "https://web.push.apple.com/QAbCdEf123",
  expirationTime: null,
  keys: {
    p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
    auth: "tBHItJI5svbpez7KI4CCXg",
  },
};

test("restPushEnv is all-or-nothing: any missing required value means not configured", () => {
  const cfg = restPushEnv(FULL_ENV);
  assert.ok(cfg);
  assert.deepEqual(cfg.signingKeys, ["sig_current", "sig_next"]);
  for (const key of ["WEB_PUSH_PUBLIC_KEY", "WEB_PUSH_PRIVATE_KEY", "WEB_PUSH_SUBJECT", "QSTASH_TOKEN", "QSTASH_CURRENT_SIGNING_KEY"]) {
    assert.equal(restPushEnv({ ...FULL_ENV, [key]: "" }), null, `${key} missing must disable`);
    assert.equal(restPushEnv({ ...FULL_ENV, [key]: "   " }), null, `${key} blank must disable`);
  }
  // The next signing key is optional (Upstash only issues one until you rotate).
  assert.deepEqual(restPushEnv({ ...FULL_ENV, QSTASH_NEXT_SIGNING_KEY: "" }).signingKeys, ["sig_current"]);
  // VAPID subjects must be mailto: or https:, anything else is misconfiguration.
  assert.equal(restPushEnv({ ...FULL_ENV, WEB_PUSH_SUBJECT: "ops@example.com" }), null);
  assert.ok(restPushEnv({ ...FULL_ENV, WEB_PUSH_SUBJECT: "https://spotterai.example" }));
});

test("validateSubscription accepts a real toJSON() shape and rejects everything else", () => {
  assert.deepEqual(validateSubscription(SUB), { endpoint: SUB.endpoint, keys: SUB.keys });
  // Base64 padding on the keys is tolerated and stripped.
  const padded = validateSubscription({ ...SUB, keys: { p256dh: SUB.keys.p256dh + "=", auth: SUB.keys.auth + "==" } });
  assert.deepEqual(padded.keys, SUB.keys);

  assert.equal(validateSubscription(null), null);
  assert.equal(validateSubscription("string"), null);
  assert.equal(validateSubscription({ ...SUB, endpoint: "http://insecure.example/x" }), null);
  assert.equal(validateSubscription({ ...SUB, endpoint: "not a url" }), null);
  assert.equal(validateSubscription({ ...SUB, endpoint: "https://web.push.apple.com/" + "a".repeat(2100) }), null);
  assert.equal(validateSubscription({ endpoint: SUB.endpoint }), null);
  assert.equal(validateSubscription({ ...SUB, keys: { p256dh: "short", auth: SUB.keys.auth } }), null);
  assert.equal(validateSubscription({ ...SUB, keys: { p256dh: SUB.keys.p256dh, auth: "not+base64url/" } }), null);
  assert.equal(validateSubscription({ ...SUB, keys: { p256dh: SUB.keys.p256dh + "x".repeat(20), auth: SUB.keys.auth } }), null);
});

test("seal/open round-trips only under the same secret and detects tampering", () => {
  const token = seal(SUB, "secret-a");
  assert.match(token, /^[A-Za-z0-9_-]+$/, "must be base64url so it survives any transport");
  assert.deepEqual(open(token, "secret-a"), SUB);
  // Two seals of the same value differ (random IV), both open.
  const again = seal(SUB, "secret-a");
  assert.notEqual(again, token);
  assert.deepEqual(open(again, "secret-a"), SUB);

  assert.equal(open(token, "secret-b"), null, "another secret must not open it");
  const flipped = token.slice(0, -2) + (token.endsWith("A") ? "BB" : "AA");
  assert.equal(open(flipped, "secret-a"), null, "a flipped byte must fail the GCM tag");
  assert.equal(open("", "secret-a"), null);
  assert.equal(open("nope", "secret-a"), null);
  assert.equal(open(undefined, "secret-a"), null);
});

test("the sealed blob never contains the endpoint or keys in the clear", () => {
  const token = seal(SUB, "secret-a");
  const raw = Buffer.from(token.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("latin1");
  assert.equal(raw.includes("apple.com"), false);
  assert.equal(raw.includes(SUB.keys.auth), false);
  assert.equal(token.includes(SUB.keys.auth), false);
});

test("cancel tokens are bound to the message id and to the secret", () => {
  const token = signCancelToken("msg_abc123", "secret-a");
  assert.match(token, /^msg_abc123\.[0-9a-f]{32}$/);
  assert.equal(verifyCancelToken(token, "secret-a"), "msg_abc123");
  assert.equal(verifyCancelToken(token, "secret-b"), null);
  assert.equal(verifyCancelToken("msg_other." + token.split(".")[1], "secret-a"), null);
  assert.equal(verifyCancelToken("msg_abc123", "secret-a"), null, "bare id without a mac");
  assert.equal(verifyCancelToken("../x." + "0".repeat(32), "secret-a"), null, "id must be url-safe");
  assert.equal(verifyCancelToken(42, "secret-a"), null);
  assert.equal(verifyCancelToken("a".repeat(300), "secret-a"), null);
});

const URL_ = "https://spotterai.example/api/rest-push";

test("verifyUpstashSignature accepts a JWT signed with the current or the next key", () => {
  const body = '{"v":1,"s":"blob","endsAt":1700000000000}';
  const now = 1_700_000_000;
  for (const key of ["sig_current", "sig_next"]) {
    const jwt = signUpstashJwt({ key, body, url: URL_, now });
    const claims = verifyUpstashSignature({ signature: jwt, body, url: URL_, keys: ["sig_current", "sig_next"], now });
    assert.ok(claims, `must verify under ${key}`);
    assert.equal(claims.iss, "Upstash");
    assert.equal(claims.sub, URL_);
  }
});

test("verifyUpstashSignature rejects every forged or stale variant", () => {
  const body = '{"v":1}';
  const now = 1_700_000_000;
  const keys = ["sig_current"];
  const good = signUpstashJwt({ key: "sig_current", body, url: URL_, now });
  assert.ok(verifyUpstashSignature({ signature: good, body, url: URL_, keys, now }));

  // Wrong key.
  assert.equal(verifyUpstashSignature({ signature: signUpstashJwt({ key: "attacker", body, url: URL_, now }), body, url: URL_, keys, now }), null);
  // Body swapped after signing: the hash claim no longer matches the bytes.
  assert.equal(verifyUpstashSignature({ signature: good, body: '{"v":2}', url: URL_, keys, now }), null);
  // Aimed at a different endpoint.
  assert.equal(verifyUpstashSignature({ signature: good, body, url: "https://other.example/api/rest-push", keys, now }), null);
  // Expired (Upstash JWTs live 5 minutes; tolerance is 60s).
  assert.equal(verifyUpstashSignature({ signature: good, body, url: URL_, keys, now: now + 300 + 61 }), null);
  assert.ok(verifyUpstashSignature({ signature: good, body, url: URL_, keys, now: now + 300 + 30 }), "inside tolerance still passes");
  // Not yet valid.
  assert.equal(verifyUpstashSignature({ signature: good, body, url: URL_, keys, now: now - 61 }), null);
  // Wrong issuer.
  assert.equal(verifyUpstashSignature({ signature: signUpstashJwt({ key: "sig_current", body, url: URL_, now, claims: { iss: "Someone" } }), body, url: URL_, keys, now }), null);
  // alg=none and friends are not HS256.
  assert.equal(verifyUpstashSignature({ signature: signUpstashJwt({ key: "sig_current", body, url: URL_, now, header: { alg: "none" } }), body, url: URL_, keys, now }), null);
  // Garbage.
  assert.equal(verifyUpstashSignature({ signature: "a.b", body, url: URL_, keys, now }), null);
  assert.equal(verifyUpstashSignature({ signature: undefined, body, url: URL_, keys, now }), null);
  assert.equal(verifyUpstashSignature({ signature: good, body, url: URL_, keys: [], now }), null);
  assert.equal(verifyUpstashSignature({ signature: "x.y.z", body, url: URL_, keys, now }), null);
});

test("the body claim is compared padding-insensitively, as Upstash's own receiver does", () => {
  const body = "hello";
  const now = 1_700_000_000;
  const padded = toBase64Url(createHash("sha256").update(body).digest()) + "==";
  const jwt = signUpstashJwt({ key: "k", body, url: URL_, now, claims: { body: padded } });
  assert.ok(verifyUpstashSignature({ signature: jwt, body, url: URL_, keys: ["k"], now }));
});

test("deadlineFor accepts leads inside the rest range and floors to the second", () => {
  const now = 1_700_000_000_500; // .5s into a second
  assert.equal(deadlineFor(now + 90_000, now, now).notBefore, Math.floor((now + 90_000) / 1000));
  assert.equal(deadlineFor(now + 1_500, now, now).notBefore, Math.floor((now + 1_500) / 1000));
  // A deadline that just passed still books (the push arrives ~now, which is
  // right), but never before the current second.
  assert.equal(deadlineFor(now - 2_000, now, now).notBefore, Math.floor(now / 1000));
  // Too far in the past, too far in the future, or not a number.
  assert.equal(deadlineFor(now - 6_000, now, now), null);
  assert.equal(deadlineFor(now + (MAX_LEAD_SEC + 1) * 1000, now, now), null);
  assert.equal(deadlineFor("soon", now, now), null);
  assert.equal(deadlineFor(undefined, now, now), null);
});

test("deadlineFor takes the INTERVAL from the client and the ORIGIN from this server", () => {
  const serverNow = 1_700_000_000_000;
  // A phone whose clock is 40s fast: it reports a deadline 40s beyond what its
  // own timer will actually reach on the server's clock. The push must land
  // when the timer hits zero, not 40s later.
  const clientNow = serverNow + 40_000;
  const d = deadlineFor(clientNow + 120_000, clientNow, serverNow);
  assert.equal(d.endsAt, serverNow + 120_000, "120s of rest is 120s from now, whatever the phone thinks the date is");
  assert.equal(d.notBefore, Math.floor((serverNow + 120_000) / 1000));

  // A slow clock is the mirror image, and a short rest on a skewed clock is
  // still bookable rather than being rejected as already past.
  const slow = serverNow - 40_000;
  assert.equal(deadlineFor(slow + 30_000, slow, serverNow).endsAt, serverNow + 30_000);

  // No client clock reported: fall back to trusting the epoch.
  assert.equal(deadlineFor(serverNow + 60_000, undefined, serverNow).endsAt, serverNow + 60_000);
});

test("only a real push service may be named as the endpoint", () => {
  for (const host of ["web.push.apple.com", "fcm.googleapis.com", "updates.push.services.mozilla.com", "abc.notify.windows.com"]) {
    assert.equal(isPushServiceHost(host), true, host);
    assert.equal(isPushServiceHost(host.toUpperCase()), true, "case does not matter");
  }
  for (const host of ["victim.example", "169.254.169.254", "localhost", "notify.windows.com.evil.example", "evilweb.push.apple.com"]) {
    assert.equal(isPushServiceHost(host), false, host);
  }
  // The whole point: an arbitrary https host is not a subscription.
  assert.equal(validateSubscription({ ...SUB, endpoint: "https://victim.example/relay" }), null);
  assert.equal(validateSubscription({ ...SUB, endpoint: "https://169.254.169.254/latest/meta-data" }), null);
  assert.ok(validateSubscription(SUB), "a real Apple endpoint still passes");
});

test("isStale draws the line at MAX_LATE_SEC", () => {
  const now = 1_700_000_000_000;
  assert.equal(isStale(now, now), false);
  assert.equal(isStale(now - (MAX_LATE_SEC - 1) * 1000, now), false);
  assert.equal(isStale(now - (MAX_LATE_SEC + 1) * 1000, now), true);
  assert.equal(isStale("never", now), true);
});

function fakeFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { fetchImpl, calls };
}

test("publishQstashMessage books the callback as raw text with an absolute Not-Before", async () => {
  const { fetchImpl, calls } = fakeFetch(() => new Response(JSON.stringify({ messageId: "msg_1" }), { status: 201 }));
  const out = await publishQstashMessage({
    fetchImpl,
    token: "qstash-token",
    destination: URL_,
    body: '{"v":1}',
    notBefore: 1_700_000_090,
  });
  assert.deepEqual(out, { messageId: "msg_1" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://qstash.upstash.io/v2/publish/${URL_}`);
  const { headers, body, method } = calls[0].init;
  assert.equal(method, "POST");
  assert.equal(headers.Authorization, "Bearer qstash-token");
  assert.equal(headers["Content-Type"], "text/plain", "text/plain so the callback body arrives as the raw string that was hashed");
  assert.equal(headers["Upstash-Not-Before"], "1700000090");
  assert.equal(headers["Upstash-Retries"], "2");
  assert.equal(body, '{"v":1}');
});

test("publishQstashMessage surfaces a non-2xx or an id-less answer as a throw", async () => {
  const denied = fakeFetch(() => new Response("nope", { status: 401 }));
  await assert.rejects(
    publishQstashMessage({ fetchImpl: denied.fetchImpl, token: "t", destination: URL_, body: "{}", notBefore: 1 }),
    (err) => err.status === 401,
  );
  const empty = fakeFetch(() => new Response("{}", { status: 200 }));
  await assert.rejects(publishQstashMessage({ fetchImpl: empty.fetchImpl, token: "t", destination: URL_, body: "{}", notBefore: 1 }), /no messageId/);
});

test("cancelQstashMessage distinguishes cancelled, already delivered, and broken", async () => {
  const ok = fakeFetch(() => new Response('{"cancelled":1}', { status: 200 }));
  assert.equal(await cancelQstashMessage({ fetchImpl: ok.fetchImpl, token: "t", messageId: "msg_1" }), true);
  assert.equal(ok.calls[0].url, "https://qstash.upstash.io/v2/messages/msg_1");
  assert.equal(ok.calls[0].init.method, "DELETE");
  assert.equal(ok.calls[0].init.headers.Authorization, "Bearer t");

  const gone = fakeFetch(() => new Response("", { status: 404 }));
  assert.equal(await cancelQstashMessage({ fetchImpl: gone.fetchImpl, token: "t", messageId: "msg_1" }), false);

  const broken = fakeFetch(() => new Response("", { status: 500 }));
  await assert.rejects(cancelQstashMessage({ fetchImpl: broken.fetchImpl, token: "t", messageId: "msg_1" }), (err) => err.status === 500);

  // The id is URL-encoded so a hostile value cannot change the path.
  const enc = fakeFetch(() => new Response("", { status: 200 }));
  await cancelQstashMessage({ fetchImpl: enc.fetchImpl, token: "t", messageId: "a/b?c" });
  assert.equal(enc.calls[0].url, "https://qstash.upstash.io/v2/messages/a%2Fb%3Fc");
});
