"use strict";

// Says whether a date is a holiday listed in .github/holidays.json, for
// scheduled workflows that post a greeting instead of their usual message on
// holidays. Run as a script by .github/actions/holiday-check.
//
// Each entry has a `name` and one of three date rules:
//   { "month": 7, "day": 4 }                 a fixed date
//   { "month": 11, "weekday": "Thu", "nth": 4 }  the 4th Thursday of November
//   { "month": 5, "weekday": "Mon", "nth": -1 }  the last Monday of May
// `offset` adds days to the date a rule gives ("offset": 1 is the day after).
// `observed: true` moves a Saturday holiday to the Friday before and a Sunday
// holiday to the Monday after, as US federal holidays are observed. When two
// entries land on the same day, the one listed first wins.

const fs = require("node:fs");

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const KEYS = ["name", "month", "day", "weekday", "nth", "offset", "observed"];
const DAY_MS = 24 * 60 * 60 * 1000;

function fail(index, message) {
  throw new Error(`holidays entry ${index}: ${message}`);
}

function isInt(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

// `month` is 1–12; day 0 of the next month is this month's last day.
function daysIn(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// Throws on any entry that doesn't match one of the rules above, so a typo
// fails the run instead of silently dropping a holiday.
function validate(rules) {
  if (!Array.isArray(rules))
    throw new Error("holidays file must hold a JSON array");
  rules.forEach((rule, i) => {
    if (typeof rule !== "object" || rule === null) fail(i, "must be an object");
    for (const key of Object.keys(rule)) {
      if (!KEYS.includes(key)) fail(i, `unknown key \`${key}\``);
    }
    if (typeof rule.name !== "string" || !/^[^\r\n]+$/.test(rule.name.trim())) {
      fail(i, "needs a one-line `name`");
    }
    if (!isInt(rule.month, 1, 12)) fail(i, "`month` must be 1–12");
    const fixed = "day" in rule;
    const nthWeekday = "weekday" in rule || "nth" in rule;
    if (fixed === nthWeekday)
      fail(i, "needs either `day` or `weekday` with `nth`");
    // A leap year's month lengths, so February 29 stays valid.
    if (fixed && !isInt(rule.day, 1, daysIn(2024, rule.month))) {
      fail(i, "`day` must exist in that month");
    }
    if (nthWeekday) {
      if (!WEEKDAYS.includes(rule.weekday)) {
        fail(i, `\`weekday\` must be one of ${WEEKDAYS.join(", ")}`);
      }
      if (!(isInt(rule.nth, 1, 5) || rule.nth === -1))
        fail(i, "`nth` must be 1–5 or -1");
    }
    if ("offset" in rule && !isInt(rule.offset, -31, 31)) {
      fail(i, "`offset` must be a whole number of days from -31 to 31");
    }
    if ("observed" in rule && typeof rule.observed !== "boolean") {
      fail(i, "`observed` must be true or false");
    }
  });
  return rules;
}

function loadHolidays(file) {
  return validate(JSON.parse(fs.readFileSync(file, "utf8")));
}

// The rule's date in `year` as a UTC-midnight timestamp, or null when the
// rule has no such day that year (a 5th weekday the month lacks).
function ruleDate(rule, year) {
  const month = rule.month - 1;
  let time;
  if ("day" in rule) {
    time = Date.UTC(year, month, rule.day);
    if (new Date(time).getUTCMonth() !== month) return null;
  } else {
    const target = WEEKDAYS.indexOf(rule.weekday);
    if (rule.nth === -1) {
      const last = new Date(Date.UTC(year, month + 1, 0));
      time = last.getTime() - ((last.getUTCDay() - target + 7) % 7) * DAY_MS;
    } else {
      const first = new Date(Date.UTC(year, month, 1));
      const day =
        1 + ((target - first.getUTCDay() + 7) % 7) + (rule.nth - 1) * 7;
      time = Date.UTC(year, month, day);
      if (new Date(time).getUTCMonth() !== month) return null;
    }
  }
  time += (rule.offset ?? 0) * DAY_MS;
  if (rule.observed) {
    const weekday = new Date(time).getUTCDay();
    if (weekday === 6) time -= DAY_MS;
    if (weekday === 0) time += DAY_MS;
  }
  return time;
}

function toIsoDate(time) {
  return new Date(time).toISOString().slice(0, 10);
}

// The name of the holiday on `isoDate` (YYYY-MM-DD), or null. Checks the
// neighbouring years too, since an observed day can cross New Year's.
function holidayOn(rules, isoDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate))
    throw new Error(`not a YYYY-MM-DD date: ${isoDate}`);
  const year = Number(isoDate.slice(0, 4));
  for (const rule of rules) {
    for (const y of [year - 1, year, year + 1]) {
      const time = ruleDate(rule, y);
      if (time !== null && toIsoDate(time) === isoDate) return rule.name.trim();
    }
  }
  return null;
}

// Today's date (YYYY-MM-DD) in `timeZone`, so a run near midnight UTC is
// matched against the right US day.
function localDate(now, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function greeting(name) {
  return `Happy ${name} everyone! Take the day off and enjoy time with friends and family.`;
}

// Script mode: reads HOLIDAYS_FILE and TIME_ZONE and writes `name` and
// `greeting` to $GITHUB_OUTPUT, both empty on a normal day.
function main() {
  const file = process.env.HOLIDAYS_FILE;
  const timeZone = process.env.TIME_ZONE;
  const output = process.env.GITHUB_OUTPUT;
  if (!file || !timeZone || !output) {
    throw new Error("HOLIDAYS_FILE, TIME_ZONE and GITHUB_OUTPUT must be set");
  }
  const date = localDate(new Date(), timeZone);
  const name = holidayOn(loadHolidays(file), date);
  fs.appendFileSync(
    output,
    `name=${name ?? ""}\ngreeting=${name ? greeting(name) : ""}\n`,
  );
  console.log(
    name ? `${date} is ${name}.` : `${date} is not a listed holiday.`,
  );
}

if (require.main === module) main();

module.exports = {
  validate,
  loadHolidays,
  ruleDate,
  holidayOn,
  localDate,
  greeting,
};
