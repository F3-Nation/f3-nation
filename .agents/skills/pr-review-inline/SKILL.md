---
name: pr-review-inline
description: Use when the user wants a GitHub pull request reviewed with the findings posted as inline, line-level comments on the PR ("review PR #N and comment inline", "inline PR review", "leave inline review comments"). Not for reading or addressing comments already on a PR — use address-pr-comments.
compatibility: Any agent with a shell. Needs git, gh (authenticated), and jq. Uses the Superpowers requesting-code-review skill if installed (bundled fallback otherwise); --deep uses Claude Code's pr-review-toolkit if installed.
---

# Inline PR Review

## Overview

Review a PR and post every finding as its own inline comment, on the file and line it is about.
A separate code reviewer produces the findings; this skill owns everything around it: the
isolated checkout, the diff-first summary, de-duplicating against existing feedback, the comment
format, and posting.

Conventions:

- **Inline, one comment per finding.** Each finding is its own line-level comment, so the author
  sees how many things need fixing and exactly where. No top-level or review-summary comment.
- **Every comment serves two readers.** A plain-language explanation for a human who may not
  read the code, then a `## For the coding agent` section with a self-contained spec an AI agent
  can execute without any other context.
- **Follow the repo's `github` skill** for pre-flight, attribution, and safety rules (Step 1).
- **Verify against the PR head SHA**, not the local working tree.
- **The diff is the source of truth for what the PR does.** The report leads with a summary
  derived from the code, written before the title and description are read (Steps 3–4).

