# F3versary Announcements

> Human designer: `Venus F3 The Fe` (`Venus F3 The Fe`)

## 1. Summary

Provide each F3 region with an optional daily Slack announcement recognizing PAX whose F3 start-date anniversary falls on a configurable date. A valid profile start-date override is authoritative; otherwise, the earliest recorded actual attendance is used. The announcement states how many years each PAX has been with F3 and encourages them to celebrate by grabbing a Q slot.

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
- Start-date sources: the existing PostgreSQL user profile metadata and attendance/event-instance records.
- Regional opt-in: a separate PostgreSQL F3versary settings table keyed by
  Slack workspace and region, so unrelated cached Slackbot settings writes
  cannot revert this feature's enabled flag, channel, or lead time.
- Delivery state: dedicated PostgreSQL F3versary run and page tables. Both
  delivery state and regional settings are created by one additive migration,
  which must be applied before the revised Slackbot job is deployed.

## 3. User stories

- As a regional Slack administrator, I want to enable F3versary announcements, choose their destination channel, and configure how many days in advance they are posted.
- As a region member, I want to recognize PAX reaching an F3 milestone and encourage them to celebrate by grabbing a Q slot.
- As a maintainer, I want the hourly job to be safe to retry without creating duplicate announcements.

## 4. Acceptance criteria

- **AC-1 — Default off:** GIVEN a region without a F3versary settings row, WHEN the hourly job runs, THEN no F3versary query or Slack post is made for that region.

- **AC-2 — Settings location:** GIVEN an authorized regional administrator, WHEN they open F3 Nation Settings, THEN “F3versary Announcements” appears as its own option under Bot Management.

- **AC-3 — Configurable settings:** GIVEN an authorized regional administrator, WHEN they configure F3versary Announcements, THEN they can enable or disable the feature, select a destination channel, and enter a whole-number lead time from 0 through 30 days. These choices are saved and reopened from the settings row for the region bound to their current Slackbot settings context, not the cached shared `SlackSpace.settings` document. Storage keys include both region and workspace, so separate rows cannot overwrite one another.

- **AC-4 — Defaults and validation:** GIVEN a region that has not selected a lead time, WHEN its settings are displayed or processed, THEN the lead time defaults to 14 days. The settings form rejects values below 0, above 30, or containing something other than a whole number. If a stored value is corrupt despite that validation, the job logs a non-sensitive warning and uses the 14-day default rather than silently treating it as intentional.

- **AC-5 — Daily schedule:** GIVEN an opted-in workspace, WHEN the hourly runner executes at or after 5:00 PM US/Central and that region has no completed delivery run for the current Central calendar date, THEN the F3versary task processes that region.

- **AC-6 — Target date:** GIVEN a processing date and configured lead time, WHEN candidates are selected, THEN a candidate qualifies only when the observed anniversary date equals `processing date + lead days`. A lead time of 0 recognizes anniversaries occurring that day.

- **AC-7 — Start-date precedence:** GIVEN a user with a valid ISO date in `users.meta.start_date_override`, WHEN their F3versary is calculated, THEN that override is the effective start date, including when the user has no actual-attendance record. If the override is missing, blank, or invalid, the effective start date falls back to the earliest attendance for which `attendance.is_planned` is false and the event instance is active. Planned attendance and attendance on canceled or inactive event instances do not establish or change the F3versary date, and a user with neither a valid override nor a qualifying actual-attendance date is excluded.

- **AC-8 — Region scope:** GIVEN an opted-in region, WHEN candidates are selected, THEN only users whose current `home_region_id` matches that region’s organization ID are considered. If a PAX moves regions while retaining the same user record, their global profile start-date override or earliest actual attendance in a previous region still establishes their F3versary date; the announcement goes to their current home region. The aggregate query is scoped to current home-region users rather than the entire national attendance table, but does not restrict their attendance to events in that region.

