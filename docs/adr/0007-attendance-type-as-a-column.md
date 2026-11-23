# ADR 0007: Store attendance type as a column on the attendance record

- **Date:** 2026-11-15
- **Author(s):** @evanpetzoldt

## Context

An attendance record says that a user planned to attend, or did attend, one
event instance. Its type says in what capacity: as a regular attendee (`PAX`),
as the leader (`Q`), or as a co-leader (`Co-Q`). The Slack bot calls the
`PAX` type (id 1) `HC`, for "hard commit"; both names refer to the same row.

The type is stored as a many-to-many relationship. `attendance_types` is a
lookup table with one row per type, and `attendance_x_attendance_types` links
an attendance record to any number of them. Nothing uses that flexibility:

- The code knows exactly three types and refers to them by fixed id. No
  feature creates, renames or removes a type, so the lookup table is
  reference data that behaves like a constant.
- The three types are ranks of one role, not independent attributes. A Q is
  attending; a Co-Q is not also the Q. The only combination the code writes
  on purpose is `PAX` plus a leadership type, and there `PAX` adds nothing
  the record's existence does not already say.
- No type has data of its own beyond its name and an optional description.

The structure has costs that every consumer pays:

- **Every question about a Q is a join.** Finding an event's Q, listing
  events without one, and counting Qs in reports all join through the link
  table. The API, the Slack bot's direct database queries and the analytics
  SQL each repeat that join, and analytics collapses it back to one value per
  record with a `GROUP BY`.
- **Type ids are magic numbers.** Because the lookup table's ids are not
  known at compile time, consumers either hard-code `2` and `3` or look the
  ids up by name on each request. The same literals appear in TypeScript,
  Python and SQL with nothing tying them together.
- **Changing a type is a delete and an insert.** There is no "set the type";
  writers remove link rows and add new ones, and every one of those row
  changes is recorded by the audit history as well.
- **The database cannot enforce the rules.** "One Q per planned event" spans
  two tables, so it can only be a read-then-write check in application code,
  which two concurrent requests can both pass.
- **The link table is as large as the attendance table.** It holds at least
  one row per attendance record, plus a primary-key index and a second index
  on the type column, on a table of several million rows.

## Decision

**Attendance type becomes a single required column on `attendance`, typed as
a Postgres enum.** The `attendance_types` and `attendance_x_attendance_types`
tables are removed.

- The enum is `attendance_type` with the values `pax`, `q` and `co_q`,
  declared with the other enums in `packages/shared/src/app/enums.ts` and
  mirrored in `packages/db-python`.
- The column is `attendance.attendance_type`, `NOT NULL`, defaulting to
  `pax`.
- An attendance record has exactly one type. Records that carry several
  today collapse to the highest by the precedence `q`, then `co_q`, then
  `pax`. The Slack bot's `HC` is the `PAX` row, so an `HC`-only record
  becomes `pax` and a `Q` plus `HC` record becomes `q`. A record with no
  type becomes `pax`.
- The API reads and writes one `attendanceType` value per record in place of
  the `attendanceTypeIds` request array and the `attendanceTypes` response
  array.

The change is made by expand and contract, because three separately deployed
systems read the link table directly (the API, the Slack bot and analytics),
as does anything fed by the database's change-data-capture stream:

1. **Expand.** Add the column, backfill it, and keep it correct from the link
   table with a database trigger, so every existing writer keeps working
   unchanged.
2. **Move readers.** Each consumer switches to reading the column, and each
   client that reads `attendanceTypes` from API responses switches to
   `attendanceType`.
3. **Move writers.** Each writer sets the column and keeps writing the
   matching link rows, so the column and the trigger agree whichever writer
   touched a record last. This starts only when no reader of the link table
   is left.
4. **Contract.** Once every writer sets the column, writers stop writing link
   rows. Then drop the trigger, both tables, their audit tracking and the
   `attendanceTypes` response field.

## Alternatives considered

**Keep the many-to-many structure.** Rejected: it models a flexibility the
domain does not have, and its costs fall on every consumer in three
languages.

**A foreign-key column, `attendance.attendance_type_id`, keeping the lookup
table.** This removes the link table and its join, and keeps the integer ids
the API and Slack bot already pass around, so it is the cheaper change.
Rejected because it keeps the magic numbers and the per-request id lookup,
which are a large part of what makes the current code hard to read. A lookup
table earns its place when its rows change at runtime or carry data; these do
neither.

**Boolean columns, `is_q` and `is_co_q`.** Rejected: it permits the
contradictory state "both", which needs a check constraint to rule out, and
adding a type means adding a column.

**A plain text column with a check constraint.** Equivalent in behavior. The
enum is chosen for consistency with the other fixed sets in the schema and
because the enum-parity test already keeps the Python models in step with it.

## Consequences

**Better:**

- A Q lookup is a filter on a column of the row already being read. The
  aggregate steps in analytics disappear.
- Types are named values checked by the type system in TypeScript and Python,
  and by Postgres on write.
- Setting a type is one `UPDATE`. Creating an attendance record is one insert
  and one audit entry, not two or more of each.
- The database can enforce type rules. A partial unique index can guarantee
  one Q per planned event instance, which closes the race in the application
  check. Planned events that already have more than one Q are counted and
  resolved before the index is created, since it cannot be built over them.
- One fewer multi-million-row table and two fewer indexes to store, back up,
  copy to staging and obfuscate.

**Accepted tradeoffs:**

- **A record can hold only one type.** "Q and Co-Q at once" cannot be stored,
  and "Q but not attending" cannot either: a Q counts as attending. Any
  record that held such a combination loses it in the backfill, so the
  combinations present in production are counted before the backfill runs.
- **Withdrawing as a leader needs a defined result.** With several types, a
  Q could drop the `PAX` type and stay Q. With one type, removing Q status
  demotes the record to `pax`, and withdrawing attendance deletes it.
- **Adding a type is a migration.** A new value needs an `ALTER TYPE`, and
  reordering or removing one means recreating the enum. This is the right
  cost for a set that has not changed, and the wrong design if regions ever
  need to define their own types.
- **The API contract changes.** Requests send one `attendanceType` in place
  of the `attendanceTypeIds` array; the API still accepts the old field,
  collapsing it by the same precedence, until its callers have moved.
  Responses gain `attendanceType` and keep the `attendanceTypes` array,
  derived from the column, until its readers have moved; it is removed at the
  contract step.
- **The backfill writes the leadership rows.** Adding the column with its
  `pax` default writes no rows, so only records holding `Q` or `Co-Q` are
  updated. Those updates run in batches and are recorded in audit history
  like any other change; tracking on `attendance` is not disabled, because
  that would also drop the audit entries of every live writer in the window.
- **The migration window has two sources of truth.** While the trigger is in
  place the column is derived from the link table, and any link-row change
  overwrites it. A writer that set only the column would lose its value at
  the next link-row change, and a remove by a writer that has not moved
  would find no link row to delete and leave the column stale. So writers
  keep writing link rows until all of them set the column, and stop only at
  the contract step, when no reader of the link table is left.
- **Consumers outside this repository break at the contract step.** Anything
  reading the two tables from the replicated copy of the database has to move
  before they are dropped.
