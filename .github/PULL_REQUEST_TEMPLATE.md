<!--
Learn more about GitHub Pull Request Templates at...
https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/creating-a-pull-request-template-for-your-repository
-->
<!--
### 🚧 This PR is Part of a Series
-->
<!--
You can simply remove this section
if you don't need it for your use-case
(e.g., a one-off PR that isn't actually
stacked or part of a series)
-->
<!--
- #1 short description
- #2 short description
- #3 short description
-->

### 👋 TL;DR

<!-- keep it simple, a sentence or two at most -->

(coming soon)

### 🔎 Details

<!--
This is the place to get in the weeds about what changed.
Consider linking out to project artifacts like:
- Jira issue(s)
- Slack post(s)
- Loom video(s)
- Figma design(s)
- etc.
-->

(coming soon)

### ✅ How to Test

<!--
Document what a real testing looks like.
Think not only about code review,
but also about QA/UAT.
Given-When-Then acceptance criteria are great,
but even just a flat list of common test cases
in common language is better than nothing
-->

(coming soon)

### 📋 Checklist

<!--
Check what applies; delete lines that don't. Explain anything left unchecked.
-->

- [ ] Commands run: <!-- e.g. pnpm ci:local -->
- [ ] Tests pin the new behavior and fail without this change
- [ ] Docs updated with the code (specs, `AGENTS.md`, READMEs, `docs/` — see "Docs that change with the code" in `REVIEW.md`)
- [ ] Database migration: none / included and follows the [`db-migration`](https://github.com/F3-Nation/f3-nation/blob/main/.agents/skills/db-migration/SKILL.md) skill (lock risk, release steps, rollback)
- [ ] Environment variables: none / added to every `.env*.example`, `cloud-run-env*.sh` and env docs
- [ ] Deploy order: none / stated (e.g. `api` before an app that depends on it)
- [ ] UI change: screenshots or recording attached
- [ ] Touches security, availability or scalability: called out for human sign-off

### 🥜 GIF

<!-- GIFs are always optional but never forgotten -->

![lack-of-hustle](https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjExNWZ2enV5YXY5YXdzb2IwOWFtMGp1OTd0bGljdHBzNXpiYXVzM2Y2ZCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/3oKIPACZEWen2eaBm8/giphy.gif)
