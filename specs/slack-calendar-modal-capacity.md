# Slack calendar modal capacity and failure handling

> Human designer: Michael Potter (@michaeldpotter)

## 1. Summary

The interactive Slack calendar renders chronologically ordered future events
until the next complete event group would exceed Slack's 100-block modal
limit. Calendar rendering must count fixed controls, date headers, and every
event—including closed events—and a rejected modal update must be observable
and must not leave the user indefinitely on a loading view.

## 2. Context & links

- App affected: `apps/slackbot`
- Issue: [#879](https://github.com/F3-Nation/f3-nation/issues/879)
- Key code:
  - `apps/slackbot/features/calendar/home.py`
  - `apps/slackbot/utilities/slack/orm.py`
  - `apps/slackbot/utilities/builders.py`
  - `apps/slackbot/main.py`

## 3. User stories

- As a Slack workspace member, I want the calendar to display every
  chronological event that fits so that a dense schedule does not prevent the
  calendar from loading.
- As a Slack workspace member, I want a clear failure response if Slack rejects
  the calendar so that I am not left on an indefinite loading view.
- As an operator, I want modal-update failures recorded without sensitive Slack
  data so that calendar failures can be diagnosed.

## 4. Acceptance criteria (testable, non-contradictory)

- **AC-1** — GIVEN calendar controls and future events WHEN the event list is
  rendered THEN the resulting modal contains no more than 100 blocks.
- **AC-2** — GIVEN an event on a date that is not yet rendered WHEN its divider,
  date header, and event block would exceed 100 blocks THEN none of those three
  blocks is appended.
- **AC-3** — GIVEN a closed event WHEN capacity is evaluated THEN it consumes
  one event block under the same capacity rule as a non-closed event.
- **AC-4** — GIVEN an event group that brings the modal to exactly 100 blocks
  WHEN capacity is evaluated THEN the complete group is appended.
- **AC-5** — GIVEN additional chronological events after the modal reaches
  capacity WHEN rendering continues THEN no later event is appended.
- **AC-6** — GIVEN Slack rejects `views.update` WHEN a modal is updated THEN the
  failure is logged with a safe operation name and Slack error code, without
  logging payloads, response URLs, trigger IDs, view IDs, user IDs, or tokens.
- **AC-7** — GIVEN Slack rejects the completed calendar update WHEN the calendar
  handler returns to the dispatcher THEN the dispatcher does not record the
  handler as normally completed.
- **AC-8** — GIVEN a loading modal exists WHEN the completed view fails to update
  THEN the application attempts to replace it with a small generic error view;
  if that replacement also fails, it falls back to the existing direct-message
  error response.

## 5. Roles & authorization (RBAC)

This change does not alter Slack or F3 authorization. The calendar remains
scoped to the invoking workspace's configured region, and existing admin/AO-Q
permissions continue to determine which event actions are available.

| Action                           | Allowed                                                                            | Explicitly denied                             |
| -------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------- |
| Open the interactive calendar    | Members of a configured Slack workspace with access to the installed F3 Nation app | Users without access to that workspace or app |
| Use administrative event actions | Existing region admins and AO-Q users under current calendar authorization rules   | Non-admin users for admin-only actions        |

## 6. Out of scope / non-goals

- Adding pagination or a “Load more” action.
- Establishing a fixed calendar date range shared by every region.
- Increasing Slack's 100-block platform limit.
- Changing the database query's 100-event limit.
- Changing event ordering, filtering, or authorization.

## 7. Critical-path test cases

1. A production-shaped sequence at 96 blocks followed by six closed events
   stops at exactly 100 blocks and produces a Slack-valid modal (AC-1/AC-3/AC-4/AC-5).
2. A new date whose complete three-block group cannot fit leaves no orphan
   divider or date header (AC-2).
3. A rejected `views.update` records only sanitized error context and propagates
   to the dispatcher (AC-6/AC-7).
4. A failed completed-view update replaces the loading modal with a generic
   error view, with direct-message fallback if replacement fails (AC-8).

## 8. Observability

- Emit `slack.modal.update_failed` for rejected modal updates.
- Safe context may include the Slack error code and constraint messages.
- Do not record Slack payloads, response URLs, trigger IDs, view IDs, user IDs,
  tokens, or other sensitive request data.