Options the user may pass: `--deep` (Step 6), `--dry-run` (draft comments, post nothing),
`--rereview` (only the commits since this skill's last review), and review aspects to focus on.

## Requirements

Check these before Step 1 and report everything missing in one message.

| Need                                       | If missing                                                                                                                                                        |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git`, `gh` (`gh auth status`), `jq`       | Stop. Install hints: `brew install <tool>` (macOS), `sudo apt install <tool>` (WSL/Linux).                                                                        |
| Superpowers `requesting-code-review` skill | Continue with the bundled `reviewer-brief.md`. Results are the same; mention once that installing [Superpowers](https://github.com/obra/superpowers) is optional. |
| Claude Code `pr-review-toolkit` plugin     | Only matters for `--deep`. Without it, `--deep` runs extra reviewer seats instead (Step 6).                                                                       |

## Step 1 — Resolve the target PR and capture the head SHA

```bash
# Repo context
gh repo view --json owner,name

# If a PR number/URL was given, use it; otherwise the current branch's PR:
gh pr view <pr-or-omit> --json number,headRefName,headRefOid,url,baseRefName,state
```

- The `--json` field list above is exact. `title` and `body` are **not** in it, and are fetched
  later in Step 4 — Step 3 characterizes the diff without them in context.
- Record `headRefOid` as `HEAD_SHA` — it is the `commit_id` for every inline comment and the
  revision you must review.
- If no PR is found (and none was specified), tell the user "No open PR found — specify a PR
  number or URL, or check out the PR branch first." and stop.
- If the PR is not `OPEN`, note it and confirm the user still wants to proceed.
- **Cross-repo review:** if a PR URL was given and its `{owner}/{name}` differs from `gh repo
view`'s (e.g. a private GHSA security-advisory collaboration repo, `<org>/<repo>-ghsa-xxxx-...`),
  extract `{owner}/{name}` from the URL itself and pass it explicitly (`--repo {owner}/{name}` or
  the full `repos/{owner}/{name}/...` path) to every `gh api`/`gh pr` call for the rest of this
  skill — don't rely on the ambient repo context from `gh repo view`, which still points at the
  local checkout's origin.

**Repo GitHub policy — check now, before any review work.** Read `.agents/skills/github/SKILL.md`,
run its pre-flight with write access, and adopt its mandatory directives (attribution signature,
safety rules) for the rest of this skill. Skip the pre-flight for `--dry-run`. If it fails, stop
here — the review would be wasted work if the comments can't be posted.

```bash
bash .agents/skills/github/scripts/gh-check.sh --require-write
```

## Step 2 — Create an isolated worktree for the PR head

The reviewer reads the working tree, so check out the PR head in a disposable detached worktree
— never in the main working directory, and without creating a local branch:

```bash
ORIGINAL_CWD="$(pwd)"
# Other sessions may be reviewing other PRs in parallel, so a registered pr-*-review worktree is
# not necessarily abandoned. Never remove one for a different PR number, and never remove one
# this run did not create. Only if a worktree for THIS PR number (pr-<n>-review) is already
# registered, tell the user and ask before replacing it: it may belong to a live session.
git worktree prune
git worktree list | grep 'pr-[0-9]*-review'
# Same-repo PR: fetch from origin.
git fetch origin "pull/<n>/head"
# Cross-repo PR (Step 1 found a different {owner}/{name}): that repo isn't a configured remote,
# so fetch by full URL. These repos usually share history with the main repo, so this is fast.
git fetch "https://github.com/<owner>/<name>.git" "pull/<n>/head"

# Create the worktree under /tmp explicitly, not bare `mktemp -d` (see Harness notes).
WORKTREE_PATH="$(mktemp -d -p /tmp)/pr-<n>-review"
git worktree add --detach "$WORKTREE_PATH" FETCH_HEAD
cd "$WORKTREE_PATH"
```

- **Verify the revision:** assert `git rev-parse HEAD` == `HEAD_SHA` (from Step 1). If they
  differ, remove the worktree (Step 10's cleanup command) and abort — do not review the wrong
  revision.
- Stay in `$WORKTREE_PATH` until Step 10. Reviewers started in Step 6 must be given the absolute
  worktree path and `HEAD_SHA` so they can't drift to the main checkout.

## Step 3 — Characterize the diff on its own terms

Read the full diff and write a summary of what the code actually does. Do this before Step 4
fetches the PR title and body, so the summary is derived from the diff alone.

```bash
gh pr diff <n> --name-only | wc -l
git diff --shortstat <merge-base> HEAD     # merge-base = git merge-base origin/<baseRefName> HEAD
gh pr diff <n>
```

No `--patch`. On a single-commit PR that flag prepends a `git format-patch` header whose
`Subject:` line is the PR title, defeating this step. Plain `gh pr diff` starts at `diff --git`.
Record the changed-line count; Step 6 uses it to size the review.

**`--rereview`:** find the last commit this skill reviewed — the newest `original_commit_id`
among this PR's inline comments whose body contains `<!-- pr-review-inline -->` (Step 5 fetches
them). If it is still an ancestor of `HEAD_SHA`, review only `git diff <that sha> HEAD` from here
on and say so in the report. Otherwise (force-push, or none found) review the whole PR.

Every claim in this summary traces to a specific hunk. If the diff does not show it, it is not
in the summary.

**Output contract — these four parts, in this order:**

1. **What changed** — one sentence naming the behavioral delta: what the system does after this
   merges that it did not do before.
2. **Change inventory** — a bullet per coherent unit of work, grouped by behavior rather than
   by file: `<area or path> — what it now does differently`. A single behavior spanning six
   files is one bullet; six unrelated edits in one file are six bullets.
3. **Blast radius** — call sites and consumers touched, DB schema/migrations, env vars, public
   API or wire-contract changes, dependency changes, config and CI.
4. **Mechanical changes** — pure renames, file moves, formatting, generated files, lockfiles.
   Named here and set aside, so they do not inflate parts 1–3.

## Step 4 — Compare the diff against the PR's stated intent

Now fetch what the PR claims about itself:

```bash
gh pr view <n> --json title,body
```

**Output contract — a `Description accuracy` block with these three slots:**

- **Unsupported claims** — asserted in the title or body; no hunk implements it.
- **Undocumented changes** — present in the diff; absent from the title and body.
- **Contradictions** — the diff does something other than what the description states.

An empty slot is written as "none". All three empty → `Description accuracy: matches the diff.`

Steps 3 and 4 produce **report content only** (Step 10). Nothing from them is posted to GitHub,
and a description mismatch is not by itself an inline finding — only an actual code defect is.

## Step 5 — Fetch existing feedback for dedup (BEFORE running the review)

```bash
# Inline (line-level) review comments already on the PR
gh api repos/{owner}/{name}/pulls/{n}/comments --paginate \
  --jq '.[] | {path, line, original_line, original_commit_id, body, user: .user.login}'

# Top-level conversation comments (so we don't repeat a point made at the top level)
gh api repos/{owner}/{name}/issues/{n}/comments --paginate \
  --jq '.[] | {body, user: .user.login}'
```

This is the **dedup baseline** — comments from anyone (humans, bots, prior runs). If it is long,
keep only `path`, `line`, and the first ~200 characters of each body in context.

A cross-repo target such as a private GHSA advisory repo often has Issues disabled, so the
`issues/{n}/comments` call 404s. That's expected; proceed with the inline-only baseline.

## Step 6 — Run the review

**Pick the brief.** If the Superpowers `requesting-code-review` skill is available (Claude Code:
`superpowers:requesting-code-review`; other agents: `requesting-code-review`), load it and use
its `code-reviewer.md` template. Otherwise use `reviewer-brief.md` in this skill's folder. Fill
the placeholders this way, so the reviewer judges the code against requirements rather than
against the author's own description:

| Placeholder             | Fill with                                                                                                                                                                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DESCRIPTION`           | Step 3's "What changed" and change inventory                                                                                                                                                                                                  |
| `PLAN_OR_REQUIREMENTS`  | The `docs/specs/` file that covers the changed behavior, if one clearly does (search by feature and app names from Step 3). Otherwise: "No spec. Judge by what a reasonable user or maintainer of this code would expect." Never the PR body. |
| `BASE_SHA` / `HEAD_SHA` | The merge base (or the `--rereview` start) and `HEAD_SHA`                                                                                                                                                                                     |

Then append the **PR additions** below to the prompt. Both briefs need them: they make every
finding postable.

```text
## PR additions
- The checkout is at <WORKTREE_PATH>, detached at <HEAD_SHA>. Read files only there.
- Read the repo's AGENTS.md files for the paths you review; documented rules count as standards.
- Report only problems in lines this PR adds or changes, or problems those lines cause elsewhere.
- For every issue give: path (repo-relative), line in the HEAD version of the file (or a line
  range), side (RIGHT for added/changed code, LEFT for removed code), severity, what is wrong,
  why it matters, and a fix. If the fix is a drop-in replacement for exactly those lines, give
  the replacement code.
- Start from the diff and the code it directly calls or is called by. Read further (other apps,
  other languages, history) only to confirm or rule out a specific suspicion, and say what you
  were checking.
- Already raised on this PR (don't repeat these unless you think one is wrong):
  <one line per existing comment from Step 5: path:line — concern>
- Skip Strengths and Recommendations; Issues, Declined to judge, and the Assessment are used.
- Focus areas from the user, if any: <aspects>.
```

**Size the review** by Step 3's changed-line count, ignoring mechanical changes:

| Size                     | Reviewer seats                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Under ~400 changed lines | One reviewer for the whole diff                                                                                                       |
| ~400 lines or more       | 2–3 reviewers, each given one group of related files from the change inventory (and told the others exist)                            |
| `--deep`                 | `pr-review-toolkit:review-pr` if installed (pass through any aspects the user named); otherwise one seat per inventory group, up to 4 |

Give each seat its own fresh sub-agent (a general-purpose sub-agent in Claude Code, a fresh
worker in Codex) with only the filled brief, never this session's history. If the agent has no
sub-agent tool, run the brief yourself, one group at a time, and say so in the report.

## Step 7 — Parse findings

For each finding, extract:

- `path`, `line` (and `start_line` for a multi-line span)
- `side`: `RIGHT` for added/changed code, `LEFT` for removed code
- `severity` — normalize to three buckets so the author sees priority at a glance:
  - 🔴 **Critical** — bugs, security issues, data loss, broken behavior (Critical / Must Fix /
    confidence 90–100)
  - 🟠 **Important** — likely wrong or risky; should fix (Important / Should Fix / confidence
    80–89)
  - 🟡 **Suggestion** — style, clarity, minor improvement (Minor / Nice to Have / Suggestions)
- `source` — the reviewer seat that raised it (`code-reviewer`, or the pr-review-toolkit agent
  name such as `silent-failure-hunter`)
- `explanation` — the prose reason
- `suggested_fix` — and whether it is a **concrete replacement for the commented line(s)**
  (eligible for a ```suggestion block) versus general advice
- `plain_summary` — what the problem is and what it means in outcomes (what breaks, for whom,
  how likely). Rewritten from the reviewer's technical `explanation`, not pasted from it.
- `agent_spec` — exact repo-relative paths, exact replacement content, and verification
  steps. Built from `suggested_fix`, filled in where the reviewer left it vague.

## Step 8 — Dedup, then verify

Drop a finding when a prior comment already covers it: same-or-near `path` + overlapping `line`
**and** the same underlying concern (judge semantically — exact text will not match). Also drop
a finding already addressed by a top-level comment, or one the PR description already
acknowledges as a known gap. Track every skip and the reason, for the final report.

**Then verify what's left.** Dedup first, so no effort goes into checking a duplicate. For each
remaining 🔴 and 🟠 finding, read the cited lines at `HEAD_SHA` yourself and confirm the problem
is real and caused by this PR. For a 🟡 finding that makes a factual claim (expected values in a
suggested test, a behavior the code supposedly has), check that claim too. Drop or downgrade
what doesn't hold up, and record it for the report. Reviewers over-report; a wrong comment costs
the author more than a missing nit.

## Step 9 — Post each surviving finding as an individual inline comment

**`--dry-run`:** don't post. Show each drafted comment, in full, with its `path:line` in the
report, and post only the ones the user then approves. Before posting them later, re-run the
GitHub pre-flight and compare `gh pr view <n> --json headRefOid` with `HEAD_SHA`. If the author
has pushed since, say so: the comments still attach to `HEAD_SHA`, and a line may have moved or
been fixed, so offer a `--rereview` instead.

Post **one comment per finding**, each attached to its own file and line. Never post a top-level
or review-summary comment, and do not use `POST .../reviews` with a body.

Write each body to its own file first, then pass it with `-F body=@<file>`:

```bash
gh api repos/{owner}/{name}/pulls/{n}/comments \
  -F body=@bodies/<n>.md \
  -f commit_id="$HEAD_SHA" \
  -f path="<path>" \
  -F line=<line> \
  -f side="<side>"
# <side> is the value computed per-finding in Step 7 (RIGHT for added/changed code, LEFT for
# removed code) — substitute it, don't hardcode RIGHT.
# multi-line span: also -F start_line=<start> -f start_side="<side>"
```

`-F body=@<file>` rather than `-f body="$BODY"`: the bodies are markdown containing backticks,
fenced blocks and `$`, and interpolating them through the shell mangles them. Emit each body
with a quoted heredoc (`<<'BODY'`) so nothing expands. Issue the calls as **plain sequential
commands, not a shell function** (see Harness notes).

**Comment body format** (this exact shape — dual audience; the signature line is the one the
repo's `github` skill requires):

````markdown
**🔴 Critical** · code-reviewer

This catch block swallows the error, so a failed user sync looks like a success. Nobody is
alerted, and the affected users just silently stop being updated.

## For the coding agent

In `<repo-relative path>`, log the failure and rethrow so callers and monitoring see it:

```suggestion
} catch (err) {
  logError("user.sync.failed", { userId }, err);
  throw err;
}
```

Verify: the `<named test file or suite>` tests still pass, and add a test that a failing
sync rejects instead of resolving.

_written by <model name>_
<!-- pr-review-inline -->
````

- Header: emoji + text severity, then `· <source>`.
- No heading on the plain-language section — it is the paragraph right under the header.
  Only the agent section gets a heading, spelled exactly `## For the coding agent`.

**Plain-language section**

- Say what is wrong in terms of outcomes: what breaks, for whom, and how likely. 2–4 sentences.
- Gloss any jargon on first use. Don't over-explain or talk down — write for a smart reader
  who doesn't read the diff.
- If you couldn't verify a claim (tests not run, no DB available), say so here and make
  confirming it step 1 of the agent section.
- Don't hard-wrap prose. GitHub renders single newlines as `<br>`, so break only at paragraph
  boundaries.

**`## For the coding agent` section**

- Fully self-contained. Never write "see above" or "as in the other comment" — the agent may
  be handed this one comment alone.
- Give exact repo-relative paths and exact content. Number the steps when order matters.
- Give a verification step for every change. Use only commands you have confirmed exist in
  this repo; if unsure, name the test file or suite instead of guessing a command.
- Before narrowing a test command to one file (`pnpm test -- <file>`), read what the `test`
  script actually runs. If it always collects coverage with enforced thresholds (e.g.
  `vitest --run --coverage`), a single-file run fails those thresholds even when the test
  passes — give the full-suite command instead.
- Call out any step that must not be skipped (e.g. "run the mutation check before
  strengthening the test").
- Suggested code comments must be terse and contain no issue or PR numbers.
- Put a ```suggestion block here **only when** it is a concrete drop-in replacement for the
  exact commented line(s), so the author can one-click apply. Otherwise use numbered prose
  steps.
- When there are several viable fixes, list the preferred one first and say why.

**Small findings.** A one-line nit still gets both sections, kept proportionate: the
plain-language part is one sentence, and the agent section can be just the suggestion block
plus one verification line. Never omit a section, so every comment has the same shape.

- End with the `github` skill's signature, exactly once, as the last visible line.
- After it, on its own line, add the hidden marker `<!-- pr-review-inline -->`. GitHub doesn't
  render it; `--rereview` and triage tooling use it to find this skill's comments.

**Line-not-in-diff (HTTP 422):** GitHub rejects comments on lines outside the PR diff. If a post
returns 422, retry on the nearest changed line in that file; if that also fails, skip the finding
and record it for the report — never let one bad line abort the whole run.

## Step 10 — Cleanup and report

Remove the worktree and return to your original directory, then report — do not post the report
to GitHub. Run the removal as its **own command**, from the original checkout:

```bash
cd "$ORIGINAL_CWD"
git worktree remove --force "$WORKTREE_PATH"
git worktree list
```

Only if `git worktree remove` actually **failed** (e.g. a reviewer left build artifacts behind),
run this as a separate, second command:

```bash
rm -rf "$WORKTREE_PATH"
git worktree prune
```

If removal is still refused, don't work around it. Say which path is left behind and give the
user the exact `git worktree remove --force <path>` command.

**Optional triage ledger.** Only if `PR_TRIAGE_LEDGER` is set (a file path), append one line,
even when zero comments were posted:

```bash
[ -n "${PR_TRIAGE_LEDGER:-}" ] && mkdir -p "$(dirname "$PR_TRIAGE_LEDGER")" && \
  printf '%s\t%s\t%s\t%s\t%s\n' "{owner}/{name}" "{n}" pr-review-inline "$HEAD_SHA" \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$PR_TRIAGE_LEDGER"
```

**Final report** (in the conversation), in this order:

1. **What this PR actually does** — the Step 3 summary, verbatim: what changed, change
   inventory, blast radius, mechanical changes.
2. **Description accuracy** — the Step 4 block: unsupported claims, undocumented changes,
   contradictions.
3. **Comments posted** — count by severity, with links from each API response's `html_url`
   (or, for `--dry-run`, the drafts).
4. **Skipped** — duplicates (and which existing comment each matched), findings dropped or
   downgraded in verification, and any dropped for line-not-in-diff.
5. **Review engine** — which brief and how many reviewer seats ran, and the reviewer's
   "Declined to judge" list in one line each (pre-existing problems there may deserve an issue).
6. **Worktree cleanup** — confirmation, from `git worktree list`, that the worktree was removed;
   if it was not, the leftover path and the exact command for the user to run.

Sections 1 and 2 are REQUIRED and lead the report; they stand whether or not any comments were
posted. Nothing in the report goes to GitHub.

## Harness notes

Agent sandboxes differ; these are the known traps.

- **Temp directories:** on macOS, bare `mktemp -d` resolves under `$TMPDIR`
  (`/var/folders/...`), which some sandboxes (Claude Code among them) don't allow. A `cd` there
  is silently undone after the command, so every later step runs in the wrong place.
  `mktemp -d -p /tmp` avoids it.
- **Worktree removal:** Claude Code refuses an `rm -rf` of a directory the session has `cd`'d
  into, and refuses the _whole_ command when it is chained (`git worktree remove … || rm -rf …`),
  so the worktree is left behind. Keep the two as separate commands, run after `cd` back.
- **Shell functions:** `PATH` doesn't reliably reach function scope in every sandbox, so a
  posting function can fail every call at once. Use plain sequential commands.
- **Inline-comment tools:** if the agent has a dedicated inline-comment tool (e.g.
  `mcp__github_inline_comment__create_inline_comment`), it may replace the `gh api` call, with
  the same one-call-per-finding rule.
