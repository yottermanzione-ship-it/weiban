#!/usr/bin/env bash
# 香港服务器发版（root）：把一个已合并进 main 的提交上线。
#   开发机：bash deploy/hk/upload-release.sh <提交>   # 闸门检查 + 分片上传 + 校验，最后打印服务器上要执行的命令
#   服务器：bash /tmp/rel-<提交>.release.sh [选项] <完整提交号>
#           （也可以用 /srv/weiban/src/deploy/hk/release.sh，效果一样：辅助脚本都从新版本目录里取）
# 选项：
#   --pr 52,53       写进 deployment-version.txt 的 pullRequest
#   --note 文字      写进 deployment-version.txt 的 deployedBy
#   --no-prune       最后不自动清理（新清理规则第一次上线时用：先手动 release-prune.sh --dry-run 核对）
#   --force-backup   不含迁移也先备份
#
# 步骤（任何一步失败就停；切换之前失败，线上一直是原版本）：
#   1. 检查：提交号、加锁、src 是软链接、源码包校验和；
#   2. 解压到 releases/<提交>（目录已存在就直接用，例如上次构建失败后重跑）；
#   3. 检查 runtime.env、当前镜像、数据盘剩余空间；构建 <仓库>:release-<提交>（应用照常运行）；
#   4. 要不要备份（总经理 2026-11-03）：含数据库迁移 → 先备份；不含 → 24 小时内有完整备份就不备份，没有就备份。
#      备份走 systemctl start weiban-backup.service：与每日备份同一脚本、目录、保留规则，备份期间停站两三分钟；
#   5. 当前镜像打 before-<新短号> 回滚标签，旧源码留 src.before-<新短号> 软链接，runtime.env 存一份到 release-state/；
#   6. 切换 runtime.env 的镜像和 src 软链接，up -d --wait app caddy（含迁移时 migrate 先跑完才启动应用）；
#      没通过：不含迁移就自动退回原版本；含迁移不自动退（旧版本认不得新迁移），按提示处理；
#   7. 写 deployment-version.txt（字段沿用手工发版），追加发版历史 release-state/history.tsv；
#   8. 调用新版本的 release-prune.sh：只留当前 + 2 个可回退版本。
# 说明见 docs/ops/hk-server.md 第四节、第六节。
set -euo pipefail
umask 022
export LC_ALL=C
# 与 ops-lib.sh 的默认值一致；先导出，下面引用新版本的 ops-lib.sh 和 release-prune.sh 时沿用。
export WEIBAN_SRC=${WEIBAN_SRC:-/srv/weiban/src}
export WEIBAN_RELEASES_DIR=${WEIBAN_RELEASES_DIR:-/srv/weiban/releases}
export WEIBAN_STATE_DIR=${WEIBAN_STATE_DIR:-/srv/weiban/release-state}
ARCHIVE_DIR=${RELEASE_ARCHIVE_DIR:-/tmp}
BACKUP_ROOT=${RELEASE_BACKUP_ROOT:-/var/backups/weiban}
BACKUP_MAX_AGE_MINUTES=${RELEASE_BACKUP_MAX_AGE_MINUTES:-1440}
MIN_FREE=${RELEASE_MIN_FREE_BYTES:-4294967296}
LOCK_FILE=${RELEASE_LOCK_FILE:-/run/lock/weiban-release.lock}

die() {
  echo "发版停止：$1" >&2
  exit 1
}
usage() {
  echo "用法：$0 [--pr 号] [--note 说明] [--no-prune] [--force-backup] <完整提交号>" >&2
  exit 2
}

pr=- note=release.sh prune=1 force_backup=0 commit=
while (($#)); do
  case $1 in
    --pr)
      (($# >= 2)) || usage
      pr=$2
      shift 2
      ;;
    --note)
      (($# >= 2)) || usage
      note=$2
      shift 2
      ;;
    --no-prune) prune=0 && shift ;;
    --force-backup) force_backup=1 && shift ;;
    -h | --help) usage ;;
    -*) usage ;;
    *)
      [[ -z $commit ]] || usage
      commit=$1
      shift
      ;;
  esac
