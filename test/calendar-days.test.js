import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import { dayNumber, ymdFromNumber, addDays, weekdayOf } from "../lib/calendar-days.js";

test("a date and its day number round-trip", () => {
  for (const d of ["2026-03-07", "2026-03-08", "2026-03-09", "2026-10-25", "2026-12-31", "2027-01-01", "2024-02-29"]) {
    assert.equal(ymdFromNumber(dayNumber(d)), d);
  }
});

test("consecutive dates are exactly one day apart across DST changes and month ends", () => {
  for (const [a, b] of [["2026-03-07", "2026-03-08"], ["2026-03-08", "2026-03-09"], ["2026-10-24", "2026-10-25"], ["2026-10-25", "2026-10-26"], ["2026-12-31", "2027-01-01"], ["2026-02-28", "2026-03-01"]]) {
    assert.equal(dayNumber(b) - dayNumber(a), 1, `${a} to ${b}`);
  }
});

test("addDays and weekdayOf", () => {
  assert.equal(addDays("2026-10-05", 28), "2026-11-02");
  assert.equal(addDays("2026-03-07", 3), "2026-03-10");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
  assert.equal(weekdayOf("2026-10-05"), 1, "Monday");
  assert.equal(weekdayOf("2026-10-04"), 0, "Sunday");
});

test("the answers are identical in every timezone", () => {
  const probe = `
    import { dayNumber, ymdFromNumber, addDays, weekdayOf } from ${JSON.stringify(new URL("../lib/calendar-days.js", import.meta.url).href)};
    const out = [];
    for (const d of ["2026-03-07","2026-03-08","2026-10-25","2026-12-31"]) out.push(dayNumber(d), ymdFromNumber(dayNumber(d)), addDays(d, 28), weekdayOf(d));
    console.log(JSON.stringify(out));`;
  const results = new Set();
  for (const TZ of ["UTC", "Asia/Bangkok", "Pacific/Auckland", "America/Los_Angeles", "Pacific/Kiritimati", "America/Sao_Paulo"]) {
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", probe], { env: { ...process.env, TZ }, encoding: "utf8" });
    assert.equal(r.status, 0, `${TZ}: ${r.stderr}`);
    results.add(r.stdout.trim());
  }
  assert.equal(results.size, 1, "one answer across six timezones");
});
