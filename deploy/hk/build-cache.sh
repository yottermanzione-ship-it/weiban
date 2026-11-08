#!/usr/bin/env bash
# Dedicated build cache uses a capacity-selected filesystem; never relocate live volumes.
set -euo pipefail
export LC_ALL=C
config=${WEIBAN_BUILD_CACHE_CONFIG:-/srv/weiban/ops-state/build-cache.env}
lock=${RELEASE_LOCK_FILE:-/run/lock/weiban-release.lock}
builder=weiban-release
cache_path=/var/lib/weiban-build-cache
max_bytes=4294967296
legacy_bytes=1073741824
reserve_bytes=536870912
free_bytes=12884901888
buildkit_image=moby/buildkit@sha256:c5f8862f52499773af85bc07695b2379ef08e8002352b0df2c4864c91d78dabe
configured=0
die() { echo "Build cache: $*" >&2; exit 1; }
value() { sed -n "s/^$1=//p" "$config" | tail -n 1; }
if [[ -f $config ]]; then
  configured=1
  builder=$(value BUILDER)
  cache_path=$(value CACHE_PATH)
  max_bytes=$(value MAX_BYTES)
  legacy_bytes=$(value LEGACY_MAX_BYTES)
  reserve_bytes=$(value RESERVED_BYTES)
  free_bytes=$(value MIN_FREE_BYTES)
fi
[[ $builder =~ ^weiban-[a-z0-9-]+$ ]] || die 'invalid builder name'
[[ $cache_path =~ ^/[A-Za-z0-9_/-]+$ && $cache_path != / && $cache_path != */../* &&
  $cache_path != */.. && $cache_path != /srv/weiban && $cache_path != /var/lib ]] || die 'invalid cache path'
for number in "$max_bytes" "$legacy_bytes" "$reserve_bytes" "$free_bytes"; do
  [[ $number =~ ^[1-9][0-9]*$ ]] || die 'invalid capacity setting'
done
((reserve_bytes < max_bytes && free_bytes >= max_bytes)) || die 'invalid capacity relationship'
volume=buildx_buildkit_${builder}0_state
container=buildx_buildkit_${builder}0

