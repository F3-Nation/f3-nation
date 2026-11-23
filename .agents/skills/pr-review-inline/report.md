# Final report

What pr-review-inline tells the user in the conversation at the end of a run. Nothing in it
goes to GitHub. The steps named here are the steps of [`SKILL.md`](SKILL.md).

Write these sections in this order:

1. **What this PR actually does** — the summary from "Characterize the diff on its own terms", verbatim: what changed, change
   inventory, blast radius, mechanical changes.
2. **Description accuracy** — the block from "Compare the diff against the PR's stated intent": unsupported claims, undocumented changes,
   contradictions.
3. **Comments posted** — count by severity, with links from each API response's `html_url`
   (or, for `--dry-run`, the drafts in full with their `path:line`). For a clean review, the
   link to the "no issues" comment.
4. **Skipped** — duplicates (and which existing comment each matched), findings dropped or
   downgraded in verification, and any dropped for line-not-in-diff or for having no changed
   line to attach to.
5. **Branch currency** — how many commits the PR is behind its base (`BEHIND`), and any
   conflicting files. Never call the PR ready to merge while it is behind or conflicting; say
   the author should update the branch first.
6. **Safety checklist** (gated PRs only) — one line per safety-checklist item the diff touches,
   or "none touched". If the gated lookup failed, say the PR was treated as gated for that
   reason.
7. **Provenance** — what actually ran and what didn't, so the user can judge how much the
   review covers:
   - the agent tool and model that ran the review; the depth (full or light) and the "Pick the depth"
     condition that decided it; which seats ran (by lens); whether each was a sub-agent or a
     pass in this session; the sub-agents' model, or that the tool didn't show it; any lane
     that was not reviewed; and, for `--rereview`, the checkpoint commit the diff started from
   - whether the PR was assigned to you, skipped as a self-review, left with its existing
     assignee (name them, and that the user said to continue), skipped for `--dry-run`, or the
     assignment failed
   - the reviewers' "Declined to judge" lists in one line each (pre-existing problems there
     may deserve an issue)
   - what was blocked: permission refusals, missing tools, comments dropped for
     line-not-in-diff, and the clean-review comment if it couldn't be posted
   - token usage or cost, only if the harness measured it
8. **Worktree cleanup** — confirmation, from `git worktree list`, that the worktree was removed;
   if it was not, the leftover path and the exact command for the user to run.

Sections 1 and 2 are required and lead the report; they stand whether or not any comments were
posted.

**Next step.** The usual order is this review, the author's fixes, `address-pr-comments` for
anything still open, and then `pr-local-test` as the final check once review feedback is
resolved.
