---
name: staging-test-plan
description: Draft and file a short GitHub issue of manual test steps for volunteers to run on Staging after a release-please release — dependent steps grouped into stories, then 2–3 smoke checks per app. Use when someone asks for a "staging test plan" or "test plan" for a release PR.
---

# Staging test plan issue

Produces one GitHub issue that volunteers work through on Staging. Its only
job is to tell a tester **what to click, in what order, and what they should
see**. Volunteers skip long plans, so every line has to earn its place.

The release plan is a separate issue made by the
[`release-plan`](../release-plan/SKILL.md) skill. Monitoring, deploy steps,
and database migrations belong there, not here.

## Inputs

Ask for anything missing before starting:

1. **Release PR number** — the `chore: release main` PR from release-please.
2. **Release plan issue number** — optional; linked from the Reporting line.

## Steps

1. **Read the release PR.**

   ```bash
   gh pr view <PR> --json title,body --jq '{title,body}'
   ```

   The body is the changelog: one `<details>` block per app with the merged
   PRs and issues. Note which apps are releasing. Ignore version numbers.

2. **Decide what each change needs.** For each changelog entry, read the PR
   title and, if unclear, the start of its body or its linked issue. Put it
   in exactly one bucket:
   - **Story** — the change can only be checked by doing things in order,
     often across apps (e.g. create a Territory in Admin → move an Area under
     it → see the Area under it on the Map). One feature = one story.
   - **App check** — one extra check in a single app, no setup needed.
   - **Skip** — not visible to a tester (dependency bumps, refactors, CI,
     tests, docs, logging). Most entries are this. Do not mention them.

3. **Fill in [`template.md`](template.md)** following the rules below.
   - Stories go first, in the order they must run (a story that creates
     test data comes before one that uses it).
   - Then one section per releasing app: its checks from
     [`smoke-checks.md`](smoke-checks.md), plus that app's **App check**
     items. Skip apps that are not releasing. Apps with only 1–2 checks
     may share a section (e.g. "Auth and Me").
   - Delete every `<!-- ... -->` comment and every optional block that does
     not apply. Replace every `{{PLACEHOLDER}}`.

4. **Check the size limits** below. If the draft is over, cut: drop the
   least risky checks first. Never "fix" length by merging items into long
   sentences.

5. **Write the draft to a local file**, e.g. `staging-test-plan-<PR>.md` in a
   scratch/temp directory (not in the repo). Show it to the person who asked
   and **stop until they approve** or request changes.

6. **File the issue** only after approval. Follow the repo
   [`github`](../github/SKILL.md) skill: run its pre-check with
   `--require-write` and end the body with its `_written by <model_name>_`
   signature.

   ```bash
   gh issue create --title "Staging test plan: <short release name> (#<PR>)" \
     --body-file <draft file>
   ```

   No labels, no assignees. If `gh` is not available to you, stop after
   step 5 and tell the person to paste the draft into a new issue.

## Rules for the content

- **Nothing above the first story** except the three items in the template:
  the URL table, the test-accounts line, and the reporting line. No
  overview, background, or "before you start" paragraphs.
- **Each story:** a `###` heading naming the feature, one line with
  `~N min · Owner: ___`, and at most one sentence of context if the steps
  would not make sense without it. Then checkboxes.
- **Each checkbox:** one action and what the tester should see, in one or two
  plain sentences. Name the app at the start of the step when a story crosses
  apps (e.g. "**Map:** …").
- **A step that checks an earlier step's result lives in the same story**,
  directly after it. Never split one story across app sections.
- **No app versions**, PR numbers only where a tester would need to open the
  PR, no explanation of how the code works.
- **Test accounts and test data are never written in the issue** (the repo
  is public). Point to the pinned message in `#monorepo` instead.
- **Cleanup section** only if a story creates or changes Staging data; one
  checkbox per thing to undo.

## Size limits

- Each story: **at most 8 checkboxes and ~15 minutes.** Split a bigger
  feature into two stories only if the second can be run by a different
  person after the first is done.
- Each app section: the smoke checks plus **at most 3** app checks.
- Whole issue: aim for **under 60 minutes** of total testing time. If it is
  over, cut app checks before story steps.

## What to leave out

These made past plans too long for volunteers to use. Do not include them:

- App version numbers or "→" version arrows in headings.
- A "Standing checklist" / "This release" split — just list the checks.
- Paragraphs explaining what changed or why before the steps.
- Tests an automated suite already covers, and "not testable on Staging"
  notes.
- Monitoring, log queries, or database queries — those are in the release
  plan.
