#!/usr/bin/env bash
# 发版后清理（香港服务器，root）。release.sh 最后一步自动调用；收到磁盘告警时也可手动运行：
#   bash /srv/weiban/src/deploy/hk/release-prune.sh            # 实际清理
#   bash /srv/weiban/src/deploy/hk/release-prune.sh --dry-run  # 只列出会删什么，不删
#
# 保留口径（总经理 2026-11-03）：只留当前版本和最近 KEEP_ROLLBACK_VERSIONS（默认 2）个可回退版本，镜像和源码目录同一口径。
#   - 当前版本：runtime.env 的 APP_IMAGE / EDGE_IMAGE，src 软链接指向的目录。
#   - 可回退版本：按发版历史 release-state/history.tsv（release.sh、rollback.sh 写）的部署先后从新到旧取，
#     与 rollback.sh 的「上一版 / 上上一版」是同一份名单；历史里不够时（例如还没用过 release.sh），
#     镜像按构建时间、源码目录按修改时间补足。
#   - :hk 标签改指当前版本（它只是 runtime.env.example 的兜底名），不再单独留一份旧镜像。
#   - 安全底线：任何容器（包括已停止的）在用的镜像、被任何容器挂载的源码目录也保留。
# 删除：weiban-app / weiban-edge 里其余标签和悬空镜像；超过 BUILD_CACHE_UNTIL（默认 24h）没用过的构建缓存；
#   releases/ 下其余源码目录和旧版本的 .tar / .tgz 源码包；src.before-* 软链接里指向已删除或已不存在目录的。
# 不碰：数据库、媒体卷、备份、其他仓库的镜像（postgres、caddy 等）、src.old* 等历史目录、/var/lib/weiban/releases。
# 从不加 -f：docker 本身也会拒绝删除容器在用的镜像。说明见 docs/ops/hk-server.md「六、磁盘、备份与清理」。
set -euo pipefail
export LC_ALL=C
# shellcheck source=deploy/hk/ops-lib.sh
. "$(dirname -- "${BASH_SOURCE[0]}")/ops-lib.sh"
ENV_FILE=$WEIBAN_DEPLOY_ENV
SRC_LINK=$WEIBAN_SRC
RELEASES_DIR=$WEIBAN_RELEASES_DIR
LINKS_DIR=$(dirname -- "$SRC_LINK")
KEEP_ROLLBACK=${KEEP_ROLLBACK_VERSIONS:-2}
BUILD_CACHE_UNTIL=${BUILD_CACHE_UNTIL-24h}
dry_run=0
case ${1:-} in
  --dry-run) dry_run=1 ;;
  '') ;;
  *)
    echo "用法：$0 [--dry-run]" >&2
    exit 2
    ;;
esac
die() {
  echo "拒绝清理：$1" >&2
  exit 1
}
[[ $KEEP_ROLLBACK =~ ^[0-9]+$ ]] || die 'KEEP_ROLLBACK_VERSIONS 必须是非负整数'
case $RELEASES_DIR in /?*/?*) ;; *) die "源码目录 $RELEASES_DIR 不像发版目录" ;; esac
[[ -r $ENV_FILE ]] || die "读不到 $ENV_FILE"

echo '清理前：'
docker system df || true

# ---------- 当前版本 ----------
declare -A keep=() current_of=() current_ref=() keep_dir=()
repos=()
cur_ids=()
for var in APP_IMAGE EDGE_IMAGE; do
  ref=$(kv_get "$ENV_FILE" "$var")
  [[ -n $ref ]] || die "$ENV_FILE 里没有 $var"
  id=$(image_id "$ref") || die "当前镜像 $ref 不存在"
  repo=${ref%:*}
  keep[$id]=1
  current_of[$repo]=$id
  current_ref[$repo]=$ref
  repos+=("$repo")
  cur_ids+=("$id")
  echo "保留当前版本 $ref（$(short_id "$id")）"
done
current_src=
if [[ -L $SRC_LINK ]]; then
  current_src=$(readlink -f -- "$SRC_LINK")
  keep_dir[$current_src]=1
fi

# ---------- 可回退版本：先按发版历史 ----------
from_history=0
while IFS=$'\t' read -r commit _ app edge app_id edge_id src at; do
  keep[$app_id]=1
  keep[$edge_id]=1
  from_history=$((from_history + 1))
  if [[ $src != - && -d $src ]]; then keep_dir[$(readlink -f -- "$src")]=1; fi
  echo "保留可回退版本 ${commit:0:12}（部署于 $at；$app $(short_id "$app_id")，$edge $(short_id "$edge_id")）"
