---
name: implement-issue
description: Use when the user gives a GitHub issue number or URL to build ("implement issue 42", "work on #42", "pick up this issue") — takes the issue from pre-flight checks through codebase exploration, an approved approach, test-first implementation, self-review and a draft PR. Not for reviewing someone else's PR (pr-review-inline) or answering review feedback (address-pr-comments).
compatibility: macOS, Linux, or WSL 2 with bash, git and gh (authenticated). Works in any agent; steps that use subagents say what to do without them.
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

Shell variables do not persist between commands. When a step sets `MAIN_ROOT` or `WT`, note
the literal value and write it into later commands.

## Step 1: Pre-flight

1. Run `bash scripts/gh-check.sh`. If it fails, show its message and stop.
2. Fetch the issue. Accept `42`, `#42` or a URL and let `gh` resolve it:

   ```bash
   gh issue view <ref> --comments
   gh issue view <ref> --json number,title,body,labels,state,assignees
   ```

   Take the issue number from the JSON, never from the raw argument, and state the title back
   to the user so a wrong number is caught here.

3. Stop and ask before continuing if the issue is **closed**, is **assigned to someone else**,
   or is an **Epic** or other parent issue (implement one of its sub-issues instead).
4. Look for work already under way:

   ```bash
   gh issue develop --list <number>
   gh pr list --search "<number> in:body" --state all
   ```

   If a branch or PR exists, report it and ask how to proceed.

5. `git fetch origin`. Everything below starts from `origin/main`; the main checkout's own
   branch and state don't matter.

## Step 2: Workspace

Set up the worktree before exploring, so the code being read is current `origin/main`.

```bash
MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
pwd
git status --porcelain
git rev-list --count origin/main..HEAD
```

**Reuse the current worktree** when `pwd` is not `MAIN_ROOT`, `status` printed nothing and the
count is `0`. Bring it up to date with `git merge --ff-only origin/main`; its branch is renamed
in Step 4.

**Otherwise create one**, detached, so nothing dangles if the work is dropped early:

```bash
WT="$MAIN_ROOT/.claude/worktrees/issue-<number>"
git -C "$MAIN_ROOT" worktree add --detach "$WT" origin/main
```

Then work only inside it. If your agent has a tool that moves the session into a worktree, use
it; otherwise `cd` there, use absolute paths under `WT` for every read and edit, and give `WT`
to every subagent. Never read or edit files under `MAIN_ROOT` itself.

Make the worktree runnable. Commit hooks need the dependencies:

```bash
cd "$MAIN_ROOT" && git ls-files '*.env.example' | sed 's/\.example$//' | while read -r f; do [ -f "$f" ] && cp "$f" "$WT/$f" && echo "copied $f"; done
cd "$WT" && pnpm install --frozen-lockfile
```

The copied `.env` files point at the main checkout's local services. If the work needs running
apps or a database of its own, ask the user before giving the worktree a slot
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
created in Step 2 run `git switch -c <branch>`; in a reused one run `git branch -m <branch>`
so no second branch is left behind.

## Step 5: Build

For the test-first parts, follow the [`tdd`](../tdd/SKILL.md) skill (load it through your
agent's skill mechanism, or read the file). The seams are the ones approved at Gate 2, so
don't ask for them again unless the design has changed. One failing test, the least code that
passes it, then the next.

While building:

- Run the single test file and the affected workspace's typecheck after each slice, not the
  whole repo.
- Match the code around you. Follow [Coding Style](../../../AGENTS.md#coding-style--naming-conventions)
  and [Logging](../../../AGENTS.md#logging); comments follow
  [`durable-docs`](../durable-docs/SKILL.md).
- Tests follow [Writing tests that can fail](../../../docs/testing.md#writing-tests-that-can-fail):
  assert values and specific error codes, and cover both sides of every guard, including a
  cross-org authorization case where one applies.
- If the approved approach turns out not to work, stop and go back to Gate 2 with what you
  found. Don't redesign silently.

## Step 6: Verify and review your own work

1. Run `pnpm ci:local` in the worktree. If it is too slow to repeat, run at least
   `pnpm lint:fix`, `pnpm format:fix`, `pnpm typecheck`, `pnpm lint:unused` and the affected
   tests, and tell the user which parts of the full sequence were skipped. Fix what fails;
   never bypass a hook or lower a coverage threshold. A test run that rewrites
   `vitest.config.ts` thresholds upward is expected; keep the change.
2. For a change a user can see or call, run it. Follow [`verify`](../verify/SKILL.md) and keep
   the evidence (response body, screenshot) for the PR.
3. Commit in Conventional Commits form, `type(scope): subject`, with a scope from
   `scope-enum` in [`commitlint.config.mjs`](../../../commitlint.config.mjs). The review below
   reads committed changes only.
4. Review the branch with [`code-review`](../code-review/SKILL.md) against `origin/main`. With
   subagents, run it in one with a fresh context, giving it the diff and the issue but not
   your reasoning, so it isn't anchored on your solution.
5. Check the diff against the issue, line by line: every requirement and acceptance criterion
   is met, and nothing is in the diff that the issue didn't ask for.
6. Fix what the review found, in a new commit, and re-run the checks the fix touches. Tell the
   user about any finding you chose not to fix, and why.

## Step 7: Draft pull request

**Gate 3.** Show the user the PR title and body, plus any issue comment drafted in Step 3, and
wait for an explicit go-ahead before pushing or posting.

1. Run `bash scripts/gh-check.sh --require-write`.
2. Fill in the PR template: a plain-language overview first, `Closes #<number>`, the commands
   run, and database, environment-variable and deploy-order impact. Add screenshots for UI
   changes. Title in Conventional Commits form.
3. End the body with the signature line from
   [Writing to GitHub](../../../AGENTS.md#writing-to-github).
4. Push the branch and open the PR with `gh pr create --draft`. The author marks it ready.

Then tell the user:

- The PR link, and what was verified by running it versus by tests alone.
- The worktree path. Leave it in place: review rounds happen there, with
  [`address-pr-comments`](../address-pr-comments/SKILL.md). After the PR merges, remove it
  with `git worktree remove <path>` and delete the local branch; a worktree with its own slot
  needs `docker compose down -v` from inside it first.

If the user drops the work at any point, remove a worktree this skill created
(`git -C "$MAIN_ROOT" worktree remove "$WT"`) and any branch it made. Never remove a worktree
this run did not create.
