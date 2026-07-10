---
name: verify
description: Build/launch/drive recipe for verifying changes in the running f3-nation apps (map, admin, api)
---

# Verifying changes in the running apps

## Prereqs

- Docker stack must be running: `f3-postgres` (:5433), `f3-mailpit` (:1025/:8025), `f3-gcs` (:9023), `f3-adminer` (:8080). Check with `docker ps`.
- Per-app `.env` files are NOT in git worktrees — copy them from the main checkout: `cp /path/to/main/apps/<app>/.env apps/<app>/.env` for admin, map, auth, me, api, slackbot.

## Launch

- `pnpm --filter f3-api dev` → :3001 (map's oRPC backend; map's `/` 500s with ECONNREFUSED without it)
- `pnpm --filter f3-map dev` → :3000
- `pnpm --filter f3-admin dev` → :3002 (redirects to SSO login; needs the sso app for a session — hard to drive headlessly)

## Driving the map app (Playwright MCP)

- Local seed data: workouts near Boone/Charlotte NC ("The Dark Tower" etc.).
- **Auth shortcut**: Settings modal (gear icon, `svg.lucide-settings`) has a "Sign in (Dev Mode)" button — instant session, no email flow.
- Edit mode: the pencil control is the button containing `svg.lucide-square-pen` AND `div[aria-label="My Location"]` (other square-pen icons exist). Unauthenticated click opens the sign-in modal.
- Workout details: click a nearby-locations entry; logo click opens the full-image modal; in edit mode "Edit Workout" opens the update-location form, "Delete Workout" opens the delete confirmation.
- QR modal: Settings modal → `svg.lucide-qr-code` button.
- Version easter egg: click the `(local)` channel button 12× **with ~60ms spacing** (a tight synchronous `.click()` loop gets batched by React and never increments past 1) → debug panel (Zoom/Center/Workouts) appears.

## Gotchas

- Playwright MCP browser could not connect to :3002 (admin) even though curl could; map on :3000 worked fine.
- Map "Edit Workout" form's Start/End Time show empty for API time strings not exactly 4 chars (`convertHHmmToHH_mm` in packages/shared) — pre-existing, don't chase it as a regression.
