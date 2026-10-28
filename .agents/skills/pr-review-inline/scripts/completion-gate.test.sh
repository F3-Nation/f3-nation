#!/usr/bin/env bash
set -euo pipefail

skill_dir="$(cd "$(dirname "$0")/.." && pwd)"
fixture_dir="$(mktemp -d)"
trap 'rm -rf "$fixture_dir"' EXIT
review_sha=1111111111111111111111111111111111111111
passed=0

cat > "$fixture_dir/complete.json" <<'JSON'
{
  "schema": 1,
  "head_sha": "1111111111111111111111111111111111111111",
  "reconciliation_complete": true,
  "findings_verified": true,
  "required_reviewers": ["host", "coordinator", "code-reviewer"],
  "reviewers": [
    {"id":"host","status":"completed","reviewed_sha":"1111111111111111111111111111111111111111","report_path":"host.md","result_ref":"host-final","evidence_verified":true},
    {"id":"coordinator","status":"completed","reviewed_sha":"1111111111111111111111111111111111111111","report_path":"coordinator.md","result_ref":"coordinator-final","evidence_verified":true},
    {"id":"code-reviewer","status":"completed","reviewed_sha":"1111111111111111111111111111111111111111","report_path":"code.md","result_ref":"agent-final","evidence_verified":true}
  ]
}
JSON

check_case() {
  case_name="$1"
  expected="$2"
  transform="$3"
  jq "$transform" "$fixture_dir/complete.json" > "$fixture_dir/case.json"
  actual=fail
  if jq -e --arg sha "$review_sha" -f "$skill_dir/completion-gate.jq" "$fixture_dir/case.json" >/dev/null 2>&1; then
    actual=pass
  fi
  if [ "$actual" != "$expected" ]; then
    printf 'FAIL: %s expected %s, got %s\n' "$case_name" "$expected" "$actual" >&2
    exit 1
  fi
  passed=$((passed + 1))
}

check_case "completed zero-finding review" pass '.'
check_case "launch without specialist completion" fail '.reviewers[2].status = "running"'
check_case "missing required specialist" fail '.reviewers |= map(select(.id != "code-reviewer"))'
check_case "cancelled coordinator with completed specialists" fail '.reviewers[1].status = "cancelled"'
check_case "specialist examined another revision" fail '.reviewers[2].reviewed_sha = "other"'
check_case "manifest examined another revision" fail '.head_sha = "other"'
check_case "missing report reference" fail '.reviewers[2].report_path = ""'
check_case "missing final result reference" fail '.reviewers[2].result_ref = ""'
check_case "unverified completion evidence" fail '.reviewers[2].evidence_verified = false'
check_case "reconciliation not finished" fail '.reconciliation_complete = false'
check_case "findings not verified" fail '.findings_verified = false'
check_case "empty required set" fail '.required_reviewers = []'
check_case "duplicate required reviewer" fail '.required_reviewers += ["host"]'
check_case "duplicate final result" fail '.reviewers += [.reviewers[2]]'
check_case "standard host-only review" pass '.required_reviewers = ["host"] | .reviewers = [.reviewers[0]]'
check_case "absent named Claude reviewer" fail '.required_reviewers += ["claude"]'

repo_root="$(cd "$skill_dir/../../.." && pwd)"
mkdir -p "$fixture_dir/bin"
for tool in turbo pnpm node; do
  cat > "$fixture_dir/bin/$tool" <<'SH'
#!/bin/sh
exit 0
SH
  chmod +x "$fixture_dir/bin/$tool"
done
cat > "$fixture_dir/bin/bash" <<'SH'
#!/bin/sh
case "$1" in
  .agents/skills/pr-review-inline/scripts/completion-gate.test.sh)
    exit "${COMPLETION_GATE_TEST_EXIT:-0}"
    ;;
  *) exit 0 ;;
esac
SH
chmod +x "$fixture_dir/bin/bash"
for expected_status in 9 0; do
  actual_status=0
  (cd "$repo_root" && PATH="$fixture_dir/bin:$PATH" COMPLETION_GATE_TEST_EXIT="$expected_status" \
    /bin/bash scripts/lint.sh) > "$fixture_dir/lint.log" 2>&1 || actual_status=$?
  if [ "$actual_status" -ne "$expected_status" ]; then
    cat "$fixture_dir/lint.log" >&2
    printf 'FAIL: lint expected completion-gate status %s, got %s\n' "$expected_status" "$actual_status" >&2
    exit 1
  fi
  passed=$((passed + 1))
done
printf 'completion gate: %s cases passed\n' "$passed"
