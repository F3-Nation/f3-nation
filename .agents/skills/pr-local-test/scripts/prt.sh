#!/usr/bin/env bash
# pr-local-test sandbox helper: one disposable worktree, port block, Docker
# project and database per run, built with the repo's own `pnpm local:setup`.
# Bash 3.2 compatible (macOS default).
# shellcheck disable=SC2016 # jq programs are single-quoted on purpose
#
#   bash prt.sh init <pr> [--keep]          create the sandbox (from inside the repo)
#   bash prt.sh setup <run-dir> [--at-base] install, local:setup (Docker, .env, migrate, seed)
#   bash prt.sh serve <run-dir> <app> [dev|start] [--restart]
#   bash prt.sh stop <run-dir> <app>
#   bash prt.sh exec <run-dir> -- <cmd...>  run a command in the worktree with the run's env
#   bash prt.sh psql <run-dir> [psql args]  psql into this run's database (stdin ok)
#   bash prt.sh info <run-dir>              ports, URLs, server status
#   bash prt.sh update <run-dir>            pull the PR's newest commits (keep-running)
#   bash prt.sh down-db <run-dir>           delete this run's containers + data (then setup)
#   bash prt.sh down <run-dir> [--keep-drafts]
#   bash prt.sh list                        every run on this machine, with liveness
set -euo pipefail

ROOT=/tmp/pr-local-test
SLOTS="$ROOT/slots"
APPS="map api admin me auth homepage"
# repo variable (scripts/lib/local-ports.sh) : state key : offset in the run's port block
PORTMAP="F3_MAP_PORT:map:0 F3_API_PORT:api:1 F3_ADMIN_PORT:admin:2 F3_ME_PORT:me:3 F3_AUTH_PORT:auth:4 F3_HOMEPAGE_PORT:homepage:5 F3_POSTGRES_PORT:postgres:10 F3_MAILPIT_SMTP_PORT:smtp:11 F3_MAILPIT_UI_PORT:mailpit:12 F3_GCS_PORT:gcs:13 F3_ADMINER_PORT:adminer:14"
RUN_DIR_RE='^/tmp/pr-local-test/pr[0-9]+-[0-9a-f]{4}$'

die() { echo "ERROR: $*" >&2; exit 1; }
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

listening() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  else
    ss -ltn 2>/dev/null | grep -qE "[:.]$1[[:space:]]"
  fi
}

st() { jq -r "$1" "$RUN_DIR/state.json"; }

st_set() {
  local tmp
  tmp=$(mktemp "$RUN_DIR/.state.XXXXXX")
  jq "$@" "$RUN_DIR/state.json" | jq --arg t "$(now)" '.updated_at = $t' >"$tmp"
  mv "$tmp" "$RUN_DIR/state.json"
}

# Loads a run: its paths, its Node, and its ports (the worktree's root .env,
# which Compose, local:setup and the apps' dev scripts all read).
load() {
  RUN_DIR="${1:-}"
  RUN_DIR="${RUN_DIR%/}"
  [[ "$RUN_DIR" =~ $RUN_DIR_RE ]] || die "not a run dir: '$RUN_DIR'"
  [ -f "$RUN_DIR/state.json" ] || die "no state.json in $RUN_DIR"
  WT=$(st .wt)
  MAIN=$(st .main)
  PROJECT=$(st .compose_project)
  PATH="$(st .path_prefix):$PATH"
  set -a
  # shellcheck disable=SC1091
  . "$WT/.env"
  set +a
  st_set '.'
}

port() { st ".ports.$1"; }