done < <(rollback_versions "${cur_ids[0]}" "${cur_ids[1]}" "$current_src" "$KEEP_ROLLBACK")
slots=$((KEEP_ROLLBACK - from_history))

# 按构建时间从新到旧列出某仓库的镜像：每行「构建时间 镜像ID 标签」。
list_repo() {
  local refs ref
  refs=$(docker image ls --format '{{.Repository}}:{{.Tag}}' "$1") || return 1
  while IFS= read -r ref; do
    [[ -n $ref && $ref != *:'<none>' ]] || continue
    docker image inspect --format "{{.Created}} {{.Id}} $ref" "$ref" 2>/dev/null || true
  done <<<"$refs"
}

# ---------- 历史不够时按构建时间补足（:hk 不算，它马上改指当前版本） ----------
if ((slots > 0)); then
  for repo in "${repos[@]}"; do
    filled=0
    while read -r _ id ref; do
      ((filled < slots)) || break
      [[ $ref != "$repo:hk" && -z ${keep[$id]:-} ]] || continue
      keep[$id]=1
      filled=$((filled + 1))
      echo "保留可回退版本 $ref（$(short_id "$id")，发版历史不够，按构建时间补足）"
    done < <(list_repo "$repo" | sort -r)
  done
fi

# ---------- 安全底线：容器在用的镜像 ----------
container_ids=$(docker ps -aq) || die '读不到容器列表'
containers=()
while IFS= read -r cid; do
  if [[ -n $cid ]]; then containers+=("$cid"); fi
