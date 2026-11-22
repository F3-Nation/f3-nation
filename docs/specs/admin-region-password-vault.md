# Region password vault opt-in and multi-role access

> Human designer: Tackle

## 1. Summary

Regions can opt in to a shared password vault, and admins grant vault access
with two roles: Password Manager (read and write) and Password Reader (read
only). A region's editors turn the vault on or off from the region editor in
admin. Admins grant the vault roles from Manage Access, where a user can hold
several roles on the same org, so a region admin can also be a Password
Manager there. The vault itself is a self-hosted Vaultwarden instance kept in
step with the F3 API by a sync job in a separate repository; this spec covers
only what the F3 apps store and show.

## 2. Context & links

- App(s) affected: admin, api.
- Key code:
  - `apps/admin/src/app/_components/modal/password-vault-field.tsx`
  - `apps/admin/src/app/_components/modal/admin-org-edit-modal.tsx`
  - `apps/admin/src/app/_components/role-assignments-field.tsx`
  - `apps/admin/src/lib/roles.ts`
  - `packages/api/src/router/user.ts` (`user.crupdate`)
  - `packages/api/src/router/org.ts` (`org.crupdate`, region `meta` merge)
  - `packages/validators/src/index.ts` (`CrupdateUserSchema`)
  - `packages/shared/src/app/types.ts` (`OrgMeta`)
  - `packages/shared/src/app/permissions.ts` (`ROLE_ORG_TYPES`)
- The sync job reads `orgs.meta.password_vault_enabled` and each user's
  `password_manager` and `password_reader` roles through the API. Both names
  are a contract with that job: renaming either turns access off.
- User help: <https://help.passwords.f3nation.com>.

## 3. User stories

- As a region editor, I want to turn on a password vault for my region so
  that its leaders share credentials safely.
- As a region editor, I want a clear warning before turning the vault off so
  that I don't remove everyone's access by accident.
- As a region admin, I want to give someone a vault role on my region without
  taking away their other roles there.

## 4. Acceptance criteria (testable, non-contradictory)

Vault opt-in (region editor):

- **AC-1** — GIVEN the region editor WHEN it opens THEN it shows a "Password
  vault" checkbox, checked exactly when the saved region's
  `meta.password_vault_enabled` is `true`. No other org type's editor shows
  it.
- **AC-2** — GIVEN the saved vault is off WHEN the editor checks the box THEN
  a confirmation says a vault will be created within the next hour, that
  everyone with the Password Manager or Password Reader role for the region
  will be invited, and links to the help site, before anything changes.
- **AC-3** — GIVEN the saved vault is on WHEN the editor unchecks the box
  THEN a confirmation says all members will be removed from the region's
  vault collection and passwords will not be deleted.
- **AC-4** — GIVEN either confirmation WHEN the editor cancels THEN the box
  keeps its previous state.
- **AC-5** — GIVEN the editor confirmed WHEN they save THEN the region's
  `meta.password_vault_enabled` is saved as `true` (checked) or `false`
  (unchecked), and every other `meta` key is saved unchanged.
- **AC-6** — GIVEN an unsaved change to the box WHEN the editor changes it
  back to the saved value THEN no confirmation is shown.
- **AC-15** — GIVEN `org.crupdate` WHEN the submitted `meta` holds a
  `password_vault_enabled` other than `true` or `false` THEN it is refused
  with `BAD_REQUEST` and nothing is saved.

Roles (Manage Access and the user edit page):

- **AC-7** — GIVEN a user's roles WHEN Manage Access opens THEN it shows one
  row per org with every role the user holds there selected, including
  Password Manager and Password Reader.
- **AC-8** — GIVEN a row for a region WHEN its roles are opened THEN Admin,
  Editor, Password Manager and Password Reader are offered. A row for any
  other org type offers Admin and Editor only. The admin site reads this from
  `ROLE_ORG_TYPES`, the same rule the API enforces (AC-14).
- **AC-9** — GIVEN an org the signed-in admin can't manage WHEN Manage Access
  or the user edit page shows the user's roles there THEN that row is
  read-only and a save keeps those roles.
- **AC-10** — GIVEN `user.crupdate` WHEN the submitted roles list one org
  with several roles THEN each is saved; WHEN it lists the same org and role
  twice THEN the request fails with `BAD_REQUEST` and nothing changes.
- **AC-11** — GIVEN `user.crupdate` for an existing user WHEN a role the user
  holds is left out of the submitted list THEN that role is removed.
- **AC-12** — GIVEN role assignments WHEN admin lists them (the user tables,
  the user modal, the account menu, the API key list) THEN it shows one badge
  per org naming each role there, e.g. "Boone (Admin, Password Manager)".
- **AC-13** — GIVEN a user who holds only password roles WHEN they open admin
  THEN they are sent to the no-access page.
- **AC-14** — GIVEN `user.crupdate` WHEN it would newly give Password Manager
  or Password Reader on an org that isn't a region THEN it fails with
  `BAD_REQUEST` naming the role and the allowed org type, and nothing
  changes. Resubmitting an assignment the user already holds is not refused.

## 5. Roles & authorization (RBAC)

| Action                                  | Allowed                                                                        | Explicitly denied                                              |
| --------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| Turn a region's vault on or off         | Editor or admin of the region or an org above it                               | Password Manager, Password Reader, editors of other orgs       |
| Grant or remove Password Manager/Reader | Admin of the region or an org above it (`user.crupdate`); regions only (AC-14) | Editors, admins of other orgs, Password Manager/Reader holders |
| Enter the admin portal                  | Editor or admin on any org                                                     | Users whose only roles are Password Manager or Reader          |

The password roles carry no API permissions (`ROLE_PERMISSIONS` in
`packages/shared/src/app/permissions.ts`); they only tell the vault sync who
gets access.

## 6. Out of scope / non-goals

- Creating, syncing or deleting vault collections and members: the sync job
  owns that.
- Giving password roles to API keys.
- Showing whether a region's vault has been created yet.

## 7. Critical-path test cases

- AC-2 then AC-5: turn the vault on, confirm, save, and check the saved
  `meta`.
- AC-3 then AC-5: turn the vault off, confirm, save.
- AC-7 then AC-10: give a region admin the Password Manager role in Manage
  Access and save; both roles remain.

## 8. Observability

- No new log events. Role grants and region `meta` changes are recorded by
  the existing database audit history.
