# shellcheck shell=bash
# 香港服务器运维脚本的公共部分，被 backup.sh、disk-check.sh、release.sh、rollback.sh、release-prune.sh 引用，不单独执行。
#   - weiban_compose：固定生产项目的 docker compose 命令（与发版、备份共用同一份 override）。
#   - ops_alert：把运维异常写进系统日志，并登记到管理后台「运行提醒」页。
#   - 发版历史（history_*、rollback_versions）：「当前 + 2 个可回退版本」按它排先后。
# 说明见 docs/ops/hk-server.md「六、磁盘、备份与清理」。
WEIBAN_SRC=${WEIBAN_SRC:-/srv/weiban/src}
WEIBAN_DEPLOY_ENV=${WEIBAN_DEPLOY_ENV:-/srv/weiban/runtime.env}
WEIBAN_RELEASES_DIR=${WEIBAN_RELEASES_DIR:-/srv/weiban/releases}
WEIBAN_STATE_DIR=${WEIBAN_STATE_DIR:-/srv/weiban/release-state}
WEIBAN_VERSION_FILE=${WEIBAN_VERSION_FILE:-/srv/weiban/deployment-version.txt}
WEIBAN_HISTORY=${WEIBAN_RELEASE_HISTORY:-$WEIBAN_STATE_DIR/history.tsv}
# shellcheck disable=SC2034 # 由引用本文件的脚本使用
weiban_compose=(docker compose --env-file "$WEIBAN_DEPLOY_ENV" -p "${WEIBAN_COMPOSE_PROJECT:-weiban-prod}"
  -f "$WEIBAN_SRC/deploy/prod/compose.yml" -f "$WEIBAN_SRC/deploy/hk/compose.override.yml")

# 字节数写成 3.2G 这样的人看得懂的形式。
human_bytes() { numfmt --to=iec -- "$1" 2>/dev/null || printf '%s 字节' "$1"; }

# ops_alert <合并键> <warning|critical> <一句话说明> <种类>
# 尽力而为、从不失败：先写系统日志（journalctl -t weiban-ops），再写进数据库表 push.admin_alerts，
# 管理后台「运行提醒」页即可看到。同一合并键还有未处理的提醒时只累加次数、更新说明，
# 与后台自己的提醒规则一致。种类 host_disk_high、backup_failed 从契约 5.3 起在 AdminAlertKind 里，
# 后台「类型」列显示「磁盘空间不足」「备份失败」。这条路径不发手机推送。数据盘真写满时数据库也写不进，
# 只剩系统日志，所以告警线定在 80%，留出处理时间。
ops_alert() {
  local key=$1 severity=$2 summary=$3 kind=$4 level=warning
  [[ $severity == critical ]] && level=crit
  echo "运维提醒（$severity）：$summary" >&2
  if command -v logger >/dev/null; then
    logger -t weiban-ops -p "user.$level" -- "$summary [$key]" || true
  fi
  [[ ${OPS_ALERT_DB:-1} == 1 ]] || return 0
  if ! timeout 30 "${weiban_compose[@]}" exec -T postgres psql -X -q -v ON_ERROR_STOP=1 -U weiban -d weiban \
    -v "key=$key" -v "severity=$severity" -v "summary=$summary" -v "kind=$kind" >/dev/null 2>&1 <<'SQL'
INSERT INTO push.admin_alerts AS a (id, kind, severity, dedupe_key, summary, first_raised_at, last_raised_at)
VALUES (gen_random_uuid(), :'kind', :'severity', :'key', :'summary', now(), now())
ON CONFLICT (dedupe_key) WHERE acknowledged_at IS NULL DO UPDATE SET
  summary = EXCLUDED.summary,
  last_raised_at = EXCLUDED.last_raised_at,
  occurrences = a.occurrences + 1,
  severity = CASE WHEN a.severity = 'critical' THEN 'critical' ELSE EXCLUDED.severity END;
SQL
  then
    echo '提醒没能写进管理后台（数据库不可用？），只记在系统日志里' >&2
  fi
  return 0
}

# ---------- 小工具 ----------
# kv_get <文件> <键>：读 KEY=VALUE 文件里某一项（取最后一次出现，去掉引号和回车）；文件不存在时输出空、不算失败。
kv_get() {
  [[ -r $1 ]] || return 0
  sed -n "s/^$2=//p" "$1" | tail -n 1 | tr -d "\"'\r"
}
# Optional push configuration is retained by deploy, backup recovery and rollback alike.
if [[ -n $(kv_get "$WEIBAN_DEPLOY_ENV" PUSH_CREDENTIALS_PATH) ]]; then
  weiban_compose+=(-f "$WEIBAN_SRC/deploy/prod/push.override.yml")