- **AC-9 — Completed years:** GIVEN a qualifying effective start date, WHEN the announcement is created, THEN the user must have completed at least one full year and the correct completed-year count is included.

- **AC-10 — Leap day:** GIVEN a February 29 effective start date and a non-leap target year, WHEN the F3versary is evaluated, THEN it is recognized on February 28.

- **AC-11 — Slack identity:** GIVEN a qualifying user with an associated Slack user mapping, WHEN the message is built, THEN the user is represented by a Slack mention. If no Slack mapping exists, the user’s F3 name is displayed instead, with Slack's `&`, `<`, and `>` parsing characters encoded as their supported entities. A record with neither usable identity is omitted. Other mrkdwn control characters in free-form names require a separate plain-text or rich-text rendering review.

- **AC-12 — Message:** GIVEN one or more qualifying users, WHEN the task posts,
  THEN it sends one combined message to the configured regional channel if the
  full announcement fits Slack's limits. Otherwise, it sends numbered posts
  `(1/N)`, `(2/N)`, and so on to the same channel, with each qualifier appearing
  exactly once in stable order. Every post contains at most 50 blocks, every
  section contains at most 3,000 characters, and top-level text is kept below
  4,000 characters. The
  heading is `:tada: *F3versary Announcements:*`, followed by one bold line per
  qualifier. For a lead time greater than zero, each line uses the form
  `*• <Slack mention or F3 name> celebrates <N year/years> with F3 on
<Month Day> — be sure to celebrate by grabbing a Q slot!*`. For a lead time
  of zero, the date phrase is replaced with `TODAY`. The message uses “year”
  for exactly one year and “years” otherwise. Candidate lines are split across
  section blocks as needed so that no section exceeds Slack’s 3,000-character
  limit.
- **AC-13 — No empty post:** GIVEN no qualifying users for an opted-in region, WHEN the task processes that region, THEN no Slack message is sent and a zero-page delivery run is recorded as complete for the date.

- **AC-14 — Duplicate prevention:** GIVEN a region that was successfully processed for the current date, WHEN the hourly runner executes again that day, THEN no duplicate announcement is sent. A unique delivery-run key for workspace, region, and processing date prevents overlapping jobs from creating separate plans. Each immutable page has a deterministic Slack `client_msg_id` that includes workspace, region, channel, date, and page number. A short database transaction claims a pending page using a lease; another transaction records its successful send. Already-recorded pages are not posted again after a later page fails. A successful Slack call followed by a failed database commit remains an ambiguous case requiring maintainer reliability review; the message ID reduces, but does not prove elimination of, duplicate delivery.

- **AC-15 — Failure and retry:** GIVEN a database or Slack failure, WHEN the task runs, THEN the failure is logged without sensitive information, the other hourly jobs continue, and the affected region remains eligible for a later hourly retry on the same Central calendar date. The ordered page plan and its exact text/blocks are committed before posting. Slack calls occur without a database row lock or transaction held across the network call. A same-day retry resumes at the first unrecorded page without recomputing or reordering candidates and reuses that page's deterministic Slack message ID. An expired claim may be reclaimed. If a run remains unfinished on a later Central calendar date, it is abandoned with a warning rather than sending stale pages or blocking future daily announcements; the current day's run may then proceed.

- **AC-16 — Concurrent settings safety:** GIVEN an administrator saves F3versary settings while the job or an unrelated Slackbot settings screen is processing, WHEN their database writes complete, THEN the administrator’s enabled, channel, and lead-time values in the independent settings row and the separate delivery state are all preserved. A stale full-document rewrite of `SlackSpace.settings` must not revert these F3versary choices. The job rechecks current settings before saving a plan and claiming each next page, and pauses the saved run when it detects changed enablement, channel, or lead time. A settings edit that races after a page is claimed cannot recall a post already in flight; that race requires maintainer reliability review.

- **AC-17 — Forced local execution:** GIVEN a local or automated test invocation with forced execution enabled, WHEN the task runs outside its normal time, THEN it bypasses only the time gate and still observes regional enablement and duplicate protection.

