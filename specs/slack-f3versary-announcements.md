# F3versary Announcements

> Human designer: `Venus F3 The Fe` (`Venus F3 The Fe`)

## 1. Summary

Provide each F3 region with an optional daily Slack announcement recognizing PAX whose anniversary of their first recorded F3 attendance falls on a configurable date. The announcement states how many years each PAX has been with F3 and encourages them to celebrate by grabbing a Q slot.

## 2. Context & links

- App affected: `apps/slackbot`
- Key code:
  - `apps/slackbot/scripts/f3versary_announcements.py`
  - `apps/slackbot/scripts/hourly_runner.py`
  - `apps/slackbot/features/f3versary_announcements.py`
  - `apps/slackbot/utilities/database/orm/__init__.py`
  - `apps/slackbot/utilities/routing.py`
  - `apps/slackbot/utilities/slack/actions.py`
  - `apps/slackbot/utilities/slack/forms.py`
- Attendance source: existing PostgreSQL attendance, event-instance, user, organization, and Slack-mapping models.

## 3. User stories

- As a regional Slack administrator, I want to enable F3versary announcements, choose their destination channel, and configure how many days in advance they are posted.
- As a region member, I want to recognize PAX reaching an F3 milestone and encourage them to celebrate by grabbing a Q slot.
- As a maintainer, I want the hourly job to be safe to retry without creating duplicate announcements.

## 4. Acceptance criteria

- **AC-1 — Default off:** GIVEN a Slack workspace without F3versary settings, WHEN the hourly job runs, THEN no F3versary query or Slack post is made for that workspace.

- **AC-2 — Settings location:** GIVEN an authorized regional administrator, WHEN they open F3 Nation Settings, THEN “F3versary Announcements” appears as its own option under Bot Management.

- **AC-3 — Configurable settings:** GIVEN an authorized regional administrator, WHEN they configure F3versary Announcements, THEN they can enable or disable the feature, select a destination channel, and enter a whole-number lead time from 0 through 30 days.

- **AC-4 — Defaults and validation:** GIVEN a region that has not selected a lead time, WHEN its settings are displayed or processed, THEN the lead time defaults to 14 days. Values below 0, above 30, or containing something other than a whole number are rejected.

- **AC-5 — Daily schedule:** GIVEN an opted-in workspace, WHEN the hourly runner executes at or after 5:00 PM US/Central and that region has not yet been processed for the current Central calendar date, THEN the F3versary task processes that region.

- **AC-6 — Target date:** GIVEN a processing date and configured lead time, WHEN candidates are selected, THEN a candidate qualifies only when the observed anniversary date equals `processing date + lead days`. A lead time of 0 recognizes anniversaries occurring that day.

- **AC-7 — First actual attendance:** GIVEN a user with attendance records, WHEN their F3versary is calculated, THEN the source date is their earliest attendance for which `attendance.is_planned` is false. Planned attendance does not establish or change the F3versary date.

- **AC-8 — Region scope:** GIVEN an opted-in region, WHEN candidates are selected, THEN only users whose current `home_region_id` matches that region’s organization ID are considered.

- **AC-9 — Completed years:** GIVEN a qualifying first-attendance date, WHEN the announcement is created, THEN the user must have completed at least one full year and the correct completed-year count is included.

- **AC-10 — Leap day:** GIVEN a February 29 first-attendance date and a non-leap target year, WHEN the F3versary is evaluated, THEN it is recognized on February 28.

- **AC-11 — Slack identity:** GIVEN a qualifying user with an associated Slack user mapping, WHEN the message is built, THEN the user is represented by a Slack mention. If no Slack mapping exists, the user’s F3 name is displayed instead. A record with neither usable identity is omitted.

- **AC-12 — Message:** GIVEN one or more qualifying users, WHEN the task posts,
  THEN it sends one combined message to the configured regional channel. The
  heading is `:tada: *F3versary Announcements:*`, followed by one bold line per
  qualifier. For a lead time greater than zero, each line uses the form
  `*• <Slack mention or F3 name> celebrates <N year/years> with F3 on
<Month Day> — be sure to celebrate by grabbing a Q slot!*`. For a lead time
  of zero, the date phrase is replaced with `TODAY`. The message uses “year”
  for exactly one year and “years” otherwise.
- **AC-13 — No empty post:** GIVEN no qualifying users for an opted-in region, WHEN the task processes that region, THEN no Slack message is sent and that region is recorded as successfully processed for the date.

- **AC-14 — Duplicate prevention:** GIVEN a region that was successfully processed for the current date, WHEN the hourly runner executes again that day, THEN no duplicate announcement is sent. The successful processing date is stored in shared database settings rather than process memory.

- **AC-15 — Failure and retry:** GIVEN a database or Slack failure, WHEN the task runs, THEN the failure is logged without sensitive information, the other hourly jobs continue, and the affected region remains eligible for a later hourly retry.

- **AC-16 — Forced local execution:** GIVEN a local or automated test invocation with forced execution enabled, WHEN the task runs outside its normal time, THEN it bypasses only the time gate and still observes regional enablement and duplicate protection.

- **AC-17 — Dry run:** GIVEN a local invocation in dry-run mode, WHEN the task runs, THEN it displays the proposed message without contacting Slack or recording the region as processed.

## 5. Roles & authorization

| Action                            | Allowed                                                                            | Explicitly denied                                 |
| --------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------- |
| View an announcement              | Members who can access the configured Slack channel                                | People without access to that channel             |
| View or change F3versary settings | Regional administrators authorized through the existing Slackbot settings controls | Non-admin members and members of other workspaces |
| Execute the scheduled task        | The deployed Slackbot hourly job                                                   | Slack users                                       |
| Perform a local dry run           | Developers using local or controlled test data                                     | End users through Slack                           |

No new API endpoint or authorization tier is introduced.

## 6. Out of scope / non-goals

- BigQuery access or a BigQuery client dependency.
- Direct messages to individual PAX.
- Automatically assigning or reserving Q slots.
- Editing a user’s inferred first-attendance date.
- Announcements for regions that have not explicitly enabled the feature.
- Lead times longer than 30 days.
- Database schema migrations.
- Production deployment by the contributor.

## 7. Critical-path test cases

- An opted-out region is skipped.
- An opted-in region processes once after 5:00 PM Central.
- Lead times of 0, 14, and 30 days identify the correct target date.
- Invalid lead times are rejected.
- Planned attendance is excluded from the first-attendance calculation.
- The correct completed-year count and singular/plural wording are produced.
- A Slack mention is used when available, with an F3-name fallback.
- A February 29 anniversary is recognized on February 28 in a non-leap year.
- A repeated hourly run does not duplicate a successful announcement.
- A simulated Slack failure remains eligible for retry.
- Dry-run mode neither contacts Slack nor records successful processing.
- A non-admin cannot change the settings.

## 8. Observability

- Log one summary per processed workspace containing the processing date, target date, and non-identifying candidate count.
- Log database and Slack failures without names, message contents, tokens, credentials, or other sensitive information.
- Flag concurrent-run duplicate prevention, query performance, and Slack retry behavior for human reliability and scalability review in the pull request.
