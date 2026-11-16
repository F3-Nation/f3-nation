# ADR 0006: How a first-party app calls the API on behalf of an F3 user

- **Date:** 2026-11-15
- **Author(s):** @BigGillyStyle

## Context

The Slackbot is moving every change it makes to shared F3 data out of its own
database code and into the API. Some of those changes are made by a person: a
region admin edits the region or its admin list, a member edits their own
profile. For those, the API has to answer two questions the bot answers for
itself today: _is this person allowed to do this?_ and _who made this change?_

The API cannot answer either from a bot request as it stands:

- The bot authenticates with a database API key. The API resolves a key to
  the key's own role grants (`roles_x_api_keys_x_org`) and treats the key's
  owner as the session user (`getSession` in `packages/api/src/shared.ts`).
  The person in Slack never appears.
- Audit history records no actor for an API-key request: the audit context
  sets `userId` to null for API-key sessions and `source` to null for every
  request.
- Endpoints that act on "the signed-in user" (`personalUserProcedure`) reject
  API keys outright.

A person using Slack has no F3 credential to hand over. Slack authenticates
them, and the bot knows which F3 user they are from its own link between a
Slack account and an F3 user (`slack_users.user_id`), which it creates by
matching the Slack profile's email to an F3 user's email. The Auth service
issues user access tokens only through the authorization-code and
refresh-token grants, which need the person to sign in through a browser.

So the bot must tell the API which F3 user is acting, and the API must decide
how far to trust that.

Two other decisions bound this one. [ADR 0002](0002-permission-based-authorization.md)
owns what a principal may do: roles granted per org, checked up the org tree,
moving to permission checks. The service-principals work owns how an app gets
a key of its own rather than a person's. This ADR adds only the missing piece
between them: an app acting for a person.

## Decision

**A trusted first-party app names the acting F3 user in a request header, and
the API honors it only from an API key that holds a delegation grant. The API
then authorizes the call as that user, within the limits of the app's grant,
and records the user as the actor.**

### The request

- The app sends its API key as it does today, plus an acting-user header
  carrying one F3 user id.
- The app takes that id only from its own account link for the platform
  account that the platform authenticated on the request it is handling (for
  the Slackbot, the Slack user id). It never takes it from text a person
  typed or from data that round-trips through the platform's client.
- A request with no acting-user header is the app acting as itself. How it is
  authorized does not change. How it is attributed in audit history does: the
  app is recorded as `changed_via` once service principals give the key an app
  identity. Until then the source is null and `changed_via` stays empty (see
  "Calls with no acting user").

### Who may send it

- The right to act for users is a role granted to the API key in
  `roles_x_api_keys_x_org`, like every other key grant. Granting or removing
  that row turns delegation on or off for that key with no deploy.
- It is a dedicated role that exists only for this. It is never granted to a
  person, and it is matched exactly: the rule that `admin` satisfies any
  requested role does not apply to it. An admin key cannot act for users
  unless it also holds this grant.
- The org the role is granted on is the delegation's scope. A delegated call
  can touch only resources at or beneath that org.
- If the acting-user header arrives with any other credential (a cookie
  session, a user access token, a key without the grant), the API rejects the
  request. It does not ignore the header and continue as the caller, because
  a misconfigured app would then make changes as itself without anyone
  noticing.

### What the API checks

Every delegated call must pass all of these:

1. The key is valid and holds the delegation grant.
2. The acting user exists and is active.
3. The procedure has opted in to delegated calls. Delegation is off by
   default, so a new endpoint is not reachable this way until someone decides
   it should be. Managing API keys and nation-admin-only procedures never opt
   in.
4. The acting user passes the procedure's normal authorization, using that
   user's own role grants read from the database for this request.
5. The resource is inside the delegation's scope. A procedure that acts on
   the acting user's own record, with no org to check, requires the
   delegation grant to be on the root of the org tree.

The result is the intersection: a delegated call can do what the user may do
**and** the app has been allowed to relay. When the two disagree, the call is
refused. The app's own role grants (for example, `admin` on the nation for
its scheduled jobs) add nothing to a delegated call.

Authorization uses the role checks that exist when this is built
(`checkHasRoleOnOrg`). When ADR 0002's permission checks replace them, the
delegated path changes with every other caller, and the delegation role
becomes the one role mapped to an "act for a user" permission.

### Audit history

- `changed_by` is the acting user.
- `changed_via` is the calling app, taken from the key's own record and never
  from a request header. Until service principals give the key an app
  identity, there is nothing trusted to record, so `changed_via` stays empty.
- A call with no acting user records no person. It must not fall back to the
  key's owner: that would name someone who did nothing.

