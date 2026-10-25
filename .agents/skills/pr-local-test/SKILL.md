---
name: pr-local-test
description: Use when the user wants a GitHub pull request pulled down and tested hands-on in their local dev environment ("test PR #N locally", "verify PR N on my machine", "QA this PR", "run through PR N before I approve it"), possibly several PRs in parallel, or wants leftover pr-local-test sandboxes listed or cleaned up. Not for code-only reviews without running anything — use pr-review-inline.
compatibility: macOS, Linux, or WSL 2 with bash, git, gh (authenticated), jq, curl, openssl, Docker, and lsof or ss. Browser checks use a Playwright tool or the Playwright CLI if available; otherwise those checks go to the user.
---

# Local PR Test

## Overview

Build a throwaway sandbox for one PR, test what the code actually changed, post feedback the
user approves, and delete the sandbox. The user keeps working in their own checkout, with their
own Docker services and dev servers, the whole time, and several runs can go at once.

This is the **final check** in the review flow: pr-review-inline, the author's fixes,
address-pr-comments for what's still open, then this skill once review feedback is resolved.
It can run earlier, but while review conversations are still open its verdict is capped at
⏸️ **Can't recommend yet** (Phase 5).

Ground rules:

- **The sandbox is the only place anything happens.** Each run gets its own git worktree, its
  own Docker containers and database, and its own block of ports, all created by
  `scripts/prt.sh`. Never check out branches in the user's checkout, never touch the shared
  `f3-*` containers or their database, never edit the user's `.env` files, and never stop a
  process or container this run didn't start. (The worktree's `.env` copies belong to the run.)
- **The diff decides what gets tested.** Build the plan from the code before reading the PR's
  title, body, commit messages, or linked issues. Then compare the two and put any mismatch at
  the top.
- **Write for someone who doesn't code.** The plan, the results, and every stop message use
  feature names people know ("the Map's region filter") instead of code names, function names,
  or jargon. Name a file only when the user has to act on it. Tables beat paragraphs. Each
  message should take under three minutes to read.
- **Clean up on every exit** once `init` has succeeded, including aborts and failures, unless
  the run is in keep-running mode.
- **Nothing reaches GitHub without approval.** Draft the review and any new issues, show them,
  and publish only when the user says "post". The one exception is claiming the PR with the
  assignee field (Phase 1), which the user asked for by starting the run.
- **Reviewers suggest, authors fix.** Never push to the PR's branch, update it from the base
  branch, or edit its description, unless the user explicitly asks for that change on this PR.
  A temporary change in the sandbox to observe something (a debug log, a lowered timeout) is
  reverted before the results, and the results name it.
- **The PR review is only about the PR.** Bugs that already existed before the PR become GitHub
  issues. They never go in the review.
- **Test data stays on this machine.** Never send test traffic to real outside services (the
  error tracker, Slack, email providers, production or Staging APIs).

All sandbox commands go through the helper. `<S>` below means
`bash <repo root>/.agents/skills/pr-local-test/scripts/prt.sh`, with `<repo root>` the absolute
path of the user's own checkout, written out in full each time (zsh doesn't split a `$S`
variable into a command and its argument), and `$RUN` means the `RUN_DIR` that `init` prints.
Never run the copy inside `$RUN/wt`: that one comes from the PR, so a PR could change it.
Don't wrap SQL or other quoted input in `bash -c '…'`: zsh and bash both handle the helper
called directly, and the extra quoting layer mangles `$` and `'`. The helper's own header lists
every subcommand.

## User checkpoints

The run doesn't wait for a "go" after the plan. It pauses only here, using `templates.md` →
**Stop message** for the first two:

| When                    | Why the run pauses                                                                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0 / `init`        | A missing tool, Docker not running, unsupported platform, the PR's Node version not installed, or the PR isn't open. **All problems go in one message.** |
| Phase 1, claim          | Someone else is already assigned to the PR: say who, and ask whether to continue.                                                                        |
| Phase 3, gated PRs only | A PR from a fork or from outside the team needs an explicit **"go, run it"** before any of its code runs.                                                |
| Phase 5                 | 🙋 manual checks (only if there are any), then the proposed GitHub feedback: wait for "post", edits, or "skip".                                          |

