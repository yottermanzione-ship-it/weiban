#!/usr/bin/env bash
# 香港服务器运维脚本检查（CI 与本机都能跑；不连服务器、不起容器）：
#   1. shellcheck 静态检查 deploy/hk/*.sh；
#   2. 用假的 docker / age / df / logger 跑 backup.sh、disk-check.sh、release-prune.sh 的行为用例。
# 重点守住 2026-11-03 事故的教训：备份空间不够时绝不停应用；中途失败必须删掉半成品并把应用拉起来；
# 发版清理不能删当前版本、上一版、hk 标签和容器在用的镜像。
set -euo pipefail
repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd -- "$repo_root"
hk=$repo_root/deploy/hk

if command -v shellcheck >/dev/null; then
  shellcheck --severity=warning -x deploy/hk/*.sh .github/scripts/check-hk-ops.sh
  echo 'shellcheck 通过'
elif [[ -n ${CI:-} ]]; then
  echo 'CI 上缺少 shellcheck' >&2
  exit 1
else
  echo '本机没有 shellcheck，跳过静态检查（CI 会做）'
fi

work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
stub=$work/bin
mkdir -p "$stub"
export STUB_LOG=$work/calls.log STUB_IMAGES=$work/images STUB_CONTAINERS=$work/containers
: >"$STUB_IMAGES"
: >"$STUB_CONTAINERS"

# ---------- 假命令 ----------
cat >"$stub/docker" <<'STUB'
#!/usr/bin/env bash
printf 'docker %s\n' "$*" >>"$STUB_LOG"
event() { echo "EVENT $*" >>"$STUB_LOG"; }
if [[ $1 == compose ]]; then
  a=" $* "
  case $a in
    *" ps --status running -q app "*) [[ -n ${STUB_APP_STOPPED:-} ]] || echo app-cid ;;
    *" stop app "*) event stop-app ;;
    *" exec -T postgres pg_dump "*)
      if [[ -n ${STUB_SLOW_DUMP:-} ]]; then sleep "$STUB_SLOW_DUMP"; fi
      printf 'database-bytes' ;;
    *pg_database_size*) echo ' 5000' ;;
    *" exec -T postgres psql "*) cat >/dev/null; event alert ;;
    *" --entrypoint du "*) printf '7000\t/app/.data/media\n' ;;
    *" --entrypoint tar "*) [[ -z ${STUB_FAIL_MEDIA:-} ]] || exit 1; printf 'media-bytes' ;;
    *) echo "假 docker 不认识：$*" >&2; exit 99 ;;
  esac
  exit 0
fi
case "$1 ${2:-}" in
  "start "*) event start-app ;;
  "inspect -f") echo "${STUB_HEALTH:-healthy}" ;;
  "inspect --format")
    format=$3
    shift 3
    for cid in "$@"; do
      IFS='|' read -r _ image config mount < <(awk -F'|' -v c="$cid" '$1 == c' "$STUB_CONTAINERS")
      if [[ $format == *Mounts* ]]; then echo "$mount"; else echo "$image|$config"; fi
    done ;;
  "ps -aq") cut -d'|' -f1 "$STUB_CONTAINERS" ;;
  "system df") echo '（假）docker system df' ;;
  "image inspect")
    line=$(awk -v r="$5" '$1 == r' "$STUB_IMAGES")
    [[ -n $line ]] || exit 1
    read -r ref id created <<<"$line"
    if [[ $4 == *Created* ]]; then echo "$created $id $ref"; else echo "$id"; fi ;;
  "image ls") awk -v p="$5:" 'index($1, p) == 1 { print $1 }' "$STUB_IMAGES" ;;
  "image rm")
    id=$(awk -v r="$3" '$1 == r { print $2 }' "$STUB_IMAGES")
    [[ -n $id ]] || exit 1
    others=$(awk -v r="$3" -v i="$id" '$2 == i && $1 != r' "$STUB_IMAGES" | wc -l)
    if ((others == 0)) && cut -d'|' -f2 "$STUB_CONTAINERS" | grep -qx -- "$id"; then
      echo "conflict: image is being used by a container" >&2
      exit 1
    fi
    awk -v r="$3" '$1 != r' "$STUB_IMAGES" >"$STUB_IMAGES.tmp" && mv "$STUB_IMAGES.tmp" "$STUB_IMAGES"
    event "rm $3" ;;
  "image prune") event image-prune ;;
  "builder prune") event "builder-prune ${*:3}" ;;
  *) echo "假 docker 不认识：$*" >&2; exit 99 ;;
esac
STUB
cat >"$stub/age" <<'STUB'
#!/usr/bin/env bash
cat
STUB
cat >"$stub/df" <<'STUB'
#!/usr/bin/env bash
case " $* " in
  *pcent*) printf 'Use%%  Avail\n%s%% %s\n' "${STUB_PCENT:-50}" "${STUB_AVAIL:-1000000000000}" ;;
  *" -h "*) printf 'Filesystem Size Used Avail Use%% Mounted on\nfake 50G 10G 40G 20%% /\n' ;;
  *) printf 'Avail\n%s\n' "${STUB_AVAIL:-1000000000000}" ;;
esac
STUB
cat >"$stub/logger" <<'STUB'
#!/usr/bin/env bash
echo "EVENT logger $*" >>"$STUB_LOG"
STUB
chmod +x "$stub"/*
export PATH="$stub:$PATH"

# ---------- 断言工具 ----------
failures=0
check() {
  local desc=$1
  shift
  if "$@"; then echo "  通过：$desc"; else
    echo "  失败：$desc" >&2
    failures=$((failures + 1))
  fi
}
logged() { grep -qF -- "$1" "$STUB_LOG"; }
not_logged() { ! grep -qF -- "$1" "$STUB_LOG"; }
before() {
  local a b
  a=$(grep -nF -- "$1" "$STUB_LOG" | head -n 1 | cut -d: -f1)
  b=$(grep -nF -- "$2" "$STUB_LOG" | head -n 1 | cut -d: -f1)
  [[ -n $a && -n $b ]] && ((a < b))
}
equals() { [[ $1 == "$2" ]]; }
output_has() { grep -qF -- "$1" "$work/out.log"; }

# ---------- backup.sh ----------
export WEIBAN_SRC=$work/src WEIBAN_DEPLOY_ENV=$work/runtime.env
export BACKUP_AGE_RECIPIENT_FILE=$work/recipient BACKUP_LOCK_FILE=$work/backup.lock
export BACKUP_RESERVE_BYTES=0 APP_HEALTH_TIMEOUT_SECONDS=0 KEEP=2
echo 'age1-not-a-real-key' >"$BACKUP_AGE_RECIPIENT_FILE"
backups=$work/backups
rc=0
run_backup() {
  : >"$STUB_LOG"
  rc=0
  bash "$hk/backup.sh" "$backups" >"$work/out.log" 2>&1 || rc=$?
}
complete_count() {
  local n=0 d
  for d in "$backups"/weiban-*/; do if [[ -f $d/manifest.txt ]]; then n=$((n + 1)); fi; done
  echo "$n"
}
dir_count() {
  local n=0 d
  for d in "$backups"/weiban-*/; do if [[ -d $d ]]; then n=$((n + 1)); fi; done
  echo "$n"
}

