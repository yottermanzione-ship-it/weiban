#!/usr/bin/env bash
# 香港服务器回滚（root）：退回到发版后保留的上一版或上上一版。
#   bash /srv/weiban/src/deploy/hk/rollback.sh --list     # 只看有哪些版本可退，不改动
#   bash /srv/weiban/src/deploy/hk/rollback.sh 1          # 退回上一版
#   bash /srv/weiban/src/deploy/hk/rollback.sh 2          # 退回上上一版
#   bash /srv/weiban/src/deploy/hk/rollback.sh <提交号>   # 退回指定版本（至少 7 位，必须还在可回退列表里）
#   加 --dry-run：做完全部检查、打印计划，不切换。
# 「上一版」按发版历史 release-state/history.tsv 的部署先后排（与 release-prune.sh 保留的是同一份名单），不按提交时间。
# 只切换 runtime.env 的镜像和 src 软链接，再 up -d --wait app caddy：不删任何东西，不备份，不清理。
# 数据库迁移：数据库里已执行、但目标版本不认识的迁移，会让旧版本的 migrate 拒绝启动。脚本先查出这些迁移，
# 有就拒绝回滚，并打印两种处理办法（用当前版本执行 down 退掉这几个迁移，或用备份恢复），由人判断后执行。
set -euo pipefail
export LC_ALL=C
# shellcheck source=deploy/hk/ops-lib.sh
. "$(dirname -- "${BASH_SOURCE[0]}")/ops-lib.sh"
LOCK_FILE=${RELEASE_LOCK_FILE:-/run/lock/weiban-release.lock}

die() {
  echo "回滚停止：$1" >&2
  exit 1
}
usage() {
  echo "用法：$0 --list | [--dry-run] 1|2|<提交号>" >&2
  exit 2
}
list=0 dry_run=0 target=
while (($#)); do
  case $1 in
    --list) list=1 ;;
    --dry-run) dry_run=1 ;;
    -h | --help) usage ;;
    -*) usage ;;
    *)
      [[ -z $target ]] || usage
      target=$1
      ;;
  esac
  shift
done
((list)) || [[ -n $target ]] || usage

# ---------- 当前版本 ----------
[[ -L $WEIBAN_SRC ]] || die "$WEIBAN_SRC 不是软链接，不知道当前版本在哪"
cur_src=$(readlink -f -- "$WEIBAN_SRC")
[[ -r $WEIBAN_DEPLOY_ENV ]] || die "读不到 $WEIBAN_DEPLOY_ENV"
cur_app=$(kv_get "$WEIBAN_DEPLOY_ENV" APP_IMAGE)
cur_edge=$(kv_get "$WEIBAN_DEPLOY_ENV" EDGE_IMAGE)
cur_app_id=$(image_id "$cur_app") || cur_app_id=-
cur_edge_id=$(image_id "$cur_edge") || cur_edge_id=-
cur_commit=$(kv_get "$WEIBAN_VERSION_FILE" sourceCommit)
[[ -n $cur_commit ]] || cur_commit=$(basename -- "$cur_src")

# ---------- 可回退版本（镜像都还在的，按部署先后从新到旧） ----------
candidates=()
while IFS= read -r line; do
  if [[ -n $line ]]; then candidates+=("$line"); fi
done < <(rollback_versions "$cur_app_id" "$cur_edge_id" "$cur_src" 99)

