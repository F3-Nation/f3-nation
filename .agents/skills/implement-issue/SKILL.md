---
name: implement-issue
description: 'Use when the user gives a GitHub issue number or URL to build ("implement issue 42", "work on #42", "pick up this issue") — takes the issue from pre-flight checks through codebase exploration, an approved approach, test-first implementation, a draft PR and a self-review of it. Not for reviewing someone else''s PR (pr-review-inline) or answering review feedback (address-pr-comments).'
compatibility: macOS, Linux, or WSL 2 with bash, git, gh (authenticated) and jq. Works in any agent; steps that use subagents say what to do without them.
---

# Implement a GitHub issue

Take one issue from "assigned" to a draft pull request that is ready for review. The person
running this often did not write the issue and may not know this codebase, so the skill does
the reading for them and stops for their decision at three gates:

1. **Understanding** (Step 3): what the issue asks for, and the open questions.
2. **Approach** (Step 4): what will change, and where the tests go.
3. **Publishing** (Step 7): before anything is pushed or posted to GitHub.

Ground rules:

- **One issue, one branch, one PR.** A second problem found along the way becomes its own
  issue ([Filing Issues](../../../AGENTS.md#filing-issues)), not extra scope.
- **Never work in the main checkout.** Everything happens in a git worktree (Step 2).
- **No code before the approach is approved.** Reading and running things is fine; editing is
  not.
- **Write to the user in plain language.** Use feature names people know ("the Map's region
  filter") before file names. Each gate message should take under three minutes to read.
- **The repo's rules outrank this skill.** Root [`AGENTS.md`](../../../AGENTS.md) and the
  `AGENTS.md` above each file you touch decide how code is written here.

Shell variables do not persist between commands. When a step sets `ISSUE_REPO`, `MAIN_ROOT`
or `WT`, note the literal value and write it into later commands.

## Step 1: Pre-flight

1. Run `bash scripts/gh-check.sh`. If it fails, show its message and stop. Check that `jq` is
   installed (`command -v jq`); the Step 8 review needs it. If it is missing, stop and give the
   install hint: `brew install jq` (macOS) or `sudo apt install jq` (WSL/Linux).
2. Fetch the issue. Accept only a number (`42` or `#42`) or an issue URL of the form
   `https://github.com/<owner>/<repo>/issues/<number>`. Stop on anything else, before running a
   command: a quote in the argument would end the shell string. First find the repository the
   issue belongs to:

   ```bash
   gh repo view --json nameWithOwner,parent --jq 'if .parent then "\(.parent.owner.login)/\(.parent.name)" else .nameWithOwner end'
   ```

   It prints the upstream repository when the checkout is a fork, and the checkout's own
   repository otherwise. That is `ISSUE_REPO` (`<owner>/<name>`); every `gh` command below
   passes it, so a bare number never resolves against the fork. Stop if a URL argument is not
   in `ISSUE_REPO`. Pass the number or URL, and nothing else, inside single quotes:

   ```bash
   gh issue view '<ref>' --repo <ISSUE_REPO> --comments
   gh issue view '<ref>' --repo <ISSUE_REPO> --json number,title,body,labels,state,assignees,url
   gh api "repos/<ISSUE_REPO>/issues/<number>" --jq '{type: .type.name, sub_issues: .sub_issues_summary.total}'
   ```

   Take the issue number from the JSON, never from the raw argument, and state the title back
   to the user so a wrong number is caught here.

3. Stop and ask before continuing if the issue is **closed**, is **assigned to someone else**,
   or is a parent issue: its `type` is `Epic` or `sub_issues` is above `0` (implement one of
   its sub-issues instead).
4. Look for work already under way:

   ```bash
   gh issue develop --list <number> --repo <ISSUE_REPO>
   gh pr list --repo <ISSUE_REPO> --search "<number> in:title,body" --state all --limit 100
   ```

   If a branch or PR exists, report it and ask how to proceed. If `gh pr list` returns 100 rows,
   treat the list as incomplete and ask the user.

5. `git fetch origin`. Everything below starts from `origin/main`; the main checkout's own
   branch and state don't matter. When `origin` is not `ISSUE_REPO` (it is your fork), fetch
   `ISSUE_REPO` instead (`git fetch "https://github.com/<ISSUE_REPO>.git" "+main:refs/remotes/issue-base/main"`)
   and use `issue-base/main` wherever a later step says `origin/main`.

## Step 2: Workspace

Set up the worktree before exploring, so the code being read is current `origin/main`.

```bash
MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
[ "$(git rev-parse --path-format=absolute --git-dir)" = "$(git rev-parse --path-format=absolute --git-common-dir)" ] && echo "main checkout" || echo "linked worktree"
git rev-parse --show-toplevel
git branch --show-current
git status --porcelain
git rev-list --count origin/main..HEAD
```

**Reuse the current worktree** only when the second command printed `linked worktree`,
`status` printed nothing, the count is `0` and the user agrees: tell them its path and branch,
and that Step 4 renames that branch, and ask, because a clean worktree may belong to other
work. `WT` is then the path
`--show-toplevel` printed. Bring it up to date with `git merge --ff-only origin/main`; Step 4
names its branch.

**Otherwise create one**, detached, so nothing dangles if the work is dropped early:

```bash
WT="$MAIN_ROOT/.claude/worktrees/issue-<number>"
git -C "$MAIN_ROOT" worktree add --detach "$WT" origin/main
```

If `$WT` already exists (`git -C "$MAIN_ROOT" worktree list` shows it), stop and ask the user:
continue in it, or create `issue-<number>-2`. Never pass `--force` or delete it.

Then work only inside it. If your agent has a tool that moves the session into a worktree, use
it; otherwise `cd` there, use absolute paths under `WT` for every read and edit, and give `WT`
to every subagent. Never read or edit files under `MAIN_ROOT` itself. Run each `git` command on
its own, not inside a pipe, loop or chain with other commands: an agent that confines the
session to the worktree (Claude Code does, once the session moves there) refuses a `git` call
it can't check stays inside it.

Make the worktree runnable. Commit hooks need the dependencies, and each `.env` is created from
the worktree's own tracked `.env.example`. Never copy the main checkout's `.env` files, which
may hold real credentials. List the examples first:

```bash
cd "$WT" && pnpm install --frozen-lockfile
git -C "$WT" ls-files '*.env.example'
```

Then copy each one, writing the paths it printed into the loop:

```bash
cd "$WT" && for ex in <path> <path>; do f="${ex%.example}"; if [ -e "$f" ] || [ -L "$f" ]; then echo "skip $f (exists)"; else cp "$ex" "$f" && echo "created $f"; fi; done
```

Those files hold the stock local-dev values, which point at the default local services. The
copied `apps/auth/.env` keeps a placeholder signing key (`AUTH_JWT_PRIVATE_KEY`) that only
`pnpm local:setup` replaces, so sign-in fails until the worktree has a slot. If the work needs
running apps, sign-in or a database of its own, ask the user before giving the worktree a slot
(`pnpm local:setup --slot N`, see
[Running several checkouts at once](../../../docs/LOCAL_DEV_DOCKER.md#running-several-checkouts-at-once-git-worktrees)).

## Step 3: Understand the issue and the code

Read, in this order:

1. The issue body and every comment. Later comments often change the ask.
2. The [`docs/specs/`](../../../docs/specs/) file covering the feature, if one exists. The
   spec is the source of truth for what the feature does and who may do it.
3. The `AGENTS.md` in each directory the change is likely to touch.
4. For security-, auth- or reliability-sensitive work:
   [`docs/AI_GUARDRAILS.md`](../../../docs/AI_GUARDRAILS.md) and
   [`docs/AI_DEVELOPMENT_GUIDE.md`](../../../docs/AI_DEVELOPMENT_GUIDE.md).

Then explore the code. Size the effort to the issue: a one-file fix needs the file, its
callers and its tests; a feature needs all three of the questions below. With subagents, give
each question to its own read-only subagent with a fresh context, and have each return the
five to ten files most worth reading. Then read those files yourself; a summary is not enough
to design from. Without subagents, answer the questions one at a time.

- **What already does something like this?** Find the closest existing feature and trace it
  from its entry point (page, route, Slack handler, script) to the database and back.
- **What does the change touch?** Map the modules, shared packages and callers in the area,
  including other apps that consume the same package or API route.
- **How is this area tested?** Find the nearest tests, the fixtures they use and how they are
  run on their own.

**Gate 1.** Send the user one message:

- What the issue asks for, in two or three sentences.
- How the affected feature works today, in a short paragraph or table.
- Every open question: behavior the issue leaves unstated, edge cases, who is allowed to do
  it, what should happen to existing data. Give each a recommended answer so the user can
  accept it in a word.
- Anything in the issue that contradicts the spec or the code.

Wait for answers. "Whatever you think" is a request for your recommendation, stated plainly
and then confirmed. If the answers change what the issue means, offer to record the decision
as a comment on the issue (it is posted only at Gate 3).

Stop here and say so when the issue is too large for one reviewable PR (propose a split into
sub-issues) or cannot be built until someone decides something the user cannot.

## Step 4: Agree the approach

Design the change to fit the patterns found in Step 3: reuse before adding, and the smallest
change that fully does what the issue asks. When there is a real choice (where the logic
lives, new module or existing one), show two options with the trade-off and say which you
recommend. Don't invent a second option for a change that has one sensible shape.

**Gate 2.** Send the user one message:

- **What will change**, as a short list of files or modules with a line each.
- **Where the tests go.** List each seam (the public boundary a test calls: an API procedure,
  an exported function, a rendered component), with a line on what a test there catches and
  what it misses. Step 5 writes tests only at these.
- **What is test-first and what is not.** Behavior changes behind a seam are test-first. Say
  which parts are not and why: documentation, configuration, generated files, visual-only
  styling.
- **Impact outside the code:** database schema or migration, environment variables, deploy
  order, a spec that needs creating or updating.
- **Out of scope:** what the PR will deliberately not do.

A schema change follows [`db-migration`](../db-migration/SKILL.md) from here on. A new or
changed feature updates its `docs/specs/` file in the same PR.

Once the user approves, name the branch `<type>/<number>-<short-slug>`: `fix` for bugs, `docs`
for documentation, `chore` for maintenance or tooling, otherwise `feat`; the slug is three to
five lowercase hyphenated words from the title (`feat/42-add-dark-mode-toggle`). In a worktree
created in Step 2, or a reused one that is detached (`git branch --show-current` printed
nothing), run `git switch -c <branch>`; in a reused one that is on a branch run
`git branch -m <branch>` so no second branch is left behind.

## Step 5: Build

For the test-first parts, follow the [`tdd`](../tdd/SKILL.md) skill (load it through your
agent's skill mechanism, or read the file). The seams are the ones approved at Gate 2, so
don't ask for them again unless the design has changed. One failing test, the least code that
passes it, then the next.

`tdd` is vendored and written for any repo, so three of its pointers don't apply here. It
leaves refactoring to a review stage and points to a `code-review` skill for it, which this repo
doesn't have: tidy up once the last slice is green and before Step 6, with the tests still
passing; Step 8 is the review. It
names a `codebase-design` skill and a `GLOSSARY.md` that this repo doesn't have: the approach
agreed at Gate 2 settles the interface, and terms come from the spec.

While building:

- Run the single test file and the affected workspace's typecheck after each slice, not the
  whole repo.
- Match the code around you. Follow [Coding Style](../../../AGENTS.md#coding-style--naming-conventions)
  and [Logging](../../../AGENTS.md#logging); comments follow
  [`durable-docs`](../durable-docs/SKILL.md).
- Tests follow [Writing tests that can fail](../../../docs/testing.md#writing-tests-that-can-fail).
  Where `tdd` disagrees, that page wins: asserting persisted database state, and that a
  rejected call left it unchanged, is required here, not a side channel.
- If the approved approach turns out not to work, stop and go back to Gate 2 with what you
  found. Don't redesign silently.

## Step 6: Verify

1. Run `pnpm ci:local` in the worktree. If it is too slow to repeat, run at least
   `pnpm lint:fix`, `pnpm format:fix`, `pnpm typecheck`, `pnpm lint:unused` and the affected
   tests, and tell the user which parts of the full sequence were skipped. Fix what fails;
   never bypass a hook or lower a coverage threshold. A test run that raises the coverage
   thresholds in a `vitest.config.*` file is expected; keep the change. Item 4 treats it, and
   everything approved at Gate 2 (spec update, migration, tests), as in scope.
2. For a change a user can see or call, run it. Follow [`verify`](../verify/SKILL.md) and keep
   the evidence (response body, screenshot) for the PR. In a slotted worktree, use the ports in
   its root `.env` (`F3_API_PORT`, `F3_MAP_PORT` and the rest) in place of the default ports
   `verify` names.
3. Commit in Conventional Commits form, `type(scope): subject`, with a scope from
   `scope-enum` in [`commitlint.config.mjs`](../../../commitlint.config.mjs).
4. Check the diff (`git diff origin/main...HEAD`) against the issue, line by line: every
   requirement and acceptance criterion is met, and nothing is in the diff that the issue
   didn't ask for. Fix any gap, re-run the checks the fix touches and commit again before
   going on.

## Step 7: Draft pull request

**Gate 3.** Show the user the PR title and body, plus any issue comment drafted in Step 3, and
wait for an explicit go-ahead before pushing or posting.

1. Run `bash scripts/gh-check.sh --require-write` against the repository you will push to
   (set `GH_REPO=<owner>/<name>` when that is your fork).
2. Fill in every section of `.github/PULL_REQUEST_TEMPLATE.md` as
   [Pull Request Guidelines](../../../AGENTS.md#pull-request-guidelines) describes, with
   `Closes #<number>`, and remove its placeholders. Title in Conventional Commits form.
3. End the body with the signature line from
   [Writing to GitHub](../../../AGENTS.md#writing-to-github).
4. Push the branch and open the PR with `gh pr create --draft --repo <ISSUE_REPO>`. From a
   fork, add `--head <fork-owner>:<branch>` so the PR targets upstream from your fork's branch.
   Note the PR URL it prints; Step 8 needs it.
5. Post any issue comment approved above with
   `gh issue comment <number> --repo <ISSUE_REPO> --body-file <file>`,
   ending with the same signature line.

## Step 8: Review the draft

A draft PR is not picked up by the hosted review bots, so this pass costs none of their
shared quota and nobody else sees it.

1. Run [`pr-review-inline`](../pr-review-inline/SKILL.md) on the new PR with `--dry-run`, giving
   it the PR URL from Step 7, not the number: a bare number resolves against the checkout's
   repository, which from a fork is the fork. It drafts its findings and posts nothing. With
   subagents, run it in one with a fresh context, giving it the PR URL but not your reasoning,
   so it isn't anchored on your solution. It checks the PR out in a worktree of its own, which
   an agent that confines the session to `WT` refuses to create: first leave `WT` (in Claude
   Code, `ExitWorktree` with `action: "keep"`), then return to it for the fixes.
2. Fix what it found, in a new commit, and re-run the checks the fix touches. Tell the user
   about any finding you chose not to fix, and why.
3. Show the user the fix diff, and the new PR body if the fixes changed what it says, and wait
   for a go-ahead before pushing or editing the PR: the Gate 3 approval covered only what they
   saw then.

   If the push is rejected as not a fast-forward, someone updated the branch on GitHub (often
   with its **Update branch** button). Never force-push: it would drop their commits. Fetch
   the branch from the repository you push to, and list what it brings in:

   ```bash
   git fetch "https://github.com/<owner>/<name>.git" <branch>
   git log --oneline HEAD..FETCH_HEAD
   ```

   Show the user that list and wait for their go-ahead. Then merge it, stopping to ask if it
   conflicts, re-run the checks the merge touches and push again:

   ```bash
   git merge --no-edit FETCH_HEAD
   ```

   If the list holds commits that aren't on the base branch, someone pushed new work to the
   PR branch. Item 1's review reads the PR's head on GitHub, so it can only see the merge
   once it is pushed; the PR is still a draft, so the hosted bots skip it. After that push,
   run item 1's review again and repeat items 2 and 3 for what it finds. A merge of the base
   branch alone brings in only reviewed, merged work and needs no second review.

4. After the last push, wait for the hosted checks (`gh pr checks <pr-number> --repo <ISSUE_REPO> --watch`) and
   handle a failure the same way. `pnpm ci:local` does not run every hosted job.

The user marks the PR ready for review once those checks pass; never do that for them.

Then tell the user:

- The PR link, and what was verified by running it versus by tests alone.
- The worktree path. Leave it in place: review rounds happen there, with
  [`address-pr-comments`](../address-pr-comments/SKILL.md). After the PR merges, remove it
  with `git worktree remove <path>` and delete the local branch; a worktree with its own slot
  needs `docker compose down -v` from inside it first.

If the user drops the work at any point, remove a worktree this skill created
(`git -C "$MAIN_ROOT" worktree remove "$WT"`) and any branch it made. Never remove a worktree
this run did not create.
