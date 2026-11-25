# ADR 0008: Positions grant permissions alongside roles

- **Date:** 2026-11-25
- **Author(s):** @taterhead247

## Context

[ADR 0002](0002-permission-based-authorization.md) decided that **code checks
permissions; humans are granted roles.** An endpoint asks "may this caller
`messages.send` on this org?", and a code-defined map in `@acme/shared`
(`ROLE_PERMISSIONS` in `packages/shared/src/app/permissions.ts`) says which
permissions each role includes. Roles are granted per org and checked up the
org tree.

F3 also has **positions**: jobs a person holds in F3, such as Site Q of an AO
or Nant'an of a region. A position is defined in `positions`, either by the
nation (no `org_id`, offered to every org) or by one org for its own use, and
a person holds it on an org through `positions_x_orgs_x_users`. Nothing in
the API's authorization reads positions.

The Slack bot does read them. It enforces two rules the API has no way to
express:

- A person who holds the Site Q position on any AO in a region may do what a
  region admin does to that region's calendar, preblasts and backblasts. The
  bot finds Site Qs by matching the position's name, `"Site Q"`.
- The Q or a Co-Q of an event may edit that event's preblast, backblast,
  location and event tags, and add or remove the people on it.

As the bot's changes move into the API and are made as the person acting in
Slack ([ADR 0006](0006-first-party-app-acts-for-a-user.md)), the API has to
enforce these rules itself, or the people they cover lose access.

The ways to do that with roles alone all make a role stand in for a position:
grant every Site Q the admin role, by hand or automatically when the position
is assigned, or add a "Site Q" role. Each one makes regions keep two records
of the same fact in step, and each turns a job at one AO into admin rights
over a whole region.

The two words mean different things and should stay that way. A **role** is a
term of this codebase: a named bundle of permissions an admin grants. A
**position** is something a person does in the F3 world.

## Decision

**Endpoints keep checking only permissions. Positions become a second source
of permissions, mapped in code exactly as roles are.** For each call, the API
gathers the caller's role grants and, when the caller is a person, their
position assignments, turns each into the permissions it includes on the org
it is held on, and checks the requested permission against that set with the
existing walk up the org tree. No endpoint asks for a role or a position by
name.

### Who the API looks up

- **A person** (a cookie session, a user access token, or the acting user of
  a delegated call): their roles and their positions.
- **An API key acting as itself**: the roles granted to the key. A key holds
  no positions.
- Position assignments are read from the database on every request. They are
  not added to the session token, so assigning or removing a position takes
  effect on the caller's next request.
- A permission that comes from a position covers the org the position is held
  on and everything beneath it, the same as a role grant.

The change sits behind the existing permission check
(`checkHasPermissionsOnOrg` and `permissionProcedure`): the lookup behind
them gains positions, and their callers do not change.

### The position map

- A `POSITION_PERMISSIONS` map in `@acme/shared`, beside `ROLE_PERMISSIONS`,
  lists the permissions each mapped position includes and the org types it
  grants them on. An assignment on any other org type grants nothing.
- A mapped position is identified by a fixed id that the nation's seed gives
  it in every environment, never by its name. Names can be edited, and any
  org can define a position of its own with the same name as a nation one.
  The migration that seeds a mapped position fails if its id is already held
  by a different position.
- Only positions the nation defines can be mapped. A position an org defines
  for itself grants nothing.
- Assigning or removing a position that grants permissions requires
  `security.manage` on the org, because it gives or takes away permissions.
  Positions that grant nothing keep their current requirement.

### Permissions

`entities.manage` is split into three, so a grant can cover events and
attendance without covering orgs or locations. Every role that included
`entities.manage` includes all three of its replacements.

| Permission          | Allows                                                                  |
| ------------------- | ----------------------------------------------------------------------- |
| `security.manage`   | Give and remove roles and permission-granting positions; API keys.      |
| `orgs.manage`       | Create, edit and delete orgs.                                           |
| `locations.manage`  | Create, edit and delete locations.                                      |
| `events.manage`     | Create, edit and delete event series and event instances.               |
| `attendance.manage` | Add, change and remove other people's attendance, including Q and Co-Q. |
| `messages.send`     | Send and edit Slack messages through the API.                           |
| `pii.read`          | See people's personal information, such as email addresses.             |

### Roles and positions

