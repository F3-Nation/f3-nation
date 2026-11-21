# Slack user resolution

> Human designer: Evan Petzoldt (@evanpetzoldt)

## 1. Summary

Integrations that receive Slack events see Slack identities (a workspace's team
ID and a member's user ID), while F3 data is keyed by F3 user ID. This endpoint
resolves one Slack identity to the F3 user it is linked to, so an integration
can relate Slack activity to F3 records without its own copy of the mapping.

## 2. Context & links

- Apps affected: api.
- Key code: [`packages/api/src/router/slack.ts`](../../packages/api/src/router/slack.ts)
  (`slack.resolveUser`), the `slack_users` table in
  [`packages/db/drizzle/schema.ts`](../../packages/db/drizzle/schema.ts).
- How Slack identities are created and linked to F3 users:
  [Slack identities within a workspace](slackbot-workspace-identities.md).

## 3. User stories

- As an integration acting in a Slack workspace, I want to turn a Slack member
  ID into an F3 user ID so that I can look up or record that member's F3 data.

## 4. Acceptance criteria (testable, non-contradictory)

- **AC-1** — GIVEN a stored Slack identity linked to an F3 user WHEN an
  authenticated caller requests that workspace team ID and Slack user ID THEN
  the response is that F3 user's ID.
- **AC-2** — GIVEN a stored Slack identity with no F3-user link WHEN it is
  requested THEN the response is `userId: null`.
- **AC-3** — GIVEN no stored identity for the pair WHEN it is requested THEN
  the call fails with `NOT_FOUND`. A Slack user ID stored only under another
  workspace is not a match.
- **AC-4** — GIVEN a request with no valid credential THEN the call fails with
  `UNAUTHORIZED`.
- **AC-5** — GIVEN any successful request THEN the response holds only the F3
  user ID: no Slack profile fields, email, integration tokens or metadata.
- **AC-6** — GIVEN a team ID or user ID that is not an uppercase alphanumeric
  Slack ID THEN the call fails with `BAD_REQUEST` before any database query.

## 5. Roles & authorization (RBAC)

Tier: `protectedProcedure`, with no per-org check. A Slack identity has no
owning org, and the mapping is not personal information: it reveals only that
a Slack member is linked to an F3 user ID, and the caller must already know the
workspace and member IDs, which are visible to that workspace's members. The
reverse lookup (an F3 user's Slack identities across workspaces) is out of
scope because it would collect a person's accounts in one answer.

| Action                   | Allowed                                                   | Explicitly denied                        |
| ------------------------ | --------------------------------------------------------- | ---------------------------------------- |
| Resolve a Slack identity | Any signed-in user or API key, whatever its roles or orgs | Callers with no valid session or API key |

## 6. Out of scope / non-goals

- Resolving several identities in one request.
- Resolving an F3 user ID to Slack identities.
- Returning Slack profile data (name, avatar, email).

## 7. Critical-path test cases

- AC-1, AC-2 and AC-3 for an API key with no roles.
- AC-4 for a request with no session.

## 8. Observability

- No events: a miss is an ordinary `NOT_FOUND` for the caller, not a fault.
