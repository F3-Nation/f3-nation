# ADR 0002: Permission-based authorization with a code-defined role map

- **Date:** 2026-07-15
- **Author(s):** @taterhead247

## Context

### The triggering incident

@taterhead247 (Project Lead), in Slack:

> We set up the database such that users had roles, and roles were made up of
> permissions. Roles were basically a grouping of more granular permissions.
> When we started, we just created an admin role and editor role; no
> permissions backing them. It was a justifiable simplicity at the time. The
> api just checks if a user is an admin or an editor to see if they can make
> certain calls.
>
> Today I had to grant admin access at the sector level to a comzq so that he
> could send a slack message to regions in his sector. It's been bubbling up
> for a while that our permissions system isn't nuanced enough. This broke the
> camels back. And while I was scratching my head for a solution, I remembered
> we already planned for a solution!!! (Permissions)
>
> I imagine it might not be too bad to get api to use permissions instead of
> roles. Right now we have a helper to check a user's roles. We could add a
> new helper to add up all the permissions for all the roles they have and
> return a distinct list, or confirm if a certain permission is granted. Then
> we could start migrating calls over.
>
> The big question is what are the permissions. I would submit the following.
>
> entities.manage
> security.manage
> messages.send
> pii.read
>
> Admin role would have all of them. Editor role would have all but
> security.manage, Comz role would have just messages.send. You could even do
> more nuanced stuff like add Codex in here. Codex admin role with
> codex.exicon.manage and codex.lexicon.manage. Etc.

Granting sector-level **admin** so someone could **send a message** is the
canonical over-grant: the role vocabulary (admin/editor) is coarser than the
capabilities the org actually delegates.

### What existed when this was accepted (November 2026)

**The planned permission model is already in the database — dormant.**
`packages/db/drizzle/schema.ts` defines `permissions` and
`roles_x_permissions`, but nothing reads them; the seed code that would
populate `permissions` was commented out and has since been removed, and two
vestigial `Permissions` enums (`packages/shared/src/app/constants.ts`,
`enums.ts` — both just `admin`/`edit`) have no meaningful consumers.

**Authorization is a two-layer role check:**

1. Coarse middleware gates in `packages/api/src/shared.ts`:
   `editorProcedure` / `adminProcedure` pass if the session has that role on
   _any_ org. They are door-checks only; they scope nothing.
2. Org-scoped checks at call sites: `checkHasRoleOnOrg`
   (`packages/api/src/check-has-role-on-org.ts`) takes a role + org and walks
   _up_ the org's ancestors in SQL without assuming a fixed set of tiers (see
   [ADR 0003](0003-depth-agnostic-org-hierarchy.md)), so a grant at Sector
   level covers everything beneath it. The walk follows at most
   `ORG_TREE_MAX_DEPTH` parent edges
   (`packages/shared/src/app/org-hierarchy.ts`), far more than the hierarchy
   has; a grant farther up than that does not match, so the check denies.
   `"admin"` is hard-coded as a superset of any requested role.

**Load-bearing facts that constrain any redesign:**

- Role grants live in `roles_x_users_x_org` (role × user × org). How fresh a
  caller's roles are depends on the credential:
  - Cookie sessions bake them into the session JWT at sign-in as
    `{orgId, orgName, roleName}[]` (the `jwt` callback in
    `packages/auth/src/config.ts`). Grant changes do not reach a live cookie
    session until re-login or session update — the ComzQ grant above needed a
    re-login to take effect.
  - Auth-service access tokens and API keys carry no roles; when one of them
    authenticates a request, the API reads its grants from the database for
    that request (`getSession` in `packages/api/src/shared.ts`), so a grant
    change takes effect at once. `getSession` checks the session cookie
    first, so a request that also carries a valid cookie is authorized with
    the cookie session's roles instead.
- `roles.name` is a Postgres enum (`user_role`). Adding any new role (e.g. `comz`)
  requires an `ALTER TYPE` migration, not just an insert.
- API keys authenticate through the same role tables
  (`roles_x_api_keys_x_org`, resolved in `packages/api/src/shared.ts`), so a
  permission layer must cover both principal types.
- `nationAdminProcedure` requires `admin` on the org whose id is
  `F3_NATION_ORG_ID` **and** whose name contains "f3 nation"
  (`isNationAdminFromSession` in `packages/shared/src/app/role-checks.ts`).
  The name match is fragile: renaming that org would lock every nation
  admin out.
- The org-hierarchy walk is the genuinely hard part of the system's
  authorization, and it already exists and works.

## Decision

Adopt the principle **code checks permissions; humans are granted roles.**
Call sites stop asking "is this user an admin?" and ask "can this principal
`messages.send` on this org?" Roles remain the administration unit — named
bundles of permissions granted to people (and API keys) per org.

Concretely:

