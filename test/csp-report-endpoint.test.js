import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import handler, { parseReports, __setReporterForTests } from "../api/csp-report.js";
import { __resetRateLimitForTests } from "../lib/rate-limit.js";

function makeRes() {
  const res = { statusCode: null, ended: false, headers: {} };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = () => { res.ended = true; return res; };
  res.end = () => { res.ended = true; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; return res; };
  return res;
}

function fakeReporter() {
  const calls = [];
  return { calls, captureException: async (msg, ctx) => { calls.push({ msg, ctx }); return true; } };
}

const legacy = (over = {}) => ({
  "csp-report": {
    "document-uri": "https://spotterai.xyz/?token=secret#/today?id=9",
    "violated-directive": "script-src-elem 'self'",
    "effective-directive": "script-src-elem",
    "blocked-uri": "https://evil.example/x.js?k=v",
    disposition: "report",
    ...over,
  },
});

test("legacy report: directive kept, URLs cut to origin+path, query and token dropped", () => {
  const [v] = parseReports(legacy());
  assert.equal(v.directive, "script-src-elem");
  assert.equal(v.blocked, "https://evil.example/x.js");
  assert.equal(v.page, "https://spotterai.xyz/#/today");
  assert.ok(!JSON.stringify(v).includes("secret"));
});

test("Reporting API format is read, and non-CSP reports are ignored", () => {
  const body = [
    { type: "deprecation", body: { id: "x" } },
    { type: "csp-violation", body: { effectiveDirective: "connect-src", blockedURL: "https://o1.ingest.sentry.io/api/1/envelope/", documentURL: "https://spotterai.xyz/" } },
  ];
  const out = parseReports(JSON.stringify(body));
  assert.equal(out.length, 1);
  assert.equal(out[0].directive, "connect-src");
});

test("extension noise is dropped; inline, eval and data keep only their keyword", () => {
  assert.deepEqual(parseReports(legacy({ "blocked-uri": "chrome-extension://abc/inject.js" })), []);
  assert.deepEqual(parseReports(legacy({ "source-file": "moz-extension://abc/x.js", "blocked-uri": "inline" })), []);
  assert.equal(parseReports(legacy({ "blocked-uri": "inline" }))[0].blocked, "inline");
  assert.equal(parseReports(legacy({ "blocked-uri": "data:image/png;base64,AAAA" }))[0].blocked, "data");
});

test("oversize, malformed and empty bodies yield nothing and never throw", () => {
  assert.deepEqual(parseReports("x".repeat(9000)), []);
  assert.deepEqual(parseReports("{not json"), []);
  assert.deepEqual(parseReports(undefined), []);
  assert.deepEqual(parseReports({ unrelated: true }), []);
  assert.deepEqual(parseReports(Buffer.from(JSON.stringify(legacy()))).length, 1);
});

test("handler: 204 and one Sentry event per violation, capped per request", async () => {
  __resetRateLimitForTests();
  const r = fakeReporter();
  __setReporterForTests(r);
  const many = Array.from({ length: 30 }, (_, i) => ({ type: "csp-violation", body: { effectiveDirective: "img-src", blockedURL: `https://a.example/${i}.png` } }));
  const res = makeRes();
  await handler({ method: "POST", headers: { "x-real-ip": "1.1.1.1" }, body: many }, res);
  assert.equal(res.statusCode, 204);
  assert.equal(r.calls.length, 10);
  assert.equal(r.calls[0].ctx.tags.route, "csp-report");
});

test("handler: garbage still answers 204, other verbs 405, flood gets 429", async () => {
  __resetRateLimitForTests();
  __setReporterForTests(fakeReporter());
  const ok = makeRes();
  await handler({ method: "POST", headers: { "x-real-ip": "2.2.2.2" }, body: "{bad" }, ok);
  assert.equal(ok.statusCode, 204);

  const get = makeRes();
  await handler({ method: "GET", headers: {} }, get);
  assert.equal(get.statusCode, 405);

  let last;
  for (let i = 0; i < 40; i++) {
    last = makeRes();
    await handler({ method: "POST", headers: { "x-real-ip": "3.3.3.3" }, body: "{}" }, last);
  }
  assert.equal(last.statusCode, 429);
});

test("a reporter outage cannot fail the request: the reporter swallows, we still 204", async () => {
  __resetRateLimitForTests();
  __setReporterForTests({ captureException: async () => false });
  const res = makeRes();
  await handler({ method: "POST", headers: { "x-real-ip": "4.4.4.4" }, body: legacy() }, res);
  assert.equal(res.statusCode, 204);
});

test("vercel.json points the report-only CSP at this endpoint and declares the route", () => {
  const cfg = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  const set = Object.fromEntries(cfg.headers[0].headers.map((h) => [h.key, h.value]));
  assert.match(set["Content-Security-Policy-Report-Only"], /report-uri \/api\/csp-report/);
  assert.match(set["Content-Security-Policy-Report-Only"], /report-to csp-endpoint/);
  assert.match(set["Reporting-Endpoints"], /csp-endpoint="\/api\/csp-report"/);
  assert.equal(set["Content-Security-Policy"], undefined, "still report-only");
  assert.ok(cfg.functions["api/csp-report.js"]);
});