Each delegated call is also logged with the key id, the acting user id and
the procedure, so use of the grant can be reviewed.

### Calls with no acting user

Scheduled jobs and other work the app does on its own (awarding
achievements, filling in missing home regions, creating a user the first
time someone appears in a workspace) send no acting-user header. They are
authorized by the key's own role grants, as today, and audit history records
no person. It names the app once service principals give the key an app
identity.

### Other first-party clients

A mobile app or a web app does not use delegation. The person signs in to the
Auth service on their own device and the client sends that person's access
token, which the API already accepts. Delegation is only for a surface where
another platform authenticates the person and no F3 credential can be
presented. A second such app would get its own key and its own grant.

### What waits for this

Until delegation is built, these Slackbot changes stay where they are,
because moving them would either lose the person's identity or require
giving the bot's key the right to do them for anyone:

- granting or removing admin roles, and editing a region's details;
- creating a region and granting its first admin;
- a member's edits to their own profile and home region.

Changes the bot already makes through the API under its own grant (attendance
and Q sign-ups, event changes, backblasts) keep working without it. They
should move to delegated calls afterwards so audit history names the person.

### Dependencies

- **ADR 0002** defines roles, org scoping and the move to permissions. This
  ADR adds one role and reuses the rest.
- **Service principals** make the bot's key belong to the app instead of a
  volunteer, and give `changed_via` a name that can be trusted. Delegation
  can be built on today's person-owned key; it does not wait for that work,
  but it is only fully attributable once it lands.

## Alternatives considered

- **The app gets a short-lived token for the user from the Auth service**
  (a token-exchange grant). The API would need no new path: it already
  accepts user access tokens and attributes them. Rejected because it buys
  less than it costs. The bot would still be vouching for the user with
  nothing from the user themself, so its credential could mint a token for
  anyone, which is the same trust as the header. In exchange, the Auth
  service gains a new grant type on a sign-in stack that is mid-migration,
  the bot gains a second network dependency inside Slack's three-second
  acknowledgement window, and it must cache tokens per user. Worth revisiting
  if the Auth service gains token exchange for another reason.
- **Leave authorization in the app; the API trusts the app.** The bot keeps
  deciding who may do what and calls the API with a key powerful enough for
  all of it. Rejected: it keeps a second copy of every permission rule in
  Python, which is the problem being solved, and the API still cannot say who
  made a change. Passing the user id for audit only, without authorizing as
  that user, would make the audit trail look more trustworthy than the
  enforcement behind it.
- **Each person links their Slack account by signing in to F3 once**, and the
  bot stores a refresh token per person. This is the only option where the
  user presents proof. Rejected because every member of every workspace would
  have to complete a sign-in before the bot worked for them, and the bot
  would hold a long-lived credential for each of them.
- **A request signed by the app with its own key pair** in place of a bearer
  key plus header. Same trust as the chosen design with replay protection
  added, at the cost of key distribution and a verifier the API does not
  have. Not worth it while F3 operates both the app and the API and they talk
  over TLS.

## Consequences

**Better:**

- One copy of each permission rule. The Slackbot's own admin checks can be
  deleted as each change moves.
- Audit history names the person who acted and the app they used.
- Turning delegation off for an app is one row, with no deploy.
- A new endpoint cannot be reached through delegation by accident.

**Accepted risks:**

- **The key is as powerful as the most privileged user it can name**, on the
  procedures that opt in. Anyone holding the bot's key and able to reach the
  API can act as a region admin anywhere in the delegation's scope. This is
  narrower than today, where the bot writes to the database directly, but it
  is the reason the opt-in list, the exact-match role and the exclusion of
  key management and nation-admin procedures are part of the decision and
  not implementation detail.
- **The API cannot verify the app's claim about who is acting.** Its trust is
  capped by the app's account link, which rests on a Slack profile email
  matching an F3 user's email. A weakness in how that link is made becomes a
  way to act as someone else through the API. Strengthening the link (for
  example, confirming it by email before it can be used for a user who holds
  roles) is separate work, and it matters more once this exists.
- **Role changes apply at once** for delegated calls, because the user's
  grants are read per request. That differs from cookie sessions, which keep
  their roles until re-login.
- **Two more things to keep correct on every delegated endpoint:** the opt-in
  and the scope check. An endpoint that opts in but checks only "has the role
  on some org" lets a region admin act outside their region through the bot,
  exactly as it would through any other client.

**Watch for:**

- A caller that sets the acting-user header for a scheduled job to make audit
  history look complete. A job has no acting user.
- Pressure to honor the header from user sessions "for support". That is
  impersonation by people, a different decision with different safeguards.
