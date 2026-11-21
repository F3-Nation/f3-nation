# Slack calendar modal layout, capacity and failure handling

> Human designer: Michael Potter (@michaeldpotter)

## 1. Summary

The interactive Slack calendar (Calendar Home) shows the region's upcoming
events one page at a time. Filter inputs stay hidden behind a Filters button so
the schedule starts near the top; Slack does not allow its collapsible container
block in modals. Each event shows a bold title line, a detail line and its
most likely action as a visible button. A page renders chronologically ordered
events until the next complete event group would exceed Slack's 100-block
modal limit, and "Show more" continues from there. Rendering counts fixed
controls, any filter inputs on screen, date headers and every
event, including closed events. A rejected modal update must be observable and
must not leave the user indefinitely on a loading view.

## 2. Context & links

- App affected: `apps/slackbot`
- Issue: [#879](https://github.com/F3-Nation/f3-nation/issues/879)
- Key code:
  - `apps/slackbot/features/calendar/home.py`
  - `apps/slackbot/utilities/slack/orm.py`
  - `apps/slackbot/utilities/database/special_queries.py` (`home_schedule_query`)
  - `apps/slackbot/utilities/builders.py`
  - `apps/slackbot/main.py`

## 3. User stories

- As a Slack workspace member, I want the calendar to display every
  chronological event that fits so that a dense schedule does not prevent the
  calendar from loading.
- As a Slack workspace member, I want the schedule near the top of the modal
  and each event's main action one tap away, so I can HC or take a Q without
  opening a menu.
- As a Slack workspace member, I want to page past the first screen of events
  so that a busy schedule is not cut off.
- As a Slack workspace member, I want a clear failure response if Slack rejects
  the calendar so that I am not left on an indefinite loading view.
- As an operator, I want modal-update failures recorded without sensitive Slack
  data so that calendar failures can be diagnosed.

## 4. Acceptance criteria (testable, non-contradictory)

- **AC-1** — GIVEN calendar controls and future events WHEN the event list is
  rendered THEN the resulting modal contains no more than 100 blocks, counting
  each filter input on screen.
- **AC-2** — GIVEN an event on a date that is not yet rendered WHEN its date
  header and event blocks would exceed the limit THEN none of them is appended.
- **AC-3** — GIVEN a closed event WHEN capacity is evaluated THEN it consumes
  one block (title, detail and menu in one section) under the same capacity
  rule as an open event, which consumes two (a section and a row of actions).
- **AC-4** — GIVEN an event group that brings the event list to exactly the
  limit WHEN capacity is evaluated THEN the complete group is appended.
- **AC-5** — GIVEN additional chronological events after the page reaches
  capacity WHEN rendering continues THEN no later event is appended and a
  "Show more" button continues from the first event not shown.
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

- **AC-9** — GIVEN Calendar Home opens WHEN it renders THEN the filter inputs
  are hidden and the top row has a Filters button labelled with the number of
  active filters, followed by a one-line summary of those filters and a legend
  for the event icons. The button shows or hides the inputs, and hidden
  filters keep applying, including across pages.
- **AC-10** — GIVEN the user changes a filter WHEN the calendar re-renders THEN
  the filter inputs stay shown and the first page of results is shown.
- **AC-11** — GIVEN an open event WHEN its row renders THEN the visible button
  is Take Q when the Q slot is open, otherwise HC, or Going when the user has
  already HC'd; Going removes the HC only after a confirmation. Every other
  action the user may take stays in the overflow menu.
- **AC-12** — GIVEN an event with more than one event type WHEN the schedule is
  queried THEN it is listed once, with all of its types, and an event-type
  filter matches it when any of its types is selected.
- **AC-13** — GIVEN the user is on a later page WHEN an event action refreshes
  the calendar THEN the same page is shown; "Back to start" returns to the
  first page.
- **AC-14** — GIVEN "Special events only" is selected WHEN the schedule is
  queried THEN only highlighted events are listed.

## 5. Roles & authorization (RBAC)

This change does not alter Slack or F3 authorization. The calendar remains
scoped to the invoking workspace's configured region, and existing admin/AO-Q
permissions continue to determine which event actions are available.

| Action                           | Allowed                                                                            | Explicitly denied                             |
| -------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------- |
| Open the interactive calendar    | Members of a configured Slack workspace with access to the installed F3 Nation app | Users without access to that workspace or app |
| Use administrative event actions | Existing region admins and AO-Q users under current calendar authorization rules   | Non-admin users for admin-only actions        |

## 6. Out of scope / non-goals

- Showing other regions' events, and saving a user's default filters.
- Establishing a fixed calendar date range shared by every region.
- Increasing Slack's 100-block platform limit.
- Changing event ordering or authorization.

## 7. Critical-path test cases

1. A full page of open and closed events stays within 100 blocks and ends with
   "Show more" (AC-1/AC-3/AC-5).
2. A new date whose complete group cannot fit leaves no orphan date header
   (AC-2), and a group that reaches the limit exactly is appended (AC-4).
3. A rejected `views.update` records only sanitized error context and propagates
   to the dispatcher (AC-6/AC-7).
4. A failed completed-view update replaces the loading modal with a generic
   error view, with direct-message fallback if replacement fails (AC-8).
5. Opening the calendar renders hidden filter inputs, the Filters button,
   summary and legend; the button shows and hides the inputs without dropping
   active filters; a filter change keeps them shown and resets to the first
   page; no block type outside those Slack allows in modals is sent
   (AC-9/AC-10).
6. Each row type renders its visible button and menu (AC-11).
7. Against Postgres, a two-type event is listed once, the type filter matches
   it, and offsets page through events without gaps or repeats (AC-12/AC-13).

## 8. Observability

- Emit `slack.modal.update_failed` for rejected modal updates.
- Safe context may include the Slack error code and constraint messages.
- Do not record Slack payloads, response URLs, trigger IDs, view IDs, user IDs,
  tokens, or other sensitive request data.