echo 'backup.sh：目录里还没有备份、空间足够'
export STUB_AVAIL=100000
run_backup
check '成功退出' equals "$rc" 0
check '按当前数据库与媒体大小估算' logged pg_database_size
check '先停应用、后恢复应用' before 'EVENT stop-app' 'EVENT start-app'
check '留下 1 份完整备份' equals "$(complete_count)" 1
check '数据库导出写进加密文件' equals "$(cat "$backups"/weiban-*/database.dump.age)" 'database-bytes'

echo 'backup.sh：备份盘空间不足'
export STUB_AVAIL=10
run_backup
check '失败退出' test "$rc" -ne 0
check '没有停应用' not_logged 'stop app'
check '没有导出数据库' not_logged pg_dump
check '登记了后台提醒' logged 'EVENT alert'
check '提醒合并键是 backup_failed:hk' logged 'key=backup_failed:hk'
check '没有新建备份目录' equals "$(dir_count)" 1
check '输出说明没有停应用' output_has '没有停应用'

echo 'backup.sh：导出媒体中途失败'
export STUB_AVAIL=1000000000000 STUB_FAIL_MEDIA=1
run_backup
unset STUB_FAIL_MEDIA
check '失败退出' test "$rc" -ne 0
check '停过应用之后又把应用拉起来' before 'EVENT stop-app' 'EVENT start-app'
check '登记了后台提醒' logged 'EVENT alert'
check '半成品已删除' equals "$(dir_count)" 1
check '原有完整备份还在' equals "$(complete_count)" 1

