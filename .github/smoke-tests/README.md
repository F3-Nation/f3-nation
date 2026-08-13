# Staging smoke-test checklists

Each file here is a short (3-5 item) regression checklist for one deploy
target — the core flows that should still work, not new-feature testing (see
individual release issues like [#841](https://github.com/F3-Nation/f3-nation/issues/841)
for that).

After every successful staging deploy, `_deploy-cloudrun.yml` /
`_deploy-cloudrun-job.yml` call the `.github/actions/staging-smoke-test-issue`
composite action, which writes/updates **this app's own section** of a single,
long-lived "Staging smoke test tracker" issue — one issue covering every app,
not one issue per deploy. Each section is delimited by an HTML comment marker
(`<!-- smoke-test:<name>:start/end -->`, `<name>` = this file's basename) so a
redeploy replaces only that app's section and leaves everyone else's checkbox
state alone. If no open `staging-smoke-test`-labeled issue exists, a new
tracker issue is created; closing the issue once everything's checked lets the
next deploy start a fresh one. See the `smoke_test_file` input on each
`deploy-*.yml` caller workflow.

**Adding a new deploy target:** add `<name>.md` here, then pass
`smoke_test_file: .github/smoke-tests/<name>.md` (and `app_label: "app: <name>"`
if that label exists) from the corresponding `deploy-*.yml`.
