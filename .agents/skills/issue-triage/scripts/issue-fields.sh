#!/usr/bin/env bash
# Read and set an issue's Type and its organization issue fields (Priority,
# Effort, App) by name. The field options and issue types are fetched from
# GitHub on every run, so a renamed or added option needs no change here.
#
#   issue-fields.sh options
#   issue-fields.sh get <number>...
#   issue-fields.sh untriaged
#   issue-fields.sh set <number> [--type T] [--priority P] [--effort E] [--app "A,B"]
#   issue-fields.sh apply <file.tsv>
#
# `get` and `untriaged` print one JSON object per issue. `apply` reads rows of
# number<TAB>type<TAB>priority<TAB>effort<TAB>app (app comma-separated; an
# empty cell leaves that field unchanged; lines starting with # are skipped;
# further columns are ignored). It checks every row's names and looks up every
# issue before writing any; a write that fails after that leaves earlier rows set.
#
# Targets GH_REPO (owner/name) when set, else the current checkout's repo.
set -euo pipefail

TRIAGE_FIELDS='["Priority","Effort","App"]'
BODY_LIMIT=4000

die() {
  printf 'issue-fields: %s\n' "$*" >&2
  exit 1
}

usage() {
  sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

repo_slug() {
  if [ -n "${GH_REPO:-}" ]; then
    printf '%s\n' "$GH_REPO"
  else
    gh repo view --json nameWithOwner --jq .nameWithOwner
  fi
}

SLUG=""
OWNER=""
NAME=""
init_repo() {
  SLUG=$(repo_slug)
  case "$SLUG" in
    */*) ;;
    *) die "GH_REPO must be owner/name, got '$SLUG'" ;;
  esac
  OWNER=${SLUG%%/*}
  NAME=${SLUG#*/}
}

# Runs a GraphQL request whose body ({query, variables}) is on stdin. gh exits
# non-zero on an `errors` entry; the body still names each error. A response
# without `data` (empty or not JSON) also fails.
graphql() {
  local out status=0
  out=$(gh api graphql --input -) || status=$?
  if printf '%s' "$out" | jq -e '(.errors // []) | length > 0' >/dev/null 2>&1; then
    die "GraphQL error: $(printf '%s' "$out" | jq -r '[.errors[].message] | join("; ")')"
  fi
  [ "$status" -eq 0 ] || die "GraphQL request failed (gh exit $status)"
  printf '%s' "$out" | jq -e '.data != null' >/dev/null 2>&1 || die "GraphQL response has no data"
  printf '%s\n' "$out"
}

CATALOG=""
load_catalog() {
  [ -n "$CATALOG" ] && return 0
  CATALOG=$(jq -n --arg o "$OWNER" '{
    query: "query($o:String!){ organization(login:$o){ issueFields(first:50){ nodes{ __typename ... on IssueFieldSingleSelect{ id name options{ id name } } ... on IssueFieldMultiSelect{ id name options{ id name } } } } issueTypes(first:50){ nodes{ id name isEnabled } } } }",
    variables: { o: $o }
  }' | graphql | jq -c --argjson want "$TRIAGE_FIELDS" '.data.organization | {
    types: [.issueTypes.nodes[] | select(.isEnabled) | {id, name}],
    fields: [.issueFields.nodes[] | select(.name as $n | $want | index($n)) | {id, name, multi: (.__typename == "IssueFieldMultiSelect"), options}]
  }')
  local missing
  missing=$(printf '%s' "$CATALOG" | jq -r --argjson want "$TRIAGE_FIELDS" '[$want[] as $w | select([.fields[].name] | index($w) | not) | $w] | join(", ")')
  [ -z "$missing" ] || die "organization $OWNER has no issue field named: $missing"
}