done

# ---------- 1. 检查（还没改动任何东西） ----------
[[ $commit =~ ^[0-9a-f]{40}$ ]] || die '要写完整的 40 位提交号（git rev-parse <提交>）'
[[ $BACKUP_MAX_AGE_MINUTES =~ ^[1-9][0-9]*$ && $MIN_FREE =~ ^[0-9]+$ ]] || die '备份时限或空间下限参数不是数字'
S=${commit:0:8}
D=$WEIBAN_RELEASES_DIR/$commit
archive=$ARCHIVE_DIR/rel-$commit.tgz
meta=$ARCHIVE_DIR/rel-$commit.meta
state_meta=$WEIBAN_STATE_DIR/rel-$commit.meta
if command -v flock >/dev/null; then
  mkdir -p -- "$(dirname -- "$LOCK_FILE")"
  exec 8>"$LOCK_FILE" || die "无法打开锁文件 $LOCK_FILE"
  flock -n 8 || die '已有另一个发版或回滚正在进行'
fi
[[ -L $WEIBAN_SRC ]] || die "$WEIBAN_SRC 不是软链接，不知道当前版本在哪"
OLD=$(readlink -f -- "$WEIBAN_SRC")
[[ -d $OLD ]] || die "当前源码目录 $OLD 不存在"
[[ $OLD != "$(readlink -m -- "$D")" ]] || die "$commit 已经是当前版本"
mkdir -p -- "$WEIBAN_STATE_DIR"

# ---------- 2. 解压 ----------
if [[ -d $D ]]; then
  echo "源码目录 $D 已存在（上次没做完？），直接使用，不再解压"
  [[ -f $D/deploy/prod/compose.yml && -f $D/deploy/hk/ops-lib.sh ]] || die "$D 不完整：删掉它，重新上传后再发版"
  [[ ! -f $meta ]] || cp -f -- "$meta" "$state_meta"
else
  [[ -f $archive && -f $meta ]] ||
    die "找不到 $archive 或 $meta：先在开发机运行 bash deploy/hk/upload-release.sh $commit"
  [[ $(sed -n 's/^commit=//p' "$meta") == "$commit" ]] || die "$meta 里的提交号对不上"
  want=$(sed -n 's/^sha256=//p' "$meta")
  got=$(sha256sum -- "$archive" | cut -d' ' -f1)
  [[ -n $want && $got == "$want" ]] || die "源码包校验和不对（应为 $want，实际 $got），请重新上传"
  partial=$WEIBAN_RELEASES_DIR/.partial-$commit
  rm -rf -- "$partial"
  mkdir -p -- "$partial"
  tar -xzf "$archive" -C "$partial"
  mv -T -- "$partial" "$D"
  cp -f -- "$meta" "$state_meta"
  echo "已解压到 $D"
fi
tree=$(sed -n 's/^tree=//p' "$state_meta" 2>/dev/null) || tree=
tree=${tree:--}

# 辅助函数和清理脚本都用新版本里的，保证与这次发布的代码一致。
# shellcheck source=deploy/hk/ops-lib.sh
. "$D/deploy/hk/ops-lib.sh"
declare -F history_add >/dev/null || die "$D 里的 ops-lib.sh 太旧，不能用本脚本发布"