The user can interrupt at any point; treat "stop" or "abort" as an exit, which means cleanup.

## Modes

- **Normal (default):** the sandbox is torn down as soon as results are drafted.
- **Keep-running:** the user says "keep it running", "keep the environment", or passes `--keep`.
  Pass `--keep` to `init`. The apps stay up after the results so the user can poke at them, and
  re-tests after new commits reuse the sandbox (`reference.md` → **Keep-running**). "post" and "skip" only
  decide what goes to GitHub; the sandbox is torn down when the user says "done" or "clean up".
- **Cleanup:** "clean up pr-local-test", "/pr-local-test cleanup [run-id | all]". See
  `reference.md` → **Cleanup**.
- **Nothing to run:** when Phase 2a finds nothing observable by running the apps (docs, CI
  config, comments, or behavior only an outside service shows), skip Phase 4. Build the
  database with `setup` only if a test that CI didn't run needs it.

## Phase 0 — Pre-flight (read-only)

1. **Other runs.** Run `<S> list`. Rows whose OWNER is `gone` are leftovers from a session that
   ended. Mention them in the plan with the cleanup command, and carry on: they hold their own
   ports, so they don't block this run. For the plan's count of runs still going, use `init`'s
   `ACTIVE_RUNS` minus one, since another run may start between the two commands. Never tear
   down a row whose OWNER is `live` or `unknown` (the agent had no `CLAUDE_PID`) and isn't this
   session's run. If browser checks are likely,
   note whether `.playwright-mcp/` exists in the session's working folder (see `reference.md`
   → **Browser checks**).
2. **Checks.** Run all of them, then report **every** failure in one stop message:
   - Platform: macOS, Linux, or WSL 2 (`reference.md` → **Platform**). Windows outside WSL is a
     hard stop.
   - Tools: `git`, `gh` (`gh auth status`), `jq`, `curl`, `openssl`, `docker`, and `lsof`
     (or `ss` on Linux). Install hints are in `reference.md`.
   - Docker running: `docker info` (fixes in `reference.md`).
   - GitHub access, through the repo `github` skill's pre-flight:
     `bash <repo root>/.agents/skills/github/scripts/gh-check.sh`. A failure here is a stop.
     Then run it again with `--require-write`; if only that fails, it isn't a stop: set
     `CAN_POST=false`, and the plan says feedback is drafted but not posted.

## Phase 1 — Create the sandbox

From inside the repo (any checkout or worktree of it): `<S> init <N>` (add `--keep` in
keep-running mode). It fetches the PR without touching the user's branches, picks the Node version
from the PR's Dockerfiles, claims a free port block, and creates a detached worktree at
`$RUN/wt`. Keep its output: `RUN_DIR`, `PR_SHA`, `MERGE_BASE`, and `ACTIVE_RUNS`.

- Exit code 5 with `NEEDS_UPDATE_BRANCH`: the PR's branch predates the repo's per-checkout
  ports (`pnpm local:setup --slot`). Stop and ask the user to press **Update branch** on the PR,
  then run `init` again.
- Exit code 3 with `NODE_MISSING=<v>`: the PR needs a Node version that isn't installed. Stop
  and give the install command for the user's version manager from `reference.md` → **Node**.
  Installing is enough; the user's default version stays as it is. `NODE_UNKNOWN`: ask which
  version to use. `PNPM_MISSING`: tell the user to run `corepack enable`.
- `PR_STATE` isn't `OPEN`: say so and ask before going on; on "no", clean up.
- `WARN=` lines and a `.nvmrc` fallback note go in the plan's mismatch box.
- `ACTIVE_RUNS` of 4 or more: say in the plan that the machine may be slow.

