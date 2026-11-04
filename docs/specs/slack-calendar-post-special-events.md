# Slack calendar post special events

> Human designer: Chubbs (@michaeldpotter)

## 1. Summary

Slack calendar posts include highlighted upcoming events when the workspace's
Special Days Out setting permits them. An empty special-event list must not
produce an invalid Slack section or prevent the regular calendar post and the
job's refreshed image references and posting timestamp from being saved.

## 2. Context & links

- App affected: `apps/slackbot`
- Block construction and calendar refresh: [calendar_images.py](../../apps/slackbot/scripts/calendar_images.py)
- Settings form and persistence: [config.py](../../apps/slackbot/features/calendar/config.py)
- Settings menu access: [config.py](../../apps/slackbot/features/config.py)
- Regression tests: [test_calendar_images.py](../../apps/slackbot/tests/scripts/test_calendar_images.py)

## 3. User stories

- As a calendar reader, I want regular calendar posts to remain available when
  no highlighted events fall inside the display window.
- As a region administrator, I want an inclusive upcoming-event window, an
  unlimited date window, or no special-event section.

## 4. Acceptance criteria (testable, non-contradictory)

- **AC-1** — GIVEN a positive Special Days Out value N WHEN a calendar post is
  built THEN highlighted events dated from today through N days ahead
  (inclusive) are eligible and later events are excluded, with today taken as
  the current Central date.
- **AC-2** — GIVEN a blank or absent setting WHEN a calendar post is built THEN
  the setting applies no upper date cutoff.
- **AC-3** — GIVEN a zero setting WHEN a calendar post is built THEN neither
  the Special Events header nor its section is included, even for today's events.
- **AC-4** — GIVEN no events remain after filtering WHEN a calendar post is
  built THEN neither the Special Events header nor its section is included.
- **AC-5** — GIVEN more than ten eligible events WHEN a calendar post is built
  THEN it lists only the earliest ten, ordered by start date and time.
- **AC-6** — GIVEN the special-event window excludes every highlighted event
  WHEN calendar generation succeeds and Slack accepts the regular calendar
  post THEN the refreshed image references and posting timestamp are committed.

## 5. Roles & authorization (RBAC)

This feature affects formatting only. It uses Slackbot workspace settings and
scheduled-job access, not oRPC procedure tiers.

| Action                                                   | Allowed                                                                                                                                                                               | Explicitly denied                                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Open General Calendar Settings through the settings menu | Region administrators; the first user to open the menu when the region has an organization but no admins (who is then made an admin); every user when all-users-admin mode is enabled | Ordinary non-admin members when a region already has admins and all-users-admin mode is disabled |
| Read a posted calendar                                   | Users with access to the destination Slack channel                                                                                                                                    | Users without channel access                                                                     |
| Run the scheduled calendar refresh                       | The job runtime with its configured database and Slack access                                                                                                                         | Users without access to run that job                                                             |

The menu-access row describes the settings-menu UI gate; the General Calendar
Settings submit callback does not check admin status itself. Event selection is
limited to the configured region and its immediate child organizations.

## 6. Out of scope / non-goals

- Changing calendar schedules, image storage, or transaction ordering.
- Changing event queries, access controls, preblast links, or Slack text limits.
- Changing the interactive calendar modal or standalone special-event posts.

## 7. Critical-path test cases

- Exercise empty, excluded, inclusive-boundary, blank, missing, zero, and
  over-cap inputs through both block-builder query paths (AC-1 through AC-5).
- Place an earlier same-day event after enough later events to fill the cap;
  assert date takes precedence over time and earlier same-day events are included
  before later ones (AC-5).
- Run calendar generation with synthetic data and a Slack transport mock that
  rejects empty sections; assert the regular post succeeds and the refreshed image references and posting
  timestamp are committed when all special events are excluded (AC-4 and AC-6).

These are Python tests of the posting path, not browser Playwright tests. Live
Slack delivery requires a separately configured test workspace.

## 8. Observability

No dedicated events or metrics cover special-event selection. A per-region
calendar job failure is printed and the job continues with the next region. A
failed post raises before the job saves the refreshed image references and
posting timestamp, and that region's transaction is rolled back. External image
writes are not rolled back by that database transaction.