echo 'backup.sh：只保留最近 KEEP=2 份'
run_backup
run_backup
run_backup
check '最后一次成功退出' equals "$rc" 0
check '用上一份备份估算空间' not_logged pg_database_size
check '完整备份只剩 2 份' equals "$(complete_count)" 2
check '没有残留目录' equals "$(dir_count)" 2

echo 'backup.sh：应用原本就没在运行'
export STUB_APP_STOPPED=1
run_backup
unset STUB_APP_STOPPED
check '成功退出' equals "$rc" 0
check '不去启动本来停着的应用' not_logged 'EVENT start-app'

echo 'backup.sh：应用恢复后不健康'
export STUB_HEALTH=starting
run_backup
unset STUB_HEALTH
check '失败退出' test "$rc" -ne 0
check '尝试过启动应用' logged 'EVENT start-app'
check '登记了严重提醒' logged 'severity=critical'
check '备份本身仍完整保留' equals "$(complete_count)" 2

echo 'backup.sh：导出时收到停止信号（systemd 超时或手动 stop）'
: >"$STUB_LOG"
export STUB_SLOW_DUMP=3
bash "$hk/backup.sh" "$backups" >"$work/out.log" 2>&1 &
pid=$!
for _ in $(seq 1 50); do
  if logged 'EVENT stop-app'; then break; fi
  sleep 0.1
done
kill -TERM "$pid" 2>/dev/null || true
rc=0
wait "$pid" || rc=$?
unset STUB_SLOW_DUMP
check '以信号退出码 143 结束' equals "$rc" 143
check '应用被拉起来' before 'EVENT stop-app' 'EVENT start-app'
check '半成品已删除' equals "$(dir_count)" 2
unset STUB_AVAIL

# ---------- disk-check.sh ----------
disk_check() {
  : >"$STUB_LOG"
  STUB_PCENT=$1 DISK_CHECK_MOUNTS=/srv/weiban bash "$hk/disk-check.sh" >"$work/out.log" 2>&1
}
echo 'disk-check.sh：使用率 50%'
disk_check 50
check '不告警' not_logged 'EVENT alert'
echo 'disk-check.sh：使用率 85%'
disk_check 85
check '登记警告' logged 'severity=warning'
check '合并键按挂载点' logged 'key=host_disk_high:/srv/weiban'
check '写了系统日志' logged 'EVENT logger'
echo 'disk-check.sh：使用率 93%'
disk_check 93
check '登记严重' logged 'severity=critical'

# ---------- release-prune.sh ----------
releases=$work/releases
reset_images() {
  cat >"$STUB_IMAGES" <<'EOF'
weiban-app:new sha256:aaa 2026-11-03T03:00:00Z
weiban-app:before-new sha256:bbb 2026-11-02T19:00:00Z
weiban-app:older sha256:ccc 2026-11-01T10:00:00Z
weiban-app:before-final-20261026 sha256:ddd 2026-10-26T10:00:00Z
weiban-app:hk sha256:eee 2026-10-13T10:00:00Z
weiban-app:stopped sha256:fff 2026-10-20T10:00:00Z
weiban-edge:new sha256:e01 2026-11-03T03:00:00Z
weiban-edge:before-new sha256:e02 2026-11-02T19:00:00Z
weiban-edge:older sha256:e03 2026-11-01T10:00:00Z
pgvector/pgvector:0.8.7-pg18-bookworm sha256:ppp 2026-09-01T00:00:00Z
EOF
}
reset_images
cat >"$STUB_CONTAINERS" <<EOF
c-app|sha256:aaa|weiban-app:new|$work/volumes/media
c-pg|sha256:ppp|pgvector/pgvector:0.8.7-pg18-bookworm|$releases/rel-mounted/deploy/prod/postgres-init
c-old|sha256:fff|weiban-app:stopped|
EOF
printf '%s\n' 'APP_IMAGE=weiban-app:new' 'EDGE_IMAGE="weiban-edge:new"' >"$work/prune.env"
for name in rel-a rel-b rel-mounted rel-c rel-cur; do mkdir -p "$releases/$name/deploy"; done
touch -d '2026-10-01 00:00' "$releases/rel-a"
touch -d '2026-10-10 00:00' "$releases/rel-b"
touch -d '2026-10-15 00:00' "$releases/rel-mounted"
touch -d '2026-11-02 00:00' "$releases/rel-c"
touch -d '2026-11-03 00:00' "$releases/rel-cur"
ln -s "$releases/rel-cur" "$work/src-link" 2>/dev/null || true
if [[ ! -L $work/src-link ]]; then
  rm -rf -- "$work/src-link"
  MSYS=winsymlinks:nativestrict ln -s "$releases/rel-cur" "$work/src-link" 2>/dev/null || true
