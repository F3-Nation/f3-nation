# Series status cascade

> Human designer: Human-approved request

## 1. Summary

Reactivating an existing event series reactivates its already-existing current
and future instances, including instances individually deactivated, without
recreating instances or changing their history and relationships. Reactivating
an inactive one-off event whose `dayOfWeek` is null with a request that supplies
a non-null `dayOfWeek` generates its series instances. Deactivating an active
AO cascades to its event series and today's/future instances only; other events
and past instances are unchanged. This change adds a resource-scoped admin gate
for active AO deactivation via `org.crupdate`. Reactivating an inactive AO does
not cascade to event series or instances. An update that clears `dayOfWeek` on
an existing series, or combines active-series deactivation with an effective
structural schedule change, is rejected with `BAD_REQUEST` rather than
hard-deleting or regenerating instances.

## 2. Context & links

- App(s) affected: API
- Key code: `packages/api/src/router/event.ts`, `packages/api/src/lib/cascade-service.ts`
- Related: [Slackbot series time exceptions](slackbot-series-time-exceptions.md)

## 3. User stories

- As an authorized event editor, I want to reactivate an inactive series and
  its existing current/future instances so the series is available again.
- As an authorized event editor, I want to reactivate an inactive one-off event
  with `dayOfWeek: null` by supplying a non-null `dayOfWeek` and generate its
  series instances.
- As an AO editor, I want AO reactivation to leave event statuses unchanged so
  AO administration does not implicitly alter event decisions.
- As an AO admin, I want active AO deactivation to cascade to its event series
  and today's/future instances, without changing other events or past
  instances, while preventing editors from deactivating the AO.

## 4. Acceptance criteria (testable, non-contradictory)

- **AC-1** — GIVEN an inactive series with active or inactive instances dated
  today or later WHEN an editor reactivates the series THEN all those existing
  instances are active.
- **AC-2** — GIVEN past instances or instances belonging to another series
  WHEN a series is reactivated THEN their statuses are unchanged.
- **AC-3** — GIVEN an instance with `seriesException: "closed"` WHEN its series
  is reactivated THEN its exception, ID, attendance, and associations are
  unchanged.
- **AC-4** — GIVEN an existing series with `dayOfWeek` and an effective
  structural schedule change WHEN its status is changed THEN the request fails
  with `BAD_REQUEST` and no instances are deleted, recreated, or generated.
- **AC-5** — GIVEN an inactive AO with inactive events or instances WHEN an
  editor reactivates the AO THEN event and instance statuses remain unchanged.
- **AC-6** — GIVEN an active event WHEN an editor deactivates it through
  `event.crupdate` THEN the new resource-scoped admin requirement in this change
  denies an editor without admin permission. Inactive-to-active series edits
  remain editor-authorized.
- **AC-7** — GIVEN an active AO with event series and past, current, or future
  instances WHEN it is deactivated through `org.crupdate` THEN the event series
  and today's/future instances are deactivated, while other events and past
  instances are unchanged; an editor without resource-scoped admin permission
  is denied.
- **AC-8** — GIVEN an inactive one-off event with `dayOfWeek: null` WHEN an
  authorized editor reactivates it with a request supplying non-null
  `dayOfWeek` THEN its series instances are generated. See
  [`creates instances when an inactive one-off becomes an active series`](../../packages/api/src/router/event.test.ts).
- **AC-9** — GIVEN an existing event series WHEN an update clears `dayOfWeek`
  to convert it to a one-off THEN the request fails with `BAD_REQUEST` and does
  not hard-delete or regenerate its existing instances.
- **AC-10** — GIVEN an active event series WHEN a deactivation update through
  `event.crupdate` includes an effective structural schedule change THEN the
  request fails with `BAD_REQUEST` and does not hard-delete or regenerate
  instances.

## 5. Roles & authorization (RBAC)

The active-event and active-AO deactivation admin gates are new in this change;
they require admin permission scoped to the event/AO's resource. Other existing
event authorization is unchanged.

| Action                                              | Allowed                                        | Explicitly denied                                  |
| --------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------- |
| Reactivate a series                                 | Existing resource-scoped event editor or admin | Callers without editor permission on the event org |
| Deactivate an active event through `event.crupdate` | Resource-scoped admin (new in this change)     | Editor without admin permission                    |
| Deactivate an active AO through `org.crupdate`      | Resource-scoped admin (new in this change)     | Editor without admin permission                    |
| Reactivate an AO                                    | Existing resource-scoped AO editor or admin    | Callers without editor permission on the AO        |

## 6. Out of scope / non-goals

- Creating missing instances during status-only reactivation of an existing
  series with `dayOfWeek`.
- Changing past instances, unrelated series, closed exceptions, attendance,
  associations, or instance IDs.
- Cascading AO reactivation to events or instances.
- Converting an existing series to a one-off by clearing `dayOfWeek`; such
  updates are rejected with `BAD_REQUEST` rather than taking a hard-delete or
  regeneration path.
- Combining active-series deactivation with an effective structural schedule
  change; such updates are rejected with `BAD_REQUEST`. Do not treat a separate
  structural edit as a safe workaround, since the ordinary structural-edit
  path can hard-delete instances.

## 7. Critical-path test cases

- Reactivate a series and verify today's/future instances, including inactive
  ones, while past/unrelated instances and instance relationships stay intact.
- Reactivate an existing series with a structural schedule edit and verify
  `BAD_REQUEST` with no instances deleted, recreated, or generated.
- Reactivate an inactive one-off event with `dayOfWeek: null`, supplying
  non-null `dayOfWeek`, and verify its series instances are generated (see the
  linked `event.test.ts` case above).
- Reactivate an AO and verify event and instance statuses remain unchanged.
- Deactivate an active AO and verify its event series and today's/future
  instances are deactivated, while other events and past instances are
  unchanged; verify an editor without resource-scoped admin permission is
  denied.
- Clear `dayOfWeek` on an existing series and verify `BAD_REQUEST` with no
  hard-deletion or regeneration of instances.
- Deactivate an active series while applying an effective structural schedule
  change and verify `BAD_REQUEST` with no hard-deletion or regeneration of
  instances; do not substitute separate structural and deactivation updates.

## 8. Observability

- No new events or metrics.