# ---------- 3. 检查与构建（应用照常运行） ----------
[[ -r $WEIBAN_DEPLOY_ENV ]] || die "读不到 $WEIBAN_DEPLOY_ENV"
OLDAPP=$(kv_get "$WEIBAN_DEPLOY_ENV" APP_IMAGE)
OLDEDGE=$(kv_get "$WEIBAN_DEPLOY_ENV" EDGE_IMAGE)
[[ -n $OLDAPP && -n $OLDEDGE ]] || die "$WEIBAN_DEPLOY_ENV 里没有 APP_IMAGE / EDGE_IMAGE"
image_id "$OLDAPP" >/dev/null || die "当前镜像 $OLDAPP 不存在"
image_id "$OLDEDGE" >/dev/null || die "当前镜像 $OLDEDGE 不存在"
OLDC=$(kv_get "$WEIBAN_VERSION_FILE" sourceCommit)
[[ -n $OLDC ]] || OLDC=$(basename -- "$OLD")
APP_NEW=${OLDAPP%:*}:release-$commit
EDGE_NEW=${OLDEDGE%:*}:release-$commit
avail=$(df -B1 --output=avail -- "$WEIBAN_RELEASES_DIR" | tail -n 1 | tr -dc '0-9') || avail=
[[ -n $avail ]] || die '读不到数据盘剩余空间'
((avail >= MIN_FREE)) ||
  die "数据盘只剩 $(human_bytes "$avail")，构建至少要 $(human_bytes "$MIN_FREE")。先运行 bash $WEIBAN_SRC/deploy/hk/release-prune.sh --dry-run 看能清什么"

echo "构建 $APP_NEW、$EDGE_NEW（应用照常运行）"
build_compose=(docker compose --env-file "$WEIBAN_DEPLOY_ENV" -p "${WEIBAN_COMPOSE_PROJECT:-weiban-prod}"
  -f "$D/deploy/prod/compose.yml" -f "$D/deploy/hk/compose.override.yml")
APP_IMAGE=$APP_NEW EDGE_IMAGE=$EDGE_NEW "${build_compose[@]}" build app caddy || die '构建失败，线上仍是原版本'
{ image_id "$APP_NEW" && image_id "$EDGE_NEW"; } >/dev/null || die '构建命令成功了，但找不到新镜像'

# ---------- 4. 要不要备份 ----------
new_journal=$D/apps/server/drizzle/meta/_journal.json
old_journal=$OLD/apps/server/drizzle/meta/_journal.json
[[ -f $new_journal ]] || die "新版本缺少迁移清单 $new_journal"
has_migration=0
new_migrations=()
if [[ ! -f $old_journal ]] || ! cmp -s -- "$old_journal" "$new_journal"; then
  has_migration=1
  mapfile -t new_migrations < <(comm -13 <(journal_tags "$old_journal" 2>/dev/null | sort) <(journal_tags "$new_journal" | sort))
fi
# 备份目录里最新的完整备份（有 manifest.txt）；额外参数传给 find，例如 -mmin -1440。
latest_backup() {
  { find "$BACKUP_ROOT" -mindepth 2 -maxdepth 2 -name manifest.txt -path "$BACKUP_ROOT/weiban-*" "$@" -printf '%h\n' 2>/dev/null || true; } |
    sort | tail -n 1
}
run_backup() {
  echo "$1，先备份（停站两三分钟）：systemctl start weiban-backup.service"
  systemctl start weiban-backup.service ||
    die '备份失败，发版停止（线上仍是原版本，新镜像已构建好）。原因看 journalctl -u weiban-backup.service -n 50'
  backup_dir=$(latest_backup -mmin -120)
  [[ -n $backup_dir ]] || die "备份命令成功了，但 $BACKUP_ROOT 里找不到刚做的完整备份（weiban-backup.service 的目标目录不是这里？）"
  echo "已备份：$backup_dir"
}
backup_dir=
if ((has_migration)); then
  run_backup "这次含数据库迁移（${new_migrations[*]:-清单有改动}）"
elif ((force_backup)); then
  run_backup '按 --force-backup'
else
  backup_dir=$(latest_backup -mmin "-$BACKUP_MAX_AGE_MINUTES")
  if [[ -n $backup_dir ]]; then
    echo "不含数据库迁移，用 $((BACKUP_MAX_AGE_MINUTES / 60)) 小时内的完整备份 $backup_dir，不再备份"
  else
    run_backup "不含数据库迁移，但 $((BACKUP_MAX_AGE_MINUTES / 60)) 小时内没有完整备份"
  fi