1. **Define permissions and the role → permission map as constants in
   `@acme/shared`** — not in the dormant `permissions` /
   `roles_x_permissions` tables:

   ```ts
   export const Permission = {
     EntitiesManage: { name: "entities.manage" /* displayName, description */ },
     SecurityManage: { name: "security.manage" /* … */ },
     MessagesSend: { name: "messages.send" /* … */ },
     PiiRead: { name: "pii.read" /* … */ },
   } as const;

   export type Permission = (typeof Permission)[keyof typeof Permission];

   export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
     admin: [
       Permission.EntitiesManage,
       Permission.SecurityManage,
       Permission.MessagesSend,
       Permission.PiiRead,
     ],
     editor: [Permission.EntitiesManage, Permission.PiiRead],
     user: [],
     // Dormant today (no permissions wired); present so the map stays
     // exhaustive over UserRole.
     password_manager: [],
     password_reader: [],
     // comz: [Permission.MessagesSend],  // planned addition — see step 5 below
   };
   ```

   Each permission carries a `displayName` and `description` alongside its
   `name`, so the API docs and refusal messages are built from the same
   definition the checks use.

   `editor` does not include `messages.send`, unlike the proposal quoted in
   Context ("all but security.manage"). Sending Slack messages on an org's
   behalf stays with admins, and with roles that are given `messages.send`
   explicitly, such as the planned `comz`.

   This replaces the vestigial `Permissions` enums. The hard-coded
   `roleName === "admin"` bypass in `checkHasRoleOnOrg` disappears as a
   special case — admin is simply the role mapped to all permissions.

2. **Add `checkHasPermissionsOnOrg`** sharing the existing
   `checkHasRoleOnOrg` hierarchy logic: identical ancestor walk, but a grant
   matches when `ROLE_PERMISSIONS[r.roleName]` includes the requested
   permission. It takes one or more permissions and requires all of them;
   different roles may supply different permissions. Add a
   `permissionProcedure(...permissions)` middleware factory to replace the
   coarse `editorProcedure` / `adminProcedure` gates; it gives the handler
   `ctx.assertPermissionsOnOrg(orgId)` for the org-scoped check and lists the
   permissions in the endpoint's API docs. The helper accepts either principal
   type (session or API key).

3. **Migrate endpoints incrementally.** Old role checks and new permission
   checks coexist; each endpoint migration preserves the two-layer structure
   (coarse gate + org-scoped check). Endpoints where the middleware is the
   _only_ check get extra scrutiny — a missed org-scope during migration is a
   privilege escalation.

4. **Start with exactly the four proposed permissions.** `resource.action`
   naming; no pre-splitting (no `codex.*` until a real role needs the
   distinction). Every permission is permanent API surface: splitting
   `entities.manage` later is cheap, merging is painful.

5. **Unblock new roles:** migrate the `user_role` Postgres enum (add
   `comz`).

6. **Fold `isNationAdminFromSession` into the framework** — it becomes
   `security.manage` (or the relevant permission) scoped to the nation org,
   removing the org-name substring match.

The grant model does not change: `roles_x_users_x_org` and
`roles_x_api_keys_x_org` stay as-is, the JWT session shape stays as-is, and
the org-hierarchy scoping stays as-is.

## Alternatives considered

- **Activate the dormant `permissions` / `roles_x_permissions` tables**
  (the mapping as data, as originally planned). Rejected for now: it requires
  either a join on every check or baking permissions into the JWT (worsening
  grant staleness — a mapping tweak would not reach any live session), plus
  seeding, cross-environment drift risk, and eventually a management UI —
  runtime-editable policy that nobody has asked for. Data-driven mapping
  earns its complexity only when non-developers must change policy at
  runtime; "add a Comz role" happens at developer speed anyway. Crucially,
  the call sites this ADR introduces (`checkHasPermissionsOnOrg`) are the
  stable seam: if the org later needs runtime role composition, only the
  lookup behind the helper changes, and the tables are already waiting.
  A code-defined map is type-safe (typos fail the build, not silently at
  runtime), greppable, code-reviewed, and identical in every environment.
- **Policy engine / library (CASL, OpenFGA, SpiceDB, Casbin).** Rejected:
  the org-hierarchy walk _is_ the hard part and it is already built and
  tested. An external engine adds infrastructure, a policy DSL, and a
  learning curve for an all-volunteer team, for no capability the code map
  does not provide at this scale.
- **Keep role checks and add more roles.** Rejected: every new capability
  combination would mint a new role and touch every call site that
  enumerates role names; the ComzQ incident is exactly this approach
  failing. Roles stay, but as grant bundles — not as the vocabulary the API
  checks.

## Consequences

**Positive:**

- The ComzQ case is solved without over-granting: a `comz` role with only
  `messages.send`, granted at sector level, scoped by the existing hierarchy
  walk.
- Authorization intent becomes explicit at every call site and type-checked
  at build time.
- The `admin`-superset special case, the vestigial `Permissions` enums, and
  the nation-org name-substring check are all subsumed or deleted.
- No new runtime moving parts: no new queries, no session shape change, no
  new tables in use.

**Negative / accepted risks:**

- Changing what a role can do requires a deploy. Accepted: for this team,
  "edit one map, open a PR" is the feature, not the limitation — changes are
  reviewed and versioned.
- The `permissions` / `roles_x_permissions` tables remain dormant (kept as
  the escape hatch for a future data-driven mapping, at the cost of schema
  readers wondering why they are empty).
- JWT grant staleness is unchanged (pre-existing): new grants require
  re-login or session update. If "grant and it works immediately" becomes a
  requirement, a session-refresh trigger after grant changes is a follow-up.
- The incremental migration window has two authorization vocabularies in the
  codebase at once; each migrated endpoint must preserve its org-scoped
  check.

**Rollback:** until the final endpoint migrates, the role-check helpers
remain; any migrated endpoint can revert to its previous role check
independently. The schema migration for new role names is additive.
