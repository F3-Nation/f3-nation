# User profile and PII access

> Human designer: Tackle (@taterhead247)

## 1. Summary

Org editors and admins manage other users through the `user` API and the admin
app's user editor. This spec says who may edit another user's profile and who
may read their PII. Both follow the user's **home region**. Holding a role on an
org gives that org's admins no access to the user's profile or PII, because any
org admin can grant any user a role on their org.

Terms used below:

- **Profile**: every field of a user other than their roles.
- **PII**: email, email-verified date, phone, and the emergency contact name,
  phone and notes.
- **Profile editor** of a user: an editor or admin of the user's home region or
  of an org above it. For a user with no home region: an editor or admin of the
  nation.

## 2. Context & links

- Apps affected: api, admin.
- Key code: [`packages/api/src/lib/user.ts`](../../packages/api/src/lib/user.ts),
  [`packages/api/src/router/user.ts`](../../packages/api/src/router/user.ts),
  [`apps/admin/src/app/_components/modal/user-editor-config.ts`](../../apps/admin/src/app/_components/modal/user-editor-config.ts).

## 3. User stories

- As a region editor or admin, I want to correct the profile and contact details
  of users homed in my region so that my region's records stay accurate.
- As an org admin, I want to grant or remove a role on my org for any user so
  that I can staff it.
- As a user, I want my contact details visible only to the people who run my
  home region so that taking a role elsewhere does not share them.

## 4. Acceptance criteria (testable, non-contradictory)

- **AC-1** — GIVEN a caller who is a profile editor of a user WHEN they change
  the user's profile other than their email through `user.crupdate` THEN the
  change is saved and the response includes the user's PII.
- **AC-2** — GIVEN a caller who is neither the user nor a profile editor WHEN
  they send a profile field with a changed value THEN the call fails with
  `UNAUTHORIZED` and nothing is written, roles included.
- **AC-3** — GIVEN a caller who is not a profile editor but is an admin of an
  org WHEN they grant or remove the user's role on that org and resend the
  profile unchanged THEN the role change is saved and the response has no PII.
- **AC-4** — GIVEN a user with no home region who holds a role on the caller's
  org WHEN the caller, who is not a nation editor or admin, sets the user's home
  region or changes their email THEN the call fails with `UNAUTHORIZED`.
- **AC-5** — GIVEN `user.byId` or `user.byEmail` with `includePii` WHEN the
  caller is a profile editor THEN PII is returned and `includePii` is `true`;
  otherwise `includePii` is `false` and no PII is returned, except that
  `user.byEmail` always returns the email that was searched for.
- **AC-6** — GIVEN `user.byOrgs` with `includePii` WHEN the caller is an admin
  of every requested org THEN PII is returned only for users homed in a
  requested org or an org below one (for every user when the nation is
  requested), and each user's `piiVisible` says whether their PII is included.
- **AC-7** — GIVEN a user list WHEN the caller searches by part of an email, or
  sorts by email or phone, THEN the search and the ordering use only the rows
  whose PII the caller is shown. Searching for a whole email address finds its
  user in any row.
- **AC-8** — GIVEN the admin app's user editor WHEN the signed-in admin is not a
  profile editor of the user THEN the profile fields are locked and the roles
  the admin may grant stay editable.
- **AC-9** — GIVEN the admin app's "my users" table WHEN a row's `piiVisible` is
  `false` THEN its email and phone cells read "Hidden".

## 5. Roles & authorization (RBAC)

Every procedure here is an `editorProcedure` or `adminProcedure`, which proves
only a role on some org. The per-user checks are below.

| Action                                                               | Allowed                                                                                                                                                                                                                                        | Explicitly denied                                                                                                                       |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Edit another user's profile (`user.crupdate`)                        | Profile editors of that user                                                                                                                                                                                                                   | Editors and admins of any other org, including one the user holds a role on                                                             |
| Change an existing user's email                                      | Nation admins, their own email included                                                                                                                                                                                                        | Everyone else, including profile editors and the user                                                                                   |
| Edit your own profile, PII excluded (`user.crupdate`)                | The signed-in user                                                                                                                                                                                                                             | An API key, which never counts as its owner                                                                                             |
| Set a user's home region                                             | A profile editor who is also an editor or admin of the new region; an admin of the user's current home region or an org above it, for any active region with active ancestors ([home-region corrections](admin-user-home-region.md)); the user | A profile editor with no role over the new region who is not an admin of the current one                                                |
| Read a user's PII (`user.byId`, `user.byEmail`, `crupdate` response) | Profile editors of that user                                                                                                                                                                                                                   | Everyone else, including admins of an org the user holds a role on                                                                      |
| Read PII in `user.byOrgs`                                            | An admin of every requested org, for users homed in those orgs or below them, and for every matched user when the nation is requested                                                                                                          | Editors; an admin of only some of the requested orgs; any caller, for users matched only through a role, unless the nation is requested |
| Read PII in `user.all`                                               | Nation admins                                                                                                                                                                                                                                  | Everyone else                                                                                                                           |
| Grant or remove a user's role on an org                              | Admins of that org or an org above it, whatever the user's home region                                                                                                                                                                         | Editors; admins of orgs that are neither that org nor above it                                                                          |

## 6. Out of scope / non-goals

- A user reading or changing their own PII, which the `me` endpoints serve.
- Assigning a home region to users who have none. Nation editors and admins
  handle them.

## 7. Critical-path test cases

- An org admin grants a role to a user homed elsewhere: the role is saved, no
  PII comes back, and a later email change is refused.
- A region editor edits the profile and phone of a user homed in their region.
- A nation admin edits a user with no home region; a region admin cannot.

## 8. Observability

- No events are specific to this rule. A refused write returns `UNAUTHORIZED`
  with a message that says whether the profile, the PII, the home region or a
  role was refused.