done <<<"$container_ids"
if ((${#containers[@]} > 0)); then
  usage=$(docker inspect --format '{{.Image}}|{{.Config.Image}}' "${containers[@]}") || die '读不到容器所用镜像'
  while IFS='|' read -r used config_ref; do
    if [[ -n $used ]]; then keep[$used]=1; fi
    if [[ -n $config_ref ]] && id=$(image_id "$config_ref"); then keep[$id]=1; fi
  done <<<"$usage"
  echo "保留 ${#containers[@]} 个容器（含已停止的）正在用的镜像"
fi

# ---------- :hk 改指当前版本 ----------
for repo in "${repos[@]}"; do
  hk_id=$(image_id "$repo:hk") || hk_id=
  if [[ $hk_id == "${current_of[$repo]}" ]]; then
    echo "$repo:hk 已指向当前版本"
  elif ((dry_run)); then
    echo "[演练] 将把 $repo:hk 改指当前版本 ${current_ref[$repo]}${hk_id:+（原来的 $(short_id "$hk_id") 没有别的标签时会作为悬空镜像清掉）}"
  else
    docker tag "${current_ref[$repo]}" "$repo:hk"
    echo "已把 $repo:hk 改指当前版本 ${current_ref[$repo]}"
  fi
done

# ---------- 删除其余标签 ----------
for repo in "${repos[@]}"; do
  refs=$(docker image ls --format '{{.Repository}}:{{.Tag}}' "$repo") || die "读不到 $repo 的镜像列表"
  while IFS= read -r ref; do
    [[ -n $ref && $ref != *:'<none>' && $ref != "$repo:hk" ]] || continue
    id=$(image_id "$ref") || continue
    [[ -z ${keep[$id]:-} ]] || continue
    if ((dry_run)); then
      echo "[演练] 将删除镜像标签 $ref（$(short_id "$id")）"
    elif docker image rm "$ref" >/dev/null; then
      echo "已删除镜像标签 $ref（$(short_id "$id")）"
    else
      echo "跳过 $ref：docker 拒绝删除（可能仍被容器使用）" >&2
    fi
  done <<<"$refs"
done

# ---------- 旧源码目录与源码包 ----------
prune_release_dirs() {
  [[ -d $RELEASES_DIR ]] || return 0
  if [[ -z $current_src ]]; then
    echo "$SRC_LINK 不是软链接，无法确定当前版本，跳过源码目录清理" >&2
    return 1
  fi
  if [[ ! -d $current_src ]]; then
    echo "当前源码目录 $current_src 不存在，跳过源码目录清理" >&2
    return 1
  fi
  local mounts="" dir real mount_src in_use filled=0 file name kept_file d tag
  if ((${#containers[@]} > 0)); then
    # 例如 postgres 挂载了源码里的初始化脚本目录：这类目录删了，容器下次启动会失败。
    mounts=$(docker inspect --format '{{range .Mounts}}{{.Source}}{{"\n"}}{{end}}' "${containers[@]}") ||
      die '读不到容器挂载'
  fi
  local -a dirs=()
  mapfile -t dirs < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -rn | cut -d' ' -f2-)
  for dir in "${dirs[@]}"; do
    real=$(readlink -f -- "$dir")
    if [[ -n ${keep_dir[$real]:-} ]]; then
      echo "保留源码 $dir（当前或可回退版本）"
      continue
    fi
    in_use=0
    while IFS= read -r mount_src; do
      [[ -n $mount_src ]] || continue
      case $mount_src in "$dir" | "$dir"/* | "$real" | "$real"/*) in_use=1 ;; esac
    done <<<"$mounts"
    if ((in_use)); then
      keep_dir[$real]=1
      echo "保留 $dir：有容器挂载了其中的文件"
      continue
    fi
    if ((filled < slots)); then
      filled=$((filled + 1))
      keep_dir[$real]=1
      echo "保留源码 $dir（发版历史不够，按修改时间补足）"
      continue
    fi
    if ((dry_run)); then
      echo "[演练] 将删除源码目录 $dir"
    else
      rm -rf --one-file-system -- "$dir"
      echo "已删除源码目录 $dir"
    fi
  done
  # 源码包：文件名里带着保留版本目录名（前 12 位）的留下，其余删除；别的类型的文件不碰。
  for file in "$RELEASES_DIR"/*.tar "$RELEASES_DIR"/*.tgz "$RELEASES_DIR"/*.tar.gz; do
    [[ -f $file ]] || continue
    name=$(basename -- "$file")
    kept_file=0
    for d in "${!keep_dir[@]}"; do
      tag=$(basename -- "$d")
      tag=${tag:0:12}
      if [[ -n $tag && $name == *"$tag"* ]]; then kept_file=1; fi
    done
    if ((kept_file)); then
      echo "保留源码包 $file"
    elif ((dry_run)); then
      echo "[演练] 将删除源码包 $file"
    else
      rm -f -- "$file"
      echo "已删除源码包 $file"
    fi
  done
}

# src.before-* 软链接：指向已不存在的目录、或指向这次清理掉的发版目录的删除；指向保留目录的留下；
# 指向 releases 以外仍存在的目录的不动（不在自动清理范围，人工判断）。只删链接本身。
prune_before_links() {
  local link target releases_real reason
  releases_real=$(readlink -f -- "$RELEASES_DIR")
  for link in "$LINKS_DIR"/src.before-*; do
    [[ -L $link ]] || continue
    if [[ ! -e $link ]]; then
      reason='指向的目录已不存在'
    else
      target=$(readlink -f -- "$link")
      if [[ -n ${keep_dir[$target]:-} ]]; then
        echo "保留软链接 $link → $target"
        continue
      fi
      case $target in
        "$releases_real"/*) reason='指向的源码目录按口径清理' ;;
        *)
          echo "保留软链接 $link → $target（不在 releases 下，不在自动清理范围）"
          continue
          ;;
      esac
    fi
    if ((dry_run)); then
      echo "[演练] 将删除软链接 $link（$reason）"
    else
      rm -f -- "$link"
      echo "已删除软链接 $link（$reason）"
    fi
  done
}
if prune_release_dirs; then prune_before_links; fi

# ---------- 悬空镜像与构建缓存 ----------
cache_args=(--all --force)
[[ -z $BUILD_CACHE_UNTIL ]] || cache_args+=(--filter "until=$BUILD_CACHE_UNTIL")
if ((dry_run)); then
  echo '[演练] 将执行 docker image prune --force'
  if [[ -f ${WEIBAN_BUILD_CACHE_CONFIG:-/srv/weiban/ops-state/build-cache.env} ]]; then
    bash "$(dirname -- "${BASH_SOURCE[0]}")/build-cache.sh" dry-run
  else
    echo "[演练] 将执行 docker builder prune ${cache_args[*]}"
  fi
else
  docker image prune --force
  if [[ -f ${WEIBAN_BUILD_CACHE_CONFIG:-/srv/weiban/ops-state/build-cache.env} ]]; then
    bash "$(dirname -- "${BASH_SOURCE[0]}")/build-cache.sh" prune
  else
    docker builder prune "${cache_args[@]}"
  fi
fi

echo '清理后：'
docker system df || true
df -h -- "$RELEASES_DIR" / || true