**Claim the PR** (skip if `CAN_POST` is false). The assignee field is how the team sees who has
a PR, and `scripts/pr-triage.sh` shows it. Run from `$RUN/wt`:

```bash
gh pr view <N> --json author,assignees --jq '{author: .author.login, assignees: [.assignees[].login]}'
gh api user --jq .login
```

- **The user is the PR's author** (a self-test): don't assign.
- **Someone else is already assigned:** say who and ask whether to continue (User
  checkpoints). Never remove another assignee.
- **Otherwise:** `gh pr edit <N> --add-assignee @me`. If it fails, say so in the plan and carry
  on.

## Phase 2 — Understand the change

### 2a. Diff only

Don't read the title, body, linked issues, or commit messages yet (`git log` output counts).
Run the `gh` commands in this phase from `$RUN/wt`; they need a checkout to find the repo.

```bash
git -C "$RUN/wt" diff --stat <MERGE_BASE> HEAD
git -C "$RUN/wt" diff <MERGE_BASE> HEAD
gh pr checks <N>
# Branch currency: commits the PR is behind its base, and conflicts (exit 1 lists the files).
# <BASE_SHA> is the sha in init's BASE= line.
git -C "$RUN/wt" rev-list --count <MERGE_BASE>..<BASE_SHA>
git -C "$RUN/wt" merge-tree --write-tree --name-only <BASE_SHA> HEAD
# Open review conversations, for Phase 5's verdict.
gh api graphql -F n=<N> -f o='{owner}' -f r='{repo}' -f query='
  query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){
    reviewThreads(first:100){nodes{isResolved}}}}}' \
  --jq '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved | not)] | length'
```

Record `BEHIND`, any conflicting files, and `OPEN_THREADS`. On git older than 2.38, use
`gh pr view <N> --json mergeable` for conflicts instead. Being behind doesn't stop the run: test
the PR as it is, and don't update its branch (ground rules).

Build an inventory:

- **Surfaces touched:** which apps and packages. A change in `packages/*` affects every app
  that uses it. `apps/api` runs one server (`dev`), and the Map, Admin, and Me read their data
  from it, so start `api` with any of them. Its REST paths are listed in
  `apps/api/**/openapi.golden.json` (search for the route name).
- **Behavior that changed:** what a user or admin would notice.
- **How to observe it:** a dev server (`next dev`) can hide some changes, such as behavior that
  depends on a production build or on a channel or environment value. For those, use
  `serve … start` (it builds first), and put extra environment values in front of the command
  (`FOO=bar <S> serve …`). The helper drops inherited values for any name the repo's env files
  define, so list a deliberate override of one of those in `PRT_PASS`
  (`F3_CHANNEL=staging PRT_PASS=F3_CHANNEL <S> serve …`); database and mail settings can't be
  passed. If a change shows up only in an outside service (the error tracker,
  Slack), check what's visible locally, such as logs or response codes. Re-run the PR's own
  tests for the rest.
- **Sandbox needs:**
  - Which apps to start. Sign-in to Admin or Me also needs `auth` and `api`.
  - **Database build:** if the diff touches `packages/db/drizzle/`, use `setup --at-base`.
    That seeds the database at the PR's starting point, then applies the PR's migrations the
    way Staging and Prod will. Otherwise use plain `setup`.
- **CI:** note which checks passed and don't rerun whole suites. Run specific tests only where
  CI didn't run them (fork PRs often have no CI), or where a PR-added test is the only way to
  observe a behavior.

If nothing in the change can be observed by running it (docs, CI config, or comments only), say
so in the plan, skip Phase 4, and go straight to results with only the ➖ and CI rows.

Suspected problems that exist without this PR go in `$RUN/notes.md`, and Phase 5 turns them
into issues. Add a check for one only if it's cheap.

### 2b. Compare with what the author says

