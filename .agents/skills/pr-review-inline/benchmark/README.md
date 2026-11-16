# Review benchmark

A change to pr-review-inline's reviewer prompts, or a new model running them, can make reviews
worse without anything failing. This folder is the check: a few past changes to this repo, each
pinned to the commit that was reviewed, with the defects a review of that commit must find.

- [`cases.md`](cases.md) lists the changes to review.
- [`expected.md`](expected.md) lists what each review must find. Don't open it until the
  findings for every case are final, so the answers can't shape the review.

## When to run it

- Before and after a change to `SKILL.md`'s review, parse or verify steps, to
  `reviewer-brief.md`, or to a file in `lenses/`. Run the base branch's version first, then
  yours, on the same model.
- When a new model becomes the one codeowners run reviews with. Run the unchanged skill on the
  new model and compare with the last result on the old one.
- When codeowners start using a different agent tool for reviews.

A full run is one reviewer seat per lens for every case that changes code, so it costs about as
much as that many reviews. Running a single case is fine for a quick check; say which.

## How to run it

Use a new session, on the agent tool and model being checked. For each case in `cases.md`:

1. Fetch the head commit and check it out in a disposable worktree, as the skill's worktree
   step does, but by commit instead of by PR:

   ```bash
   git fetch origin <head>
   WORKTREE_PARENT="$(mktemp -d /tmp/pr-review-bench.XXXXXX)"
   git worktree add --detach "$WORKTREE_PARENT/case" <head>
   ```

2. Run the skill's diff-characterization step with the case's base as `DIFF_BASE`.
3. Run the skill's review step with the default roster (no `--shallow`). Fill the brief as that
   step says, with these differences:
   - `EXISTING` and `FOCUS` are "None." and `GATED` is "Not gated."
   - `STANDARDS_SOURCE` is: "For this run, read `REVIEW.md` from `<absolute path of the
REVIEW.md being checked>` instead of the checkout's copy, which is older. Read the
     `AGENTS.md` files in the checkout."
4. Run the skill's parse and verify steps. There is nothing to de-duplicate against.
5. Write down the surviving findings: lens, severity, `path:line`, one sentence each.
6. Remove the worktree (`git worktree remove --force`, then `rmdir` the parent).

Make no GitHub call about a case, and post nothing. The cases are merged changes whose review
threads hold the answers.

## How to score it

Only now open `expected.md`. For each expected finding, mark it:

- **Caught** — a surviving finding names the same root cause. Wording, exact line and severity
  may differ.
- **Dropped** — a seat raised it and the verify step removed it.
- **Missed** — no seat raised it.

Models don't give the same answer twice. Run a case with a dropped or missed finding once more
and report both runs.

Report this table, with the agent tool, the model, the commit of the skill being checked, and
token use if the tool measured it:

| Case | Expected | Caught | Dropped or missed | Other 🔴/🟠 findings |
| ---- | -------- | ------ | ----------------- | -------------------- |

The last column counts surviving Critical and Important findings that aren't in `expected.md`.
They may be real: the expected list holds what the author confirmed and fixed, not everything
wrong with the commit. Read each one, and say how many hold up. A change that raises this count
with findings that don't hold up has made the review noisier.

**The bar:** every expected finding is caught. A change to the skill that loses one isn't
merged until the loss is explained and accepted by a codeowner. A model that can't reach the bar
isn't used for this review stage; say so in
[`docs/PR_REVIEW_PROCESS.md`](../../../../docs/PR_REVIEW_PROCESS.md).

Results go in the pull request that changes the skill, or in the request that asked for the
check. They describe one run on one day, so they are not committed here.

## Adding and removing cases

Add a case when a codeowner's own review, a local test, or production turns up a defect that a
review of that commit should have caught, or when a review catches a Critical or Important
defect that the author confirms and fixes. The set is only as good as the defects in it, so this
is how the benchmark improves.

- Record the commit that was reviewed, not the one that fixed it, and its merge base with the
  base branch at the time.
- Describe the defect in `expected.md` so that someone who hasn't seen the review can tell
  whether a finding matches.
- If the defect is a pattern that can recur, add it to [`REVIEW.md`](../../../../REVIEW.md) as
  well. The benchmark checks that reviewers find it; `REVIEW.md` is how they know to look.
- Prefer changes under about a thousand lines, and keep the set varied: runtime code, tests,
  scripts, workflows, docs.
- Never add a change from a private security-advisory fork. Its commits can't be fetched from
  this repository, and the write-up would describe the vulnerability in public.

Remove a case when its head commit can no longer be fetched, or when the code it changed is gone
and its defect no longer says anything about how this repo is reviewed.
