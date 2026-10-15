# Region-in-a-box notifications for AO and recurring-event changes

> **User-approved acceptance criteria and reliability choice.** No named human designer is assumed or assigned.
>
> Issue: [F3-Nation/f3-nation#1113](https://github.com/F3-Nation/f3-nation/issues/1113)

## 1. Summary

After a qualifying change commits, send the existing region-in-a-box welcome packet to its destination region if that region is eligible and its `region.meta.firstEventNotificationSent` marker is not already true. Eligibility is evaluated against the destination region's state after the change: it must have any active recurring event (`isActive = true`, `dayOfWeek` non-null) belonging to an AO parented by that region; the qualifying event need not be the AO/event that moved or was created. Thus, moving an empty AO into a region that already has a qualifying event can trigger the packet, while moving it into a region with no qualifying event cannot. The intended notification is one per region ever, regardless of how many AOs/events later move into or are created in that region; moving an AO/event to another region does not reset the destination region's marker. An ambiguous SMTP error followed by retry may cause duplicate delivery. Apply this behavior to direct organization/event updates, directly auto-applied map submissions, and admin review approvals. A newly created qualifying event may trigger the email even when its AO remains in the same region. Do not notify for pending/rejected requests, failed/rolled-back changes, or a same-region event move by itself. Preserve the current template, recipient policy, and existing `event.crupdate` creation behavior.

## 2. Context & links

- Issue: https://github.com/F3-Nation/f3-nation/issues/1113
- App(s) affected: **api** (`packages/api`); supporting **map** request submission and **admin** request approval flows.
- Related specs: [`map-update-request-flow.md`](map-update-request-flow.md), [`admin-generic-org-management.md`](admin-generic-org-management.md).
- Relevant existing behavior: region-in-a-box email currently sends for a newly created recurring event through `event.crupdate`. Retain that behavior.
- Triggering API paths identified by the issue: `org.crupdate`, `event.crupdate`, approved map request handlers including `create_ao_and_location_and_event` and `create_event`.
- Existing request authorization and approval behavior remains governed by the map update request flow; this feature adds no endpoint or role.

## 3. User stories

- As a destination-region contact or editor/admin, I want to be notified when an AO or recurring event enters my region so that I can welcome and support the incoming AO.
- As a map submitter or reviewer, I want notification behavior to follow the persisted, approved change so that unapproved or failed proposals do not send misleading email.

## 4. Acceptance criteria (testable, non-contradictory)

Each criterion is independently verifiable. “Destination region” means the region that owns the AO after the database change is persisted. A qualifying event is an active series event (`events.isActive = true`, `events.dayOfWeek IS NOT NULL`) belonging to an AO whose parent organization is that region. For new triggers, evaluate whether a destination region has any qualifying event after the triggering change commits; it need not be associated with the AO/event involved in that trigger.

### Notification eligibility and triggers

- **AC-1 — Existing creation behavior** — GIVEN `event.crupdate` creates a recurring event in a region WHEN the event and its related writes commit THEN the pre-existing region-in-a-box notification behavior for this path remains unchanged, including its current event-eligibility behavior; this feature does not add an `isActive` gate to that existing path. The region-level once-only rule in AC-7 still applies.
- **AC-2 — AO moved by organization update** — GIVEN a persisted AO is moved by `org.crupdate` into a different destination region WHEN the update commits THEN, if the destination region has any qualifying recurring event after the move and `destinationRegion.meta.firstEventNotificationSent` is not already true, the existing welcome packet is sent to eligible destination-region recipients. The qualifying event may belong to another AO in that region. No notification is sent to the old region, and the move does not clear or reset either region's marker.
- **AC-3 — AO move via directly applied map request** — GIVEN an authorized submitter's AO-move request is automatically applied on submission WHEN the applied change commits THEN, if the destination region has any qualifying recurring event after the move and its `meta.firstEventNotificationSent` is not already true, the existing welcome packet is sent to eligible destination-region recipients. The qualifying event need not belong to the moved AO; no notification is sent to the old region.
- **AC-4 — AO move via review approval** — GIVEN a pending AO-move request WHEN an authorized reviewer approves it and the move commits THEN, if the destination region has any qualifying recurring event after the move and its `meta.firstEventNotificationSent` is not already true, the existing welcome packet is sent to eligible destination-region recipients. The qualifying event need not belong to the moved AO; no notification is sent to the old region.
- **AC-5 — Event created by approved map request** — GIVEN a `create_ao_and_location_and_event` or `create_event` map request creates an active recurring event belonging to an AO in a region with eligible recipients WHEN the request is auto-applied or approved and its writes commit THEN the existing welcome packet is sent to that region if and only if its `meta.firstEventNotificationSent` is not already true, even when the AO already belonged to that same region before this event was created; atomically claim the region marker before sending and leave it set on successful notification.
- **AC-6 — Existing event moved across regions** — GIVEN an event is moved to an AO in a different region by `event.crupdate`, direct auto-application of a map request, or review approval WHEN the change commits THEN, if the destination region has any qualifying recurring event after the move and its `meta.firstEventNotificationSent` is not already true, the existing welcome packet is sent to that region. The qualifying event may be the moved event or another event in the region. The old region is not notified, and a region's marker remains set if the AO/event later moves elsewhere.
- **AC-7 — Once per region ever** — GIVEN `region.meta.firstEventNotificationSent` is true WHEN any later qualifying AO move, event move, or qualifying event creation targets that region THEN no additional region-in-a-box email is sent to that region, regardless of event/AO identity or whether the change originated in a different region. A successful email leaves the region marker true. A same-region event move by itself does not trigger a notification. The marker is region-scoped, not event-scoped, and is not reset by later moves; an ambiguous SMTP error followed by clearing and retrying the claim may cause duplicate delivery as described in AC-15.
- **AC-8 — Notification marker survives ordinary region edits** — GIVEN a region's persisted `meta.firstEventNotificationSent` marker is true WHEN an ordinary `org.crupdate` region edit omits `meta` or supplies stale/explicit metadata with the marker false, unset, or absent THEN the server preserves the marker as true in persisted metadata; an ordinary region edit cannot clear this server-owned true marker. This preservation applies independently of whether the current mutation causes a notification.
- **AC-9 — Destination-region eligibility for new triggers** — GIVEN a candidate notification trigger other than the pre-existing `event.crupdate` creation behavior in AC-1 WHEN the committed change leaves the destination region with no active recurring event (`isActive = true`, non-null `dayOfWeek`) belonging to any AO parented by that region THEN no new region-in-a-box email is sent and the marker is not set. The qualifying event can belong to an AO other than the one moved/edited/created. An empty AO moved into a region with another qualifying event can trigger a notification if the region marker is not already true; an empty AO moved into an empty region cannot.
- **AC-10 — Same-region event move** — GIVEN an existing event is moved between AOs whose parent is the same region WHEN the change commits THEN that move alone does not trigger a region-in-a-box email, even if the region marker is unset. A distinct qualifying event-creation trigger remains governed by AC-5.

### Request and transaction outcomes

- **AC-11 — Pending and rejected requests** — GIVEN a map request is pending or rejected WHEN it is submitted, reviewed, or rejected THEN no region-in-a-box email is sent and no region marker is set for the proposed change.
- **AC-12 — Failed persistence / rollback** — GIVEN a direct update, auto-applied submission, or review approval fails or rolls back before its data change commits WHEN its handler completes THEN no region-in-a-box email is sent and no region marker is set for the uncommitted change.

### Recipients and retry behavior

- **AC-13 — Existing template and recipients** — GIVEN a destination region has configured eligible recipients WHEN a qualifying notification is sent THEN it uses the existing region-in-a-box email template and existing recipient rules: region contact plus the region's admins/editors. This feature does not alter the template, content, or recipient selection policy.
- **AC-14 — No eligible recipients** — GIVEN a qualifying change targets a region with no eligible recipients under the existing recipient policy and its marker is unset WHEN notification is evaluated THEN no email is sent and `region.meta.firstEventNotificationSent` remains unset, allowing a later qualifying attempt to retry.
- **AC-15 — Notification failure and retry** — GIVEN the database change commits and the atomic conditional claim succeeds but sending the notification returns an error WHEN the handler completes THEN the persisted AO/event change remains committed and the claimed region marker is cleared so a later qualifying trigger can retry. If the SMTP outcome is ambiguous, that retry may result in a duplicate email. Notification failure never rolls back the committed map change.

### Approved reliability behavior

- **AC-16 — Atomic conditional claim and detached post-commit processing** — GIVEN a qualifying committed change targets an eligible, unnotified destination region WHEN detached post-commit notification processing runs THEN it atomically conditionally claims the region using the existing `region.meta.firstEventNotificationSent` marker before sending, and only the claimant sends. A failed send clears/releases the claim under AC-15. Processing is detached: a crash after claiming but before sending can suppress the email, and a crash before processing starts can lose the notification. An ambiguous SMTP error followed by a retry can duplicate the email. This design does not provide a durable outbox or guarantee exactly-once delivery.

If claim release itself fails after an email-send error, the marker remains set and suppresses later sends. An operator can manually repair this stuck claim by removing `meta.firstEventNotificationSent` from the affected region organization, preserving all other metadata, then allow a later qualifying trigger to retry. The `api.first_event.claim_release_failed` log identifies this condition with `stuck: true` and the region ID/name; do not clear markers for successful deliveries.

## 5. Roles & authorization (RBAC)

This is a side effect of existing authorized mutations, not a new user action. Do not change procedure tiers, role inheritance, resource checks, or map-request authorization. Existing `checkHasRoleOnOrg` and endpoint checks remain authoritative, including checks on every affected org for auto-application/approval.

| Action                                                            | Allowed                                                                                                                                                                               | Explicitly denied                                                                                                                                 |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trigger notification through `org.crupdate` / `event.crupdate`    | Only callers already authorized by the existing procedure tier and resource-scoped org checks for that mutation                                                                       | Anonymous callers and authenticated callers rejected by existing procedure or target-org checks; notification logic grants no mutation permission |
| Directly auto-apply a map request that can trigger a notification | Existing map-request submitter permitted to auto-apply under `map-update-request-flow.md` (editor/admin on every affected org); otherwise the existing flow records a pending request | A submitter lacking required access to any affected org cannot cause the change or notification through auto-application                          |
| Approve a pending map request that can trigger a notification     | Existing reviewer authorized for every org touched by the approved change, per `map-update-request-flow.md`                                                                           | Reviewer lacking scope on any touched org; approval fails and no change or notification occurs                                                    |
| Send the notification                                             | Server-side effect after a qualifying committed change; no additional caller role is introduced                                                                                       | Client/submitter/reviewer cannot invoke a notification independently or choose an arbitrary destination region                                    |

## 6. Out of scope / non-goals

- Changing authentication, RBAC, procedure tiers, resource authorization, or map-request review rules.
- Changing email template content, formatting, subject, or recipient policy.
- Notifications for pending/rejected proposals, or for new triggers whose destination region has no active recurring event; inactive/non-recurring events do not qualify as the required region event.
- Notification to the origin/old region, or notification solely because an existing event moved between AOs in the same region.
- A general-purpose email retry service, delivery dashboard, or guarantee of exactly-once email delivery.
- Changing event creation, AO/event persistence, or unrelated organization notifications beyond adding the specified notification triggers.

## 7. Critical-path test cases

- `event.crupdate` creation retains the existing email/template/recipient and event-eligibility behavior (including no newly imposed `isActive` gate); new notification triggers separately enforce the qualifying-event filter.
- Ordinary `org.crupdate` region edit omitting `meta` preserves an existing persisted notification marker.
- AO move via `org.crupdate`, directly auto-applied AO-move request, and approved AO-move request notify an unnotified destination region after commit when that destination region has any qualifying event, including one belonging to a different AO; never notify the old region. Cover an empty AO moved into both a qualifying and an empty destination region.
- Qualifying event creation through both `create_ao_and_location_and_event` and `create_event` notifies an unnotified region even when the AO already belongs to it; cover direct auto-application and review approval where applicable.
- Existing event moved across regions via `event.crupdate`, auto-applied request, and review approval notifies an unnotified destination region if any event in that region qualifies, whether or not the moved event itself qualifies; moving to a region whose marker is already true sends nothing, even if the event/AO has never been there before. Same-region event moves alone do not send.
- Destination region with no active recurring event, a region whose only events are inactive or null-`dayOfWeek`, pending request, rejection, and transaction rollback each produce no newly-triggered email and do not set the region marker. An AO having no qualifying event does not prevent a notification if another AO in its destination region has one.
- After one successful notification, later qualifying changes from any AO/event do not send a second email to that region; verify region-scoped marker persistence and that moving elsewhere does not reset it. Concurrent triggers verify that only one atomic claimant sends. Verify send-error claim release/retry, and document the specified detached-processing crash windows without asserting durable delivery or exactly-once behavior.
- An ordinary `org.crupdate` region edit that omits `meta` or supplies stale metadata with a false/unset marker preserves an already-true `region.meta.firstEventNotificationSent`; no eligible recipients leaves an unnotified region's marker false/unset. Verify the existing template/recipient policy and that send failure does not roll back committed map data.

## 8. Observability

- Follow existing `@acme/logger` patterns for notification failures; no additional logging or metrics are required by this issue. Never log recipient email addresses, names, message contents, or other PII.
- Keep notification failure distinct from mutation failure: a committed AO/event update remains successful even if email delivery fails.
- Observability must not imply durable delivery or exactly-once delivery; ambiguous SMTP errors may result in duplicate retries, and detached-processing crashes may lose or suppress a notification.

## 9. Data & reliability decision

- Use the existing `region.meta.firstEventNotificationSent` marker as an atomic conditional pre-send claim and region-scoped once-only record. A successful delivery leaves it true across later AO/event moves; a send error clears/releases it to permit retry. Ordinary region edits must preserve an already-true marker as specified in AC-8. Do not introduce a new schema or state model for this issue.
- “Once” means one intended notification per region ever, not one per event, AO, move, or event-region pair. Any qualifying active series event in an AO parented by an unnotified region can trigger the region's first email. An ambiguous SMTP error followed by retry may duplicate actual delivery as specified above.
- Notification work runs detached after the map-data transaction commits. There is no durable outbox: a crash after the claim and before send can suppress the notification; a crash before detached processing starts can lose it. Clearing the claim after a reported send error permits retries, but ambiguous SMTP outcomes can cause duplicates. The database claim plus external email delivery do not guarantee exactly-once delivery.