Now read the title, body, commit messages, and linked issues
(`gh pr view <N> --json title,body,commits,closingIssuesReferences`). To find a spec, search
`specs/` (or `docs/specs/`) for the feature or app names from 2a, and use one only if it clearly
covers the changed behavior.

List only mismatches that change what the PR does or how risky it is:

- claims the code doesn't support
- behavior changes the description leaves out
- contradictions with the spec

Leaving out tests, coverage, or formatting changes isn't a mismatch.

### 2c. Safety gate

```bash
gh api repos/{owner}/{repo}/pulls/<N> --jq '{assoc: .author_association, fork: .head.repo.fork}'
```

A PR is **gated** if it comes from a fork, or if `assoc` isn't `OWNER`, `MEMBER`, or
`COLLABORATOR`. For gated PRs, scan the diff for anything that runs code at install or start:
`package.json` scripts, new or changed dependencies, `.npmrc`, `scripts/`, `turbo.json`,
`docker-compose.yml`, Next.js or Docker config, and new outbound URLs. Summarize what you find
in the plan's safety box. Every step after `init` runs PR-controlled code or config (and `setup`
copies the user's Maps key into the PR's folder), so a gated run does nothing past `init` until
the user replies "go, run it".

## Phase 3 — Test plan (then keep going)

Write the plan using `templates.md` → **Test plan**. Classify each check in the **Who** column:

- 🤖 **Agent**: anything reachable through HTTP, browser automation, the database, Mailpit
  (sign-in included), logs, or reading the changed docs.
- 🙋 **You**: only what really needs a human, such as a real phone, a third-party account, or a
  judgment call about visual design.
- ➖ **Tests only**: behavior that can only be seen in an outside service. Its evidence is the
  PR's automated tests (CI, or re-run here).

Aim for zero 🙋 rows. List the test data each check needs; the agent creates all of it.

**Show the plan and start Phase 4 in the same turn.** Don't ask for approval. The only exception
is a gated PR: end the turn with the safety box and wait for "go, run it" (anything else means
clean up).

## Phase 4 — Build the sandbox and run the checks

1. `<S> setup $RUN` (or `--at-base`). `init` already wrote the run's ports to the worktree's root
   `.env`, so this installs dependencies and runs the repo's own `pnpm local:setup` there: fresh
   `.env` files from the examples on the run's ports, the run's own Docker containers, migrations,
   and seed. It checks that the applied migrations match the PR's migration list, because the
   migrate command's exit code isn't reliable, and copies only the user's Google Maps key over.
   The examples keep the error tracker and analytics off, so test traffic stays local.
   - If `setup --at-base` stops because the merge base predates per-checkout ports, run plain
     `setup` and note in the results that the migrations ran on a fresh database.
   - `ENV_TEMPLATES_CHANGED=<files>`: the run's `.env` files came from the base's examples.
     Add the keys the PR's versions add or change to the matching `.env` (keep the run's ports),
     and say so in the results.
2. `<S> serve $RUN <app> [dev|start]` for each app the plan needs, one at a time. It waits until
   the app listens and prints its URL. `<S> info $RUN` shows every port and whether each server
   is up.
3. **Sign-in and API keys:** follow `reference.md` → **Sign-in**. Always use this run's ports,
   its Mailpit, and its cookie-jar folder `$RUN/jar/`, never the defaults in `apps/auth/AGENTS.md`.
4. **Test data:** create it through the app or API where possible, otherwise with
   `<S> psql $RUN` (it reads SQL from stdin). Prefix names with `PRTEST-<N>`. The database is
   this run's alone, so you may change or delete seed rows. If one blocked a check, say so in the
   results, and record it in `notes.md` if it points at an older bug. If the harness's
   permission system refuses a change, don't retry it or find another route to the same change:
   mark the check ⏸️ blocked, finish the others, and in the results name the change so the user
   can approve it.