echo "当前版本：${cur_commit:0:12}（$cur_app，源码 $cur_src）"
if ((${#candidates[@]} == 0)); then
  die '没有可退回的版本（发版历史里除当前外没有镜像还在的版本）'
fi
i=0
for line in "${candidates[@]}"; do
  i=$((i + 1))
  IFS=$'\t' read -r c _ app _ _ _ src at <<<"$line"
  label=$i
  ((i > 2)) && label="$i（超出保留口径，下次发版会被清理）"
  echo "  $label. ${c:0:12}  部署于 $at  $app  源码 $src"
done
((!list)) || exit 0

# ---------- 选目标 ----------
chosen=
case $target in
  1 | 2)
    ((target <= ${#candidates[@]})) || die "没有第 $target 个可回退版本"
    chosen=${candidates[target - 1]}
    ;;
  *)
    [[ $target =~ ^[0-9a-f]{7,40}$ ]] || usage
    for line in "${candidates[@]}"; do
      if [[ ${line%%$'\t'*} == "$target"* ]]; then
        [[ -z $chosen ]] || die "$target 对应多个版本，写长一点"
        chosen=$line
      fi
    done
    [[ -n $chosen ]] || die "$target 不在可回退列表里"
    ;;
esac
IFS=$'\t' read -r t_commit t_tree t_app t_edge t_app_id t_edge_id t_src _ <<<"$chosen"
[[ $t_src != - && -f $t_src/deploy/prod/compose.yml ]] || die "目标版本的源码目录 $t_src 不在了，不能用本脚本退回"

# ---------- 数据库迁移检查 ----------
target_journal=$t_src/apps/server/drizzle/meta/_journal.json
[[ -f $target_journal ]] || die "目标版本缺少迁移清单 $target_journal"
applied=$("${weiban_compose[@]}" exec -T postgres psql -X -U weiban -d weiban -tAc \
  'SELECT tag FROM public.schema_migrations ORDER BY tag') ||
  die '读不到数据库里已执行的迁移（数据库没在运行？），无法确认能否退回'
unknown=()
mapfile -t unknown < <(comm -23 <(printf '%s\n' "$applied" | tr -d '\r ' | sed '/^$/d' | sort -u) <(journal_tags "$target_journal" | sort -u))
if ((${#unknown[@]} > 0)); then
  C=$(printf '%q ' "${weiban_compose[@]}")
  cat >&2 <<EOF
回滚停止：数据库里有 ${#unknown[@]} 个已执行的迁移是目标版本 ${t_commit:0:12} 不认识的：
  ${unknown[*]}
直接退回的话，旧版本的 migrate 会拒绝启动，网站起不来。两种处理办法（都会改数据库，由总负责人判断）：
  A. 用当前版本把这 ${#unknown[@]} 个迁移退掉（执行各自的 .down.sql，新表、新列里的数据会丢）：
       ${C}run --rm --no-deps migrate node dist/migrate.js status   # 先确认最近执行的正是上面这些
       ${C}stop app
       ${C}run --rm --no-deps migrate node dist/migrate.js down ${#unknown[@]}
     然后重新运行本命令。
  B. 用发版前备份恢复（docs/ops/hk-server.md 第四节「恢复」）。
EOF
  exit 1
fi

echo "计划：退回 ${t_commit:0:12}（$t_app、$t_edge，源码 $t_src）；数据库迁移检查通过"
if ((dry_run)); then
  echo '[演练] 没有切换'
  exit 0
fi

# ---------- 切换 ----------
if command -v flock >/dev/null; then
  mkdir -p -- "$(dirname -- "$LOCK_FILE")"
  exec 8>"$LOCK_FILE" || die "无法打开锁文件 $LOCK_FILE"
  flock -n 8 || die '已有另一个发版或回滚正在进行'
fi
mkdir -p -- "$WEIBAN_STATE_DIR"
if [[ ! -s $WEIBAN_HISTORY ]]; then history_seed_lines >>"$WEIBAN_HISTORY"; fi
saved_env=$WEIBAN_STATE_DIR/runtime.env.before-rollback-$(date -u +%Y%m%dT%H%M%SZ)
cp -p -- "$WEIBAN_DEPLOY_ENV" "$saved_env"
# 标签被挪走或删掉、镜像还在时，按历史里的名字重新打上。
[[ $(image_id "$t_app" || true) == "$t_app_id" ]] || docker tag "$t_app_id" "$t_app"
[[ $(image_id "$t_edge" || true) == "$t_edge_id" ]] || docker tag "$t_edge_id" "$t_edge"
set_env_images "$t_app" "$t_edge"
switch_src "$t_src"
if ! "${weiban_compose[@]}" up -d --wait app caddy; then
  C=$(printf '%q ' "${weiban_compose[@]}")
  cat >&2 <<EOF
回滚失败：退回的版本没有通过健康检查。现在 runtime.env 和 src 指向 ${t_commit:0:12}。
  看日志：${C}logs --tail 200 migrate app
  原来的 runtime.env 存在 $saved_env，原源码目录 $cur_src。
EOF
  exit 1
fi
write_version_file "$t_commit" "$t_tree" "$t_app" "$t_edge" "$cur_commit" - - "$(contract_version "$t_src")" none \
  "$cur_app,$cur_edge" "$cur_src" "rollback.sh（从 ${cur_commit:0:12} 退回）"
history_add rollback "$t_commit" "$t_tree" "$t_app" "$t_edge" "$t_src"
print_health
echo "已退回 ${t_commit:0:12}。原版本 ${cur_commit:0:12} 的镜像和源码都还在；再发新版时按「当前 + 2」清理。"
