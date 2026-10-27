# Reference

Look-ups for SKILL.md. `<S>` is `bash <repo root>/.agents/skills/pr-local-test/scripts/prt.sh`, with `<repo root>` the user's own checkout (never `$RUN/wt`); `$RUN` is the run folder.

## Platform

| `uname -s`                                    | Platform            | Action                                                                                                                                                           |
| --------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Darwin`                                      | macOS               | continue                                                                                                                                                         |
| `Linux`, `/proc/version` contains `microsoft` | WSL                 | Needs WSL 2 (`WSL2` in `/proc/version`). If the repo is under `/mnt/`, warn that it's slow and file watching is unreliable there; suggest the Linux home folder. |
| `Linux`, otherwise                            | Linux               | continue                                                                                                                                                         |
| `MINGW*`, `MSYS*`, `CYGWIN*`, or no bash      | Windows outside WSL | **Hard stop.** Run the skill from the Ubuntu (WSL) terminal.                                                                                                     |

## Tools

Install hints: `brew install <tool>` on macOS, `sudo apt install <tool>` on WSL and
Debian/Ubuntu. Missing `git` or `gh` is a hard stop.

**Docker not running:**

- macOS: open Docker Desktop.
- WSL: open Docker Desktop in Windows and turn on WSL integration for this distro (Settings →
  Resources → WSL Integration). If Docker is installed inside WSL: `sudo service docker start`.
- Linux: `sudo systemctl start docker`.

## Node

`init` exits with `NODE_MISSING=<v>` when the PR's Node version isn't installed. Find the
manager from `NODE_ON_PATH` and give only the **install** command. The helper uses that version
for this run alone, so the user's default stays as it is.

| Path contains            | Install                                                          |
| ------------------------ | ---------------------------------------------------------------- |
| `.nvm`                   | `nvm install <v>`                                                |
| `fnm`                    | `fnm install <v>`                                                |
| `.volta`                 | `volta fetch node@<v>`                                           |
| `mise`                   | `mise install node@<v>`                                          |
| `asdf`                   | `asdf install nodejs <v>`                                        |
| anything else, or `none` | Install nvm (the repo ships an `.nvmrc`), then `nvm install <v>` |

## Sign-in

### Apps with a UI (Map, Admin, Me)

Follow the headless recipe in `apps/auth/AGENTS.md` (CSRF, then send a code, then read it from
Mailpit, then the Credentials callback). Change these in it:

| In the recipe                      | Use                                             |
| ---------------------------------- | ----------------------------------------------- |
| `localhost:3004` (auth)            | `localhost:<auth port>`                         |
| `localhost:3003`, `:3002`, `:3000` | this run's `me`, `admin`, `map` ports           |
| `localhost:8025` (Mailpit)         | `localhost:<mailpit port>`                      |
| `/tmp/jar`                         | `$RUN/jar/<label>` (one jar per signed-in user) |
| `qa-bot@f3nation.test`             | `qa-bot+pr<N>@f3nation.test`                    |

A user signing in for the first time gets a "Welcome Back!" form (F3 Name, First Name, Last
Name) before reaching the app. Fill it with `PRTEST-<N>` names.

To make that user an admin (or editor) for UI checks, create the user before the first sign-in
and give it a role on an org (org rules as in **`apps/api` directly** below):

```bash
<S> psql "$RUN" -v email="qa-bot+pr<N>@f3nation.test" -v prefix="PRTEST-<N>" \
  -v role="<admin | editor>" -v org="<org id>" <<'SQL'
insert into users (email, f3_name) values (:'email', :'prefix')
  on conflict (email) do nothing;
insert into roles_x_users_x_org (role_id, user_id, org_id)
  select r.id, u.id, :'org'::int from roles r, users u
  where r.name::text = :'role' and u.email = :'email';