fi

# ---------- 5. 回滚标签与现状记录 ----------
docker tag "$OLDAPP" "${OLDAPP%:*}:before-$S"
docker tag "$OLDEDGE" "${OLDEDGE%:*}:before-$S"
ln -sfn -- "$OLD" "$(dirname -- "$WEIBAN_SRC")/src.before-$S"
saved_env=$WEIBAN_STATE_DIR/runtime.env.before-$commit
cp -p -- "$WEIBAN_DEPLOY_ENV" "$saved_env"
# 第一次用本脚本：按现状补上当前版和上一版，「当前 + 2」才数得对。
if [[ ! -s $WEIBAN_HISTORY ]]; then
  history_seed_lines >>"$WEIBAN_HISTORY"
  echo "发版历史还没有，已按现状补记：$WEIBAN_HISTORY"
fi

# ---------- 6. 切换 ----------
echo "切换到 $commit"
set_env_images "$APP_NEW" "$EDGE_NEW"
switch_src "$D"
if ! "${weiban_compose[@]}" up -d --wait app caddy; then
  C=$(printf '%q ' "${weiban_compose[@]}")
  if ((has_migration)); then
    cat >&2 <<EOF
发版失败：新版本没有通过健康检查。这次含数据库迁移（${new_migrations[*]:-清单有改动}），
旧版本可能认不得已执行的新迁移，所以没有自动退回。现在 runtime.env 和 src 指向新版本。
处理办法（任选其一）：
  1. 看日志：${C}logs --tail 200 migrate app
     修好后重新执行：${C}up -d --wait app caddy
  2. 退回上一版：bash $WEIBAN_SRC/deploy/hk/rollback.sh 1（会先查数据库迁移，按提示操作）
  3. 用发版前备份恢复：$backup_dir（docs/ops/hk-server.md 第四节「恢复」）
EOF
    exit 1
  fi
  echo "新版本没有通过健康检查，自动退回 $OLDC" >&2
  cp -p -- "$saved_env" "$WEIBAN_DEPLOY_ENV"
  switch_src "$OLD"
  if "${weiban_compose[@]}" up -d --wait app caddy; then
    die "已自动退回原版本 $OLDC，线上正常。新版本的问题看：docker logs --tail 200 <app 容器>（新镜像 $APP_NEW 还在）"
  fi
  die "自动退回后应用也没有恢复健康，网站可能已停止，请立即处理：${C}ps"
fi

# ---------- 7. 记录 ----------
migrations=none
if ((has_migration)); then migrations=$(IFS=,; echo "${new_migrations[*]:-changed}"); fi
contract=$(contract_version "$D")
write_version_file "$commit" "$tree" "$APP_NEW" "$EDGE_NEW" "$OLDC" "${backup_dir:--}" "$pr" "${contract:-unknown}" \
  "$migrations" "${OLDAPP%:*}:before-$S,${OLDEDGE%:*}:before-$S" "$(dirname -- "$WEIBAN_SRC")/src.before-$S" "$note"
history_add release "$commit" "$tree" "$APP_NEW" "$EDGE_NEW" "$D"
print_health
echo "已上线 $commit（契约 ${contract:-?}，迁移 $migrations，备份 ${backup_dir:--}）"

# ---------- 8. 清理 ----------
if ((prune)); then
  bash "$D/deploy/hk/release-prune.sh" ||
    echo "警告：发版后清理没做完（新版本已上线，不受影响）。稍后运行 bash $D/deploy/hk/release-prune.sh --dry-run 查看" >&2
else
  echo "按 --no-prune 跳过清理。核对清单：bash $D/deploy/hk/release-prune.sh --dry-run"
fi
rm -f -- "$archive" "$meta" "$ARCHIVE_DIR/rel-$commit.release.sh"
echo "发版完成。需要退回时：bash $WEIBAN_SRC/deploy/hk/rollback.sh --list"
