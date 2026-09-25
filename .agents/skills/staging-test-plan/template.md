<!--
  Staging test plan issue body. Replace every {{PLACEHOLDER}}, delete every
  OPTIONAL block that does not apply, then delete all HTML comments.
-->

| App   | Staging URL                        |
| ----- | ---------------------------------- |
| Map   | https://staging.map.f3nation.com   |
| Admin | https://staging.admin.f3nation.com |
| Auth  | https://staging.auth.f3nation.com  |
| API   | https://staging.api.f3nation.com   |
| Me    | https://staging.me.f3nation.com    |

<!-- Keep only rows for apps in this release. -->

**Test accounts and test data** are in the pinned message in `#monorepo`.
**Found a problem?** Post it in `#monorepo` with the time, the app, and what you did, and link it here.<!-- OPTIONAL: append " It blocks the go/no-go in #{{RELEASE_PLAN_ISSUE}}." -->

Put your name on a section before you start so two people don't do the same one.

## Stories

<!-- One block per story, in the order they must run. Delete this section if there are none. -->

### {{STORY_NAME}}

~{{N}} min · Owner: ___

{{OPTIONAL_ONE_SENTENCE_OF_CONTEXT}}

- [ ] **{{App}}:** {{action}}. {{what you should see}}.
- [ ] **{{App}}:** {{action}}. {{what you should see}}.

## Quick checks by app

<!-- One block per releasing app: its lines from smoke-checks.md, then at most 3 checks for this release. -->

### {{App}}

~{{N}} min · Owner: ___

- [ ] {{smoke check}}
- [ ] {{this release's check}}

<!-- OPTIONAL (only if a story changed Staging data): -->

## Cleanup

- [ ] {{undo one thing}}