| Grant            | Kind     | Granted on | Permissions                                 |
| ---------------- | -------- | ---------- | ------------------------------------------- |
| `admin`          | role     | any org    | all                                         |
| `editor`         | role     | any org    | all except `security.manage` and `pii.read` |
| Beatdown Manager | role     | region     | `events.manage`, `attendance.manage`        |
| Site Q           | position | AO         | `events.manage`, `attendance.manage`        |

Roles not listed keep the permissions ADR 0002 gives them.

Site Q and Beatdown Manager include the same permissions. Site Q covers the
one AO the person holds it on. Beatdown Manager is how a region gives someone
that same reach over every AO in the region. Neither can change an org or a
location; that stays with admins and editors.

### Rules about a person's own event

Some access follows from a person's place on one event instance, not from any
grant on an org. The API checks these rules in the endpoints that change
event instances and attendance. A call passes when the caller has the
permission on the event's org **or** one of these rules allows it.

- **Their own attendance.** Anyone may mark themselves attending (HC) an
  event instance or take themselves off it. They may sign up as Q when the
  instance has no Q, and not when it has one. Nobody can make themselves a
  Co-Q.
- **The Q and Co-Qs.** The Q of an event instance may edit it (its preblast,
  backblast, location and event tags, within the endpoints' other rules), add
  and remove people on its preblast and backblast, and add and remove Co-Qs.
  A Co-Q has the same access as the Q: they may remove themselves, add other
  Co-Qs, and remove the Q and take Q themselves.
- **Creating an event instance.** Anyone may create one. After that they
  manage it only as its Q, so the screens that create one sign the creator up
  as Q.

## Alternatives considered

- **Hard-wire an exception for the Slack bot**, so its calls skip the
  permission check where the bot's own rules apply. Rejected: the API would
  hold a second, unreviewed set of rules that only one app gets, and the
  mobile app would have none of them.
- **Grant every Site Q the admin role**, by hand or automatically when the
  position is assigned. Rejected: it gives an AO job admin rights over a whole
  region, including security and personal information, and regions must keep
  the role and the position in step. An automatic grant also has to decide
  what to remove when the position ends and the person was an admin anyway.
- **A "Site Q" role.** Rejected: a role that means the same as a position is
  two records of one fact, and the two drift apart.
- **Let endpoints check a permission _or_ a position.** Rejected: every
  endpoint would have to know which positions matter to it, which is the
  role-name check ADR 0002 removed, under a different name.
- **A `positions_x_permissions` table.** Rejected for the reasons ADR 0002
  gives for leaving `roles_x_permissions` unused: a code map is type-checked,
  reviewed and the same in every environment, and nobody needs to change it
  at runtime.
- **Find mapped positions by name.** Rejected: an org can name its own
  position "Site Q", and a rename would silently take the permissions away.
- **Keep Site Q's region-wide reach**, by having the position grant its
  permissions on the AO's region. Rejected: one AO's Site Q would control
  every AO's calendar. A region that wants that gives the person the Beatdown
  Manager role.

## Consequences

**Better:**

- Endpoints still know only permissions. Adding what a position allows is one
  entry in a map, the same as for a role.
- Regions record a Site Q once, as a position, and that record is what gives
  the access.
- The Slack bot's Site Q and Q rules can be deleted once the actions they
  govern move to the API, and the mobile app gets the same rules from the
  same place.

**Accepted risks and changes in behavior:**

- **Site Qs lose their region-wide reach.** In the Slack bot today, the Site
  Q of any AO can manage every AO's calendar, preblasts and backblasts in the
  region. Under this decision they manage only their own AO. A region that
  relies on the wider reach grants those people the Beatdown Manager role.
- **Editors change.** They gain `messages.send` and `attendance.manage` and
  lose `pii.read`.
- **Assigning a Site Q now needs `security.manage`**, so an editor who assigns
  Site Qs today needs an admin to do it.
- **Access follows the position records.** A Site Q missing from the records
  loses access the Slack bot gives them today, and a former Site Q left in
  them keeps it.
- **One more query per call** for a person: their position assignments.
- **The event rules are code, not map entries.** Each endpoint that applies
  them needs tests for the Q, a Co-Q, an attendee who is neither, and a person
  on a different event.
- **The fixed position ids are a coupling** between the seed migration and the
  code map. Changing either means changing both.