fi
image_id() { docker image inspect --format '{{.Id}}' "$1" 2>/dev/null; }
short_id() {
  local id=${1#sha256:}
  printf '%s' "${id:0:12}"
}
# journal_tags <_journal.json>：列出迁移清单里的 tag，一行一个。
journal_tags() { grep -o '"tag"[[:space:]]*:[[:space:]]*"[^"]*"' -- "$1" | sed 's/.*"\([^"]*\)"$/\1/'; }
# contract_version <源码目录>：读该版本的契约版本号。
contract_version() {
  sed -n "s/^export const CONTRACT_VERSION = '\([0-9.]*\)'.*/\1/p" "$1/packages/contracts/src/version.ts" 2>/dev/null || true
}

# set_env_images <app镜像> <edge镜像>：改 runtime.env 的 APP_IMAGE / EDGE_IMAGE（先写临时文件再改名，权限不变）。
set_env_images() {
  local tmp
  tmp=$(mktemp "$WEIBAN_DEPLOY_ENV.XXXXXX")
  sed "s#^APP_IMAGE=.*#APP_IMAGE=$1#; s#^EDGE_IMAGE=.*#EDGE_IMAGE=$2#" "$WEIBAN_DEPLOY_ENV" >"$tmp"
  chmod --reference="$WEIBAN_DEPLOY_ENV" "$tmp" 2>/dev/null || true
  chown --reference="$WEIBAN_DEPLOY_ENV" "$tmp" 2>/dev/null || true
  mv -f -- "$tmp" "$WEIBAN_DEPLOY_ENV"
}

# switch_src <源码目录>：把 src 软链接原子地改指新目录（先建临时链接再改名，任何时刻 src 都有效）。
switch_src() {
  ln -sfn -- "$1" "$WEIBAN_SRC.new"
  mv -Tf -- "$WEIBAN_SRC.new" "$WEIBAN_SRC"
}

# print_health：打印应用自己的 /health 结果，失败不报错（up --wait 已经确认过健康）。
print_health() {
  "${weiban_compose[@]}" exec -T app node -e \
    'fetch("http://127.0.0.1:3000/health").then(r=>r.text()).then(console.log)' || true
}

# write_version_file：写 deployment-version.txt（先写临时文件再改名）。字段沿用 10 月以来的手工发版。
#   $1 提交  $2 源码树  $3 app镜像  $4 edge镜像  $5 上一版提交  $6 备份目录  $7 PR  $8 契约版本
#   $9 迁移  ${10} 回滚镜像  ${11} 上一版源码  ${12} 说明
write_version_file() {
  local tmp app_id edge_id
  app_id=$(image_id "$3") || app_id=-
  edge_id=$(image_id "$4") || edge_id=-
  tmp=$(mktemp "$WEIBAN_VERSION_FILE.XXXXXX")
  cat >"$tmp" <<EOF
sourceCommit=$1
sourceTree=$2
deployedAt=$(date -u +%Y-%m-%dT%H:%M:%SZ)
appImage=$3
edgeImage=$4
appImageId=$app_id
edgeImageId=$edge_id
previousSourceCommit=$5
backupDir=$6
pullRequest=$7
contractVersion=$8
migrations=$9
rollbackImages=${10}
previousSource=${11}
deployedBy=${12}
EOF
  chmod 0644 "$tmp"
  mv -f -- "$tmp" "$WEIBAN_VERSION_FILE"
}

# ---------- 发版历史 ----------
# release.sh / rollback.sh 每次成功后在 release-state/history.tsv 追加一行，制表符分隔 9 列：
#   部署时间(UTC)  动作(release|rollback|seed)  提交  源码树  app镜像  edge镜像  app镜像ID  edge镜像ID  源码目录
# 「当前 + 2 个可回退版本」按部署先后排：同一提交以最后一次部署为准。回滚之后再发版，刚退回过的好版本排在前面，
# 不会因为构建时间早就被清掉。

# history_line <部署时间> <动作> <提交> <源码树> <app镜像> <edge镜像> <源码目录>：输出一行（镜像 ID 现查）。
history_line() {
  local app_id edge_id
  app_id=$(image_id "$5") || app_id=-
  edge_id=$(image_id "$6") || edge_id=-
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "${1:--}" "$2" "${3:--}" "${4:--}" "$5" "$6" "$app_id" "$edge_id" "${7:--}"
}

# history_add <动作> <提交> <源码树> <app镜像> <edge镜像> <源码目录>：以现在的时间追加到历史文件。
history_add() {
  mkdir -p -- "$(dirname -- "$WEIBAN_HISTORY")"
  history_line "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$@" >>"$WEIBAN_HISTORY"
}

# history_seed_lines：历史文件还没有时（第一次用 release.sh 之前），按服务器现状推出两行：
#   上一版：deployment-version.txt 的 previousSourceCommit，镜像是上次发版打的 before-<当前短号>，源码是 src.before-<当前短号>；
#   当前版：deployment-version.txt 的 sourceCommit，runtime.env 的镜像，src 指向的目录。
history_seed_lines() {
  local cur_commit cur_src app edge short prev prev_src link
  cur_src=$(readlink -f -- "$WEIBAN_SRC" 2>/dev/null) || cur_src=
  cur_commit=$(kv_get "$WEIBAN_VERSION_FILE" sourceCommit)
  [[ -n $cur_commit || -z $cur_src ]] || cur_commit=$(basename -- "$cur_src")
  app=$(kv_get "$WEIBAN_DEPLOY_ENV" APP_IMAGE)
  edge=$(kv_get "$WEIBAN_DEPLOY_ENV" EDGE_IMAGE)
  [[ -n $app && -n $edge ]] || return 0
  short=${cur_commit:0:8}
  prev=$(kv_get "$WEIBAN_VERSION_FILE" previousSourceCommit)
  if [[ -n $short && -n $prev ]] && image_id "${app%:*}:before-$short" >/dev/null &&
    image_id "${edge%:*}:before-$short" >/dev/null; then
    prev_src=-
    link=$(dirname -- "$WEIBAN_SRC")/src.before-$short
    if [[ -e $link ]]; then
      prev_src=$(readlink -f -- "$link")
    elif [[ -d $WEIBAN_RELEASES_DIR/$prev ]]; then
      prev_src=$WEIBAN_RELEASES_DIR/$prev
    fi
    history_line - seed "$prev" - "${app%:*}:before-$short" "${edge%:*}:before-$short" "$prev_src"
  fi
  history_line "$(kv_get "$WEIBAN_VERSION_FILE" deployedAt)" seed "$cur_commit" \
    "$(kv_get "$WEIBAN_VERSION_FILE" sourceTree)" "$app" "$edge" "$cur_src"
}

# history_versions：每个提交只取最后一次部署，按部署先后从新到旧输出原始行。没有历史文件时用 history_seed_lines。
history_versions() {
  local rows
  if [[ -s $WEIBAN_HISTORY ]]; then rows=$(cat -- "$WEIBAN_HISTORY"); else rows=$(history_seed_lines); fi
  [[ -n $rows ]] || return 0
  printf '%s\n' "$rows" |
    awk -F'\t' 'NF >= 9 && $1 !~ /^#/ { last[$3] = NR; row[$3] = $0 } END { for (c in last) print last[c] "\t" row[c] }' |
    sort -t "$(printf '\t')" -k1,1nr | cut -f2-
}

# resolve_image <记录的镜像ID> <标签>：镜像还在就输出它现在的 ID。记录了 ID 就只认 ID
# （标签可能已被挪走，例如 :hk）；只有没记录 ID 时才按标签找。
resolve_image() {
  if [[ -n $1 && $1 != - ]]; then
    image_id "$1"
  else
    image_id "$2"
  fi
}

# rollback_versions <当前app镜像ID> <当前edge镜像ID> <当前源码目录> <最多几个>
# 按部署先后从新到旧，列出除当前版本外、两个镜像都还在的版本，每行制表符分隔：
#   提交  源码树  app镜像  edge镜像  app镜像ID  edge镜像ID  源码目录  部署时间
# release-prune.sh 按它决定保留哪些版本，rollback.sh 按它给出「上一版 / 上上一版」，两边口径一致。
rollback_versions() {
  local cur_app=$1 cur_edge=$2 cur_src=$3 max=$4 n=0
  local at commit tree app edge app_id edge_id src
  while IFS=$'\t' read -r at _ commit tree app edge app_id edge_id src; do
    if ((n >= max)); then break; fi
    if [[ -n $cur_src && $src == "$cur_src" ]]; then continue; fi
    app_id=$(resolve_image "$app_id" "$app") || continue
    edge_id=$(resolve_image "$edge_id" "$edge") || continue
    if [[ $app_id == "$cur_app" && $edge_id == "$cur_edge" ]]; then continue; fi
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$commit" "$tree" "$app" "$edge" "$app_id" "$edge_id" "$src" "$at"
    n=$((n + 1))
  done < <(history_versions)
}
