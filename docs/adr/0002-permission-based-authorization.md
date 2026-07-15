# ADR 0002: Permission-based authorization with a code-defined role map

- **Status:** Proposed
- **Date:** 2026-07-15
- **Deciders:** @taterhead247

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

### What exists today (verified July 2026)

**The planned permission model is already in the database — dormant.**
`packages/db/drizzle/schema.ts` defines `permissions` and
`roles_x_permissions`, but nothing reads them; the seed code that would
populate `permissions` is commented out (`packages/db/src/seed.ts`), and two
vestigial `Permissions` enums (`packages/shared/src/app/constants.ts`,
`enums.ts` — both just `admin`/`edit`) have no meaningful consumers.

**Authorization is a two-layer role check:**

1. Coarse middleware gates in `packages/api/src/shared.ts`:
   `editorProcedure` / `adminProcedure` pass if the session has that role on
   _any_ org. They are door-checks only; they scope nothing.
2. Org-scoped checks at call sites: `checkHasRoleOnOrg`
   (`packages/api/src/check-has-role-on-org.ts`) takes a role + org and walks
   _up_ the org hierarchy (AO → Region → Sector → Area → Nation) in SQL, so a
   grant at Sector level covers everything beneath it. `"admin"` is
   hard-coded as a superset of any requested role.

**Load-bearing facts that constrain any redesign:**

- Role grants live in `roles_x_users_x_org` (role × user × org) and are baked
  into the JWT session at sign-in as `{orgId, orgName, roleName}[]`
  (`packages/auth/src/lib/md-pg-drizzzle-adapter.ts`). Grant changes do not
  reach live sessions until re-login or session update — the ComzQ grant
  above needed a re-login to take effect.
- `roles.name` is a Postgres enum (`region_role` = `user`/`editor`/`admin`).
  Adding any new role (e.g. `comz`) requires an `ALTER TYPE` migration, not
  just an insert.
- API keys authenticate through the same role tables
  (`roles_x_api_keys_x_org`, resolved in `packages/api/src/shared.ts`), so a
  permission layer must cover both principal types.
- `nationAdminProcedure` relies on a fragile string match —
  `orgName.toLowerCase().includes("f3 nation")` in
  `packages/shared/src/app/role-checks.ts`.
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
   export const Permission = [
     "entities.manage",
     "security.manage",
     "messages.send",
     "pii.read",
   ] as const;

   export const ROLE_PERMISSIONS: Record<RegionRole, readonly Permission[]> = {
     admin: ["entities.manage", "security.manage", "messages.send", "pii.read"],
     editor: ["entities.manage", "messages.send", "pii.read"],
     comz: ["messages.send"],
     user: [],
   };
   ```

   This replaces the vestigial `Permissions` enums. The hard-coded
   `roleName === "admin"` bypass in `checkHasRoleOnOrg` disappears as a
   special case — admin is simply the role mapped to all permissions.

2. **Add `checkHasPermissionOnOrg`** wrapping the existing
   `checkHasRoleOnOrg` hierarchy logic: identical ancestor walk, but a grant
   matches when `ROLE_PERMISSIONS[r.roleName]` includes the requested
   permission. Add a `permissionProcedure(permission)` middleware factory to
   replace the coarse `editorProcedure` / `adminProcedure` gates. The helper
   accepts either principal type (session or API key).

3. **Migrate endpoints incrementally.** Old role checks and new permission
   checks coexist; each endpoint migration preserves the two-layer structure
   (coarse gate + org-scoped check). Endpoints where the middleware is the
   _only_ check get extra scrutiny — a missed org-scope during migration is a
   privilege escalation.

4. **Start with exactly the four proposed permissions.** `resource.action`
   naming; no pre-splitting (no `codex.*` until a real role needs the
   distinction). Every permission is permanent API surface: splitting
   `entities.manage` later is cheap, merging is painful.

5. **Unblock new roles:** migrate the `region_role` Postgres enum (add
   `comz`), or convert `roles.name` to `varchar` validated at the app layer
   so future roles are TypeScript-only changes. Either way this is the one
   unavoidable schema migration.

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
  the call sites this ADR introduces (`checkHasPermissionOnOrg`) are the
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
