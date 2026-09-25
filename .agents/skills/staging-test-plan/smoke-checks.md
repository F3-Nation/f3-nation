# Standing smoke checks

Copy the lines for each releasing app into its "Quick checks by app" section.
Keep this list to 2–3 checks per app; edit it here when an app changes.

## Admin

- [ ] Sign in with F3 SSO. The Workouts table loads with rows.
- [ ] Open a workout, make a small edit, and save. It saves with no error.

## Auth

- [ ] Sign in to any app: enter your email, enter the 6-digit code from the email, and land back in the app with no error page.

## API

- [ ] https://staging.api.f3nation.com/v1/ping returns `200`.
- [ ] https://staging.api.f3nation.com/docs/openapi.json loads as JSON.

## Map

- [ ] Open the map logged out in a private window. Pins appear; the page is not blank.
- [ ] Search for a known AO, click its pin, and the workout details open.

## Me

- [ ] Sign in with F3 SSO. Your profile shows your name.
- [ ] Edit a field (e.g. bio) and save. It saves with no error.

## Slackbot

- [ ] In the Slack workspace connected to the Staging bot, run a slash command you know. The bot responds. If you don't have access to that workspace, leave this unchecked and say so in `#monorepo`.

## Analytics

No manual check. It is a scheduled job; the release plan covers its monitoring.

## Homepage

Homepage has no Staging; it is already live when the release PR merges. Title
its section in the issue "Homepage (live site, no Staging)".

- [ ] https://f3nation.com/org loads and the org chart expands.