take_lock() {
  [[ ${WEIBAN_RELEASE_LOCK_HELD:-0} != 1 ]] || return 0
  mkdir -p -- "$(dirname -- "$lock")"
  exec 8>"$lock"
  if ! flock -n 8; then
    echo 'Build cache: release/maintenance is running; skipped'
    exit 0
  fi
}
volume_check() {
  local actual expected
  actual=$(docker volume inspect --format '{{.Driver}}|{{index .Options "type"}}|{{index .Options "o"}}|{{index .Options "device"}}|{{index .Labels "app.weiban.purpose"}}' "$volume") ||
    die 'dedicated cache volume is missing'
  expected="local|none|bind|$cache_path|build-cache"
  [[ $actual == "$expected" ]] || die 'cache volume identity/location mismatch'
}
location_check() {
  local docker_root
  [[ -d $cache_path && ! -L $cache_path && $(readlink -f -- "$cache_path") == "$cache_path" ]] ||
    die 'cache location missing or redirected'
  docker_root=$(docker info --format '{{.DockerRootDir}}')
  [[ -d $docker_root ]] || die 'cannot locate image storage'
  [[ $(stat -c %d -- "$cache_path") != "$(stat -c %d -- "$docker_root")" ]] ||
    die 'cache would still use the same filesystem as image storage'
}
check_builder() {
  local actual
  ((configured)) || die 'dedicated build cache is not configured'
  location_check
  volume_check
  [[ $(docker buildx inspect "$builder" --format '{{.Driver}}') == docker-container ]] ||
    die 'unexpected builder driver'
  actual=$(docker inspect --format '{{.State.Running}}|{{range .Mounts}}{{if eq .Destination "/var/lib/buildkit"}}{{.Name}}{{end}}{{end}}' "$container")
  [[ $actual == "true|$volume" ]] || die 'builder is stopped or its storage is incorrect'
}
check_free() {
  local available
  available=$(df -B1 --output=avail -- "$cache_path" | tail -n 1 | tr -dc '0-9')
  [[ $available =~ ^[0-9]+$ ]] || die 'cannot read build filesystem capacity'
  ((available >= free_bytes)) || die "build filesystem has $available bytes free; requires $free_bytes"
}
render_config() {
  cat <<EOF
root = "/var/lib/buildkit"
insecure-entitlements = []
[worker.oci]
  enabled = true
  gc = true
  max-parallelism = 2
[[worker.oci.gcpolicy]]
  filters = ["type==source.local", "type==exec.cachemount", "type==source.git.checkout"]
  keepDuration = "24h"
  reservedSpace = $reserve_bytes
  maxUsedSpace = $max_bytes
  minFreeSpace = $free_bytes
[[worker.oci.gcpolicy]]
  all = true
  reservedSpace = $reserve_bytes
  maxUsedSpace = $max_bytes
  minFreeSpace = $free_bytes
[worker.containerd]
  enabled = false
[history]
  maxAge = 86400
  maxEntries = 20
EOF
}
prune_cache() {
  local dry=${1:-0}
  ((configured)) || return 0
  if command -v systemctl >/dev/null && ! systemctl is-active --quiet docker.service; then
    echo 'Build cache: Docker is intentionally stopped; skipped without activating it'
    return 0
  fi
  check_builder
  local args=(--all --force --reserved-space "$reserve_bytes" --max-used-space "$max_bytes" --min-free-space "$free_bytes")
  if ((dry)); then
    printf '[dry-run] dedicated cache: builder=%s max=%s reserve=%s free=%s\n' "$builder" "$max_bytes" "$reserve_bytes" "$free_bytes"
    printf '[dry-run] legacy cache: builder=default max=%s; running/rollback images are not deleted\n' "$legacy_bytes"
    return 0
  fi
  docker buildx prune --builder "$builder" "${args[@]}"
  docker buildx prune --builder default --all --force --reserved-space 0 --max-used-space "$legacy_bytes"
}
install_builder() {
  local source_root=${1:?source root required} commit=${2:?commit required} tmp toml
  [[ $(id -u) == 0 && $commit =~ ^[0-9a-f]{40}$ ]] || die 'root and full commit required'
  [[ -f $source_root/deploy/hk/install-ops-runtime.sh ]] || die 'release source incomplete'
  take_lock
  if [[ ! -d $cache_path ]]; then
    mkdir -m 0700 -- "$cache_path"
  fi
  location_check
  if docker volume inspect "$volume" >/dev/null 2>&1; then
    volume_check
  else
    [[ -z $(find "$cache_path" -mindepth 1 -maxdepth 1 -print -quit) ]] ||
      die 'refusing to claim a nonempty unmanaged directory'
    docker volume create --driver local --label app.weiban.purpose=build-cache \
      --opt type=none --opt o=bind --opt "device=$cache_path" "$volume" >/dev/null
  fi
  check_free
  mkdir -p -- "$(dirname -- "$config")"
  toml="$(dirname -- "$config")/buildkitd.toml"
  tmp=$(mktemp "$toml.XXXXXX")
  render_config >"$tmp"
  if docker buildx inspect "$builder" >/dev/null 2>&1; then
    [[ -f $toml ]] && cmp -s -- "$tmp" "$toml" ||
      { rm -f -- "$tmp"; die 'existing builder configuration differs; schedule builder-only replacement'; }
    rm -f -- "$tmp"
  else
    install -m 0644 -- "$tmp" "$toml"
    rm -f -- "$tmp"
    docker buildx create --name "$builder" --node "${builder}0" --driver docker-container \
      --driver-opt "image=$buildkit_image" --driver-opt default-load=true \
      --driver-opt memory=4g --driver-opt memory-swap=4g \
      --driver-opt cpu-period=100000 --driver-opt cpu-quota=200000 \
      --driver-opt cpu-shares=256 --buildkitd-flags '--debug=false' \
      --buildkitd-config "$toml" --bootstrap >/dev/null
  fi
  tmp=$(mktemp "$config.XXXXXX")
  printf 'BUILDER=%s\nCACHE_PATH=%s\nMAX_BYTES=%s\nLEGACY_MAX_BYTES=%s\nRESERVED_BYTES=%s\nMIN_FREE_BYTES=%s\n' \
    "$builder" "$cache_path" "$max_bytes" "$legacy_bytes" "$reserve_bytes" "$free_bytes" >"$tmp"
  chmod 0644 "$tmp"
  mv -f -- "$tmp" "$config"
  configured=1
  check_builder
  bash "$source_root/deploy/hk/install-ops-runtime.sh" "$source_root" "$commit"
  install -m 0644 -- "$source_root/deploy/hk/weiban-build-cache.service" /etc/systemd/system/weiban-build-cache.service
  install -m 0644 -- "$source_root/deploy/hk/weiban-build-cache.timer" /etc/systemd/system/weiban-build-cache.timer
  systemctl daemon-reload
  systemctl enable --now weiban-build-cache.timer
  docker buildx use "$builder"
  echo "Dedicated build cache ready: $builder at $cache_path (max $max_bytes bytes)"
}
case ${1:-status} in
  install) shift; install_builder "$@" ;;
  builder) check_builder; printf '%s\n' "$builder" ;;
  check) check_builder; check_free ;;
  prune) take_lock; prune_cache 0 ;;
  dry-run) prune_cache 1 ;;
  render-config) render_config ;;
  status)
    check_builder
    printf 'builder=%s\ncache_path=%s\nmax_bytes=%s\nlegacy_max_bytes=%s\n' "$builder" "$cache_path" "$max_bytes" "$legacy_bytes"
    df -h -- "$cache_path" /srv/weiban
    ;;
  *) die 'usage: build-cache.sh install SOURCE COMMIT | builder | check | prune | dry-run | status' ;;
esac
