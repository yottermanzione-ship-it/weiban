#!/usr/bin/env bash
# 发版后清理（香港服务器，root）。新版本切换完成、健康检查通过之后运行：
#   bash /srv/weiban/src/deploy/hk/release-prune.sh            # 实际清理
#   bash /srv/weiban/src/deploy/hk/release-prune.sh --dry-run  # 只列出会删什么，不删
#
# 保留：runtime.env 里 APP_IMAGE / EDGE_IMAGE 指向的当前版本、上一版（回滚用）、:hk 标签，
#       以及任何容器（包括已停止的）正在用的镜像。
# 删除：当前镜像所在仓库（weiban-app、weiban-edge）里其余的标签；悬空镜像；超过 BUILD_CACHE_UNTIL
#       （默认 24h）没用过的构建缓存；RELEASES_DIR 下当前版本和最近 KEEP_PREVIOUS_RELEASES（默认 1）个之外的源码目录。
# 上一版默认取「除当前版本外最新构建的镜像」。发版脚本知道回滚标签时（例如 before-<短号>），
# 用 ROLLBACK_APP_IMAGE / ROLLBACK_EDGE_IMAGE 显式指定；刚回滚过时必须显式指定。
# 不碰：数据库、媒体卷、备份、其他仓库的镜像（postgres、caddy 等）、被任何容器挂载的源码目录。
# 从不加 -f：docker 本身也会拒绝删除容器在用的镜像。说明见 docs/ops/hk-server.md「六、磁盘、备份与清理」。
set -euo pipefail
export LC_ALL=C
ENV_FILE=${WEIBAN_DEPLOY_ENV:-/srv/weiban/runtime.env}
SRC_LINK=${WEIBAN_SRC:-/srv/weiban/src}
RELEASES_DIR=${WEIBAN_RELEASES_DIR:-/srv/weiban/releases}
KEEP_PREVIOUS=${KEEP_PREVIOUS_RELEASES:-1}
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
[[ $KEEP_PREVIOUS =~ ^[0-9]+$ ]] || die 'KEEP_PREVIOUS_RELEASES 必须是非负整数'
case $RELEASES_DIR in /?*/?*) ;; *) die "源码目录 $RELEASES_DIR 不像发版目录" ;; esac
[[ -r $ENV_FILE ]] || die "读不到 $ENV_FILE"