pg_container() { docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=postgres" | head -1; }

group_alive() { kill -0 -- "-$1" 2>/dev/null; }

# --------------------------------------------------------------------------- init
cmd_init() {
  local pr="${1:-}" keep=false a
  [[ "$pr" =~ ^[0-9]+$ ]] || die "usage: init <pr-number> [--keep]"
  shift
  for a in "$@"; do case "$a" in --keep) keep=true ;; *) die "unknown flag $a" ;; esac; done

  MAIN=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || die "run init from inside the repo"
  MAIN=$(dirname "$MAIN")
  local run_id ref
  run_id="pr$pr-$(openssl rand -hex 2)"
  ref="refs/pr-local-test/$run_id"

  local info base_ref head_oid
  info=$(cd "$MAIN" && gh pr view "$pr" --json state,headRefOid,baseRefName,isCrossRepository,url) || die "gh can't read PR #$pr"
  base_ref=$(jq -r .baseRefName <<<"$info")
  head_oid=$(jq -r .headRefOid <<<"$info")

  git -C "$MAIN" fetch -q origin "+refs/pull/$pr/head:$ref" "+refs/heads/$base_ref:$ref-base" \
    || git -C "$MAIN" fetch -q origin "+refs/pull/$pr/head:$ref" "+refs/heads/$base_ref:$ref-base" \
    || die "fetch of PR #$pr failed"
  cleanup_refs() { git -C "$MAIN" update-ref -d "$ref" 2>/dev/null || true; git -C "$MAIN" update-ref -d "$ref-base" 2>/dev/null || true; }
  local pr_sha base_sha merge_base head_note=""
  pr_sha=$(git -C "$MAIN" rev-parse "$ref")
  base_sha=$(git -C "$MAIN" rev-parse "$ref-base")
  merge_base=$(git -C "$MAIN" merge-base "$pr_sha" "$base_sha")
  [ "$pr_sha" = "$head_oid" ] || head_note="GitHub reports head $head_oid but fetch got $pr_sha (push in flight?)"

  # The sandbox relies on per-checkout ports (local:setup --slot support).
  if ! git -C "$MAIN" cat-file -e "$pr_sha:scripts/lib/local-ports.sh" 2>/dev/null; then
    cleanup_refs
    echo "NEEDS_UPDATE_BRANCH=1"
    exit 5
  fi

  # Node: exact version from the PR's Dockerfiles, else its .nvmrc.
  local versions node_v node_note=""
  versions=$(git -C "$MAIN" grep -h '^FROM node:' "$pr_sha" -- 'apps/*/Dockerfile' 2>/dev/null \
    | sed -E 's/^FROM node:([^ ]+).*/\1/' | sed -E 's/^([0-9]+\.[0-9]+\.[0-9]+).*/\1/' | sort -u || true)
  if [ "$(printf '%s\n' "$versions" | grep -c .)" = 1 ] && [[ "$versions" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    node_v=$versions
  else
    node_v=$(git -C "$MAIN" show "$pr_sha:.nvmrc" 2>/dev/null | tr -d 'v[:space:]')
    node_note="Dockerfiles give '$(printf '%s' "$versions" | tr '\n' ' ')'; used .nvmrc ($node_v)"
  fi
  [[ "$node_v" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { cleanup_refs; echo "NODE_UNKNOWN=$versions"; exit 3; }

  local node_bin="" d
  if command -v node >/dev/null 2>&1 && [ "$(node --version)" = "v$node_v" ]; then
    node_bin=$(dirname "$(command -v node)")
  else
    for d in "${NVM_DIR:-$HOME/.nvm}/versions/node/v$node_v/bin" \
      "$HOME/.local/share/fnm/node-versions/v$node_v/installation/bin" \
      "$HOME/Library/Application Support/fnm/node-versions/v$node_v/installation/bin" \
      "$HOME/.volta/tools/image/node/$node_v/bin" \
      "$HOME/.local/share/mise/installs/node/$node_v/bin" \
      "$HOME/.asdf/installs/nodejs/$node_v/bin"; do
      if [ -x "$d/node" ]; then node_bin=$d; break; fi
    done
  fi
  [ -n "$node_bin" ] || { cleanup_refs; echo "NODE_MISSING=$node_v"; echo "NODE_ON_PATH=$(command -v node || echo none)"; exit 3; }

  local pnpm_dir=""
  if [ -x "$node_bin/pnpm" ]; then pnpm_dir=$node_bin
  elif command -v pnpm >/dev/null 2>&1; then pnpm_dir=$(dirname "$(command -v pnpm)")
  else
    for d in "${NVM_DIR:-$HOME/.nvm}"/versions/node/*/bin; do
      if [ -x "$d/pnpm" ]; then pnpm_dir=$d; break; fi
    done
  fi
  [ -n "$pnpm_dir" ] || { cleanup_refs; echo "PNPM_MISSING=1"; exit 3; }

  # Port block: slot k owns 41000+20k .. +19. mkdir is the atomic claim.
  mkdir -p "$SLOTS"
  local k=0 slot="" base e ok
  while [ $k -lt 20 ]; do
    if mkdir "$SLOTS/$k" 2>/dev/null; then
      base=$((41000 + k * 20)); ok=1
      for e in $PORTMAP; do
        if listening $((base + ${e##*:})); then ok=0; break; fi
      done
      if [ $ok = 1 ]; then echo "$run_id" >"$SLOTS/$k/run"; slot=$k; break; fi
      rmdir "$SLOTS/$k"
    fi
    k=$((k + 1))
  done
  [ -n "$slot" ] || { cleanup_refs; die "no free port block (20 runs active, or ports 41000-41399 busy)"; }
  base=$((41000 + slot * 20))

  RUN_DIR="$ROOT/$run_id"
  mkdir -p "$RUN_DIR/logs" "$RUN_DIR/evidence" "$RUN_DIR/keys" "$RUN_DIR/jar"
  chmod 700 "$RUN_DIR/keys"
  git -C "$MAIN" worktree add -q --detach "$RUN_DIR/wt" "$pr_sha" >/dev/null 2>&1 \
    || { rm -rf "${SLOTS:?}/$slot" "$RUN_DIR"; cleanup_refs; die "git worktree add failed"; }

  # The run's ports, in the file `pnpm local:setup --slot N` would write.
  local project="prt-$run_id" ports="{}"
  {
    echo "COMPOSE_PROJECT_NAME=$project"
    echo "F3_CONTAINER_PREFIX=$project"
    for e in $PORTMAP; do echo "${e%%:*}=$((base + ${e##*:}))"; done
  } >"$RUN_DIR/wt/.env"
  for e in $PORTMAP; do
    a=${e#*:}
    ports=$(jq --arg k "${a%%:*}" --argjson v $((base + ${e##*:})) '. + {($k): $v}' <<<"$ports")
  done

  local owner_pid="${CLAUDE_PID:-$PPID}" owner_cmd active
  owner_cmd=$(ps -o command= -p "$owner_pid" 2>/dev/null | cut -c1-200 || true)
  active=$(find "$SLOTS" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')

  jq -n \
    --arg run_id "$run_id" --argjson pr "$pr" --arg main "$MAIN" --arg wt "$RUN_DIR/wt" \
    --arg url "$(jq -r .url <<<"$info")" --arg pr_state "$(jq -r .state <<<"$info")" \
    --argjson cross "$(jq .isCrossRepository <<<"$info")" \
    --arg pr_sha "$pr_sha" --arg base_ref "$base_ref" --arg base_sha "$base_sha" --arg merge_base "$merge_base" \
    --arg head_note "$head_note" --argjson slot "$slot" --argjson ports "$ports" \
    --arg project "$project" --argjson keep "$keep" --arg node_v "$node_v" --arg node_note "$node_note" \
    --arg path_prefix "$node_bin:$pnpm_dir" --arg owner_pid "$owner_pid" --arg owner_cmd "$owner_cmd" \
    --arg ref "$ref" --arg t "$(now)" \
    '{run_id:$run_id, pr:$pr, url:$url, pr_state:$pr_state, cross_repo:$cross, main:$main, wt:$wt,
      pr_sha:$pr_sha, tested_sha:$pr_sha, base_ref:$base_ref, base_sha:$base_sha, merge_base:$merge_base,
      head_note:$head_note, git_ref:$ref, slot:$slot, ports:$ports,
      compose_project:$project, keep:$keep, node_version:$node_v, node_note:$node_note,
      path_prefix:$path_prefix, owner_pid:$owner_pid, owner_cmd:$owner_cmd,
      phase:"init", servers:[], db_mode:null, created_at:$t, updated_at:$t}' \
    >"$RUN_DIR/state.json"

  echo "RUN_DIR=$RUN_DIR"
  echo "WT=$RUN_DIR/wt"
  echo "PR_SHA=$pr_sha"
  echo "BASE=$base_ref ($base_sha), MERGE_BASE=$merge_base"
  echo "PR_STATE=$(jq -r .state <<<"$info")"
  echo "NODE=$node_v ($node_bin)${node_note:+ — $node_note}"
  echo "PORT_BLOCK=$base"
  echo "ACTIVE_RUNS=$active"
  echo "KEEP=$keep"
  [ -z "$head_note" ] || echo "WARN=$head_note"
}

# --------------------------------------------------------------------------- setup
pnpm_install() {
  local sha; sha=$(git -C "$WT" rev-parse --short HEAD)
  (cd "$WT" && pnpm install --frozen-lockfile) >"$RUN_DIR/logs/install-$sha.log" 2>&1 \
    || { tail -30 "$RUN_DIR/logs/install-$sha.log"; die "pnpm install failed at $sha"; }
}

# The migrate command can exit 0 on failure, so compare applied rows with the journal.
check_migrations() {
  local label="$1" log="$2" want table have
  want=$(jq '.entries | length' "$WT/packages/db/drizzle/meta/_journal.json")
  table=$(docker exec "$(pg_container)" psql -U f3local -d f3nation -At -c \
    "select table_name from information_schema.tables where table_schema='drizzle' and table_name like '__drizzle_migrations%' order by 1 limit 1")
  have=0
  [ -z "$table" ] || have=$(docker exec "$(pg_container)" psql -U f3local -d f3nation -At -c "select count(*) from drizzle.\"$table\"")
  if [ "$have" != "$want" ]; then
    tail -25 "$log"
    die "migrations ($label): $have applied, journal has $want — see $log"
  fi
  echo "MIGRATED($label)=$have/$want"
}

local_setup() {
  local label="$1" log="$RUN_DIR/logs/local-setup-$1.log"
  (cd "$WT" && pnpm local:setup) >"$log" 2>&1 \
    || { tail -30 "$log"; die "pnpm local:setup failed ($label) — see $log"; }
  check_migrations "$label" "$log"
}

cmd_setup() {
  load "$1"; shift
  local at_base=false a
  for a in "$@"; do case "$a" in --at-base) at_base=true ;; *) die "unknown flag $a" ;; esac; done
  local pr_sha merge_base
  pr_sha=$(st .tested_sha); merge_base=$(st .merge_base)
  if $at_base; then
    # Seed at the PR's starting point, then apply its migrations on top.
    git -C "$WT" checkout -q --detach "$merge_base"
    pnpm_install; local_setup base
    git -C "$WT" checkout -q --detach "$pr_sha"
    pnpm_install
    (cd "$WT" && pnpm db:migrate:local) >"$RUN_DIR/logs/migrate-pr.log" 2>&1 || true
    check_migrations pr "$RUN_DIR/logs/migrate-pr.log"
  else
    pnpm_install; local_setup pr
  fi
  [ "$(git -C "$WT" rev-parse HEAD)" = "$pr_sha" ] || die "worktree not back on $pr_sha"

  # The examples' Maps key is a placeholder; carry the user's over (only that).
  local dir line copied=""
  for dir in apps/map apps/admin; do
    [ -f "$MAIN/$dir/.env" ] && [ -f "$WT/$dir/.env" ] || continue
    while IFS= read -r line; do
      sed -i.prtbak "/^${line%%=*}=/d" "$WT/$dir/.env" && rm -f "$WT/$dir/.env.prtbak"
      # Some examples don't end with a newline.
      [ -z "$(tail -c1 "$WT/$dir/.env")" ] || echo >>"$WT/$dir/.env"
      printf '%s\n' "$line" >>"$WT/$dir/.env"
      copied="$copied $dir:${line%%=*}"
    done < <(grep -E '^(F3_|NEXT_PUBLIC_)GOOGLE_API_KEY=' "$MAIN/$dir/.env" | grep -v 'your-google-maps-api-key-here' || true)
  done
  if [ -n "$copied" ]; then echo "MAPS_KEY=${copied# }"; else echo "MAPS_KEY=none (the Map needs one; see reference.md)"; fi

  local i=0
  until curl -sf "http://localhost:$(port mailpit)/api/v1/messages" >/dev/null 2>&1; do
    [ $i -lt 60 ] || die "Mailpit not answering on $(port mailpit)"
    sleep 2; i=$((i + 2))
  done
  st_set --arg m "$($at_base && echo at-base || echo fresh)" '.db_mode = $m | .phase = "ready"'
  echo "READY: Postgres localhost:$(port postgres), Mailpit http://localhost:$(port mailpit), project $PROJECT"
}

# --------------------------------------------------------------------------- servers
cmd_serve() {
  load "$1"
  local app="${2:-}" mode="${3:-dev}" restart=false
  [ -n "$app" ] || die "usage: serve <run-dir> <app> [dev|start] [--restart]"
  case "$mode" in dev | start) ;; --restart) mode=dev; restart=true ;; *) die "mode must be dev or start" ;; esac
  [ "${4:-}" = "--restart" ] && restart=true
  case " $APPS " in *" $app "*) ;; *) die "unknown app '$app' (one of: $APPS)" ;; esac
  local dir="$WT/apps/$app" p pkg script cmd log pgid
  p=$(port "$app")
  if [ "$(jq -r --arg a "$app" '[.servers[] | select(.app == $a)] | length' "$RUN_DIR/state.json")" != 0 ]; then
    $restart || die "$app already started; pass --restart"
    stop_app "$app"
  fi
  pkg=$(jq -r .name "$dir/package.json")
  script=$(jq -r --arg m "$mode" '.scripts[$m] // empty' "$dir/package.json")
  [ -n "$script" ] || die "$pkg has no '$mode' script"
  log="$RUN_DIR/logs/$app.log"
  if [ "$mode" = dev ]; then
    # dev scripts read F3_<APP>_PORT (and the API reads PORT) from the run's env.
    cmd="pnpm run dev"
  else
    (cd "$WT" && pnpm --filter "$pkg" build) >"$RUN_DIR/logs/$app-build.log" 2>&1 \
      || { tail -30 "$RUN_DIR/logs/$app-build.log"; die "$app build failed"; }
    # Some start scripts hard-code a port: rewrite the flag, or add one for `next start`.
    cmd=$(printf '%s' "$script" | sed -E "s/(^|[[:space:]])(-p|--port|-l)([[:space:]]+|=)[^[:space:]]+/\1\2 $p/")
    if [ "$cmd" = "$script" ] && printf '%s' "$script" | grep -q 'next '; then cmd="$script -p $p"; fi
  fi
  export PRT_CMD="$cmd"
  pgid=$(cd "$dir" && PORT=$p bash -c 'set -m; nohup pnpm exec sh -c "$PRT_CMD" >"$0" 2>&1 </dev/null & echo $!' "$log")
  st_set --arg a "$app" --argjson port "$p" --arg m "$mode" --argjson g "$pgid" --arg l "$log" --arg c "$cmd" \
    '.servers += [{app:$a, port:$port, mode:$m, pgid:$g, log:$l, command:$c}] | .phase = "testing"'
  local i=0
  until listening "$p"; do
    group_alive "$pgid" || { tail -30 "$log"; die "$app exited before listening — see $log"; }
    [ $i -lt 240 ] || { tail -30 "$log"; die "$app not listening on $p after 240s"; }
    sleep 2; i=$((i + 2))
  done
  echo "SERVING $app ($mode) at http://localhost:$p  pgid=$pgid  log=$log"
}

kill_group() {
  local g="$1" i=0
  group_alive "$g" || return 0
  kill -TERM -- "-$g" 2>/dev/null || true
  while group_alive "$g" && [ $i -lt 10 ]; do sleep 1; i=$((i + 1)); done
  group_alive "$g" && kill -KILL -- "-$g" 2>/dev/null || true
}

stop_app() {
  local app="$1" g
  for g in $(jq -r --arg a "$app" '.servers[] | select(.app == $a) | .pgid' "$RUN_DIR/state.json"); do kill_group "$g"; done
  st_set --arg a "$app" '.servers |= map(select(.app != $a))'
}

cmd_stop() { load "$1"; stop_app "${2:?app}"; echo "STOPPED ${2}"; }

# --------------------------------------------------------------------------- helpers
cmd_exec() {
  load "$1"; shift
  [ "${1:-}" = "--" ] && shift
  cd "$WT" && exec "$@"
}

cmd_psql() {
  load "$1"; shift
  local cid; cid=$(pg_container); [ -n "$cid" ] || die "Postgres isn't up; run setup"
  exec docker exec -i "$cid" psql -U f3local -d f3nation -v ON_ERROR_STOP=1 "$@"
}

cmd_info() {
  load "$1"
  jq -r '"run \(.run_id)  PR #\(.pr)  phase=\(.phase)  keep=\(.keep)  tested=\(.tested_sha[0:9])  db=\(.db_mode)",
         "worktree \(.wt)",
         (.ports | to_entries[] | "  \(.key): \(.value)")' "$RUN_DIR/state.json"
  jq -r '.servers[] | "\(.app) \(.port) \(.pgid)"' "$RUN_DIR/state.json" | while read -r a p g; do
    if group_alive "$g" && listening "$p"; then echo "  server $a http://localhost:$p up"; else echo "  server $a http://localhost:$p DOWN"; fi
  done
}

cmd_update() {
  load "$1"
  local ref old new apps a
  ref=$(st .git_ref); old=$(st .tested_sha)
  git -C "$MAIN" fetch -q origin "+refs/pull/$(st .pr)/head:$ref" || die "fetch failed"
  new=$(git -C "$MAIN" rev-parse "$ref")
  if [ "$new" = "$old" ]; then echo "NO_NEW_COMMITS ($old)"; return 0; fi
  apps=$(jq -r '[.servers[].app] | join(" ")' "$RUN_DIR/state.json")
  for a in $apps; do stop_app "$a"; done
  git -C "$WT" checkout -q --detach "$new"
  st_set --arg n "$new" '.tested_sha = $n | .pr_sha = $n'
  echo "UPDATED $old -> $new"
  git -C "$WT" diff --stat "$old" "$new" | tail -1
  pnpm_install
  if [ -n "$(git -C "$WT" diff --name-only --diff-filter=MDR "$old" "$new" -- packages/db/drizzle)" ]; then
    echo "EXISTING_MIGRATIONS_CHANGED: rebuild the database with down-db, then setup"
  elif [ -n "$(git -C "$WT" diff --name-only "$old" "$new" -- packages/db/drizzle)" ]; then
    (cd "$WT" && pnpm db:migrate:local) >"$RUN_DIR/logs/migrate-update.log" 2>&1 || true
    check_migrations update "$RUN_DIR/logs/migrate-update.log"
  fi
  echo "STOPPED_SERVERS=$apps (restart the ones you need with serve)"
}

docker_cleanup() {
  local ids
  ids=$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT")
  # shellcheck disable=SC2086 # one argument per id
  [ -z "$ids" ] || docker rm -f -v $ids >/dev/null
  ids=$(docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT")
  # shellcheck disable=SC2086 # one argument per id
  [ -z "$ids" ] || docker volume rm $ids >/dev/null
  ids=$(docker network ls -q --filter "label=com.docker.compose.project=$PROJECT")
  # shellcheck disable=SC2086 # one argument per id
  [ -z "$ids" ] || docker network rm $ids >/dev/null
}

cmd_down_db() {
  load "$1"
  docker_cleanup
  st_set '.db_mode = null'
  echo "DB_REMOVED (rebuild with setup)"
}

# --------------------------------------------------------------------------- down
cmd_down() {
  local keep_drafts=false
  [ "${2:-}" = "--keep-drafts" ] && keep_drafts=true
  RUN_DIR="${1%/}"
  [[ "$RUN_DIR" =~ $RUN_DIR_RE ]] || die "not a run dir: '$RUN_DIR'"
  [ -f "$RUN_DIR/state.json" ] || { rm -rf "$RUN_DIR"; echo "REMOVED (no state)"; return 0; }
  WT=$(st .wt); MAIN=$(st .main); PROJECT=$(st .compose_project)

  local g pid p left="" pat
  pat="pr-local-test/$(st .run_id)/wt/"
  for g in $(jq -r '.servers[].pgid' "$RUN_DIR/state.json"); do kill_group "$g"; done
  # Safety net: anything still running from this run's worktree (path is unique).
  for pid in $(pgrep -f "$pat" 2>/dev/null || true); do
    case "$(ps -o command= -p "$pid" 2>/dev/null)" in *"$pat"*) kill -TERM "$pid" 2>/dev/null || true ;; esac
  done
  sleep 1
  for pid in $(pgrep -f "$pat" 2>/dev/null || true); do
    case "$(ps -o command= -p "$pid" 2>/dev/null)" in *"$pat"*) kill -KILL "$pid" 2>/dev/null || true ;; esac
  done
  for p in $(jq -r '.servers[].port' "$RUN_DIR/state.json"); do listening "$p" && left="$left $p"; done
  if [ -n "$left" ]; then
    echo "SERVERS_STOPPED (still listening:$left, not in this run's process groups; name them to the user)"
  else
    echo "SERVERS_STOPPED"
  fi

  docker_cleanup
  echo "DOCKER_REMOVED project=$PROJECT remaining=$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT" | wc -l | tr -d ' ')"

  if [ -e "$MAIN/.git" ]; then
    git -C "$MAIN" worktree remove --force "$WT" 2>/dev/null || true
    git -C "$MAIN" worktree prune
    local ref; ref=$(st .git_ref)
    git -C "$MAIN" update-ref -d "$ref" 2>/dev/null || true
    git -C "$MAIN" update-ref -d "$ref-base" 2>/dev/null || true
  fi
  rm -rf "$WT"
  echo "WORKTREE_REMOVED"

  local slot; slot=$(st .slot)
  if [ "$(cat "$SLOTS/$slot/run" 2>/dev/null)" = "$(st .run_id)" ]; then
    rm -rf "${SLOTS:?}/$slot"
    echo "PORTS_RELEASED block=$((41000 + slot * 20))"
  fi

  if $keep_drafts; then
    rm -rf "$RUN_DIR/logs" "$RUN_DIR/keys" "$RUN_DIR/jar"
    st_set '.servers = [] | .phase = "torn_down"'
    echo "KEPT_DRAFTS=$RUN_DIR"
  else
    rm -rf "$RUN_DIR"
    rmdir "$SLOTS" "$ROOT" 2>/dev/null || true
    echo "RUN_DIR_REMOVED"
  fi
}

# --------------------------------------------------------------------------- list
cmd_list() {
  local d s owner alive servers containers
  mkdir -p "$SLOTS"
  for s in "$SLOTS"/*; do
    [ -d "$s" ] || continue
    if [ -f "$s/run" ]; then
      [ -d "$ROOT/$(cat "$s/run")" ] || rm -rf "$s"
    elif [ -n "$(find "$s" -maxdepth 0 -mmin +5)" ]; then rm -rf "$s"; fi
  done
  printf '%-14s %-6s %-11s %-5s %-6s %-8s %-10s %s\n' RUN PR PHASE KEEP OWNER SERVERS CONTAINERS REPO
  for d in "$ROOT"/pr*-*; do
    [ -f "$d/state.json" ] || continue
    owner=$(jq -r .owner_pid "$d/state.json")
    if kill -0 "$owner" 2>/dev/null && [ "$(ps -o command= -p "$owner" | cut -c1-200)" = "$(jq -r .owner_cmd "$d/state.json")" ]; then alive=live; else alive=gone; fi
    servers=0
    for s in $(jq -r '.servers[].pgid' "$d/state.json"); do group_alive "$s" && servers=$((servers + 1)); done
    containers=$(docker ps -q --filter "label=com.docker.compose.project=$(jq -r .compose_project "$d/state.json")" 2>/dev/null | wc -l | tr -d ' ')
    printf '%-14s %-6s %-11s %-5s %-6s %-8s %-10s %s\n' "$(jq -r .run_id "$d/state.json")" "#$(jq -r .pr "$d/state.json")" \
      "$(jq -r .phase "$d/state.json")" "$(jq -r .keep "$d/state.json")" "$alive" "$servers" "$containers" "$(jq -r .main "$d/state.json")"
  done
}

cmd="${1:-}"; shift || true
case "$cmd" in
  init) cmd_init "$@" ;; setup) cmd_setup "$@" ;;
  serve) cmd_serve "$@" ;; stop) cmd_stop "$@" ;; exec) cmd_exec "$@" ;; psql) cmd_psql "$@" ;;
  info) cmd_info "$@" ;; update) cmd_update "$@" ;; down-db) cmd_down_db "$@" ;;
  down) cmd_down "$@" ;; list) cmd_list ;;
  *) sed -n '2,16p' "$0"; exit 2 ;;
esac
