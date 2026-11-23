#!/usr/bin/env bash
# Regression tests for scripts/check-dockerfile-global-installs.mjs: that it
# passes exact-pinned global installs (literal or through an ARG default),
# exact-pinned npx runs and lockfile installs, and fails, naming the file and
# line, on a floating or missing version (literal or from an ARG default), an
# ARG with no default or not redeclared in its stage, an unpinned npx or npm
# exec run, a yarn global add, a root package.json dependency fetched outside
# the lockfile (global or pnpm dlx), and installs hidden by a comment line,
# a quoted `#`, a lowercase keyword or an unusual global-flag spelling.
# Run directly: bash scripts/check-dockerfile-global-installs.test.sh
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
checker="${script_dir}/check-dockerfile-global-installs.mjs"
failures=0

tmp_dir=""
trap 'if [[ -n "$tmp_dir" ]]; then rm -rf "$tmp_dir"; fi' EXIT
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/check-dockerfile-global-installs-test.XXXXXX")" || exit 1

# Creates fixture repo <dir> whose root package.json depends on turbo, with
# <path> holding the given Dockerfile contents.
make_repo() {
  local dir="$1" path="$2" contents="$3"
  mkdir -p "$dir/$(dirname "$path")"
  git -C "$dir" init -q
  printf '{ "devDependencies": { "turbo": "catalog:" } }\n' >"$dir/package.json"
  printf '%s\n' "$contents" >"$dir/$path"
}

expect() {
  local description="$1" expected_status="$2" dir="$3" pattern="${4:-}"
  local output status
  output="$(cd "$dir" && node "$checker" 2>&1)"
  status=$?
  if [[ "$expected_status" == "pass" && "$status" -ne 0 ]]; then
    echo "FAIL: ${description} (expected pass, got: ${output})"
    failures=$((failures + 1))
  elif [[ "$expected_status" == "fail" && "$status" -eq 0 ]]; then
    echo "FAIL: ${description} (expected a failure)"
    failures=$((failures + 1))
  elif [[ -n "$pattern" && "$output" != *"$pattern"* ]]; then
    echo "FAIL: ${description} (output missing '${pattern}': ${output})"
    failures=$((failures + 1))
  else
    echo "PASS: ${description}"
  fi
}

make_repo "$tmp_dir/ok" apps/web/Dockerfile 'ARG COREPACK_VERSION=0.36.0
FROM node:26 AS builder
ARG COREPACK_VERSION
RUN npm install -g corepack@${COREPACK_VERSION} && corepack enable
RUN npm i --global semver@7.7.2
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts --filter=f3-nation && \
    node_modules/.bin/turbo prune web --docker'
make_repo "$tmp_dir/ok" tooling/Dockerfile.job 'FROM node:26
RUN npx --yes cowsay@1.6.0 hi'
expect "exact pins and lockfile installs pass" pass "$tmp_dir/ok"

make_repo "$tmp_dir/floating-arg" apps/api/Dockerfile 'ARG TURBO_VERSION=2
FROM node:26 AS builder
ARG TURBO_VERSION
RUN npm install -g turbo@${TURBO_VERSION}'
expect "root dependency installed globally from an ARG" fail "$tmp_dir/floating-arg" \
  "apps/api/Dockerfile:4: turbo@\${TURBO_VERSION} is a root package.json dependency"

make_repo "$tmp_dir/pinned-root-dep" apps/api/Dockerfile 'FROM node:26
RUN npm install -g turbo@2.11.10'
expect "root dependency installed globally even when pinned" fail \
  "$tmp_dir/pinned-root-dep" "apps/api/Dockerfile:2: turbo@2.11.10 is a root package.json dependency"

make_repo "$tmp_dir/floating" Dockerfile.tool 'FROM node:26
RUN apk add git && \
    npm install -g corepack@0 && corepack enable'
expect "floating major version, across a line continuation" fail \
  "$tmp_dir/floating" "Dockerfile.tool:2: corepack@0 does not pin an exact version"

make_repo "$tmp_dir/no-default" apps/me/Dockerfile 'FROM node:26
ARG COREPACK_VERSION
RUN pnpm add -g corepack@${COREPACK_VERSION}'
expect "ARG with no default" fail "$tmp_dir/no-default" \
  "apps/me/Dockerfile:3: corepack@\${COREPACK_VERSION} does not pin an exact version"

