# F3 Nation API Reference

**Live deployed spec**: `https://api.f3nation.com/docs/openapi.json`
**Local spec**: `<F3_API_BASE_URL>/docs/openapi.json`
**Interactive docs**: `https://api.f3nation.com/docs`
**API version**: 4.2.2

> This file is a curated summary for AI agents and developers. It covers auth,
> conventions, and the domains relevant to this Slack bot. For full schema details,
> fetch the live OpenAPI JSON above.

---

## Authentication

Every request requires **both** of the following headers:

```
Authorization: Bearer <F3_API_KEY>
Client: f3-nation-slack-bot
```

- `F3_API_KEY` — env var; never commit to source control.
- `Client` — identifies this application; must be a non-empty string.
- **Rate limit**: 500 requests per 60 seconds → `429 Too Many Requests`.

See `infrastructure/api_client/client.py` for the implementation.

---

## Response Conventions

### Envelope keys

Most endpoints wrap results in a typed envelope key:

| Domain         | List key     | Single key  |
| -------------- | ------------ | ----------- |
| event-tag      | `eventTags`  | `eventTag`  |
| event-type     | `eventTypes` | `eventType` |
| org            | `orgs`       | `org`       |
| location       | `locations`  | `location`  |
| event          | `events`     | `event`     |
| event-instance | _(varies)_   | _(varies)_  |
| user           | `users`      | `user`      |
| position       | `positions`  | `position`  |

### Field naming

API responses use **camelCase** (`specificOrgId`, `isActive`). Some older or alternative
payloads may use snake_case. Repository implementations must handle both:

```python
raw.get("specificOrgId", raw.get("specific_org_id"))
```

### Create vs Update (crupdate pattern)

Most domains use a single `POST` endpoint for both create and update:

- **Omit `id`** → creates a new record.
- **Include `id`** → updates the existing record.

### Soft delete

`DELETE` operations mark records as `isActive: false` rather than removing them.
The response returns the deleted record's ID (e.g., `{ "eventTagId": 42 }`).

### Pagination

List endpoints accept `pageIndex` (0-based) and `pageSize`. Responses include `totalCount`.

---

## Domains

### event-tag

| Method   | Path                        | Purpose                                                         |
| -------- | --------------------------- | --------------------------------------------------------------- |
| `GET`    | `/v1/event-tag`             | List all tags (paginated, filterable by `orgIds`, `statuses`)   |
| `POST`   | `/v1/event-tag`             | Create or update a tag (crupdate)                               |
| `GET`    | `/v1/event-tag/org/{orgId}` | All tags for an org (global + org-specific; filter client-side) |
| `GET`    | `/v1/event-tag/id/{id}`     | Single tag by ID                                                |
| `DELETE` | `/v1/event-tag/id/{id}`     | Soft delete                                                     |

**Create/update payload:**

```json
{ "name": "CSAUP", "color": "#32CD32", "specificOrgId": 123, "isActive": true }
```

**Update additionally requires:** `"id": 42`

**Response object fields:**
`id`, `name`, `description`, `color`, `specificOrgId`, `isActive`, `created`, `updated`

> **Important**: `GET /v1/event-tag/org/{orgId}` returns **both** global (nation-wide) and
> org-specific tags. Filter to `specificOrgId == orgId` to get only org-specific ones.
> See `infrastructure/api_client/event_tag_repository.py`.

---

### org

Organizations are hierarchical: `nation → sector → area → region → ao`

| Method   | Path                  | Purpose                                                      |
| -------- | --------------------- | ------------------------------------------------------------ |
| `GET`    | `/v1/org`             | List orgs (filter by `orgTypes`, `parentOrgIds`, `statuses`) |
| `POST`   | `/v1/org`             | Create or update an org                                      |
| `GET`    | `/v1/org/id/{id}`     | Single org by ID                                             |
| `GET`    | `/v1/org/accessible`  | Orgs the caller has editor/admin role on                     |
| `GET`    | `/v1/org/mine`        | Orgs where the caller has any role                           |
| `DELETE` | `/v1/org/delete/{id}` | Soft delete (cascades to AO events/instances)                |
| `GET`    | `/v1/org/count`       | Count matching orgs                                          |