# Projects an issue node into the flat shape `get` and `untriaged` print.
ISSUE_SELECTION='number title url author{ login } labels(first:20){ nodes{ name } } parent{ number title } subIssuesSummary{ total } body issueType{ name } issueFieldValues(first:20){ nodes{ ... on IssueFieldSingleSelectValue{ name field{ ... on IssueFieldSingleSelect{ name } } } ... on IssueFieldMultiSelectValue{ options{ name } field{ ... on IssueFieldMultiSelect{ name } } } } }'
# shellcheck disable=SC2016 # jq program, expanded by jq not the shell
ISSUE_PROJECTION='{
  number, title, url,
  author: (.author.login // null),
  labels: [.labels.nodes[].name],
  parent: .parent,
  sub_issues: .subIssuesSummary.total,
  type: (.issueType.name // null),
  priority: ([.issueFieldValues.nodes[] | select(.field.name == "Priority") | .name][0] // null),
  effort: ([.issueFieldValues.nodes[] | select(.field.name == "Effort") | .name][0] // null),
  app: [.issueFieldValues.nodes[] | select(.field.name == "App") | .options[].name],
  body: ((.body // "") | if length > $limit then .[:$limit] + "\n[truncated]" else . end)
}'

cmd_options() {
  load_catalog
  printf '%s' "$CATALOG" | jq -r '
    "Type: " + ([.types[].name] | join(", ")),
    (.fields[] | "\(.name)\(if .multi then " (multiple)" else "" end): " + ([.options[].name] | join(", ")))'
}

cmd_get() {
  [ $# -gt 0 ] || usage
  local n
  for n in "$@"; do
    case "$n" in
      '' | *[!0-9]*) die "not an issue number: '$n'" ;;
    esac
    jq -n --arg o "$OWNER" --arg r "$NAME" --argjson n "$n" --arg sel "$ISSUE_SELECTION" '{
      query: ("query($o:String!,$r:String!,$n:Int!){ repository(owner:$o,name:$r){ issue(number:$n){ " + $sel + " } } }"),
      variables: { o: $o, r: $r, n: $n }
    }' | graphql | jq -c --argjson limit "$BODY_LIMIT" ".data.repository.issue | if . == null then error(\"issue $n not found\") else $ISSUE_PROJECTION end"
  done
}

cmd_untriaged() {
  local cursor="" page
  while :; do
    page=$(jq -n --arg o "$OWNER" --arg r "$NAME" --arg c "$cursor" --arg sel "$ISSUE_SELECTION" '{
      query: ("query($o:String!,$r:String!,$c:String){ repository(owner:$o,name:$r){ issues(first:50,after:$c,states:OPEN,orderBy:{field:CREATED_AT,direction:ASC}){ pageInfo{ hasNextPage endCursor } nodes{ " + $sel + " } } } }"),
      variables: { o: $o, r: $r, c: (if $c == "" then null else $c end) }
    }' | graphql)
    printf '%s' "$page" | jq -c --argjson limit "$BODY_LIMIT" ".data.repository.issues.nodes[] | $ISSUE_PROJECTION | select(.type == null or .priority == null or .effort == null or (.app | length) == 0)"
    [ "$(printf '%s' "$page" | jq -r '.data.repository.issues.pageInfo.hasNextPage')" = true ] || break
    cursor=$(printf '%s' "$page" | jq -r '.data.repository.issues.pageInfo.endCursor')
  done
}

# Resolves one row of names to IDs. Prints {number, typeId, fields}, or prints
# the first unknown name in the row with its valid choices and returns non-zero.
resolve_row() {
  local number=$1 type=$2 priority=$3 effort=$4 app=$5
  case "$number" in
    '' | *[!0-9]*)
      printf "issue %s: not an issue number\n" "'$number'"
      return 1
      ;;
  esac
  printf '%s' "$CATALOG" | jq -c \
    --argjson n "$number" --arg type "$type" --arg priority "$priority" --arg effort "$effort" --arg app "$app" '
    def norm: ascii_downcase | gsub("^\\s+|\\s+$"; "");
    def pick($list; $want; $label):
      ($list | map(select((.name | norm) == ($want | norm))) | .[0])
      // error("issue \($n): unknown \($label) \"\($want)\"; choose one of: \($list | map(.name) | join(", "))");
    def field($name): .fields[] | select(.name == $name);
    . as $cat
    | {
        number: $n,
        typeId: (if $type == "" then null else pick($cat.types; $type; "Type").id end),
        fields: ([
          (if $priority == "" then empty else
            ($cat | field("Priority")) as $f | {fieldId: $f.id, singleSelectOptionId: pick($f.options; $priority; "Priority").id} end),
          (if $effort == "" then empty else
            ($cat | field("Effort")) as $f | {fieldId: $f.id, singleSelectOptionId: pick($f.options; $effort; "Effort").id} end),
          (($app | split(",") | map(select(norm != ""))) as $names
            | if ($names | length) == 0 then empty else
              ($cat | field("App")) as $f
              | {fieldId: $f.id, multiSelectOptionIds: [$names[] | pick($f.options; .; "App").id] | unique} end)
        ])
      }
    | if .typeId == null and (.fields | length) == 0 then error("issue \($n): nothing to set") else . end
  ' 2>&1 | sed 's/^jq: error ([^)]*): //'
}

# Prints the issue's node ID. A failed request exits with graphql's reason;
# "not found" is only for a request that succeeded and returned no issue.
issue_node_id() {
  local out
  out=$(jq -n --arg o "$OWNER" --arg r "$NAME" --argjson n "$1" '{
    query: "query($o:String!,$r:String!,$n:Int!){ repository(owner:$o,name:$r){ issue(number:$n){ id } } }",
    variables: { o: $o, r: $r, n: $n }
  }' | graphql) || exit 1
  printf '%s' "$out" | jq -er '.data.repository.issue.id' || die "issue $1 not found in $SLUG"
}

# Adds the issue's node ID to a resolved row, or fails without writing.
with_issue_id() {
  local row=$1 id
  id=$(issue_node_id "$(printf '%s' "$row" | jq -r .number)") || return 1
  printf '%s' "$row" | jq -c --arg id "$id" '. + {id: $id}'
}

write_row() {
  local row=$1 number id type_id fields
  number=$(printf '%s' "$row" | jq -r .number)
  id=$(printf '%s' "$row" | jq -r .id)
  type_id=$(printf '%s' "$row" | jq -r '.typeId // ""')
  fields=$(printf '%s' "$row" | jq -c .fields)
  printf 'setting #%s\n' "$number" >&2
  if [ -n "$type_id" ]; then
    jq -n --arg i "$id" --arg t "$type_id" '{
      query: "mutation($i:ID!,$t:ID!){ updateIssueIssueType(input:{issueId:$i, issueTypeId:$t}){ issue{ number } } }",
      variables: { i: $i, t: $t }
    }' | graphql >/dev/null
  fi
  if [ "$fields" != "[]" ]; then
    jq -n --arg i "$id" --argjson f "$fields" '{
      query: "mutation($i:ID!,$f:[IssueFieldCreateOrUpdateInput!]!){ setIssueFieldValue(input:{issueId:$i, issueFields:$f}){ issue{ number } } }",
      variables: { i: $i, f: $f }
    }' | graphql >/dev/null
  fi
  printf 'set #%s\n' "$number"
}