fi
symlinks=1
[[ -L $work/src-link ]] || symlinks=0
prune() {
  : >"$STUB_LOG"
  rc=0
  WEIBAN_DEPLOY_ENV=$work/prune.env WEIBAN_SRC=$work/src-link WEIBAN_RELEASES_DIR=$releases \
    bash "$hk/release-prune.sh" "$@" >"$work/out.log" 2>&1 || rc=$?
}
has_image() { awk -v r="$1" '$1 == r { found = 1 } END { exit !found }' "$STUB_IMAGES"; }
no_image() { ! has_image "$1"; }

echo 'release-prune.sh：演练模式'
prune --dry-run
check '成功退出' equals "$rc" 0
check '列出将删除的旧标签' output_has '[演练] 将删除镜像标签 weiban-app:older'
check '一个镜像都没删' not_logged 'EVENT rm'
check '没有清构建缓存' not_logged 'EVENT builder-prune'
check '源码目录都还在' test -d "$releases/rel-a"

echo 'release-prune.sh：实际清理'
prune
check '成功退出' equals "$rc" 0
check '保留当前版本' has_image weiban-app:new
check '保留上一版（除当前外最新构建）' has_image weiban-app:before-new
check '保留 hk 标签' has_image weiban-app:hk
check '保留已停止容器在用的镜像' has_image weiban-app:stopped
check '删除更早的版本' no_image weiban-app:older
check '删除旧回滚标签' no_image weiban-app:before-final-20261026
check '网页镜像保留当前与上一版' has_image weiban-edge:before-new
check '网页镜像删除更早的版本' no_image weiban-edge:older
check '不碰其他仓库的镜像' has_image pgvector/pgvector:0.8.7-pg18-bookworm
check '清理悬空镜像' logged 'EVENT image-prune'
check '构建缓存只清 24 小时前的' logged 'EVENT builder-prune --all --force --filter until=24h'
if ((symlinks)); then
  check '保留当前源码目录' test -d "$releases/rel-cur"
  check '保留上一版源码目录' test -d "$releases/rel-c"
  check '保留被容器挂载的源码目录' test -d "$releases/rel-mounted"
  check '删除更早的源码目录（一）' test ! -e "$releases/rel-a"
  check '删除更早的源码目录（二）' test ! -e "$releases/rel-b"
else
  echo '  本机不能建软链接，跳过源码目录用例（CI 会做）'
fi

echo 'release-prune.sh：发版脚本显式指定回滚镜像'
reset_images
ROLLBACK_APP_IMAGE=weiban-app:older prune
check '成功退出' equals "$rc" 0
check '保留指定的回滚镜像' has_image weiban-app:older
check '不再按构建时间猜上一版' no_image weiban-app:before-new

echo 'release-prune.sh：当前镜像找不到时拒绝清理'
reset_images
printf '%s\n' 'APP_IMAGE=weiban-app:missing' 'EDGE_IMAGE=weiban-edge:new' >"$work/prune.env"
prune
check '失败退出' test "$rc" -ne 0
check '一个镜像都没删' not_logged 'EVENT rm'

if ((failures > 0)); then
  echo "香港运维脚本检查：$failures 项失败" >&2
  exit 1
fi
echo '香港运维脚本检查全部通过'
