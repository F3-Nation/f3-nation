# Slackbot series time exceptions

> Human designer: Human-approved request

## 1. Summary

When Slackbot edits an event instance generated from a series, it preserves an
explicit per-instance time override as `different-time`, and removes that
exception when the time is returned to the series schedule. Closed instances
remain closed until reopened.

## 2. Context & links

- App(s) affected: slackbot
- Key code: `apps/slackbot/application/event_instance/`, calendar features

## 3. User stories

- As an authorized Slackbot calendar editor, I want edited series instances to
  retain their time exception so that the calendar reflects intentional overrides.
- As an authorized Slackbot calendar editor, I want reopening to restore the
  correct series relationship so that closed events are represented accurately.

## 4. Acceptance criteria (testable, non-contradictory)

- **AC-1** — GIVEN an existing series instance and an explicit submitted start
  time different from the fetched series start time WHEN it is edited THEN the
  full event-instance payload contains `seriesException: "different-time"`.
- **AC-2** — GIVEN a `different-time` series instance WHEN it is edited with an
  explicit start time matching the series time THEN the payload contains
  `seriesException: null`.
- **AC-3** — GIVEN a non-series instance or an update without an explicit start
  time WHEN it is edited THEN its current exception is preserved.
- **AC-4** — GIVEN a closed instance WHEN it is edited to another time THEN the
  payload still contains `seriesException: "closed"`.
- **AC-5** — GIVEN a closed series instance WHEN it is reopened THEN its
  exception is `different-time` when its time differs from the parent, and
  `null` when it matches.
- **AC-6** — GIVEN the parent series cannot be fetched or has no start time
  WHEN an instance is edited or reopened THEN the current exception is preserved.
- **AC-7** — GIVEN any full event-instance crupdate used by calendar editing,
  preblast-safe updates, or posted-preblast persistence THEN the payload sends
  `seriesException`, including a `null` value.

## 5. Roles & authorization (RBAC)

Existing Slackbot authorization remains unchanged. Users who are already
authorized by the existing calendar/preblast handlers can perform these
actions; unauthenticated or otherwise unauthorized users remain denied by the
existing routing and role checks.

| Action                                     | Allowed                            | Explicitly denied                               |
| ------------------------------------------ | ---------------------------------- | ----------------------------------------------- |
| Edit, reopen, or persist an event instance | Existing authorized Slackbot users | Users denied by existing Slackbot authorization |

## 6. Out of scope / non-goals

- Changing API/server behavior or Slackbot authorization.
- Changing the parent series itself.

## 7. Critical-path test cases

- Edit a series instance to a different time, then revert it.
- Reopen a closed series instance at matching and differing times.
- Save preblast fields and posted-preblast metadata without losing the exception.

## 8. Observability

- No new events or metrics; existing Slackbot logging is unchanged.
