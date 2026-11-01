# How to contribute

F3 Nation is a volunteer organization invigorating male community leadership in our local communities (https://f3nation.com). Since its start in 2001, it has grown to thousands of weekly workouts affecting tens of thousands of men. From the beginning enterprising men started building technology to support the mission in their area. A lot of great apps and content were generated. Around 2024, a concerted effort was started to consolidate some of the enterprise-minded apps into a holistic ecosystem. And here we are.

F3 is free. All the contributors are volunteers. Reviews will be slower than you'd like. We're glad you're here!

We expect everyone here — contributors, reviewers, and maintainers alike — to communicate with respect and good faith. If you experience or witness behavior that doesn't meet that bar, reach out to a codeowner.

## Local Development

All the apps in this monorepo can be developed and tested locally. See [LOCAL_DEV_DOCKER.md](LOCAL_DEV_DOCKER.md) for instructions on how to set up a local environment. Coding conventions, commands, and the full contributor reference live in [AGENTS.md](../AGENTS.md).

## Submitting Changes

1. Fork the repository into your own account, then create a branch from `main`.
1. Make something awesome. Commit messages must follow [Conventional Commits](https://www.conventionalcommits.org/) (`type(scope): subject`) — see [AGENTS.md](../AGENTS.md#commit-message-convention) for allowed types and scopes. This is enforced locally by a commit hook.
   - For staged `.py` files, the Python pre-commit job applies Ruff lint fixes, formats the files, and stages the fixes. Unfixable lint errors block the commit. If `uv` is unavailable locally, this job prints a skip message; Python contributors should install `uv` and run `pnpm python:install`. The repository-wide `pnpm typecheck` hook runs on every commit.
1. Submit a PR against the F3-Nation `main` branch in **DRAFT**. Your PR title must also follow Conventional Commits format (`type(scope): subject`) — it's checked by [pr-title.yml](../.github/workflows/pr-title.yml), since our release process parses the title rather than individual commits. Fill in the PR template with a plain-language summary up top — many reviewers are volunteers without deep context on your change.
   - First PR to this repo? GitHub holds the CI workflows at `action_required` until a maintainer approves the run. That's a GitHub setting for first-time contributors, not a problem with your PR — give it a day, then ask in the F3 developers Slack if it's still waiting.
1. Run `pnpm ci:local` locally — it chains the same steps CI runs — then make sure all Checks pass once pushed. Catching issues locally is faster than waiting on CI.
   - The test step can rewrite `vitest.config.ts` coverage thresholds in the workspaces it ran — apps and packages alike (they ratchet upward). That's expected — commit the updated config with your change, and never lower a threshold by hand. See [AGENTS.md](../AGENTS.md) for the rules.
1. Mark the PR as **Ready for review**. At this point, a number of AI bots will run and provide feedback (see "Use of AI" below).
   - CodeRabbit doesn't review drafts. It posts a "Draft PR not reviewed" notice while your PR is still a draft — that's normal; its review arrives once you mark the PR ready.
1. Work the PR through the review stages in [PR_REVIEW_PROCESS.md](PR_REVIEW_PROCESS.md). As the author, you reply to and resolve the review threads; [Addressing feedback](PR_REVIEW_PROCESS.md#addressing-feedback) says how.
   - Once the AI bots' review threads are resolved, add the `ready for human review` label if you have `write` access to the repo.
     - Don't have `write` access, or forgot to add it? A scheduled workflow ([`ready-for-human-review-label.yml`](../.github/workflows/ready-for-human-review-label.yml)) applies the label automatically once your PR is out of draft, has no merge conflicts with `main`, all required checks are green, and the AI review bots' threads are resolved — it runs daily, so there can be up to a day's delay. The same workflow also removes the label if any of those stop being true (e.g. a new commit resets checks to pending, or `main` moves ahead and your branch now has merge conflicts), even if you added it by hand. Only actual merge conflicts count: a branch that is merely behind `main`, or unresolved threads from human reviewers, won't remove the label. A maintainer can trigger it manually for a fresher check.
     - Small, self-evident PRs (a one-line fix, a doc correction) are sometimes approved and merged by a codeowner before the label is ever applied. That's fine — the label is a review-queue signal, not a required check.

## Finding PRs that need you

Run `pnpm pr:triage` to see every open PR sorted by what it needs next: waiting on the AI bots, needs the `pr-review-inline` skill, waiting on the author's unresolved threads, needs the `pr-local-test` skill, needs a codeowner's approval, or approved and waiting to merge. Your own PRs get their own section, since someone else has to approve them. Run `pnpm pr:triage:html` to open the same thing as a board in your browser; run it again to refresh.

It needs the [GitHub CLI](https://cli.github.com) (signed in with `gh auth login`) and `jq`, and works on macOS, Linux and WSL. Drafts and Renovate and release-please PRs are left out. `scripts/pr-triage.sh --help` lists the options.

## Use of AI

AI tools are welcome for writing code, tests, and PR descriptions. You're responsible for understanding, testing, and reviewing anything AI-generated before you submit it. See [AI_DEVELOPMENT_GUIDE.md](AI_DEVELOPMENT_GUIDE.md) and [AI_GUARDRAILS.md](AI_GUARDRAILS.md) for the guardrails our own AI agents follow.

Conventions for writing code live in each area's `AGENTS.md`; rules for reviewing it live in [`REVIEW.md`](../REVIEW.md), which every AI reviewer loads. If a review bot keeps raising the same false positive, add a "do not flag" entry to `REVIEW.md`. If reviewers keep catching the same mistake, add a one-line rule to the matching `AGENTS.md`.

## Filing issues

Each issue covers one objective and is as small as is reasonable, ideally something a single PR can close. Small, single-focus issues are easier to claim, track and review, and they're the kind that suits `good first issue`.

- An issue can have a task list, but every task is a requirement for that one objective. If a task could be done, reviewed and closed on its own, it's a separate issue.
- Found several problems (an audit, a review, a bug bash)? File one issue per problem, and mention closely related ones in each other's descriptions. Being related isn't a reason for an Epic: the **Epic** type is for a large, cohesive effort whose issues only together deliver one outcome, each added to it as a sub-issue. Setting an issue's type and adding sub-issues needs triage access or higher. Without it, file the Epic and its child issues yourself, then comment on the Epic mentioning a code owner (see [`.github/CODEOWNERS`](../.github/CODEOWNERS)) and ask them to set its type and link the children.
- Search open and closed issues for a duplicate first, use an issue template, and lead with the plain-language impact before the root cause and fix.

## Choosing which Issues to work on

Short answer: work on whatever interests you. Any improvement you can make will be appreciated, even if there's not a current Issue for it.

New to the project? Issues labeled [`good first issue`](https://github.com/F3-Nation/f3-nation/issues?q=is%3Aopen+is%3Aissue+label%3A%22good+first+issue%22) are a good place to start; [`help wanted`](https://github.com/F3-Nation/f3-nation/issues?q=is%3Aopen+is%3Aissue+label%3A%22help+wanted%22) issues are ones we'd love a hand with.

Larger efforts are tracked as Epics: parent issues whose sub-issues are each their own small piece of work. Pick a sub-issue and comment on it to claim it before you start.

If you're looking to drive along the roadmap with us, check out the Issues project board: https://github.com/orgs/F3-Nation/projects/4

The board is organized by Priority and then Effort. Priority options are Urgent, High, Medium, and Low. The higher on the list you can work, the more impactful it could be.

## Slack for F3 Developers

We have a Slack workspace for F3 developers to discuss topics and issues. If you would like an invite, reach out to a codeowner and we can send you an invite.
