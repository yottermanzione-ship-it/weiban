#!/usr/bin/env bash
# 开发机（Windows Git Bash）把要发布的提交传到香港服务器，只上传、不切换、不重启任何东西：
#   bash deploy/hk/upload-release.sh <提交，例如 main 或完整提交号>
# 做的事：
#   1. 跑只读闸门 deploy/hk/Assert-ReleaseSource.ps1：要发布的提交必须包含最新 origin/main 和线上版本；
#   2. git archive 打包该提交，切成 4MB 分片逐片上传（10 月大文件 scp 会在二十几 MB 处断开）。
#      每片先比对服务器上已有分片的 SHA256，一致就跳过（断点续传）；不一致就传，最多重传一次；
#   3. 服务器上合并、核对整包 SHA256，写校验文件 /tmp/rel-<提交>.meta，再放一份同版本的 release.sh；
#   4. 打印服务器上要执行的发版命令（见 deploy/hk/release.sh）。
# 环境变量：WEIBAN_HK_HOST（默认 103.231.58.124）、WEIBAN_HK_KEY（默认 ~/.ssh/weiban_deploy）、
#   RELEASE_ARCHIVE_DIR（服务器上放源码包的目录，默认 /tmp）、UPLOAD_CHUNK_SIZE（默认 4M）。
# 说明见 docs/ops/hk-server.md 第四节。
# shellcheck disable=SC2029 # 远程命令里的路径和校验和故意在本机展开
set -euo pipefail
export LC_ALL=C
HOST=${WEIBAN_HK_HOST:-103.231.58.124}
KEY=${WEIBAN_HK_KEY:-$HOME/.ssh/weiban_deploy}
REMOTE_DIR=${RELEASE_ARCHIVE_DIR:-/tmp}
CHUNK=${UPLOAD_CHUNK_SIZE:-4M}
die() {
  echo "上传停止：$1" >&2
  exit 1
}
(($# == 1)) || {
  echo "用法：$0 <提交>" >&2
  exit 2
}
[[ $HOST =~ ^[A-Za-z0-9.-]+$ && $REMOTE_DIR =~ ^/[A-Za-z0-9._/-]+$ ]] || die '服务器地址或目录含有不允许的字符'
repo=$(git -C "$(dirname -- "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)
commit=$(git -C "$repo" rev-parse --verify --end-of-options "$1^{commit}") || die "$1 不是提交"
tree=$(git -C "$repo" rev-parse "$commit^{tree}")

# ---------- 1. 闸门 ----------
# RELEASE_GATE=skip 只给 CI 的行为用例用，真实发布不要跳过。
if [[ ${RELEASE_GATE:-assert} != skip ]]; then
  command -v powershell.exe >/dev/null || die '找不到 powershell.exe，无法运行发布闸门 Assert-ReleaseSource.ps1'
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$repo/deploy/hk/Assert-ReleaseSource.ps1" -Ref "$commit" ||
    die '发布闸门没通过（见上面的说明）'
fi

ssh_run() { ssh -o BatchMode=yes -o ConnectTimeout=15 -i "$KEY" "root@$HOST" "$@"; }
scp_put() { scp -q -o BatchMode=yes -o ConnectTimeout=15 -i "$KEY" "$1" "root@$HOST:$2"; }
sha_of() { sha256sum -- "$1" | cut -d' ' -f1; }
remote_sha() { ssh_run "sha256sum -- '$1' 2>/dev/null | cut -d' ' -f1" || true; }

# ---------- 2. 打包、切片、逐片上传 ----------
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
git -C "$repo" -c core.autocrlf=false archive --format=tar.gz -o "$work/rel.tgz" "$commit"
git -C "$repo" show "$commit:deploy/hk/release.sh" >"$work/release.sh" || die "$commit 里没有 deploy/hk/release.sh"
sum=$(sha_of "$work/rel.tgz")
bytes=$(wc -c <"$work/rel.tgz" | tr -dc '0-9')
(cd -- "$work" && split -b "$CHUNK" -d -a 3 rel.tgz part-)
base=$REMOTE_DIR/rel-$commit
parts=("$work"/part-*)
echo "提交 $commit（源码树 $tree），源码包 $bytes 字节，分 ${#parts[@]} 片上传到 $HOST:$base.tgz"
ssh_run "mkdir -p -- '$base.parts'"
for part in "${parts[@]}"; do
  name=${part##*/}
  want=$(sha_of "$part")
  for attempt in 1 2 3; do
    [[ $(remote_sha "$base.parts/$name") != "$want" ]] || break
    ((attempt < 3)) || die "分片 $name 重传后校验仍不一致"
    scp_put "$part" "$base.parts/$name" || echo "分片 $name 第 $attempt 次上传失败" >&2
  done
  echo "  $name 已核对"
done

# ---------- 3. 服务器上合并并核对 ----------
ssh_run "set -e; cat -- '$base.parts'/part-* >'$base.tgz.partial'
got=\$(sha256sum -- '$base.tgz.partial' | cut -d' ' -f1)
if [ \"\$got\" != '$sum' ]; then rm -f -- '$base.tgz.partial'; echo \"整包校验和不对：\$got\" >&2; exit 1; fi
mv -f -- '$base.tgz.partial' '$base.tgz'
printf 'commit=%s\ntree=%s\nsha256=%s\nbytes=%s\n' '$commit' '$tree' '$sum' '$bytes' >'$base.meta'
rm -rf -- '$base.parts'" || die '服务器上合并或核对整包失败，重新运行本命令即可（已传好的分片会跳过）'
scp_put "$work/release.sh" "$base.release.sh" || die '发版脚本上传失败'
[[ $(remote_sha "$base.release.sh") == "$(sha_of "$work/release.sh")" ]] || die '发版脚本上传后校验不一致'

# ---------- 4. 下一步 ----------
cat <<EOF
上传完成，整包 SHA256 $sum 已在服务器上核对。
服务器上（root）执行发版：
  bash $base.release.sh --pr <PR号> --note '<一句话说明>' $commit
EOF