5. **Run each check.** Note the time before starting it, so errors can be traced to a check.
   Collect, per check or once at the end grouped by those times:
   - server logs in `$RUN/logs/`
   - `docker logs --since <ts>` for this run's containers
     (`docker ps --filter label=com.docker.compose.project=prt-<run-id>`)
   - browser console errors and network 4xx/5xx responses, from this run's ports only
   - a screenshot for each check that has a UI (see `reference.md` → **Browser checks** for
     where screenshots can be saved), moved into `$RUN/evidence/`

   Watch the page for broken layout, error toasts, and spinners that never finish. An error
   anywhere counts **even if the check "passed"**: mark the check ⚠️ and name it in Notes. The
   exceptions are dev-mode framework noise (React hydration warnings, Fast Refresh messages)
   that also shows on pages the PR didn't touch, and failed calls to an app this run didn't
   start (for example the API's `api.map_revalidate.error` when the Map isn't running). Mention
   those once under the table instead. To run the PR's own tests, use
   `<S> exec $RUN -- pnpm -F <pkg> test …`; the test database lives in this run's Postgres too.

6. **Trace each failure to the diff.** If the cause is in lines this PR changed, record
   `path:line` for an inline comment. If not, it's an **older bug**: confirm the code behind it
   is the same at the merge base, never by checking out. Use
   `git -C "$RUN/wt" diff --quiet <MERGE_BASE> HEAD -- <paths>` when the PR didn't touch those
   files; when it did, read the lines at `git show <MERGE_BASE>:<path>`. Record it in
   `notes.md` with what you did, what happened, and the root cause with file paths.

**Stop rules.** Stop testing if any of these happen:

- `setup` fails (that covers migration failures)
- a server fails to start after 3 attempts (`serve … --restart`)
- the same blocker appears 3 times in a row

Report what happened and go to Phase 5 with partial results. Don't improvise around it.

## Phase 5 — Results, cleanup, feedback approval

1. If there are 🙋 checks, show the Results so far with the 🙋 section (the apps stay up), give
   numbered steps with this run's URLs, and wait for the user's outcomes.
2. Work out the **verdict** (table below), then draft the feedback and any issues (below). The
   drafts need the worktree, so do this before step 3.
3. **Tear down**, unless the run is keep-running: `<S> down $RUN --keep-drafts`. It stops this
   run's servers, removes its containers and volumes, worktree, and fetched refs, and frees its
   ports. Only the drafts, `notes.md`, and `evidence/` stay. If it reports something still
   listening on one of this run's ports, name it to the user and leave it alone.
4. Present `templates.md` → **Results**, ending with the post question. Wait.

**Recommendation.** Every results report opens with exactly one of these verdicts. Pick the
first row whose condition is true:

| Verdict                                   | When                                                                                                                                     |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| ⏸️ **Can't recommend yet**                | A check of the PR's main purpose was skipped or blocked (a stop rule, or a 🙋 check still pending)                                       |
| ❌ **Don't approve yet**                  | Any 🔴 or 🟠 problem caused by this PR; a check of the PR's main purpose failed; or the description claims something the code doesn't do |
| ⏸️ **Can't recommend yet**                | Review conversations are still open on the PR (`OPEN_THREADS` above 0), so the code may still change                                     |
| ✅ **Approve, with optional suggestions** | Every proposed inline comment is 🟡: a small fix the PR works fine without                                                               |
| ✅ **Approve**                            | Nothing to post but the summary                                                                                                          |

Under the verdict, add one plain sentence explaining it. For ❌ and ⏸️, add what would change
the verdict (for open conversations: "Resolve the N open review conversations, then re-test.").
If the PR is behind its base or has conflicts, add one more line: "<N> commits behind <base>
<and conflicts in …>; this result is for the tested commit, so update the branch before
merging." Never call the PR ready to merge while it is behind or conflicting. Problems "not
caused by this PR" never change the verdict. ➖ rows count as passed when their tests pass. When the user's 🙋 results arrive, work out the verdict again and show
it again.

