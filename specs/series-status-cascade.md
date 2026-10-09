# Series status cascade

> Human designer: Human-approved request

## 1. Summary

Reactivating an existing event series reactivates its already-existing current
and future instances, including instances individually deactivated, without
recreating instances or changing their history and relationships. Reactivating
an inactive AO does not cascade to event series or instances.

## 2. Context & links

- App(s) affected: API
- Key code: `packages/api/src/router/event.ts`, `packages/api/src/lib/cascade-service.ts`
- Related: [Slackbot series time exceptions](slackbot-series-time-exceptions.md)

## 3. User stories

- As an authorized event editor, I want to reactivate an inactive series and
  its existing current/future instances so the series is available again.
- As an AO editor, I want AO reactivation to leave event statuses unchanged so
  AO administration does not implicitly alter event decisions.

## 4. Acceptance criteria (testable, non-contradictory)

- **AC-1** — GIVEN an inactive series with active or inactive instances dated
  today or later WHEN an editor reactivates the series THEN all those existing
  instances are active.
- **AC-2** — GIVEN past instances or instances belonging to another series
  WHEN a series is reactivated THEN their statuses are unchanged.
- **AC-3** — GIVEN an instance with `seriesException: "closed"` WHEN its series
  is reactivated THEN its exception, ID, attendance, and associations are
  unchanged.
- **AC-4** — GIVEN a series reactivation with simultaneous schedule changes
  WHEN the update is saved THEN existing instances are not hard-deleted,
  recreated, or supplemented with missing instances.
- **AC-5** — GIVEN an inactive AO with inactive events or instances WHEN an
  editor reactivates the AO THEN event and instance statuses remain unchanged.
- **AC-6** — GIVEN an active series WHEN an editor deactivates it through
  `event.crupdate` THEN the existing resource-scoped admin requirement remains;
  an editor without admin permission is denied. Inactive-to-active series
  edits remain editor-authorized.

## 5. Roles & authorization (RBAC)

Existing event authorization is unchanged apart from the already-approved
active-to-inactive admin gate.

| Action                                              | Allowed                                        | Explicitly denied                                  |
| --------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------- |
| Reactivate a series                                 | Existing resource-scoped event editor or admin | Callers without editor permission on the event org |
| Deactivate an active event through `event.crupdate` | Resource-scoped admin                          | Editor without admin permission                    |
| Reactivate an AO                                    | Existing resource-scoped AO editor or admin    | Callers without editor permission on the AO        |

## 6. Out of scope / non-goals

- Creating missing instances during status-only reactivation.
- Changing past instances, unrelated series, closed exceptions, attendance,
  associations, or instance IDs.
- Cascading AO reactivation to events or instances.

## 7. Critical-path test cases

- Reactivate a series and verify today's/future instances, including inactive
  ones, while past/unrelated instances and instance relationships stay intact.
- Reactivate with a structural schedule edit and verify there are no hard
  deletes or generated instances.
- Reactivate an AO and verify event and instance statuses remain unchanged.

## 8. Observability

- No new events or metrics.
