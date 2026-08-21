# Staging smoke-test checklists

`checklists.md` holds one short (2-5 item) regression checklist per deploy
target, each under a `## <app key>` heading — the core flows that should
still work, not new-feature testing (see individual release issues like
[#841](https://github.com/F3-Nation/f3-nation/issues/841) for that). Some
targets land at the low end because there isn't much left to check without
extra setup — e.g. `api`'s other routes all require auth, so its checklist
only covers the two that don't.

After every successful staging deploy, `_deploy-cloudrun.yml` /
`_deploy-cloudrun-job.yml` call the `.github/actions/staging-smoke-test-issue`
composite action, which pulls the deploying app's section out of
`checklists.md` and writes/updates **that app's own section** of a single,
long-lived "Staging smoke test tracker" issue — one issue covering every app,
not one issue per deploy. Each section is delimited by an HTML comment marker
(`<!-- smoke-test:<app key>:start/end -->`) so a redeploy replaces only that
app's section and leaves everyone else's checkbox state alone. If no open
`staging-smoke-test`-labeled issue exists, a new tracker issue is created;
closing the issue once everything's checked lets the next deploy start a
fresh one. See the `smoke_test_app` input on each `deploy-*.yml` caller
workflow.

**Adding a new deploy target:** add a `## <app key>` section to
`checklists.md`, then pass `smoke_test_app: <app key>` (and
`app_label: "app: <name>"` if that label exists) from the corresponding
`deploy-*.yml`.