SQL
```

`<S> info $RUN` prints every port; `$RUN/wt/.env` holds the same values under the repo's names
(`F3_AUTH_PORT`, `F3_MAILPIT_UI_PORT`, …), and `<S> exec` runs commands with them exported.
The Mailpit is this run's alone, so emptying it before each
send (`curl -s -X DELETE http://localhost:<mailpit port>/api/v1/messages`) is safe and keeps
"newest message" unambiguous. Admin and Me sign in through `auth`, so start `auth` and `api` as
well.

## Browser checks

Prefer HTTP checks with the run's cookie jar wherever they show the same thing. They cost far
fewer tokens than a browser. When a check needs a browser, use the first of these the agent has:

1. **A Playwright tool** (e.g. the Playwright MCP server). See **Playwright tool** below.
2. **A Playwright script:** the Map app already depends on `@playwright/test`. Write a short
   script to `$RUN/wt/apps/map/prt-<label>.mjs` (the worktree is the run's own) that does
   `import { chromium } from "@playwright/test"`, launches its own headless browser, signs in,
   checks the page, prints what it found, and saves screenshots to `$RUN/evidence/`. Run it
   with `<S> exec $RUN -- node apps/map/prt-<label>.mjs`. If it reports a missing browser, run
   `<S> exec $RUN -- pnpm -F f3-map exec playwright install chromium` once.
3. **Neither:** make the check 🙋 in the plan, with the run's URLs and exact steps.

Never use the user's own browser (e.g. Claude in Chrome): it holds their real sign-ins.

- **Read the page as text first** (an accessibility snapshot or the page's text), and take a
  screenshot only for visual claims or as evidence for a result. Snapshots of big pages are
  some of the most expensive things an agent reads, so scope them to the part of the page the
  check is about.
- Sign in right before each UI check, and confirm on the page who is signed in before trusting
  the result.

### Playwright tool

- **Use a browser context of this run's own.** The tool shares one page between every agent,
  and browsers keep `localhost` cookies per host, not per port, so another run, or the user's
  own dev session, can take over the page or replace this run's sign-in. With a run-code tool
  (Playwright MCP: `browser_run_code_unsafe`), create one with
  `page.context().browser().newContext()`, open its page, and tag it (`ctx.__prt = "<run-id>"`)
  so later calls can find it again with `browser.contexts().find(c => c.__prt === "<run-id>")`
  (variables don't survive between calls). Inside the context, `ctx.request.get(...)` can read
  the sign-in code from the run's Mailpit, so the whole sign-in can happen in the browser.
  Close the context when the checks are done. Never use the shared default page.
- **Screenshots and the tool's files.** The Playwright MCP server only writes inside the
  session's working folder, under `.playwright-mcp/`, and also drops console and snapshot files
  there on its own. Save screenshots as `.playwright-mcp/<run-id>-<n>.png` and move them into
  `$RUN/evidence/`. At the end, if `.playwright-mcp/` didn't exist before the run (noted in
  Phase 0) and `<S> list` shows no other run, delete the folder. Otherwise delete only your
  `<run-id>-*` files and tell the user the rest is there.
- **Google Maps.** The Map needs a real `F3_GOOGLE_API_KEY`; `setup` copies it from the user's
  `apps/map/.env` and `apps/admin/.env`. If it printed `MAPS_KEY=none`, the desktop Map page crashes with
  `InvalidKeyMapError`. Then block `maps.googleapis.com` in the run's context and use a phone
  viewport (390×844), where the workout panel opens as a drawer, and say so in the results.
  Loading Google's map tiles with the user's key isn't "test traffic"; it's fine.

### `apps/api` directly

No email sign-in. Don't rely on the dev mock session (sent when there's no auth header): it has
no roles, so admin and editor routes return 401. Seed one API key per role the checks need, then
call with `authorization: Bearer <key>` and `client: pr-local-test`. Any non-empty `client`
works except `orpc-ssg`, which skips sign-in. Without the header, a key gets a 401 that
mentions it. A key's session takes its roles from the key, not from its owner.

For a Nation admin, use `admin` on org 1 ("F3 Nation"). Look up other org ids in `orgs` by name
and `org_type`. Names repeat (local data has two regions called Boone, each with its own AOs),
so on a tie use the lowest id, unless the PR's code or other test data points at a specific one.
Use that same id for every key, user, and child org in the check, and record it in `notes.md`.

Seed each key with this snippet. Keep the key in a file and never print it. `role` is
`editor`, `admin`, or `user`; any other value (e.g. `none`) makes a read-only key with no role.
Remove the indentation when you copy it: the closing `SQL` must start at column 0. psql prints
one line per insert (user, key, role):

- user: `INSERT 0 1` the first time, then `INSERT 0 0` because the user already exists
- key: always `INSERT 0 1`, or the key wasn't created
- role: `INSERT 0 1` for a role key, `INSERT 0 0` for a read-only key

Run it directly in the agent's shell, not inside `bash -c '…'` (the quoting breaks). If your
shell tool can't take a heredoc, write the SQL to `$RUN/<label>.sql` and pass it on stdin.

```bash
KEY="f3_$(openssl rand -hex 24)"; printf %s "$KEY" > "$RUN/keys/<label>"
<S> psql "$RUN" -v key="$KEY" -v email="qa-bot+pr<N>@f3nation.test" -v prefix="PRTEST-<N>" \
  -v label="<label>" -v role="<role>" -v org="<org id, or 0 for none>" <<'SQL'
insert into users (email, f3_name) values (:'email', :'prefix')
  on conflict (email) do nothing;
insert into api_keys (key, name, owner_id)
  select :'key', :'prefix' || ' ' || :'label', id from users where email = :'email';
insert into roles_x_api_keys_x_org (api_key_id, role_id, org_id)
  select k.id, r.id, :'org'::int from api_keys k, roles r
  where k.key = :'key' and r.name::text = :'role';
SQL
```

For inputs the REST query string can't express well (nested sorting, booleans), call the RPC
route instead: `client: orpc`, `POST /v1/<router>/<procedure>` with the router name in
camelCase (`/v1/eventTag/all`) and a body of `{"json": {...input...}}`.

Call routes without a trailing slash (`/v1/api-key`, not `/v1/api-key/`). The slash form
answers with a 308 redirect, which plain `curl` reports in place of the real result.

## Keep-running

- Results say the apps are still up, with `<S> info` URLs.
- **New commits:** `<S> update $RUN` fetches the PR's newest commits, stops the servers, moves
  the worktree, reinstalls, and applies new migrations. For a fork PR it stops at
  `NEEDS_APPROVAL <old> -> <new>` (exit code 6) before running anything: scan
  `git -C "$RUN/wt" diff <old> <new>` with the `SKILL.md` Phase 2c checklist, wait for a new
  "go, run it", then run `<S> update $RUN --approved <new>` with the exact commit you scanned;
  if the PR moved again meanwhile, it prints `NEEDS_APPROVAL` for the newer head. If it prints
  `EXISTING_MIGRATIONS_CHANGED`, rebuild the database: `<S> down-db $RUN`, then `setup` (with
  `--at-base` if 2a called for it). Then restart the servers you need, re-run the checks
  touched by the new diff (`git -C "$RUN/wt" diff <old> <new>`), re-run the `SKILL.md` Phase 2a
  branch-currency and open-conversation commands, and produce fresh results and drafts. Without `down --keep-drafts`, the drafts sit in `$RUN` beside the worktree.
- **Done:** on "done" or "clean up", run Phase 6 → **Finish**.

## Cleanup

For "/pr-local-test cleanup" or any request to clear leftovers: run `<S> list`, then:

- a named run-id: `<S> down /tmp/pr-local-test/<run-id>`
- "all": tear down every row whose OWNER is `gone`, plus this session's own runs. For a row that
  is `live` in another session, list it and ask before touching it; another session is using it.
  Ask about `unknown` rows too: the agent that made them had no `CLAUDE_PID`, so the helper
  can't tell whether it's still running.

Report what was removed using the `down` output.