**Response object fields:**
`id`, `parentId`, `name`, `orgType`, `defaultLocationId`, `description`, `isActive`,
`logoUrl`, `website`, `email`, `twitter`, `facebook`, `instagram`, `lastAnnualReview`,
`meta`, `created`, `updated`, `aoCount`, `parentOrgName`, `parentOrgType`

**`orgType` values:** `"ao"` | `"region"` | `"area"` | `"sector"` | `"nation"`

---

### location

| Method   | Path                           | Purpose                                            |
| -------- | ------------------------------ | -------------------------------------------------- |
| `GET`    | `/v1/location`                 | List locations (filter by `regionIds`, `statuses`) |
| `POST`   | `/v1/location`                 | Create or update a location                        |
| `GET`    | `/v1/location/id/{id}`         | Single location by ID                              |
| `DELETE` | `/v1/location/delete/{id}`     | Soft delete (admin role required)                  |
| `GET`    | `/v1/location/in-bounding-box` | Locations within lat/lng bounds                    |

**Response object fields:**
`id`, `locationName`, `orgId`, `regionId`, `regionName`, `description`, `isActive`,
`latitude`, `longitude`, `email`, `addressStreet`, `addressStreet2`, `addressCity`,
`addressState`, `addressZip`, `addressCountry`, `meta`, `created`, `updated`

---

### event

Recurring series events. Future instances are auto-generated on create/update.

| Method   | Path                    | Purpose                                                              |
| -------- | ----------------------- | -------------------------------------------------------------------- |
| `GET`    | `/v1/event`             | List events (filter by `regionIds`, `aoIds`, `eventTypeNames`, etc.) |
| `POST`   | `/v1/event`             | Create or update an event (crupdate)                                 |
| `GET`    | `/v1/event/id/{id}`     | Single event by ID                                                   |
| `DELETE` | `/v1/event/delete/{id}` | Soft delete (future instances also deleted)                          |
| `GET`    | `/v1/event/count`       | Count matching events                                                |

**Create/update required fields:** `isActive`, `highlight`, `startDate`, `name`, `regionId`, `aoId`, `eventTypeIds`

**`recurrencePattern` values:** `"weekly"` | `"monthly"`  
**`dayOfWeek` values:** `"monday"` | `"tuesday"` | … | `"sunday"`  
**`startTime` / `endTime` format:** 4-digit string, e.g. `"0600"`

---

### event-instance

Individual occurrences of events (can be standalone or part of a series).

| Method   | Path                                        | Purpose                                                                |
| -------- | ------------------------------------------- | ---------------------------------------------------------------------- |
| `GET`    | `/v1/event-instance`                        | List instances (filter by `regionOrgId`, `aoOrgId`, `startDate`, etc.) |
| `POST`   | `/v1/event-instance`                        | Create or update an instance                                           |
| `GET`    | `/v1/event-instance/id/{id}`                | Single instance by ID                                                  |
| `DELETE` | `/v1/event-instance/id/{id}`                | Hard delete                                                            |
| `GET`    | `/v1/event-instance/calendar-home-schedule` | Calendar home view (user attendance + Q info)                          |
| `GET`    | `/v1/event-instance/upcoming-qs`            | Instances where user is Q/Co-Q (for preblast)                          |
| `GET`    | `/v1/event-instance/past-qs`                | Past instances where user is Q/Co-Q (for backblast)                    |
| `GET`    | `/v1/event-instance/without-q`              | Past instances with no Q assigned                                      |

**Instance-specific fields:** `preblast`, `preblastRich`, `preblastTs`, `backblast`,
`backblastRich`, `backblastTs`, `paxCount`, `fngCount`, `seriesException`

**`seriesException` values:** `"closed"` | `"different-time"` | `"miscellaneous"`

---

### event-type

