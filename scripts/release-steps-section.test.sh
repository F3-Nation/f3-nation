#!/usr/bin/env bash
# Regression tests for release-steps-section.sh.
# Run directly: bash scripts/release-steps-section.test.sh
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
section="${script_dir}/release-steps-section.sh"
failures=0

assert_eq() {
  local description="$1" expected="$2" actual="$3"
  if [ "$expected" != "$actual" ]; then
    echo "FAIL: ${description}"
    echo "  expected: ${expected}"
    echo "  actual:   ${actual}"
    failures=$((failures + 1))
  else
    echo "PASS: ${description}"
  fi
}

# Runs the script on $1, setting $out and $status.
run_section() {
  out="$(printf '%s' "$1" | bash "$section")"
  status=$?
}

template_top='<!--
### 🚧 This PR is Part of a Series
-->

### 👋 TL;DR

Moves the state store.

'

run_section "${template_top}### 🚀 Release steps

<!--
Write None, or list the steps.
-->

1. Create the bucket.
2. Approve the API deploy before the Slackbot.

### ✅ How to Test

Click things.
"
assert_eq "steps are printed without comments or the next section" "0" "$status"
assert_eq "the printed steps" $'1. Create the bucket.\n2. Approve the API deploy before the Slackbot.' "$out"

run_section "${template_top}### 🚀 Release steps

<!--
Write None, or list the steps.
-->

### ✅ How to Test
"
assert_eq "a heading with only its template comment is empty" "5" "$status"

run_section "${template_top}### 🚀 Release steps
"
assert_eq "a heading at the end of the body with nothing under it is empty" "5" "$status"

run_section "${template_top}### ✅ How to Test
"
assert_eq "no heading is missing" "4" "$status"

run_section "<!--
### Release steps
None
-->
### TL;DR
"
assert_eq "a heading inside a comment doesn't count" "4" "$status"

run_section ""
assert_eq "an empty body is missing" "4" "$status"

for none in "None" "none." "  NONE  "; do
  run_section "### Release steps

${none}

### Checklist
"
  assert_eq "\"${none}\" is none" "3" "$status"
done

run_section "### Release steps

None, but run the backfill after the API deploy.
"
assert_eq "None with anything after it is a step" "0" "$status"

run_section "### Release steps

None

Run the backfill.
"
assert_eq "None followed by a step is a step" "0" "$status"

run_section $'### 🚀 Release steps\r\n\r\nNone\r\n\r\n### ✅ How to Test\r\n'
assert_eq "a body with Windows line endings is read" "3" "$status"

for heading in "## Release steps" "#### release Steps:" "### **Release steps**" "### Release steps ###"; do
  run_section "${heading}

Run it.
"
  assert_eq "heading \"${heading}\" is found" "0" "$status"
done

for heading in "#Release steps" "### Release steps and notes" "### Release"; do
  run_section "${heading}

Run it.
"
  assert_eq "\"${heading}\" isn't the heading" "4" "$status"
done

run_section '### Release steps

On Production, after the API deploy:

```bash
# Backfill the new column
### not a heading
psql "$DB" -c "<!-- kept -->"
```

#### Staging

Nothing extra.

## Checklist

- [ ] done
'
assert_eq "a code block and a lower-level heading stay in the section" "0" "$status"
assert_eq "the section stops at a higher-level heading, keeping code verbatim" \
  'On Production, after the API deploy:

```bash
# Backfill the new column
### not a heading
psql "$DB" -c "<!-- kept -->"
```

#### Staging

Nothing extra.' "$out"

run_section '### Release steps

Step one. <!-- an aside --> Step two.
<!-- a note
over lines --> Step three.
'
assert_eq "comments are cut out of a line and across lines" $'Step one.  Step two.\n Step three.' "$out"

run_section 'This PR contains the following updates:

| Package | Change |
|---|---|
| next | 15.1 → 15.2 |

### 🚀 Release steps

None

---

> [!WARNING]
> Some dependencies could not be looked up.

---

### Release Notes
'
assert_eq "a Renovate body: the section ends at the thematic break" "3" "$status"

run_section '### Release steps

1. Run the backfill.
- - -
2. Not part of it.
'
assert_eq "a spaced thematic break ends the section" "1. Run the backfill." "$out"

run_section '### Release steps

- Run the backfill.
- Then restart the job.
'
assert_eq "a list isn't a thematic break" $'- Run the backfill.\n- Then restart the job.' "$out"

run_section '### Release steps

Run the backfill.

### Release steps

None
'
assert_eq "the first Release steps section is the one read" "0" "$status"

run_section '### Release steps

````markdown
```bash
# Run the backfill
### not a heading
```
````

Then restart the job.

### Next
'
assert_eq "a shorter fence inside a longer one doesn't close it" "0" "$status"
assert_eq "steps after a nested fence example are kept" 'Then restart the job.' "$(printf '%s\n' "$out" | tail -n 1)"

run_section '### Release steps

````
``
### not a heading
````

Then restart the job.
'
assert_eq "a fence shorter than the opening one doesn't close it" 'Then restart the job.' "$(printf '%s\n' "$out" | tail -n 1)"

run_section '### Release steps

```
```text
### not a heading
```

Then restart the job.
'
assert_eq "a fence with text after it doesn't close the block" 'Then restart the job.' "$(printf '%s\n' "$out" | tail -n 1)"

run_section '### Release steps

~~~sh
# Backfill
### not a heading
~~~

Then restart the job.
'
assert_eq "a tilde fence keeps its lines in the section" "0" "$status"
assert_eq "a tilde block stays intact" $'~~~sh\n# Backfill\n### not a heading\n~~~\n\nThen restart the job.' "$out"

run_section '### 👋 TL;DR

```markdown
### Release steps

None
```
'
assert_eq "a heading inside a fenced block isn't the section" "4" "$status"

run_section '### 👋 TL;DR

```pnpm ci:local``` passes.

### 🚀 Release steps

None
'
assert_eq "a line-leading inline code span above the section isn't a fence" "3" "$status"

run_section '### 🚀 Release steps

```pnpm db:migrate:prod``` after the API deploy.

### ✅ How to Test

Click things.
'
assert_eq "a line-leading inline code span inside the section isn't a fence" '```pnpm db:migrate:prod``` after the API deploy.' "$out"

run_section '### 👋 TL;DR

Strips `<!--` comments.

### 🚀 Release steps

<!--
Write None, or list the steps.
-->

None
'
assert_eq "a literal <!-- in inline code doesn't start a comment" "3" "$status"

run_section '### Release steps

Run `a <!-- b` then <!-- hidden --> go.
'
assert_eq "comments around inline code are still cut out" 'Run `a <!-- b` then  go.' "$out"

if [ "$failures" -ne 0 ]; then
  echo "${failures} release-steps-section test(s) failed"
  exit 1
fi
echo "All release-steps-section tests passed"