**Draft feedback (don't post yet):**

- **Inline comments:** only for problems traced to the diff. Use pr-review-inline's comment
  body format (dual audience, severity label) and its dedup rules (its Steps 5 and 8). Save them
  as `$RUN/comments.json`: an array of `{path, line, side, body}`, plus `start_line` and
  `start_side` for multi-line spans. Put `<!-- pr-local-test -->` on the line just above each
  body's signature, **not** pr-review-inline's `<!-- pr-review-inline -->` marker.
- **Review summary** (`$RUN/summary.md`): a short body with the **full results table**
  (mandatory, every time: the same rows and wording as the Results report, including the Notes
  column and the legend, never condensed or dropped) and any description mismatches. Omit the
  table only if the user says so in that run. Don't mention older bugs in it. **Its very first
  line, above the table, is a one-line plain-language recommendation for the PR author**, from
  the same verdict as the results report: `✅ **Recommend approving as-is.**`,
  `✅ **Recommend approving; the suggestions below are optional.**`,
  `❌ **Needs changes before approval:** <the blocking problem in a few words>.`, or
  `⏸️ **Can't recommend yet:** <what wasn't tested, or "N review conversations are still open">.`
  If the user authored the PR, leave this line out. Below the table, add the branch-currency line if the PR is behind or conflicting, and one **How this was checked**
  line: which tools ran the checks (browser automation, HTTP, database, the PR's own tests),
  any temporary sandbox change and that it was reverted, and what was blocked or skipped and
  why. Never put token or cost numbers on GitHub.
- **Signature:** the one required by the repo's `github` skill (`.agents/skills/github/SKILL.md`:
  `_written by <model name>_` as the last line). It ends `summary.md` and every issue body.
- **Hidden marker:** the line just above the signature in `summary.md` is
  `<!-- pr-local-test -->`, so the signature stays the last line. GitHub doesn't render it; triage tooling uses it to tell this
  skill's review apart from pr-review-inline's comments, which share the signature.

**Older bugs become issues (drafted now, filed on "post"):** for each older bug in `notes.md`:

1. **Search for an existing report** among open and closed issues. Try 2–4 searches: the
   feature name, the error text, and the file or function name:
   `gh issue list --state all --search "<terms>" --json number,title,state`. For each
   candidate, read the body and comments (`gh issue view <n> --json body,comments`).
2. **An open issue already covers it:** don't file anything. List it in the results as
   "already tracked in #n".
3. **Only a closed issue covers it,** and the bug still reproduces: draft a new issue that
   links the closed one.
4. **Nothing covers it:** draft a new issue.
   - **Title:** Conventional Commits, `fix(<scope>): <what to change>`.
   - **Body:** first `## For everyone`, which says in plain language what goes wrong, who notices,
     and "Found during a local test of PR #N; also happens on `<base>`". Then
     `## For the coding agent`, which gives the root cause with file paths, the fix, exact
     reproduction steps, and how to verify. Don't hard-wrap lines; GitHub renders single
     newlines as line breaks. End with the signature.
   - **Label:** `ai-audit`, if the repo has it (`gh label list --search ai-audit`). Record
     the answer as `LABELS='["ai-audit"]'` or `LABELS='[]'` for Phase 6.
   - Save each body to `$RUN/issue-<k>.md`.
   - Put only claims you verified in the verify steps.

## Phase 6 — Post (only after "post")

Run this phase's `gh` commands from `<repo root>`: `down --keep-drafts` has already removed
`$RUN/wt`, and `gh` needs a checkout to find the repo. First run the write pre-flight,
`bash <repo root>/.agents/skills/github/scripts/gh-check.sh --require-write`; if it fails, hand
the user the drafted text instead of posting.

Before posting, compare `gh pr view <N> --json headRefOid` with the run's `tested_sha`
(`jq -r .tested_sha $RUN/state.json`). If the author has pushed since, say so in your reply; the
review still attaches to the commit you tested.

When the user says "post" (and `CAN_POST` isn't false), submit **one** review so the author gets
a single notification:

```bash
jq -n --arg sha "<tested_sha>" --rawfile body "$RUN/summary.md" \
  --slurpfile comments "$RUN/comments.json" \
  '{commit_id:$sha, event:"COMMENT", body:$body, comments:$comments[0]}' > "$RUN/review.json"
gh api repos/{owner}/{repo}/pulls/<N>/reviews --input "$RUN/review.json"
```

Always use `event: "COMMENT"`; never approve or request changes. The summary's recommendation
line is advice only. If `CAN_POST` is false, hand the user the drafted text instead.

On "post", also file each drafted issue:

```bash
jq -n --arg title "<title>" --rawfile body "$RUN/issue-<k>.md" --argjson labels "$LABELS" \
  '{title:$title, body:$body, labels:$labels}' \
  | gh api -X POST repos/{owner}/{repo}/issues --input - --jq '{number, html_url}'
```

The user can approve the review and the issues separately ("post the review only", "file the
issues only"). Link every filed issue in the final report.

**Finish:** after "post" or "skip" (in keep-running mode, after "done" or "clean up"):

1. Copy anything from `$RUN/evidence/` the user asked to keep; the next step deletes it.
2. If testing ran and `PR_TRIAGE_LEDGER` is set (a file path), record it there, whether or
   not the review was posted:
   ```bash
   [ -n "${PR_TRIAGE_LEDGER:-}" ] && mkdir -p "$(dirname "$PR_TRIAGE_LEDGER")" && \
     printf '%s\t%s\t%s\t%s\t%s\n' "{owner}/{repo}" "<N>" pr-local-test "$(jq -r .tested_sha $RUN/state.json)" \
     "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$PR_TRIAGE_LEDGER"
   ```
3. `<S> down $RUN`, which removes the last of the run's files. If it (or the earlier
   `down --keep-drafts`) prints `DOCKER_SKIPPED`, tell the user to start Docker and run `down`
   again; the run stays listed until its containers are gone.
4. Clear browser leftovers (`reference.md` → **Browser checks**).

Report one line each for servers, containers, worktree, and ports, from the `down` output (the
ports line comes from the earlier `down --keep-drafts`, if one ran). Add one line for the claim
(assigned, skipped as a self-test, or failed), and token usage or cost only if the harness
measured it; that line stays in the conversation.
**End the final message with the verdict line again**, for example `✅ Recommendation: Approve, with optional suggestions`, so it's the last
thing the user reads. If testing never ran, end with `No recommendation: testing didn't run.`

## Keep-running and cleanup

See `reference.md` → **Keep-running** and **Cleanup**.

## Common mistakes

| Mistake                                                                               | Fix                                                                                     |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Using `localhost:3000`–`3005`, `8025`, or `/tmp/jar` from repo docs                   | Use this run's ports (`<S> info`) and `$RUN/jar/`                                       |
| `docker exec f3-postgres …`, or `pnpm docker:up` / `local:setup` outside the worktree | Those are the user's; use `<S> psql` and `<S> setup`                                    |
| Starting a server with `pnpm --filter … dev &` or the harness's preview tool          | Use `<S> serve`; it uses the run's port and records the process group for cleanup       |
| Reading the PR description or commit messages before the diff                         | Everything you then test becomes the claim instead of the code                          |
| `git diff origin/main..HEAD`                                                          | Diff against the merge base: `git -C "$RUN/wt" diff <MERGE_BASE> HEAD`                  |
| Plain `setup` for a PR with migrations                                                | `setup --at-base`, so the PR's migrations run on top of existing data                   |
| Testing in `next dev` when the change only shows in a build                           | `serve <app> start` with the needed env values in front                                 |
| Checking out another commit in the worktree to read old code                          | `git show <MERGE_BASE>:<path>`; moving the worktree moves the running apps              |
| Tearing down another session's live run during cleanup                                | Only `gone` rows and this session's runs, unless the user names it; ask about `unknown` |
