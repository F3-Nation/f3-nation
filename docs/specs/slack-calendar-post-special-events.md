# Slack calendar post special events

> Human designer: Chubbs (@michaeldpotter)

## 1. Summary

Slack calendar posts include highlighted upcoming events when the workspace's
Special Days Out setting permits them. An empty special-event list must not
produce an invalid Slack section or prevent the regular calendar post and its
updated settings from being saved.

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

- **AC-1** — GIVEN a positive Special Days Out value WHEN a calendar post is
  built THEN highlighted upcoming events exactly that many days ahead are
  eligible and events farther ahead are excluded, using the current Central date.
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

This contract changes formatting, not authorization. It uses existing Slackbot
workspace settings and scheduled-job access, not oRPC procedure tiers.

| Action                                                   | Allowed                                                                                                           | Explicitly denied                                                                                |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Open General Calendar Settings through the settings menu | Existing region administrators; the existing first-admin bootstrap and all-users-admin mode retain their behavior | Ordinary non-admin members when a region already has admins and all-users-admin mode is disabled |
| Read a posted calendar                                   | Users with access to the destination Slack channel                                                                | Users without channel access                                                                     |
| Run the scheduled calendar refresh                       | Existing job runtime with its configured database and Slack access                                                | Users without access to run that job                                                             |

The menu-access row describes the existing UI gate, not a new callback-level
permission check. Event selection remains limited to the configured region and
its immediate child organizations.

## 6. Out of scope / non-goals

- Changing calendar schedules, image storage, or transaction ordering.
- Changing event queries, access controls, preblast links, or Slack text limits.
- Changing the interactive calendar modal or standalone special-event posts.

## 7. Critical-path test cases

- Exercise empty, excluded, inclusive-boundary, blank, missing, zero, and
  over-cap inputs through both block-builder query paths (AC-1 through AC-5).
- Run calendar generation with synthetic data and a Slack transport mock that
  rejects empty sections; assert the regular post and persisted settings succeed
  when all special events are excluded (AC-4 and AC-6).

These are Python tests of the posting path, not browser Playwright tests. Live
Slack delivery requires a separately configured test workspace.

## 8. Observability

No new events or metrics are introduced. Existing calendar job failure reporting
remains in place. A failed post prevents saving updated calendar settings;
external image writes are not part of that database rollback.
