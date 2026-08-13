# Staging smoke-test checklists

Each file here is a short (3-5 item) regression checklist for one deploy
target — the core flows that should still work, not new-feature testing (see
individual release issues like [#841](https://github.com/F3-Nation/f3-nation/issues/841)
for that).

After every successful staging deploy, `_deploy-cloudrun.yml` /
`_deploy-cloudrun-job.yml` file a new issue titled `Staging smoke test: <service> <version>`,
labeled `staging-smoke-test` + the matching `app: <name>` label, with this
file's content as the body. See the `smoke_test_file` input on each
`deploy-*.yml` caller workflow.

**Adding a new deploy target:** add `<name>.md` here, then pass
`smoke_test_file: .github/smoke-tests/<name>.md` (and `app_label: "app: <name>"`
if that label exists) from the corresponding `deploy-*.yml`.
