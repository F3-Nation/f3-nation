<!--
  Staging test plan issue body. Replace every {{PLACEHOLDER}}, delete every
  OPTIONAL block that does not apply, then delete all HTML comments.
-->

| App                         | Staging URL                        |
| --------------------------- | ---------------------------------- |
| Map                         | https://staging.map.f3nation.com   |
| Admin                       | https://staging.admin.f3nation.com |
| Auth                        | https://staging.auth2.f3nation.com |
| API                         | https://staging.api.f3nation.com   |
| Me                          | https://staging.me.f3nation.com    |
| Homepage (live, no Staging) | https://apps.f3nation.com          |

<!-- Keep only rows for apps in this release. -->

**Need a test account?** Ask the Release lead by commenting here or in `#monorepo`; accounts are sent privately, never posted here.
**Found a problem?** Comment on this issue (or post in `#monorepo`) with the time, the app, and what you did.<!-- OPTIONAL: append " It blocks the go/no-go in #{{RELEASE_PLAN_ISSUE}}." -->

**Before you start a section,** comment its name here so two people don't take the same one. Can't tick the boxes? Comment which checks passed.

## Stories

<!-- One block per story, in the order they must run. Delete this section if there are none. -->

### {{STORY_NAME}}

~{{N}} min

{{OPTIONAL_ONE_SENTENCE_OF_CONTEXT}}

- [ ] **{{App}}:** {{action}}. {{what you should see}}.
- [ ] **{{App}}:** {{action}}. {{what you should see}}.

## Quick checks by app

<!-- One block per releasing app: its lines from smoke-checks.md, then at most 3 checks for this release. -->

### {{App}}

~{{N}} min

- [ ] {{smoke check}}
- [ ] {{this release's check}}

<!-- OPTIONAL (only if a story changed Staging data): -->

## Cleanup

- [ ] {{undo one thing}}
