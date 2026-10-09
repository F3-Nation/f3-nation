# Slackbot Python conventions

`apps/slackbot` is a Python app. Follow Python conventions: use `snake_case` for
modules, files, functions, and variables, and use pytest for tests. Name test
files `test_*.py` and test functions `test_*` so pytest discovers them. These
app-specific conventions take precedence over the repository's general
TypeScript/Vitest test filename guidance; do not rename Python tests to
`*.test.ts[x]`.
