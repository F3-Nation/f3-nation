<!--
  One "## <app key>" section per deploy target. The staging-smoke-test-issue
  composite action extracts just the section matching the smoke_test_app
  input passed from each deploy-*.yml. See README.md in this directory.
-->

## admin

- [ ] Sign in to the Admin app via F3 SSO.
- [ ] Workouts table loads with existing rows — no error, no stuck spinner.
- [ ] Open an existing workout in the edit modal, make a trivial edit, and save successfully.

## api

- [ ] `GET <staging URL>/v1/ping` returns HTTP 200.
- [ ] `GET <staging URL>/api/docs/openapi.json` returns a valid JSON OpenAPI spec.

## auth

- [ ] Start a sign-in flow against staging auth (directly, or from a client app pointed at it).
- [ ] Enter your email, receive the 6-digit MFA code by real email, and complete sign-in.
- [ ] Confirm a session is issued — redirected back to the client with no error page.

## map

- [ ] Map loads with pins/markers visible, no console errors.
- [ ] Search or filter for a known AO/region and confirm results update.
- [ ] Click a marker and confirm the workout detail popup opens with correct info.

## me

- [ ] Sign in via F3 SSO.
- [ ] Profile page loads with your own data (name, avatar, etc.).
- [ ] Edit a field (e.g. bio) and save successfully.

## slackbot

- [ ] Not browser-testable — this service only talks to Slack.
- [ ] In a Slack workspace connected to the staging bot, run a known slash command and confirm it responds.
- [ ] If no staging Slack workspace is available to you, skip this item and flag it to whoever manages the staging bot's Slack app config.

## slackbot-scripts

- [ ] Not testable via UI — this is a Cloud Run Job (batch/cron), not a web service.
- [ ] In the GCP Console, check Cloud Run Jobs → `f3-slackbot-scripts` (staging project) → Executions, and confirm the latest execution after this deploy succeeded.
