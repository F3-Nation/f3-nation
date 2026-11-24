"use strict";

// Run with: node --test .github/scripts/holidays.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  validate,
  loadHolidays,
  ruleDate,
  holidayOn,
  localDate,
  greeting,
} = require("./holidays.cjs");

const SCRIPT = path.join(__dirname, "holidays.cjs");
const HOLIDAYS = loadHolidays(path.join(__dirname, "..", "holidays.json"));

test("every 2026 holiday lands on its expected weekday", () => {
  const expected = {
    "2026-01-01": "New Year's Day",
    "2026-01-19": "Martin Luther King Jr. Day",
    "2026-02-16": "Presidents' Day",
    "2026-05-25": "Memorial Day",
    "2026-06-19": "Juneteenth",
    "2026-07-03": "Independence Day",
    "2026-09-07": "Labor Day",
    "2026-10-12": "Columbus Day",
    "2026-11-11": "Veterans Day",
    "2026-11-26": "Thanksgiving",
    "2026-11-27": "Day after Thanksgiving",
    "2026-12-24": "Christmas Eve",
    "2026-12-25": "Christmas",
  };
  for (const [date, name] of Object.entries(expected)) {
    assert.equal(holidayOn(HOLIDAYS, date), name, date);
  }
});

test("an ordinary weekday is not a holiday", () => {
  assert.equal(holidayOn(HOLIDAYS, "2026-11-24"), null);
});

test("a Saturday holiday is observed on the Friday before", () => {
  assert.equal(holidayOn(HOLIDAYS, "2026-07-04"), null);
  assert.equal(holidayOn(HOLIDAYS, "2027-06-18"), "Juneteenth");
  assert.equal(holidayOn(HOLIDAYS, "2022-12-23"), "Christmas Eve");
});

test("a Sunday holiday is observed on the Monday after", () => {
  assert.equal(holidayOn(HOLIDAYS, "2022-12-25"), null);
  assert.equal(holidayOn(HOLIDAYS, "2022-12-26"), "Christmas");
});

test("an observed day can fall in the previous year", () => {
  assert.equal(holidayOn(HOLIDAYS, "2021-12-31"), "New Year's Day");
});

test("the entry listed first wins when two land on the same day", () => {
  // 2028: Christmas Eve is a Sunday, observed on Christmas Day itself.
  assert.equal(holidayOn(HOLIDAYS, "2028-12-25"), "Christmas");
  // 2027: Christmas is a Saturday, observed on Christmas Eve.
  assert.equal(holidayOn(HOLIDAYS, "2027-12-24"), "Christmas");
});

test("a last-weekday rule finds the final one in the month", () => {
  assert.equal(
    new Date(ruleDate({ month: 5, weekday: "Mon", nth: -1 }, 2027))
      .toISOString()
      .slice(0, 10),
    "2027-05-31",
  );
});

test("a 5th weekday the month lacks gives no date", () => {
  assert.equal(ruleDate({ month: 2, weekday: "Mon", nth: 5 }, 2026), null);
});

test("an offset moves the rule's date", () => {
  assert.equal(
    holidayOn([{ name: "Eve", month: 7, day: 4, offset: -1 }], "2026-07-03"),
    "Eve",
  );
});

test("the local date uses the given time zone, not UTC", () => {
  const lateThanksgivingInChicago = new Date("2026-11-27T03:00:00Z");
  assert.equal(
    localDate(lateThanksgivingInChicago, "America/Chicago"),
    "2026-11-26",
  );
  assert.equal(localDate(lateThanksgivingInChicago, "UTC"), "2026-11-27");
});

test("the greeting names the holiday", () => {
  assert.equal(
    greeting("Labor Day"),
    "Happy Labor Day everyone! Take the day off and enjoy time with friends and family.",
  );
});

test("validation rejects malformed entries", () => {
  assert.throws(() => validate({}), /JSON array/);
  assert.throws(
    () => validate([{ month: 1, day: 1 }]),
    /entry 0: needs a one-line `name`/,
  );
  assert.throws(
    () => validate([{ name: "X", month: 13, day: 1 }]),
    /`month` must be 1–12/,
  );
  assert.throws(
    () => validate([{ name: "X", month: 1, day: 1, weekday: "Mon", nth: 1 }]),
    /either `day` or `weekday`/,
  );
  assert.throws(
    () => validate([{ name: "X", month: 1, weekday: "Monday", nth: 1 }]),
    /`weekday` must be one of/,
  );
  assert.throws(
    () => validate([{ name: "X", month: 1, weekday: "Mon", nth: 0 }]),
    /`nth`/,
  );
  assert.throws(
    () => validate([{ name: "X", month: 1, day: 1, offset: 1.5 }]),
    /`offset`/,
  );
  assert.throws(
    () => validate([{ name: "X", month: 1, day: 1, observed: "yes" }]),
    /`observed`/,
  );
});

function runScript(rules) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "holidays-test-"));
  try {
    const file = path.join(dir, "holidays.json");
    const output = path.join(dir, "output");
    fs.writeFileSync(file, JSON.stringify(rules));
    fs.writeFileSync(output, "");
    const result = spawnSync(process.execPath, [SCRIPT], {
      env: {
        ...process.env,
        HOLIDAYS_FILE: file,
        TIME_ZONE: "America/Chicago",
        GITHUB_OUTPUT: output,
      },
      encoding: "utf8",
    });
    return {
      status: result.status,
      stderr: result.stderr,
      output: fs.readFileSync(output, "utf8"),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("script mode writes the holiday and greeting on a holiday", () => {
  const [, month, day] = localDate(new Date(), "America/Chicago")
    .split("-")
    .map(Number);
  const { status, output } = runScript([{ name: "Test Day", month, day }]);
  assert.equal(status, 0);
  assert.equal(output, `name=Test Day\ngreeting=${greeting("Test Day")}\n`);
});

test("script mode writes empty outputs on a normal day", () => {
  const { status, output } = runScript([]);
  assert.equal(status, 0);
  assert.equal(output, "name=\ngreeting=\n");
});

test("script mode fails on a malformed holidays file", () => {
  const { status, stderr } = runScript([{ name: "X", month: 1 }]);
  assert.notEqual(status, 0);
  assert.match(stderr, /entry 0/);
});
