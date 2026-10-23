---
name: address-pr-comments
description: Use when the user wants to address, implement, respond to, or work through review feedback on their GitHub pull request ("address the PR comments", "respond to review feedback", "resolve the PR threads") — invoke before touching any code in response to that feedback.
compatibility: Any agent with a shell (bash or zsh) on macOS, Linux, or WSL 2. Needs git 2.31+ and an authenticated gh. Uses the Superpowers receiving-code-review skill if installed (built-in guidance otherwise).
---

# Address PR Comments

Read all three GitHub feedback surfaces (inline threads, review bodies, conversation) together before planning — fixing one comment in isolation can conflict with another. Nothing changes until the user approves the plan. This skill never resolves threads; the user does that.

The user may pass a PR number or URL; with neither, the current branch's PR is used.

All edits, commits, and pushes happen in a git worktree for the PR's branch, never in the repo's
main checkout. A worktree this run creates is removed at the end (Step 6).

Shell variables do not persist between commands. Whenever a step sets `MAIN_ROOT`, `WT`,
`LOCAL_BRANCH`, or `REPLY_DIR`, note the literal value and write it into later commands.

## Requirements

Check these before Step 1 and report everything missing in one message.

| Need                                      | If missing                                                                                                                          |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `git` 2.31+, `gh` (`gh auth status`)      | Stop. Install hints: `brew install <tool>` (macOS), `sudo apt install <tool>` (WSL/Linux).                                          |
| `pnpm` on `PATH`                          | Follow the NVM note in the root `AGENTS.md` (Environment Setup).                                                                    |
| Superpowers `receiving-code-review` skill | Continue with the guidance in Step 5a. Mention once that installing [Superpowers](https://github.com/obra/superpowers) is optional. |

## Step 1 — Pre-flight Checks

Stop at the first failing check.

**Check 0: Repo GitHub policy.** Read `.agents/skills/github/SKILL.md` and run its pre-flight with
write access:

```bash
bash .agents/skills/github/scripts/gh-check.sh --require-write
```

Adopt its mandatory directives — the `_written by <model_name>_` attribution signature and its
safety rules — for the rest of this skill.

**Check 1: Which PR?** Use the PR number or URL the user gave. If none was given, use the
current branch's PR (`gh pr view` with no argument); if that finds nothing, ask for a number.

```bash
gh pr view <ref> --json number,url,title,state,headRefName,isCrossRepository,maintainerCanModify
```

Stop if `state` is not `OPEN`. Stop if `isCrossRepository` is true and `maintainerCanModify` is
false: the push in Step 5b would be refused. Use `number` from the JSON from here on.

## Step 2 — Set Up the PR Worktree

```bash
MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
git worktree list --porcelain
```

`MAIN_ROOT` is the repo's main checkout, even when this session runs inside a worktree. Look for a
`branch refs/heads/<headRefName>` line in the listing, then pick the case that applies:

| Where the PR branch is checked out                                  | What to do                                                                                                                                                      |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The current directory, which is a linked worktree (not `MAIN_ROOT`) | Work here. This run does **not** own it: skip Step 6's removal                                                                                                  |
| Another linked worktree                                             | Ask the user before using it; another session may be working there. If yes, enter it (below) and do not remove it in Step 6                                     |
| `MAIN_ROOT`                                                         | Stop. Git allows a branch in only one checkout: ask the user to switch the main checkout off the PR branch (e.g. `git -C <MAIN_ROOT> switch main`), then re-run |
| Nowhere                                                             | Create a worktree, as below. This run owns it                                                                                                                   |

Creating the worktree. Fetch the PR head by its pull ref, which also works for fork PRs, then let
`gh pr checkout` attach the right local branch and upstream:

```bash
git -C "$MAIN_ROOT" branch --format='%(refname:short)'
git -C "$MAIN_ROOT" fetch origin "pull/<number>/head"
WT="$MAIN_ROOT/.claude/worktrees/pr-<number>-comments"
git -C "$MAIN_ROOT" worktree add --detach "$WT" FETCH_HEAD
cd "$WT" && gh pr checkout <number>
git -C "$WT" branch --show-current
git -C "$WT" status -sb
```

Record the branch list printed first. `LOCAL_BRANCH` is what `--show-current` prints. Note whether
it was in that first list, because Step 6 deletes only a branch this run created. If `status -sb`
shows the branch is ahead of its upstream, that local branch has unpushed commits from earlier
work: stop and ask before going on, since Step 5b's push would publish them.

**Move the session into the worktree.** Never read or edit a file under `MAIN_ROOT` itself.

- **Claude Code:** call `EnterWorktree` with `path: "<WT>"` (or the existing worktree's path).
  That moves the session's working directory, so file tools and subagents act on the worktree.
- **Any other agent** (Codex, Cursor, Copilot, Gemini, …): run every shell command as
  `cd "<WT>" && …` (a terminal tool may not keep the directory between calls), use absolute
  paths under `WT` for every file read and edit, and give `WT` to any subagent you start.

**Make it runnable**, for a worktree this run created. Copy the main checkout's gitignored `.env`
files — only the ones beside a tracked `.env.example`, so build output such as
`.next/standalone/**/.env` isn't copied — then install with the frozen lockfile. Commit hooks
(formatting, lint, typecheck) need the dependencies installed.

```bash
cd "$MAIN_ROOT" && git ls-files '*.env.example' | sed 's/\.example$//' | while read -r f; do [ -f "$f" ] && cp "$f" "$WT/$f" && echo "copied $f"; done
cd "$WT" && pnpm install --frozen-lockfile
```

The copied `.env` files point at the main checkout's local services. If addressing a comment
needs running apps or a database, ask the user before giving the worktree its own services with
`pnpm local:setup --slot N` (see `docs/LOCAL_DEV_DOCKER.md`).

**Check: is the worktree clean?**

```bash
git status --porcelain
```

If any output is returned: tell the user "Uncommitted or untracked changes detected — commit, stash, or remove them before proceeding." List the affected files. Stop here. (`--porcelain` reports staged, unstaged, and untracked files alike, and Step 5b commits everything modified, so the tree must be fully clean. Gitignored files such as `.env` and `node_modules` don't show.)

If you stop at any point after creating a worktree, still run Step 6's cleanup.

## Step 3 — Fetch All Feedback

Run all three. Never truncate comment bodies — replies must respond to the reviewer's exact words.

```bash
# Get repo context
gh repo view --json owner,name

# 1. Unresolved inline review threads, with every comment in each thread. GraphQL, not REST:
#    thread resolution exists only on PullRequestReviewThread, and a reviewer's follow-up reply
#    inside an open thread ("still broken") is new feedback that a first-comment-only view misses.
#    `id` is the thread's first comment — the target for the reply endpoint in Step 5c.
gh api graphql -f query='
query($owner: String!, $name: String!, $pr: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $pr) {
      reviewThreads(first: 100) {
        pageInfo { hasNextPage endCursor }
        nodes {
          isResolved isOutdated path line originalLine
          comments(first: 100) { nodes { databaseId author { login } createdAt body } }
        }
      }
    }
  }
}' -f owner={owner} -f name={name} -F pr={pr_number} \
  --jq '.data.repository.pullRequest.reviewThreads
        | {hasNextPage: .pageInfo.hasNextPage,
           threads: [.nodes[] | select(.isResolved | not)
             | {id: .comments.nodes[0].databaseId, path, line: (.line // .originalLine), isOutdated,
                comments: [.comments.nodes[] | {author: .author.login, createdAt, body}]}]}'
# If hasNextPage is true, re-run with `reviewThreads(first: 100, after: "<endCursor>")`.

# 2. Review bodies — formal review submissions (APPROVED, CHANGES_REQUESTED, COMMENTED)
# Compact on purpose: one line per review, body capped. Dumping full bodies (bots post 10KB+)
# can push the combined output past the tool limit, where the harness saves it to a file and
# shows only a preview — that is how reviews get silently missed. Read a specific body in full
# only after this listing tells you it matters.
gh pr view {pr_number} --json reviews \
  --jq '.reviews[] | [.author.login, .state, .submittedAt, (.body|length), (.body[0:300]|gsub("\n";" "))] | @tsv'

# 3. PR conversation comments — top-level discussion, not attached to any line
gh pr view {pr_number} --json comments \
  --jq '.comments[] | {author: .author.login, createdAt, body}'
```

Run the three fetches as separate commands, not one chained block, and print section separators
with `printf '%s\n' '--- name'` (an `echo ===` aborts under zsh). If any output is reported as
saved to a file or truncated, read the saved file in full before continuing — never plan from a
preview.

Resolved threads are already excluded by #1 — on long-running PRs that is most of them. Within an
unresolved thread, plan against the **latest** comment from someone other than us, not just the
first; if the last comment in a thread is our own reply, the thread is awaiting the reviewer and
needs no new action. `isOutdated: true` means the commented line has since changed — check whether
the concern still applies before planning a fix.

Review bodies and conversation comments (#2, #3) cannot be resolved. Treat one as already
addressed when a later conversation comment or thread reply carries a `_written by …_` signature
(see Step 5c), was posted by the PR author's account, and responds to it. Teammates use different
agents, so match the signature, not a particular model name.

Keep feedback from bot **reviewers** — AI code-review bots (CodeRabbit, Copilot, Codex, adversarial
review workflows) raise real findings. Drop only noise: CI/status/coverage summaries,
dependency-bot and release-bot chatter, empty review bodies, and standalone APPROVED reviews with
no comment. A review with a non-empty body is feedback whatever its state — an APPROVED review
that says "my only comment is…" is a question to answer, and a human COMMENTED review often holds
numbered requests. Never drop a human review without reading its full body.

Before planning, account for every review: end Step 4's plan with a line like "Reviews seen: N —
planned: X; skipped as noise: Y (author — reason)". A review that appears in neither count means
the fetch was incomplete; re-fetch before presenting.

If nothing remains after filtering, tell the user "No open review feedback found on this PR." and
stop.

## Step 4 — Present the Plan and Wait for Approval

Present a numbered plan, one entry per comment, in these buckets and this order:

1. **Blockers** — bugs, broken behavior, security issues
2. **Required changes** — explicit reviewer requests
3. **Suggestions** — things to evaluate (apply receiving-code-review rigor before accepting)
4. **Push back / skip** — YAGNI, technically incorrect, conflicts with prior decisions

Within each bucket, group inline comments by file. Each entry:

```
## PR Comment Plan

### Comment 1 — [inline | review | conversation] · @author · filename:line (if inline)
**Category:** Blocker | Required | Suggestion | Push back
**Comment:** "<the reviewer's exact words>"
**Action:** <what code change to make, or "no code change needed">
**Reply:** "<exact text of the reply to post on GitHub>"
**Ready to resolve:** yes / no / n/a — informational only; conversation comments cannot be
resolved, and this skill never resolves threads itself
```

End the plan by asking the user to reply **"approve"** to proceed as-is, or with changes to the plan. Make no code changes and post no replies until they explicitly approve. On requested changes, revise and re-present; on an ambiguous response, ask.

## Step 5 — Execute (approved plan only)

### 5a — Code changes

In plan order, for each comment with a code action: read the code first and verify the reviewer's premise against it, then make one comment's change at a time.

If the Superpowers `receiving-code-review` skill is installed, apply it for evaluation, YAGNI
checks, and pushback tone. Otherwise hold to the same rules:

- Verify before implementing. A reviewer (human or bot) can be wrong about the code; check the
  claim against the PR head, and push back with evidence when it doesn't hold.
- No performative agreement ("Great catch!"). State what changed, or why nothing did.
- YAGNI: decline a suggestion that adds unused generality, and say why in the reply.
- If two comments conflict, or one is unclear, ask the user before changing code.

### 5b — Commit and push

Stage and commit all modified files with a Conventional Commit message scoped to the PR, e.g.
`fix(scope): address PR #NNN review comments`. The scope must be in `commitlint.config.mjs`'s
`scope-enum`. (Claude Code users with the `commit-commands` plugin may use its `commit` skill.)
The Lefthook hooks run on commit; if one fails, fix the cause — never `--no-verify`. Then push:

```bash
git push
```

**Push before posting any replies.** Review bots re-fetch the diff the moment a reply lands; a
reply posted before the push makes them respond to code that isn't on GitHub yet.

### 5c — Post replies

After the push, post each planned reply in its existing thread (never as a new top-level comment
when a thread exists). End every reply with the `github` skill's signature, `_written by
<model_name>_`, as its own final line, naming the model or agent that wrote it.

Write each reply to its own file with a quoted heredoc (`<<'BODY'`), then pass the file — reply
text routinely contains backticks and `$`, which `-f body="..."` would let the shell mangle. Keep
the files outside the worktree, which must stay clean for Step 6:
`REPLY_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pr-<number>-replies.XXXXXX")"` (this form works with both
the macOS and GNU `mktemp`).

```bash
# Inline review thread — {comment_id} is the thread's `id` from Step 3 #1:
gh api repos/{owner}/{name}/pulls/{pr_number}/comments/{comment_id}/replies \
  -F body=@"$REPLY_DIR/<n>.md"

# Top-level PR conversation comment:
gh pr comment {pr_number} --body-file "$REPLY_DIR/<n>.md"
```

Issue these as plain sequential commands, not inside a shell function.

## Step 6 — Clean Up and Report

### 6a — Clean up

Run this on every exit once Step 2 has created anything, including stops and failures. Skip the
worktree and branch removal when this run doesn't own the worktree (Step 2's table), or when the
user asked to keep it for another round; then give them the path and the commands below.

1. Leave the worktree. In Claude Code, call `ExitWorktree` with `action: "keep"`: it returns the
   session to where it started and never removes a worktree entered by `path`, so the next
   commands do that. In any other agent, run the next commands from `MAIN_ROOT`.
2. Remove the worktree from outside it. Its gitignored `.env` files and `node_modules` go with it:

   ```bash
   git -C "$MAIN_ROOT" worktree remove "$WT"
   ```

   If git refuses because of uncommitted or untracked files, don't force it. Show the user
   `git -C "$WT" status --porcelain` and ask.

3. If this run created `LOCAL_BRANCH`, delete it once the push has landed. Compare the two SHAs
   first and delete only when they match:

   ```bash
   git -C "$MAIN_ROOT" rev-parse "<LOCAL_BRANCH>" "<LOCAL_BRANCH>@{upstream}"
   git -C "$MAIN_ROOT" branch -D "<LOCAL_BRANCH>"
   ```

   `-D` is needed because the branch isn't merged into main yet. It's safe here because every
   commit on it is on the remote.

4. `rm -r "$REPLY_DIR"`, then `git -C "$MAIN_ROOT" worktree list` to confirm the worktree is gone.

### 6b — Report

Summarize what changed and link the pushed commit. Say what cleanup removed, or which worktree was
kept and why. List every thread the plan marked "Ready to
resolve: yes" so the user can resolve them by hand after reviewing the push. Never run
`resolveReviewThread`.