- **AC-18 — Dry run:** GIVEN a local invocation in dry-run mode, WHEN the task runs, THEN it displays the proposed message without contacting Slack or recording the region as processed.

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
- Editing a user’s profile start-date override or inferred first-attendance date.
- Announcements for regions that have not explicitly enabled the feature.
- Lead times longer than 30 days.
- Production deployment by the contributor.

The two dedicated delivery tables and the independent regional settings table
are in scope for this PR with contributor approval. Applying the migration
and deploying the job remain maintainer-controlled operations. Maintainers must
apply the additive migration before deploying code that queries the new tables
and decide how an
existing `last_processed_date` marker is honored at cutover.
The release must avoid overlapping old marker-based and new outbox-based
workers for the same date; the new worker does not write the legacy marker, so
the old worker cannot infer new outbox progress. Any pre-existing partial
legacy delivery plan must be reconciled by the maintainers rather than guessed
from its marker.
Saved page text and blocks contain member names and Slack IDs, so maintainers
must approve a retention or scrubbing policy for completed and abandoned runs.
Rolling back code without dropping the new tables preserves an audit and retry
state; dropping them later would erase that state and needs a separate human
decision. Maintainers must verify the existing Bot Management authorization
applies to the selected region/workspace association before production release.
The current Slackbot settings context resolves one region organization per
workspace. If a workspace is linked to multiple active regions, it needs a
human-approved region-selection UI before administrators can configure every
linked region from that same workspace; independent storage alone does not
make the second region selectable in Bot Management.

## 7. Critical-path test cases

- An opted-out region is skipped.
- Two region/workspace settings rows are independent in storage; stale cached
  writes from unrelated settings screens cannot undo either row.
- An opted-in region processes once after 5:00 PM Central.
- Lead times of 0, 14, and 30 days identify the correct target date.
- Invalid lead times are rejected.
- A valid profile start-date override takes precedence over first actual attendance.
- A missing, blank, or invalid override falls back to first actual attendance.
- A valid override works when the user has no actual-attendance record.
- A PAX who changes home regions retains a prior-region actual-attendance
  F3versary (or global profile override) and is announced only in the new home
  region when that region opts in.
- Planned attendance is excluded from the first-attendance fallback calculation.
- The correct completed-year count and singular/plural wording are produced.
- A Slack mention is used when available, with an F3-name fallback.
- Slack's `&`, `<`, and `>` parsing characters in an F3-name fallback are encoded;
  other mrkdwn formatting characters need a separate rendering review.
- Large candidate lists are split into section blocks of at most 3,000 characters.
- A February 29 anniversary is recognized on February 28 in a non-leap year.
- Concurrent hourly runs create one run and claim each page at most once while
  a claim lease is valid.
- A settings save preserves separate delivery rows; a mid-run settings change
  does not send later pages to the old channel.
- Failed pages retry using their original text, blocks, and message ID; sent
  pages remain recorded and are not resent.
- Expired claims can be reclaimed, and unfinished prior-day runs do not block
  current-day announcements.
- Every generated post stays within Slack's 50-block limit, including headings,
  even when many qualifiers share the anniversary date.
- The additive migration is reviewed before application; the job is not
  deployed before it is applied, and a rollback retains delivery audit rows.
- A simulated Slack failure remains eligible for retry.
- Dry-run mode neither contacts Slack nor records successful processing.
- A non-admin cannot change the settings.

## 8. Observability

- Log one summary per processed workspace containing the processing date, target date, and non-identifying candidate count.
- Log database and Slack failures without names, message contents, tokens, credentials, or other sensitive information.
- Flag concurrent-run duplicate prevention, query performance, and Slack retry behavior for human reliability and scalability review in the pull request.
- Report the migration prerequisite and the delivery-page retention decision
  for human deployment and privacy review; do not log saved message contents.
