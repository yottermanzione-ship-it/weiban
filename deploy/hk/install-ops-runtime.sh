#!/usr/bin/env bash
# Pin timer/rollback operations independently of the application source symlink.
# Two slots allow an atomic switch without touching a currently running script.
set -euo pipefail
source_root=${1:?source root required}
commit=${2:?full source commit required}
ops_root=${WEIBAN_OPS_ROOT:-/srv/weiban/ops}
[[ $commit =~ ^[0-9a-f]{40}$ && $ops_root =~ ^/[A-Za-z0-9_./-]+$ && $ops_root != / && $ops_root != */../* && $ops_root != */.. ]] || exit 2
[[ ! -L $ops_root ]] || { echo 'ops root must not be a symlink' >&2; exit 1; }
mkdir -p -- "$ops_root"
[[ ! -e $ops_root/current || -L $ops_root/current ]] || { echo 'ops/current must be a symlink' >&2; exit 1; }
if [[ -r $ops_root/current/source-commit && $(cat "$ops_root/current/source-commit") == "$commit" ]]; then exit 0; fi
slot='slot-a'
[[ $(readlink "$ops_root/current" 2>/dev/null || true) != "$ops_root/slot-a" ]] || slot='slot-b'
destination=$ops_root/$slot
[[ ! -L $destination ]] || { echo 'ops slot must not be a symlink' >&2; exit 1; }
mkdir -p -- "$destination"
for name in ops-lib.sh backup.sh disk-check.sh rollback.sh release-prune.sh; do
  bash -n "$source_root/deploy/hk/$name"
done
for name in ops-lib.sh backup.sh disk-check.sh rollback.sh release-prune.sh; do
  install -m 0750 -- "$source_root/deploy/hk/$name" "$destination/$name"
done
printf '%s\n' "$commit" >"$destination/source-commit"
ln -sfn -- "$destination" "$ops_root/current.new"
mv -Tf -- "$ops_root/current.new" "$ops_root/current"