cmd_set() {
  [ $# -ge 1 ] || usage
  local number=$1 type="" priority="" effort="" app=""
  shift
  while [ $# -gt 0 ]; do
    [ $# -ge 2 ] || die "$1 needs a value"
    case "$1" in
      --type) type=$2 ;;
      --priority) priority=$2 ;;
      --effort) effort=$2 ;;
      --app) app=$2 ;;
      *) die "unknown option: $1" ;;
    esac
    shift 2
  done
  load_catalog
  local row
  row=$(resolve_row "$number" "$type" "$priority" "$effort" "$app") || die "$row"
  row=$(with_issue_id "$row") || exit 1
  write_row "$row"
}

cmd_apply() {
  [ $# -eq 1 ] || usage
  local file=$1
  [ -f "$file" ] || die "no such file: $file"
  load_catalog
  local rows="" errors="" line number type priority effort app row lineno=0
  while IFS= read -r line || [ -n "$line" ]; do
    lineno=$((lineno + 1))
    case "$line" in '' | '#'*) continue ;; esac
    # cut keeps empty cells; `read` with a tab IFS would merge adjacent tabs.
    number=$(printf '%s\n' "$line" | cut -f1)
    type=$(printf '%s\n' "$line" | cut -sf2)
    priority=$(printf '%s\n' "$line" | cut -sf3)
    effort=$(printf '%s\n' "$line" | cut -sf4)
    app=$(printf '%s\n' "$line" | cut -sf5)
    if row=$(resolve_row "$number" "${type:-}" "${priority:-}" "${effort:-}" "${app:-}"); then
      rows="$rows$row"$'\n'
    else
      errors="${errors}line $lineno: $row"$'\n'
    fi
  done <"$file"
  [ -z "$errors" ] || die $'nothing written; fix these rows first:\n'"$errors"
  [ -n "$rows" ] || die "no rows in $file"
  # Look up every issue before writing any, so a missing one writes nothing.
  local targets=""
  while IFS= read -r row; do
    row=$(with_issue_id "$row") || die "nothing written"
    targets="$targets$row"$'\n'
  done <<<"${rows%$'\n'}"
  printf '%s' "$targets" | while IFS= read -r row; do
    write_row "$row"
  done
}

main() {
  [ $# -ge 1 ] || usage
  command -v gh >/dev/null || die "gh is required"
  command -v jq >/dev/null || die "jq is required"
  local cmd=$1
  shift
  case "$cmd" in
    options | get | untriaged | set | apply) ;;
    -h | --help | help) usage ;;
    *) die "unknown command: $cmd" ;;
  esac
  init_repo
  "cmd_$cmd" "$@"
}

main "$@"
