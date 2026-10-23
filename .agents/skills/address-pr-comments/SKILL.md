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
gh pr view <ref> --json number,url,title,state,headRefName,headRefOid,headRepository,headRepositoryOwner,isCrossRepository,maintainerCanModify
```

Stop if `state` is not `OPEN`. Use `number` from the JSON from here on, and derive two repositories
(`<owner>/<name>`):

- `BASE_REPO` from `url`: the repository that owns the PR and its `pull/<number>/head` ref, which
  is not necessarily `origin`. Every later `gh` call pins it (`--repo`, or a `repos/<BASE_REPO>/…`
  path), because a bare PR number resolves against gh's default repository.
- `HEAD_REPO` from `headRepositoryOwner` and `headRepository`: where the PR branch lives and where
  Step 5b pushes.

For a cross-repository PR (`isCrossRepository` is true), stop unless the push in Step 5b would be
accepted: `maintainerCanModify` is true, or the viewer can push to the head repository
(`gh api repos/<HEAD_REPO> --jq .permissions.push` prints `true`). The flag only governs access
granted to upstream maintainers, so a fork author can still push when it is false.

## Step 2 — Set Up the PR Worktree

```bash
MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
git -C "$MAIN_ROOT" fetch "https://github.com/<BASE_REPO>.git" "pull/<number>/head"
git worktree list --porcelain
```

`MAIN_ROOT` is the repo's main checkout, even when this session runs inside a worktree. The fetch
brings the PR head commit (`headRefOid`) into the local object store for the checks below; use
`BASE_REPO`, whose `origin` may be a fork. Look for a `branch refs/heads/<headRefName>` line in the
listing. A matching branch name alone does not prove the worktree belongs to this PR (an unrelated
local branch, or a fork's, can share the name), so verify the candidate by commit rather than by
upstream or remote configuration, which can be a named remote, a bare URL, or absent:

```bash
git -C "<candidate>" rev-parse HEAD
git -C "<candidate>" merge-base --is-ancestor HEAD <headRefOid> && echo "equal or behind"
```

Its HEAD must equal `headRefOid`. If it is strictly behind (an ancestor), bring it up with
`git -C "<candidate>" merge --ff-only <headRefOid>` once the worktree is clean. If it is ahead of
`headRefOid` or has diverged, it holds commits that are not on the PR: stop and ask the user rather
than reusing it, since Step 5b would publish them. Then pick the case that applies:

| Where the PR branch is checked out                                  | What to do                                                                                                                                                      |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The current directory, which is a linked worktree (not `MAIN_ROOT`) | Work here. This run does **not** own it: skip Step 6's removal                                                                                                  |
| Another linked worktree                                             | Ask the user before using it; another session may be working there. If yes, enter it (below) and do not remove it in Step 6                                     |
| `MAIN_ROOT`                                                         | Stop. Git allows a branch in only one checkout: ask the user to switch the main checkout off the PR branch (e.g. `git -C <MAIN_ROOT> switch main`), then re-run |
| Nowhere                                                             | Create a worktree, as below. This run owns it                                                                                                                   |

Creating the worktree. The PR head is already fetched (above), which also works for fork PRs; let
`gh pr checkout` attach the right local branch. First pick a destination that is free, as its own
command, and do not run the next block unless this prints `free`. If it prints `in use`, ask the
user before reusing the path, or append a suffix (`-2`, `-3`, …) and check again:

```bash
WT="$MAIN_ROOT/.claude/worktrees/pr-<number>-comments"
if [ -e "$WT" ] || git -C "$MAIN_ROOT" worktree list --porcelain | grep -qx "worktree $WT"; then echo "in use"; else echo "free"; fi
```

```bash
git -C "$MAIN_ROOT" branch --format='%(refname:short)'
git -C "$MAIN_ROOT" worktree add --detach "$WT" FETCH_HEAD && cd "$WT" && gh pr checkout <number> --repo <BASE_REPO>
git -C "$WT" branch --show-current
```

The commands are chained with `&&` so a failed `worktree add` never leaves `gh pr checkout`
running in a directory that already existed. Record the branch list printed first. `LOCAL_BRANCH` is what `--show-current` prints. Note whether
it was in that first list, because Step 6 deletes only a branch this run created.

**Move the session into the worktree.** Never read or edit a file under `MAIN_ROOT` itself.

- **Claude Code:** call `EnterWorktree` with `path: "<WT>"` (or the existing worktree's path).
  That moves the session's working directory, so file tools and subagents act on the worktree.
- **Any other agent** (Codex, Cursor, Copilot, Gemini, …): run every shell command as
  `cd "<WT>" && …` (a terminal tool may not keep the directory between calls), use absolute
  paths under `WT` for every file read and edit, and give `WT` to any subagent you start.

Do not install dependencies yet: that runs the PR's code, so it waits for plan approval (see
"Prepare the worktree" in Step 5).

**Check: is the worktree clean, and does it hold only pushed work?** This applies to every
worktree you use — current, reused, or newly created. A newly created one is detached at
`headRefOid`, so the second command prints nothing.

```bash
git status --porcelain
git log --oneline <headRefOid>..HEAD
```

If the `log` command prints anything, that local branch has commits that are not on the PR from
earlier work: stop and ask before going on, since Step 5b's push would publish them.

If the `status` command prints anything: tell the user "Uncommitted or untracked changes detected — commit, stash, or remove them before proceeding." List the affected files. Stop here. (`--porcelain` reports staged, unstaged, and untracked files alike, and Step 5b commits everything modified, so the tree must be fully clean. Gitignored files such as `.env` and `node_modules` don't show.)

If you stop at any point after creating a worktree, still run Step 6's cleanup.

## Step 3 — Fetch All Feedback

Run all three. Never truncate comment bodies — replies must respond to the reviewer's exact words.

```bash
# Pin everything to BASE_REPO (Check 1): split it into <owner> and <name> for GraphQL, and pass
# --repo <BASE_REPO> to every gh pr command. Never rely on gh's default repository.

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
          id
          comments(first: 100) {
            pageInfo { hasNextPage endCursor }
            nodes { databaseId author { login } createdAt body }
          }
        }
      }
    }
  }
}' -f owner=<owner> -f name=<name> -F pr=<number> \
  --jq '.data.repository.pullRequest.reviewThreads
        | {hasNextPage: .pageInfo.hasNextPage, endCursor: .pageInfo.endCursor,
           threads: [.nodes[] | select(.isResolved | not)
             | {id: .comments.nodes[0].databaseId, nodeId: .id, path, line: (.line // .originalLine), isOutdated,
                moreComments: .comments.pageInfo.hasNextPage, commentsCursor: .comments.pageInfo.endCursor,
                comments: [.comments.nodes[] | {author: .author.login, createdAt, body}]}]}'
# If hasNextPage is true, re-run with `reviewThreads(first: 100, after: "<endCursor>")` using the
# printed endCursor, until hasNextPage is false.
# If a thread shows moreComments: true, fetch the rest before choosing its latest comment:
#   node(id: "<nodeId>") { ... on PullRequestReviewThread { comments(first: 100, after: "<commentsCursor>") { nodes { ... } } } }

# 2. Review bodies — formal review submissions (APPROVED, CHANGES_REQUESTED, COMMENTED)
# Compact on purpose: one line per review, body capped. Dumping full bodies (bots post 10KB+)
# can push the combined output past the tool limit, where the harness saves it to a file and
# shows only a preview — that is how reviews get silently missed. Read a specific body in full
# only after this listing tells you it matters.
gh pr view <number> --repo <BASE_REPO> --json reviews \
  --jq '.reviews[] | [.author.login, .state, .submittedAt, (.body|length), (.body[0:300]|gsub("\n";" "))] | @tsv'

# 3. PR conversation comments — top-level discussion, not attached to any line
gh pr view <number> --repo <BASE_REPO> --json comments \
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

Approving the plan also approves running the PR's own code: dependency install scripts and the
commit hooks run with the user's normal credentials. If the PR changes `package.json`, the
lockfile, hook config or scripts, say so in the plan so the user can decide.

End the plan by asking the user to reply **"approve"** to proceed as-is, or with changes to the plan. Make no code changes and post no replies until they explicitly approve. On requested changes, revise and re-present; on an ambiguous response, ask.

## Step 5 — Execute (approved plan only)

### Prepare the worktree

Only for a worktree this run created, and only when a comment needs a code change. Commit hooks
(formatting, lint, typecheck) need the dependencies installed, so install with the frozen
lockfile first. Then create each `.env` from the worktree's own tracked `.env.example` — never
copy the main checkout's `.env` files, which may hold real credentials the PR's code could read.
The loop skips symlinks, existing files, and any destination whose real parent directory is
outside the worktree:

```bash
cd "$WT" && pnpm install --frozen-lockfile
cd "$WT" && git ls-files '*.env.example' | while read -r ex; do
  f="${ex%.example}"
  [ -L "$ex" ] && { echo "skip $ex (symlink)"; continue; }
  { [ -e "$f" ] || [ -L "$f" ]; } && { echo "skip $f (exists)"; continue; }
  case "$(cd "$(dirname "$f")" && pwd -P)/" in "$(pwd -P)"/*) ;; *) echo "skip $f (outside worktree)"; continue ;; esac
  cp "$ex" "$f" && echo "created $f"
done
```

If addressing a comment needs running apps or a database, ask the user before giving the
worktree its own services with `pnpm local:setup --slot N` (see `docs/LOCAL_DEV_DOCKER.md`).

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

If 5a changed nothing (`git status --porcelain` is empty — a reply-only plan), skip the commit and
push: confirm the PR head is the one you planned against
(`gh pr view <number> --repo <BASE_REPO> --json headRefOid`) and go straight to 5c.

Otherwise stage and commit all modified files with a Conventional Commit message scoped to the PR, e.g.
`fix(scope): address PR #NNN review comments`. The scope must be in `commitlint.config.mjs`'s
`scope-enum`. (Claude Code users with the `commit-commands` plugin may use its `commit` skill.)
The Lefthook hooks run on commit; if one fails, fix the cause — never `--no-verify`. Then check
that only this run's commits are outgoing, and push to an explicit destination:

```bash
git log --oneline <headRefOid>..HEAD
git push "https://github.com/<HEAD_REPO>.git" "HEAD:refs/heads/<headRefName>"
```

Never use a bare `git push`: where it goes depends on `push.default`, the branch's upstream and
`branch.<name>.pushRemote`, none of which this skill controls. If the push is rejected as
non-fast-forward, the PR moved since you planned: stop and ask. If HTTPS authentication fails
(`gh auth setup-git` configures it), ask the user.

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
gh api repos/<BASE_REPO>/pulls/<number>/comments/<comment_id>/replies \
  -F body=@"$REPLY_DIR/<n>.md"

# Top-level PR conversation comment:
gh pr comment <number> --repo <BASE_REPO> --body-file "$REPLY_DIR/<n>.md"
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

3. If this run created `LOCAL_BRANCH`, delete it once the push has landed. Fetch the branch from
   the head repository by URL (the branch may have no upstream or named remote), compare the two
   SHAs, and delete only when they match:

   ```bash
   git -C "$MAIN_ROOT" fetch "https://github.com/<HEAD_REPO>.git" "<headRefName>"
   git -C "$MAIN_ROOT" rev-parse "<LOCAL_BRANCH>" FETCH_HEAD
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