| Method   | Path                         | Purpose                                                               |
| -------- | ---------------------------- | --------------------------------------------------------------------- |
| `GET`    | `/v1/event-type`             | List event types (filter by `orgIds`, `ignoreNationEventTypes`, etc.) |
| `POST`   | `/v1/event-type`             | Create or update an event type                                        |
| `GET`    | `/v1/event-type/org/{orgId}` | Event types for a specific org                                        |
| `GET`    | `/v1/event-type/id/{id}`     | Single event type by ID                                               |
| `DELETE` | `/v1/event-type/id/{id}`     | Soft delete (removes event associations)                              |

**`eventCategory` values:** `"first_f"` | `"second_f"` | `"third_f"`

---

### attendance

| Method   | Path                                                            | Purpose                                          |
| -------- | --------------------------------------------------------------- | ------------------------------------------------ |
| `GET`    | `/v1/attendance/event-instance/{eventInstanceId}`               | All attendance for an instance                   |
| `POST`   | `/v1/attendance`                                                | Create planned attendance (HC)                   |
| `POST`   | `/v1/attendance/actual`                                         | Create actual attendance (backblast)             |
| `DELETE` | `/v1/attendance/event-instance/{eventInstanceId}/actual`        | Delete all actual attendance (for re-submission) |
| `DELETE` | `/v1/attendance/event-instance/{eventInstanceId}/user/{userId}` | Remove planned attendance                        |
| `PATCH`  | `/v1/attendance/{attendanceId}/types`                           | Update attendance types                          |
| `POST`   | `/v1/attendance/take-q`                                         | Sign up as Q                                     |
| `DELETE` | `/v1/attendance/remove-q`                                       | Remove Q status (keeps HC)                       |
| `PUT`    | `/v1/attendance/assign-q`                                       | Assign Q + Co-Qs (demotes existing Q to HC)      |

---

### user

| Method   | Path                     | Purpose                                              |
| -------- | ------------------------ | ---------------------------------------------------- |
| `GET`    | `/v1/user`               | List users (filter by `orgIds`, `roles`, `statuses`) |
| `POST`   | `/v1/user`               | Create or update a user                              |
| `GET`    | `/v1/user/id/{id}`       | Single user by ID                                    |
| `GET`    | `/v1/user/email/{email}` | User by email address                                |
| `GET`    | `/v1/user/orgs`          | Users by org (includes descendants)                  |
| `DELETE` | `/v1/user/delete/{id}`   | Permanent delete (nation admin only)                 |

**Role values:** `"user"` | `"editor"` | `"admin"`

**PII fields** (`email`, `phone`, `emergencyContact`, etc.) require `includePii=true`
query param and admin role.

---

### position

| Method   | Path                                                                       | Purpose                                       |
| -------- | -------------------------------------------------------------------------- | --------------------------------------------- |
| `GET`    | `/v1/position`                                                             | List positions (filter by `orgId`, `orgType`) |
| `POST`   | `/v1/position`                                                             | Create or update a position                   |
| `GET`    | `/v1/position/org/{orgId}`                                                 | Org-specific positions                        |
| `GET`    | `/v1/position/id/{id}`                                                     | Single position by ID                         |
| `DELETE` | `/v1/position/id/{id}`                                                     | Soft delete                                   |
| `GET`    | `/v1/position/assignments/{orgId}`                                         | Positions + assigned users for an org         |
| `POST`   | `/v1/position/assignments`                                                 | Add a single user→position assignment         |
| `DELETE` | `/v1/position/assignments/org/{orgId}/position/{positionId}/user/{userId}` | Remove assignment                             |
| `GET`    | `/v1/position/assignments/user/{userId}`                                   | All assignments for a user                    |

---

### ping

```
GET /v1/ping
```

No auth required. Returns `{ "alive": true, "timestamp": "..." }`.

---

## Error Handling

| HTTP Status     | Meaning                                  | Python exception            |
| --------------- | ---------------------------------------- | --------------------------- |
| 401 / 403       | Invalid/expired key or insufficient role | `F3ApiAuthError`            |
| 404             | Resource not found                       | `F3ApiNotFoundError`        |
| 429             | Rate limit exceeded                      | `F3ApiError`                |
| 5xx             | Server error                             | `F3ApiError`                |
| network failure | DNS / connection error                   | `F3ApiError(status_code=0)` |

See `infrastructure/api_client/exceptions.py`.