make_repo "$tmp_dir/bare" preview.Dockerfile 'FROM node:26
RUN npm install --global corepack'
expect "bare package name" fail "$tmp_dir/bare" "preview.Dockerfile:2: corepack does not pin"

make_repo "$tmp_dir/dlx" apps/map/Dockerfile 'FROM node:26
RUN pnpm dlx turbo prune f3-map --docker'
expect "pnpm dlx of a root dependency" fail "$tmp_dir/dlx" \
  "apps/map/Dockerfile:2: turbo is a root package.json dependency"

make_repo "$tmp_dir/npx" apps/map/Dockerfile 'FROM node:26
RUN npx cowsay@latest hi'
expect "npx with a dist-tag" fail "$tmp_dir/npx" "cowsay@latest does not pin"

make_repo "$tmp_dir/floating-arg-nonroot" apps/me/Dockerfile 'ARG COREPACK_VERSION=0
FROM node:26
ARG COREPACK_VERSION
RUN npm install -g corepack@${COREPACK_VERSION}'
expect "global install from a floating ARG default" fail "$tmp_dir/floating-arg-nonroot" \
  "apps/me/Dockerfile:4: corepack@\${COREPACK_VERSION} does not pin an exact version"

make_repo "$tmp_dir/multi" apps/api/Dockerfile 'FROM node:26
RUN npm install -g corepack@0.36.0 semver@7'
expect "second package in one global install" fail "$tmp_dir/multi" \
  "apps/api/Dockerfile:2: semver@7 does not pin an exact version"

make_repo "$tmp_dir/yarn" apps/api/Dockerfile 'FROM node:26
RUN yarn global add corepack@0'
expect "yarn global add of a floating version" fail "$tmp_dir/yarn" \
  "apps/api/Dockerfile:2: corepack@0 does not pin an exact version"

make_repo "$tmp_dir/comment-in-run" apps/api/Dockerfile 'FROM node:26
RUN apk add git && \
    # corepack ships pnpm
    npm install -g corepack@0'
expect "comment line inside a RUN continuation" fail "$tmp_dir/comment-in-run" \
  "apps/api/Dockerfile:2: corepack@0 does not pin an exact version"

make_repo "$tmp_dir/arg-not-redeclared" apps/admin/Dockerfile 'ARG COREPACK_VERSION=0.36.0
FROM node:26
RUN npm install -g corepack@${COREPACK_VERSION}'
expect "global ARG used in a stage without redeclaring it" fail "$tmp_dir/arg-not-redeclared" \
  "apps/admin/Dockerfile:3: corepack@\${COREPACK_VERSION} does not pin an exact version"

make_repo "$tmp_dir/location-global" apps/api/Dockerfile 'FROM node:26
RUN npm install --location=global corepack@0'
expect "npm --location=global" fail "$tmp_dir/location-global" \
  "apps/api/Dockerfile:2: corepack@0 does not pin an exact version"

make_repo "$tmp_dir/flag-first" apps/api/Dockerfile 'FROM node:26
RUN npm -g install corepack@0'
expect "global flag before the subcommand" fail "$tmp_dir/flag-first" \
  "apps/api/Dockerfile:2: corepack@0 does not pin an exact version"

make_repo "$tmp_dir/npm-exec" apps/api/Dockerfile 'FROM node:26
RUN npm exec cowsay@1 -- hi'
expect "npm exec of a floating version" fail "$tmp_dir/npm-exec" \
  "apps/api/Dockerfile:2: cowsay@1 does not pin an exact version"

make_repo "$tmp_dir/lowercase" apps/api/Dockerfile 'from node:26
run npm i -g corepack@0'
expect "lowercase instruction keywords" fail "$tmp_dir/lowercase" \
  "apps/api/Dockerfile:2: corepack@0 does not pin an exact version"

make_repo "$tmp_dir/quoted-hash" apps/api/Dockerfile 'FROM node:26
RUN echo "a #b" && npm i -g corepack@0'
expect "quoted # before a global install" fail "$tmp_dir/quoted-hash" \
  "apps/api/Dockerfile:2: corepack@0 does not pin an exact version"

if [[ "$failures" -gt 0 ]]; then
  echo "${failures} check-dockerfile-global-installs test(s) failed"
  exit 1
fi
echo "All check-dockerfile-global-installs tests passed"
