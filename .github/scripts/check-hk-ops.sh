#!/usr/bin/env bash
# 香港服务器运维脚本检查（CI 与本机都能跑；不连服务器、不起容器）：
#   1. shellcheck 静态检查 deploy/hk/*.sh；
#   2. 用假的 docker / age / df / logger / systemctl / ssh / scp 跑 backup.sh、disk-check.sh、release-prune.sh、
#      upload-release.sh、release.sh、rollback.sh 的行为用例。
# 重点守住：备份空间不够时绝不停应用；中途失败必须删掉半成品并把应用拉起来；备份最多 2 份且合计不超过上限；
# 发版只留当前 + 2 个可回退版本（按部署先后），不删容器在用的镜像；不含迁移不备份、含迁移先备份；
# 健康检查没过时不含迁移自动退回；回滚前查数据库迁移，旧版本认不得就拒绝。
# 需要软链接的用例（源码目录清理、发版、回滚）在 Windows 上建不了软链接时跳过，以 CI（ubuntu）为准。
set -euo pipefail
repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd -- "$repo_root"
hk=$repo_root/deploy/hk
node --test "$hk/provision-webpush.test.mjs"

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
# 假镜像表 $STUB_IMAGES 每行「标签 镜像ID 构建时间」；假容器表 $STUB_CONTAINERS 每行「容器|镜像ID|配置的镜像|挂载」。
cat >"$stub/docker" <<'STUB'
#!/usr/bin/env bash
printf 'docker %s\n' "$*" >>"$STUB_LOG"
event() { echo "EVENT $*" >>"$STUB_LOG"; }
add_image() {
  awk -v r="$1" '$1 != r' "$STUB_IMAGES" >"$STUB_IMAGES.tmp"
  echo "$1 $2 $3" >>"$STUB_IMAGES.tmp"
  mv "$STUB_IMAGES.tmp" "$STUB_IMAGES"
}
if [[ $1 == compose ]]; then
  a=" $* "
  case $a in
    *" ps --status running -q app "*) [[ -n ${STUB_APP_STOPPED:-} ]] || echo app-cid ;;
    *" stop app "*) event stop-app ;;
    *" build app caddy "*)
      event "build $APP_IMAGE"
      [[ -z ${STUB_BUILD_FAIL:-} ]] || exit 1
      for ref in "$APP_IMAGE" "$EDGE_IMAGE"; do
        add_image "$ref" "sha256:$(printf '%s' "$ref" | sha256sum | cut -c1-12)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      done ;;
    *" up -d --wait app caddy "*)
      event "up $(sed -n 's/^APP_IMAGE=//p' "$WEIBAN_DEPLOY_ENV")"
      if [[ -n ${STUB_UP_FAIL:-} && -f $STUB_UP_FAIL ]]; then rm -f "$STUB_UP_FAIL"; exit 1; fi ;;
    *" exec -T app node "*) echo '{"status":"ok"}' ;;
    *schema_migrations*) printf '%s\n' ${STUB_APPLIED:-} ;;
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
  "tag "*)
    line=$(awk -v r="$2" '$1 == r || $2 == r' "$STUB_IMAGES" | head -n 1)
    [[ -n $line ]] || exit 1
    read -r _ id created <<<"$line"
    add_image "$3" "$id" "$created"
    event "tag $2 $3" ;;
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
    line=$(awk -v r="$5" '$1 == r || $2 == r' "$STUB_IMAGES" | head -n 1)
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
# 假 systemctl：start weiban-backup.service 时在 RELEASE_BACKUP_ROOT 里造一份完整备份。
cat >"$stub/systemctl" <<'STUB'
#!/usr/bin/env bash
echo "EVENT systemctl $*" >>"$STUB_LOG"
[[ -z ${STUB_BACKUP_FAIL:-} ]] || exit 1
d=$RELEASE_BACKUP_ROOT/weiban-$(date -u +%Y%m%dT%H%M%SZ)-stub
mkdir -p "$d" && echo weiban-backup-v1 >"$d/manifest.txt"
STUB
# 假 ssh / scp：把「服务器」当成本机，远程命令直接在本机 bash 里跑。
cat >"$stub/ssh" <<'STUB'
#!/usr/bin/env bash
while (($#)); do case $1 in -o | -i | -p) shift 2 ;; -*) shift ;; *) break ;; esac; done
shift
echo "EVENT ssh" >>"$STUB_LOG"
exec bash -c "$*"
STUB
cat >"$stub/scp" <<'STUB'
#!/usr/bin/env bash
files=()
while (($#)); do case $1 in -o | -i | -P) shift 2 ;; -*) shift ;; *) files+=("$1"); shift ;; esac; done
cp -- "${files[0]}" "${files[1]#*:}"
echo "EVENT scp ${files[1]##*/}" >>"$STUB_LOG"
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
count_logged() { grep -cF -- "$1" "$STUB_LOG" || true; }
kv() { sed -n "s/^$2=//p" "$1" | tail -n 1; }
image_of() { awk -v r="$1" '$1 == r { print $2 }' "$STUB_IMAGES"; }
has_image() { awk -v r="$1" '$1 == r { found = 1 } END { exit !found }' "$STUB_IMAGES"; }
no_image() { ! has_image "$1"; }

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

echo 'backup.sh：合计超过上限时从最早的删起'
rm -rf -- "$backups"/weiban-*
big=$backups/weiban-20000101T000000Z-big
mkdir -p "$big"
head -c 300000 /dev/zero >"$big/media.tar.age"
echo weiban-backup-v1 >"$big/manifest.txt"
BACKUP_MAX_TOTAL=200000 run_backup
check '成功退出' equals "$rc" 0
check '最早的大备份被删' test ! -e "$big"
check '只剩新备份 1 份' equals "$(complete_count)" 1
check '输出说明按合计上限清理' output_has '合计超过'
check '没有登记提醒' not_logged 'EVENT alert'

echo 'backup.sh：只剩一份也超过上限'
BACKUP_MAX_TOTAL=100 run_backup
check '备份本身成功（退出码 0，不挡发版）' equals "$rc" 0
check '只保留最新这一份' equals "$(complete_count)" 1
check '登记了严重提醒' logged 'severity=critical'
check '提醒合并键是 backup_over_cap:hk' logged 'key=backup_over_cap:hk'

echo 'backup.sh：合计上限写错格式'
BACKUP_MAX_TOTAL=10X run_backup
check '失败退出' test "$rc" -ne 0
check '没有停应用' not_logged 'stop app'
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

# ---------- 软链接 ----------
make_link() {
  ln -s "$1" "$2" 2>/dev/null || MSYS=winsymlinks:nativestrict ln -s "$1" "$2" 2>/dev/null || true
}
make_link "$work" "$work/link-probe"
symlinks=1
[[ -L $work/link-probe ]] || symlinks=0

# The application may roll back to a source without optional push handling. Operations stay pinned.
if ((symlinks)); then
  export WEIBAN_OPS_ROOT=$work/ops
  echo 'install-ops-runtime.sh：两槽切换、重入与失败保护'
  bash "$hk/install-ops-runtime.sh" "$repo_root" 1111111111111111111111111111111111111111
  check '首次固定在第一槽' equals "$(readlink "$WEIBAN_OPS_ROOT/current")" "$WEIBAN_OPS_ROOT/slot-a"
  bash "$hk/install-ops-runtime.sh" "$repo_root" 1111111111111111111111111111111111111111
  check '同提交重复调用不切槽' equals "$(readlink "$WEIBAN_OPS_ROOT/current")" "$WEIBAN_OPS_ROOT/slot-a"
  bash "$hk/install-ops-runtime.sh" "$repo_root" 2222222222222222222222222222222222222222
  check '新提交切到第二槽' equals "$(readlink "$WEIBAN_OPS_ROOT/current")" "$WEIBAN_OPS_ROOT/slot-b"
  check '第一槽仍保留完整旧操作' test -f "$WEIBAN_OPS_ROOT/slot-a/rollback.sh"
  rc=0
  bash "$hk/install-ops-runtime.sh" "$work/missing-source" 3333333333333333333333333333333333333333 >"$work/out.log" 2>&1 || rc=$?
  check '不完整来源拒绝安装' test "$rc" -ne 0
  check '安装失败不切当前操作' equals "$(readlink "$WEIBAN_OPS_ROOT/current")" "$WEIBAN_OPS_ROOT/slot-b"
  unset WEIBAN_OPS_ROOT
fi

# ---------- release-prune.sh（没有发版历史：按构建时间、修改时间补足 2 个可回退版本） ----------
releases=$work/releases
reset_images() {
  cat >"$STUB_IMAGES" <<'EOF'
weiban-app:new sha256:aaa 2026-11-03T03:00:00Z
weiban-app:before-new sha256:bbb 2026-11-02T19:00:00Z
weiban-app:older sha256:ccc 2026-11-01T10:00:00Z
weiban-app:before-final-20261026 sha256:ddd 2026-10-26T10:00:00Z
weiban-app:hk sha256:eee 2026-11-02T20:00:00Z
weiban-app:stopped sha256:fff 2026-10-20T10:00:00Z
weiban-edge:new sha256:e01 2026-11-03T03:00:00Z
weiban-edge:before-new sha256:e02 2026-11-02T19:00:00Z
weiban-edge:older sha256:e03 2026-11-01T10:00:00Z
weiban-edge:oldest sha256:e04 2026-10-20T10:00:00Z
weiban-edge:hk sha256:e05 2026-10-13T10:00:00Z
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
for name in rel-old rel-a rel-b rel-mounted rel-c rel-cur outside; do mkdir -p "$releases/$name/deploy"; done
mv "$releases/outside" "$work/outside"
touch -d '2026-09-01 00:00' "$releases/rel-old"
touch -d '2026-10-01 00:00' "$releases/rel-a"
touch -d '2026-10-10 00:00' "$releases/rel-b"
touch -d '2026-10-15 00:00' "$releases/rel-mounted"
touch -d '2026-11-02 00:00' "$releases/rel-c"
touch -d '2026-11-03 00:00' "$releases/rel-cur"
touch "$releases/rel-a.tar" "$releases/rel-b.tgz"
make_link "$releases/rel-cur" "$work/src-link"
make_link "$releases/rel-c" "$work/src.before-cur"
make_link "$releases/rel-a" "$work/src.before-aaa"
make_link "$work/no-such-dir" "$work/src.before-gone"
make_link "$work/outside" "$work/src.before-outside"
prune() {
  : >"$STUB_LOG"
  rc=0
  WEIBAN_DEPLOY_ENV=$work/prune.env WEIBAN_SRC=$work/src-link WEIBAN_RELEASES_DIR=$releases \
    WEIBAN_STATE_DIR=$work/prune-state WEIBAN_VERSION_FILE=$work/no-version-file \
    bash "$hk/release-prune.sh" "$@" >"$work/out.log" 2>&1 || rc=$?
}

echo 'release-prune.sh：演练模式'
prune --dry-run
check '成功退出' equals "$rc" 0
check '列出将删除的旧标签' output_has '[演练] 将删除镜像标签 weiban-app:before-final-20261026'
check '列出 :hk 将改指当前版本' output_has '[演练] 将把 weiban-app:hk 改指当前版本'
check '一个镜像都没删' not_logged 'EVENT rm'
check ':hk 还没动' equals "$(image_of weiban-app:hk)" sha256:eee
check '没有清构建缓存' not_logged 'EVENT builder-prune'
check '源码目录都还在' test -d "$releases/rel-old"
if ((symlinks)); then
  check '软链接都还在' test -L "$work/src.before-gone"
  check '列出将删除的软链接' output_has '[演练] 将删除软链接'
fi

echo 'release-prune.sh：实际清理'
prune
check '成功退出' equals "$rc" 0
check '保留当前版本' has_image weiban-app:new
check '保留可回退版本一（构建时间最新）' has_image weiban-app:before-new
check '保留可回退版本二' has_image weiban-app:older
check '删除第三个旧版本' no_image weiban-app:before-final-20261026
check ':hk 改指当前版本' equals "$(image_of weiban-app:hk)" sha256:aaa
check '保留已停止容器在用的镜像' has_image weiban-app:stopped
check '网页镜像保留当前与两个可回退版本' has_image weiban-edge:older
check '网页镜像删除更早的版本' no_image weiban-edge:oldest
check '网页镜像 :hk 改指当前版本' equals "$(image_of weiban-edge:hk)" sha256:e01
check '不碰其他仓库的镜像' has_image pgvector/pgvector:0.8.7-pg18-bookworm
check '清理悬空镜像' logged 'EVENT image-prune'
check '构建缓存只清 24 小时前的' logged 'EVENT builder-prune --all --force --filter until=24h'
if ((symlinks)); then
  check '保留当前源码目录' test -d "$releases/rel-cur"
  check '保留可回退源码目录一' test -d "$releases/rel-c"
  check '保留可回退源码目录二（被挂载的不占名额）' test -d "$releases/rel-b"
  check '保留被容器挂载的源码目录' test -d "$releases/rel-mounted"
  check '删除更早的源码目录（一）' test ! -e "$releases/rel-a"
  check '删除更早的源码目录（二）' test ! -e "$releases/rel-old"
  check '删除旧版本源码包' test ! -e "$releases/rel-a.tar"
  check '保留可回退版本的源码包' test -f "$releases/rel-b.tgz"
  check '保留指向保留目录的软链接' test -L "$work/src.before-cur"
  check '删除指向已删目录的软链接' test ! -L "$work/src.before-aaa"
  check '删除指向不存在目录的软链接' test ! -L "$work/src.before-gone"
  check '不动 releases 以外的软链接' test -L "$work/src.before-outside"
else
  echo '  本机不能建软链接，跳过源码目录与软链接用例（CI 会做）'
fi

echo 'release-prune.sh：当前镜像找不到时拒绝清理'
reset_images
printf '%s\n' 'APP_IMAGE=weiban-app:missing' 'EDGE_IMAGE=weiban-edge:new' >"$work/prune.env"
prune
check '失败退出' test "$rc" -ne 0
check '一个镜像都没删' not_logged 'EVENT rm'

# ---------- upload-release.sh、release.sh、rollback.sh ----------
# 用一个很小的临时仓库当发布源：脚本是本仓库当前的副本，外加迁移清单、契约版本号和 compose 文件。
tiny=$work/tiny
mkdir -p "$tiny/deploy/hk" "$tiny/deploy/prod" "$tiny/apps/server/drizzle/meta" "$tiny/packages/contracts/src"
cp "$hk"/ops-lib.sh "$hk"/release.sh "$hk"/release-prune.sh "$hk"/rollback.sh "$hk"/upload-release.sh \
  "$hk"/install-ops-runtime.sh "$hk"/backup.sh "$hk"/disk-check.sh "$tiny/deploy/hk/"
echo 'services: {}' >"$tiny/deploy/prod/compose.yml"
echo 'services: {}' >"$tiny/deploy/hk/compose.override.yml"
echo 'services: {}' >"$tiny/deploy/prod/push.override.yml"
echo "export const CONTRACT_VERSION = '9.1' as const;" >"$tiny/packages/contracts/src/version.ts"
journal() {
  local t sep=''
  printf '{\n  "entries": ['
  for t in "$@"; do
    printf '%s\n    { "idx": 0, "tag": "%s" }' "$sep" "$t"
    sep=','
  done
  printf '\n  ]\n}\n'
}
g() { git -C "$tiny" -c user.name=ci -c user.email=ci@example.invalid -c core.autocrlf=false "$@"; }
journal 0001_a 0002_b >"$tiny/apps/server/drizzle/meta/_journal.json"
g init -q
g add -A
g commit -qm c1
c1=$(g rev-parse HEAD)
echo note >"$tiny/README"
g add -A
g commit -qm c1b
c1b=$(g rev-parse HEAD)
journal 0001_a 0002_b 0003_c >"$tiny/apps/server/drizzle/meta/_journal.json"
g add -A
g commit -qm c2
c2=$(g rev-parse HEAD)

remote=$work/remote
mkdir -p "$remote"
upload() {
  : >"$STUB_LOG"
  rc=0
  RELEASE_GATE=skip RELEASE_ARCHIVE_DIR=$remote UPLOAD_CHUNK_SIZE=4K \
    bash "$tiny/deploy/hk/upload-release.sh" "$1" >"$work/out.log" 2>&1 || rc=$?
}
echo 'upload-release.sh：分片上传并在服务器上核对'
upload "$c1"
check '成功退出' equals "$rc" 0
check '分了不止一片' test "$(count_logged 'EVENT scp part-')" -gt 1
check '整包校验和与校验文件一致' equals "$(sha256sum "$remote/rel-$c1.tgz" | cut -d' ' -f1)" "$(kv "$remote/rel-$c1.meta" sha256)"
check '校验文件记了提交号' equals "$(kv "$remote/rel-$c1.meta" commit)" "$c1"
check '校验文件记了源码树' equals "$(kv "$remote/rel-$c1.meta" tree)" "$(g rev-parse "$c1^{tree}")"
check '同版本的 release.sh 也传上去了' cmp -s "$remote/rel-$c1.release.sh" "$tiny/deploy/hk/release.sh"
check '分片目录已清掉' test ! -e "$remote/rel-$c1.parts"
check '打印了服务器上的发版命令' output_has "rel-$c1.release.sh"
echo 'upload-release.sh：服务器上已有一片是坏的'
mkdir -p "$remote/rel-$c1b.parts"
echo garbage >"$remote/rel-$c1b.parts/part-000"
upload "$c1b"
check '成功退出' equals "$rc" 0
check '坏分片重传后整包校验通过' equals "$(sha256sum "$remote/rel-$c1b.tgz" | cut -d' ' -f1)" "$(kv "$remote/rel-$c1b.meta" sha256)"
upload "$c2"

if ((symlinks)); then
  # 服务器现状：当前版本 old（第 8 波手工发布），上一版 older；历史文件还没有。
  srv=$work/srv
  sysbackups=$work/sysbackups
  older=1111111111111111111111111111111111111111
  old=2222222222222222222222222222222222222222
  mkdir -p "$srv/releases" "$sysbackups"
  for c in "$older" "$old"; do
    mkdir -p "$srv/releases/$c/deploy/prod" "$srv/releases/$c/apps/server/drizzle/meta"
    echo 'services: {}' >"$srv/releases/$c/deploy/prod/compose.yml"
    echo 'services: {}' >"$srv/releases/$c/deploy/prod/push.override.yml"
    journal 0001_a 0002_b >"$srv/releases/$c/apps/server/drizzle/meta/_journal.json"
  done
  touch "$srv/releases/$older.tar"
  ln -s "$srv/releases/$old" "$srv/src"
  ln -s "$srv/releases/$older" "$srv/src.before-${old:0:8}"
  ln -s "$srv/releases/gone" "$srv/src.before-final-20261022"
  printf '%s\n' "APP_IMAGE=weiban-app:release-$old" "EDGE_IMAGE=weiban-edge:release-$old" 'WEB_HOST=example' >"$srv/runtime.env"
  printf '%s\n' "sourceCommit=$old" 'sourceTree=t-old' 'deployedAt=2026-11-03T08:00:00Z' \
    "previousSourceCommit=$older" >"$srv/deployment-version.txt"
  cat >"$STUB_IMAGES" <<EOF
weiban-app:release-$old sha256:a02 2026-11-03T07:00:00Z
weiban-edge:release-$old sha256:e02 2026-11-03T07:00:00Z
weiban-app:before-${old:0:8} sha256:a01 2026-11-02T07:00:00Z
weiban-edge:before-${old:0:8} sha256:e01 2026-11-02T07:00:00Z
weiban-app:release-$older sha256:a01 2026-11-02T07:00:00Z
weiban-edge:release-$older sha256:e01 2026-11-02T07:00:00Z
weiban-app:ancient sha256:a00 2026-10-20T07:00:00Z
weiban-app:hk sha256:ahk 2026-11-02T01:00:00Z
weiban-edge:hk sha256:ehk 2026-11-02T01:00:00Z
EOF
  : >"$STUB_CONTAINERS"
  mkdir -p "$sysbackups/weiban-20000101T000000Z-recent"
  echo weiban-backup-v1 >"$sysbackups/weiban-20000101T000000Z-recent/manifest.txt"
  history=$srv/release-state/history.tsv
  run_srv() {
    : >"$STUB_LOG"
    rc=0
    WEIBAN_SRC=$srv/src WEIBAN_DEPLOY_ENV=$srv/runtime.env WEIBAN_RELEASES_DIR=$srv/releases \
      WEIBAN_STATE_DIR=$srv/release-state WEIBAN_VERSION_FILE=$srv/deployment-version.txt \
      WEIBAN_OPS_ROOT=$srv/ops \
      RELEASE_ARCHIVE_DIR=$remote RELEASE_BACKUP_ROOT=$sysbackups RELEASE_LOCK_FILE=$work/release.lock \
      RELEASE_MIN_FREE_BYTES=0 bash "$@" >"$work/out.log" 2>&1 || rc=$?
  }
  current_src() { readlink -f "$srv/src"; }
  history_lines() { wc -l <"$history" | tr -dc '0-9'; }

  echo 'release.sh：不含迁移、24 小时内有完整备份'
  run_srv "$remote/rel-$c1.release.sh" --pr 99 --note 'ci' "$c1"
  check '成功退出' equals "$rc" 0
  check '没有备份' not_logged 'EVENT systemctl'
  check '先构建、后切换' before "EVENT build weiban-app:release-$c1" 'EVENT up'
  check 'src 指向新版本' equals "$(current_src)" "$srv/releases/$c1"
  check 'runtime.env 换成新镜像' equals "$(kv "$srv/runtime.env" APP_IMAGE)" "weiban-app:release-$c1"
  check '原镜像打了 before 回滚标签' equals "$(image_of "weiban-app:before-${c1:0:8}")" sha256:a02
  check '原源码留了 src.before 软链接' equals "$(readlink -f "$srv/src.before-${c1:0:8}")" "$srv/releases/$old"
  check '版本文件：提交号' equals "$(kv "$srv/deployment-version.txt" sourceCommit)" "$c1"
  check '版本文件：源码树' equals "$(kv "$srv/deployment-version.txt" sourceTree)" "$(g rev-parse "$c1^{tree}")"
  check '版本文件：上一版' equals "$(kv "$srv/deployment-version.txt" previousSourceCommit)" "$old"
  check '版本文件：没有迁移' equals "$(kv "$srv/deployment-version.txt" migrations)" none
  check '版本文件：用的是已有备份' equals "$(kv "$srv/deployment-version.txt" backupDir)" "$sysbackups/weiban-20000101T000000Z-recent"
  check '版本文件：契约版本' equals "$(kv "$srv/deployment-version.txt" contractVersion)" 9.1
  check '版本文件：PR 号' equals "$(kv "$srv/deployment-version.txt" pullRequest)" 99
  check '发版历史：按现状补记两行再加本次' equals "$(history_lines)" 3
  check '发版历史：最后一行是本次发版' equals "$(tail -n 1 "$history" | cut -f2,3)" "release"$'\t'"$c1"
  check '清理：保留上一版' has_image "weiban-app:release-$old"
  check '清理：保留上上一版' has_image "weiban-app:release-$older"
  check '清理：删除更早的镜像' no_image weiban-app:ancient
  check '清理：:hk 改指当前版本' equals "$(image_of weiban-app:hk)" "$(image_of "weiban-app:release-$c1")"
  check '清理：删除指向不存在目录的软链接' test ! -L "$srv/src.before-final-20261022"
  check '清理：上上一版的源码包保留' test -f "$srv/releases/$older.tar"
  check '上传的临时文件已删' test ! -e "$remote/rel-$c1.tgz"

  echo '网页推送已配置：发布、自动退回、手动回滚、定时操作都保留挂载'
  printf '\nPUSH_CREDENTIALS_PATH=/synthetic/no-real-credentials.json\n' >>"$srv/runtime.env"
  WEIBAN_OPS_ROOT=$srv/ops bash "$hk/install-ops-runtime.sh" "$srv/releases/$c1" "$c1"

  echo 'release.sh：不含迁移、新版本健康检查没过'
  touch "$work/up-fail"
  STUB_UP_FAIL=$work/up-fail run_srv "$remote/rel-$c1b.release.sh" "$c1b"
  check '失败退出' test "$rc" -ne 0
  check '说明已自动退回' output_has '已自动退回'
  check 'up 跑了两次（新版本一次、退回一次）' equals "$(count_logged 'EVENT up')" 2
  check 'src 退回原版本' equals "$(current_src)" "$srv/releases/$c1"
  check 'runtime.env 退回原镜像' equals "$(kv "$srv/runtime.env" APP_IMAGE)" "weiban-app:release-$c1"
  check '版本文件没变' equals "$(kv "$srv/deployment-version.txt" sourceCommit)" "$c1"
  check '发版历史没有记这次' equals "$(history_lines)" 3
  check '自动退回仍带推送挂载' equals "$(count_logged "-f $srv/src/deploy/prod/push.override.yml up -d --wait app caddy")" 2

  echo 'release.sh：含数据库迁移'
  run_srv "$remote/rel-$c2.release.sh" "$c2"
  check '成功退出' equals "$rc" 0
  check '切换前先备份' before 'EVENT systemctl start weiban-backup.service' 'EVENT up'
  check '新镜像构建带推送配置' logged "-f $srv/releases/$c2/deploy/prod/push.override.yml build app caddy"
  check '新应用启动保留推送挂载' logged "-f $srv/src/deploy/prod/push.override.yml up -d --wait app caddy"
  check '运维运行副本跟到新提交' equals "$(cat "$srv/ops/current/source-commit")" "$c2"
  check '版本文件：迁移' equals "$(kv "$srv/deployment-version.txt" migrations)" 0003_c
  check '版本文件：用的是刚做的备份' test "$(kv "$srv/deployment-version.txt" backupDir)" != "$sysbackups/weiban-20000101T000000Z-recent"
  check '清理：保留上一版（c1）' has_image "weiban-app:release-$c1"
  check '清理：保留上上一版（old）' has_image "weiban-app:release-$old"
  check '清理：删除第三个旧版本的镜像' no_image "weiban-app:release-$older"
  check '清理：删除没上线成功的镜像' no_image "weiban-app:release-$c1b"
  check '清理：删除第三个旧版本的源码目录' test ! -e "$srv/releases/$older"
  check '清理：删除没上线成功的源码目录' test ! -e "$srv/releases/$c1b"
  check '清理：删除它的源码包' test ! -e "$srv/releases/$older.tar"
  check '清理：删除指向已删目录的软链接' test ! -L "$srv/src.before-${old:0:8}"
  check '清理：保留指向上上一版的软链接' test -L "$srv/src.before-${c1:0:8}"

  echo 'rollback.sh：列出可退版本'
  run_srv "$srv/src/deploy/hk/rollback.sh" --list
  check '成功退出' equals "$rc" 0
  check '上一版是 c1' output_has "1. ${c1:0:12}"
  check '上上一版是 old' output_has "2. ${old:0:12}"

  echo 'rollback.sh：数据库里有目标版本不认识的迁移'
  STUB_APPLIED='0001_a 0002_b 0003_c' run_srv "$srv/src/deploy/hk/rollback.sh" 1
  check '拒绝回滚' test "$rc" -ne 0
  check '列出不认识的迁移' output_has 0003_c
  check '给出 down 的命令' output_has 'migrate.js down 1'
  check '没有切换' equals "$(current_src)" "$srv/releases/$c2"
  check '没有重启' not_logged 'EVENT up'

  echo 'rollback.sh：迁移已退掉，退回上一版'
  STUB_APPLIED='0001_a 0002_b' run_srv "$srv/src/deploy/hk/rollback.sh" 1
  check '成功退出' equals "$rc" 0
  check 'src 指向 c1' equals "$(current_src)" "$srv/releases/$c1"
  check 'runtime.env 换回 c1 的镜像' equals "$(kv "$srv/runtime.env" APP_IMAGE)" "weiban-app:release-$c1"
  check '版本文件：提交号' equals "$(kv "$srv/deployment-version.txt" sourceCommit)" "$c1"
  check '版本文件：上一版是 c2' equals "$(kv "$srv/deployment-version.txt" previousSourceCommit)" "$c2"
  check '发版历史记了回滚' equals "$(tail -n 1 "$history" | cut -f2,3)" "rollback"$'\t'"$c1"
  check '回滚不删任何镜像' not_logged 'EVENT rm'
  check '手动回滚仍带推送挂载' logged "-f $srv/src/deploy/prod/push.override.yml up -d --wait app caddy"

  echo '回滚到不带推送操作脚本的老源码后，固定运维入口仍保留配置'
  STUB_APPLIED='0001_a 0002_b' run_srv "$srv/ops/current/rollback.sh" "$old"
  check '固定入口回滚成功' equals "$rc" 0
  check '应用指向老源码' equals "$(current_src)" "$srv/releases/$old"
  check '固定运维仍来自新提交' equals "$(cat "$srv/ops/current/source-commit")" "$c2"
  check '老版本启动保留推送配置' logged "-f $srv/src/deploy/prod/push.override.yml up -d --wait app caddy"
  run_srv "$srv/ops/current/backup.sh" "$backups"
  check '老源码下固定备份成功' equals "$rc" 0
  check '备份操作仍带推送配置' logged "-f $srv/src/deploy/prod/push.override.yml"
  check '备份恢复原应用容器' logged 'EVENT start-app'
else
  echo 'release.sh / rollback.sh：本机不能建软链接，跳过（CI 会做）'
fi

if ((failures > 0)); then
  echo "香港运维脚本检查：$failures 项失败" >&2
  exit 1
fi
echo '香港运维脚本检查全部通过'