env_value() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1 | tr -d "\"'\r"; }
image_id() { docker image inspect --format '{{.Id}}' "$1" 2>/dev/null; }
short() { local id=${1#sha256:}; printf '%s' "${id:0:12}"; }

echo '清理前：'
docker system df || true

# ---------- 要保留的镜像 ----------
declare -A keep=() current_of=() rollback_of=()
repos=()
for var in APP_IMAGE EDGE_IMAGE; do
  ref=$(env_value "$var")
  [[ -n $ref ]] || die "$ENV_FILE 里没有 $var"
  id=$(image_id "$ref") || die "当前镜像 $ref 不存在"
  repo=${ref%:*}
  keep[$id]=1
  current_of[$repo]=$id
  rollback_var=ROLLBACK_$var
  rollback_of[$repo]=${!rollback_var:-}
  repos+=("$repo")
  echo "保留当前版本 $ref（$(short "$id")）"
done

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

# 按构建时间从新到旧列出某仓库的镜像：每行「构建时间 镜像ID 标签」。
list_repo() {
  local refs ref
  refs=$(docker image ls --format '{{.Repository}}:{{.Tag}}' "$1") || return 1
  while IFS= read -r ref; do
    [[ -n $ref && $ref != *:'<none>' ]] || continue
    docker image inspect --format "{{.Created}} {{.Id}} $ref" "$ref" 2>/dev/null || true
  done <<<"$refs"
}

for repo in "${repos[@]}"; do
  if id=$(image_id "$repo:hk"); then
    keep[$id]=1
    echo "保留 $repo:hk（$(short "$id")）"
  fi
  explicit=${rollback_of[$repo]}
  if [[ -n $explicit ]]; then
    id=$(image_id "$explicit") || die "指定的回滚镜像 $explicit 不存在"
    keep[$id]=1
    echo "保留上一版 $explicit（$(short "$id")，发版脚本指定）"
    continue
  fi
  previous=$(list_repo "$repo" | sort -r | awk -v cur="${current_of[$repo]}" '!found && $2 != cur { print $2 " " $3; found = 1 }')
  if [[ -n $previous ]]; then
    keep[${previous%% *}]=1
    echo "保留上一版 ${previous#* }（$(short "${previous%% *}")，除当前外最新构建）"
  fi
done

# ---------- 删除其余标签 ----------
for repo in "${repos[@]}"; do
  refs=$(docker image ls --format '{{.Repository}}:{{.Tag}}' "$repo") || die "读不到 $repo 的镜像列表"
  while IFS= read -r ref; do
    [[ -n $ref && $ref != *:'<none>' ]] || continue
    id=$(image_id "$ref") || continue
    [[ -z ${keep[$id]:-} ]] || continue
    if ((dry_run)); then
      echo "[演练] 将删除镜像标签 $ref（$(short "$id")）"
    elif docker image rm "$ref" >/dev/null; then
      echo "已删除镜像标签 $ref（$(short "$id")）"
    else
      echo "跳过 $ref：docker 拒绝删除（可能仍被容器使用）" >&2
    fi
  done <<<"$refs"
done

# ---------- 旧源码目录 ----------
prune_release_dirs() {
  [[ -d $RELEASES_DIR ]] || return 0
  if [[ ! -L $SRC_LINK ]]; then
    echo "$SRC_LINK 不是软链接，无法确定当前版本，跳过源码目录清理" >&2
    return 0
  fi
  local current mounts="" dir real mount_src in_use kept=0
  current=$(readlink -f -- "$SRC_LINK")
  if [[ ! -d $current ]]; then
    echo "当前源码目录 $current 不存在，跳过源码目录清理" >&2
    return 0
  fi
  if ((${#containers[@]} > 0)); then
    # 例如 postgres 挂载了源码里的初始化脚本目录：这类目录删了，容器下次启动会失败。
    mounts=$(docker inspect --format '{{range .Mounts}}{{.Source}}{{"\n"}}{{end}}' "${containers[@]}") ||
      die '读不到容器挂载'
  fi
  local -a dirs=()
  mapfile -t dirs < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -rn | cut -d' ' -f2-)
  for dir in "${dirs[@]}"; do
    real=$(readlink -f -- "$dir")
    if [[ $real == "$current" ]]; then
      echo "保留当前源码 $dir"
      continue
    fi
    in_use=0
    while IFS= read -r mount_src; do
      [[ -n $mount_src ]] || continue
      case $mount_src in "$dir" | "$dir"/* | "$real" | "$real"/*) in_use=1 ;; esac
    done <<<"$mounts"
    if ((in_use)); then
      echo "保留 $dir：有容器挂载了其中的文件"
      continue
    fi
    if ((kept < KEEP_PREVIOUS)); then
      kept=$((kept + 1))
      echo "保留上一版源码 $dir"
      continue
    fi
    if ((dry_run)); then
      echo "[演练] 将删除源码目录 $dir"
    else
      rm -rf --one-file-system -- "$dir"
      echo "已删除源码目录 $dir"
    fi
  done
}
prune_release_dirs

# ---------- 悬空镜像与构建缓存 ----------
cache_args=(--all --force)
[[ -z $BUILD_CACHE_UNTIL ]] || cache_args+=(--filter "until=$BUILD_CACHE_UNTIL")
if ((dry_run)); then
  echo '[演练] 将执行 docker image prune --force'
  echo "[演练] 将执行 docker builder prune ${cache_args[*]}"
else
  docker image prune --force
  docker builder prune "${cache_args[@]}"
fi

echo '清理后：'
docker system df || true
df -h -- "$RELEASES_DIR" / || true
