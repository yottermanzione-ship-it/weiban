#!/usr/bin/env bash
# 香港服务器加密备份：weiban-backup.timer 每天调用，发版前也用它备份一次。
# 产物与 deploy/prod/scripts/backup.sh 同格式（weiban-backup-v1），可用 deploy/prod/scripts/restore.sh 恢复。
# 保留规则（总经理 2026-11-03）：最多 KEEP（默认 2）份完整备份，而且合计不超过 BACKUP_MAX_TOTAL（默认 10G），
# 超了从最早的删起；最新这一份始终保留，只有它一份也超过上限时登记「严重」提醒。
# KEK 与 age 解密身份不在备份里，须另行保管。
#
# 执行顺序（2026-11-03 数据盘写满、停站约 10 分钟后改成这样）：
#   1. 先查空间：上一份完整备份的大小加 20% 余量，再留 1G 底线。备份盘不够就直接失败退出，这时还没停应用。
#   2. 停应用 → 导出数据库和媒体 → 马上恢复应用 → 写校验和与清单 → 按份数和合计上限清理旧备份。
#   3. 中途任何一步失败或收到停止信号：先删掉本次半成品腾出空间，再把应用拉起来，并在后台「运行提醒」登记。
# 默认写到系统盘 /var/backups/weiban，和数据盘（docker、数据库、媒体）分开。
# 说明见 docs/ops/hk-server.md「六、磁盘、备份与清理」。
set -euo pipefail
umask 077
export LC_ALL=C
# shellcheck source=deploy/hk/ops-lib.sh
. "$(dirname -- "${BASH_SOURCE[0]}")/ops-lib.sh"
RECIPIENT_FILE=${BACKUP_AGE_RECIPIENT_FILE:-/srv/weiban/keys/backup-recipient.txt}
BACKUP_ROOT=${1:-/var/backups/weiban}
KEEP=${KEEP:-2}
# 所有完整备份合计的上限，写成 10G、500M 或字节数。系统盘 50G，每份约 3.2G。
MAX_TOTAL=${BACKUP_MAX_TOTAL:-10G}
MARGIN_PERCENT=${BACKUP_SPACE_MARGIN_PERCENT:-20}
RESERVE_BYTES=${BACKUP_RESERVE_BYTES:-1073741824}
HEALTH_TIMEOUT=${APP_HEALTH_TIMEOUT_SECONDS:-120}
LOCK_FILE=${BACKUP_LOCK_FILE:-/run/lock/weiban-backup.lock}
alerted=0

# 备份没做成：登记提醒后退出。在停应用之前调用时，应用一直在运行。
fail() {
  echo "备份未完成：$1" >&2
  ops_alert backup_failed:hk warning "备份未完成：$1" backup_failed
  alerted=1
  exit 1
}

# 10G / 500M / 纯字节数 → 字节数。
to_bytes() {
  [[ $1 =~ ^([0-9]+)([GgMm]?)$ ]] || return 1
  case ${BASH_REMATCH[2]} in
    [Gg]) echo $((10#${BASH_REMATCH[1]} * 1073741824)) ;;
    [Mm]) echo $((10#${BASH_REMATCH[1]} * 1048576)) ;;
    *) echo $((10#${BASH_REMATCH[1]})) ;;
  esac
}

[[ $KEEP =~ ^[1-9][0-9]*$ ]] || fail 'KEEP 必须是正整数'
MAX_TOTAL_BYTES=$(to_bytes "$MAX_TOTAL") || fail "BACKUP_MAX_TOTAL 格式不对：$MAX_TOTAL（例 10G、500M）"
[[ $MARGIN_PERCENT =~ ^[0-9]+$ && $RESERVE_BYTES =~ ^[0-9]+$ && $HEALTH_TIMEOUT =~ ^[0-9]+$ ]] || fail '空间余量或等待时间参数不是数字'
command -v age >/dev/null || fail '服务器缺少 age 命令'
[[ -s $RECIPIENT_FILE ]] || fail '缺少 age 公钥接收者文件'
mkdir -p -- "$BACKUP_ROOT" || fail "无法创建备份目录 $BACKUP_ROOT"
# 同一时间只跑一个备份：定时备份与发版前备份撞上时，后来的直接退出，不会两个一起停应用、一起占空间。
if command -v flock >/dev/null; then
  exec 9>"$LOCK_FILE" || fail "无法打开锁文件 $LOCK_FILE"
  flock -n 9 || fail '已有另一个备份正在进行'
fi

# ---------- 1. 空间预检（应用还在运行） ----------
shopt -s nullglob
complete=("$BACKUP_ROOT"/weiban-*/manifest.txt)
complete=("${complete[@]%/manifest.txt}")
if ((${#complete[@]} > 0)); then
  # 目录名以 UTC 时间开头，按名字排序就是时间顺序，最后一个最新。
  latest=${complete[-1]}
  estimate=$(du -sb -- "$latest" | cut -f1 | tr -dc '0-9') || fail '无法读取上一份备份的大小'
  basis="上一份完整备份 ${latest##*/}"
else
  db_bytes=$("${weiban_compose[@]}" exec -T postgres psql -X -U weiban -d weiban -tAc \
    'SELECT pg_database_size(current_database())' | tr -dc '0-9') || fail '无法读取数据库大小（数据库没在运行？）'
  media_bytes=$("${weiban_compose[@]}" run --rm --no-deps -T --entrypoint du app -sb /app/.data/media |
    cut -f1 | tr -dc '0-9') || fail '无法读取媒体目录大小'
  [[ -n $db_bytes && -n $media_bytes ]] || fail '无法估算备份大小'
  estimate=$((db_bytes + media_bytes))
  basis='当前数据库与媒体大小（备份目录里还没有完整备份）'
fi
[[ -n $estimate ]] || fail '无法估算备份大小'
required=$((estimate * (100 + MARGIN_PERCENT) / 100 + RESERVE_BYTES))
available=$(df -B1 --output=avail -- "$BACKUP_ROOT" | tail -n 1 | tr -dc '0-9') || fail '无法读取备份盘剩余空间'
[[ -n $available ]] || fail '无法读取备份盘剩余空间'
echo "空间预检：估算 $(human_bytes "$estimate")（依据：$basis），加 ${MARGIN_PERCENT}% 余量和 $(human_bytes "$RESERVE_BYTES") 底线共需 $(human_bytes "$required")；$BACKUP_ROOT 可用 $(human_bytes "$available")"
((available >= required)) ||
  fail "备份盘 $BACKUP_ROOT 空间不足（需要 $(human_bytes "$required")，可用 $(human_bytes "$available")），没有停应用"

# ---------- 2. 停应用并导出 ----------
running=$("${weiban_compose[@]}" ps --status running -q app) || fail '无法读取应用运行状态'
was_running=()
while IFS= read -r id; do
  if [[ -n $id ]]; then was_running+=("$id"); fi
done <<<"$running"
bundle=$(mktemp -d "$BACKUP_ROOT/weiban-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX") || fail '无法创建本次备份目录'
finished=0
resumed=0

# 只恢复本次暂停的原容器，不重新解析配置、重建依赖或回退已生效的域名环境。
# 直接 docker start 原容器，不经 compose start（它会连带重跑 migrate 依赖；发布后若残留旧 migrate 容器
# 会因迁移目录不符失败，2026-10-27 因此停站约 3 分钟）。
resume_app() {
  ((${#was_running[@]} > 0)) || return 0
  docker start "${was_running[@]}" >/dev/null || return 1
  local deadline=$((SECONDS + HEALTH_TIMEOUT)) id healthy
  while :; do
    healthy=1
    for id in "${was_running[@]}"; do
      [[ $(docker inspect -f '{{.State.Health.Status}}' "$id" 2>/dev/null) == healthy ]] || healthy=0
    done
    ((healthy)) && return 0
    ((SECONDS < deadline)) || break
    sleep 2
  done
  echo "应用容器没有在 ${HEALTH_TIMEOUT} 秒内恢复健康" >&2
  return 1
}

# 任何退出（成功、失败、被 systemd 停止）都会走到这里：先删半成品腾空间，再保证应用被拉起来。
on_exit() {
  local rc=$?
  trap '' TERM INT HUP
  set +e
  if ((!finished)); then
    rm -rf -- "$bundle" && echo "已删除未完成的备份：$bundle" >&2
  fi
  if ((!resumed)); then
    resumed=1
    if ! resume_app; then
      ops_alert backup_app_down:hk critical '备份失败后应用没能恢复健康，网站可能已停止，请立即处理' backup_failed
      alerted=1
      ((rc != 0)) || rc=1
    fi
  fi
  if ((rc != 0 && !alerted)); then
    ops_alert backup_failed:hk warning "备份失败（退出码 $rc），半成品已删除、应用已恢复，详见 journalctl -u weiban-backup" backup_failed
  fi
  exit "$rc"
}
trap on_exit EXIT
# bash 收到这些信号时先退出，再由上面的 EXIT 处理恢复应用。
trap 'exit 143' TERM INT HUP

echo "停止应用，开始导出到 $bundle"
"${weiban_compose[@]}" stop app >/dev/null
"${weiban_compose[@]}" exec -T postgres pg_dump -U weiban -d weiban --format=custom |
  age -R "$RECIPIENT_FILE" >"$bundle/database.dump.age.partial"
mv -- "$bundle/database.dump.age.partial" "$bundle/database.dump.age"
"${weiban_compose[@]}" run --rm --no-deps -T --entrypoint tar app -C /app/.data/media -cf - . |
  age -R "$RECIPIENT_FILE" >"$bundle/media.tar.age.partial"
mv -- "$bundle/media.tar.age.partial" "$bundle/media.tar.age"

# 数据已经导出完，先恢复应用，校验和与清理放在后面，缩短停站时间。
resumed=1
app_ok=1
resume_app || app_ok=0
(cd -- "$bundle" && sha256sum database.dump.age media.tar.age >SHA256SUMS)
printf '%s\n' 'weiban-backup-v1' "created_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)" 'storage=disk' 'kek_backup=separate-required' >"$bundle/manifest.txt"
finished=1
echo "已完成加密备份：$bundle（$(du -sh -- "$bundle" | cut -f1)）"

# ---------- 3. 保留：最多 KEEP 份，合计不超过 MAX_TOTAL；超了从最早的删起，最新这一份始终保留 ----------
# 只管 weiban-* 名字的目录，别的名字的手工备份不在清理范围内，也不计入合计。最后删除超过 1 天仍未完成的残留目录。
complete=("$BACKUP_ROOT"/weiban-*/manifest.txt)
complete=("${complete[@]%/manifest.txt}")
remove_oldest() {
  rm -rf -- "${complete[0]}"
  echo "已清理旧备份：${complete[0]}（$1）"
  complete=("${complete[@]:1}")
}
while ((${#complete[@]} > KEEP)); do remove_oldest "超过 $KEEP 份"; done
sizes=()
total=0
for d in "${complete[@]}"; do
  size=$(du -sb -- "$d" | cut -f1 | tr -dc '0-9') || size=0
  sizes+=("${size:-0}")
  total=$((total + ${size:-0}))
done
while ((${#complete[@]} > 1 && total > MAX_TOTAL_BYTES)); do
  total=$((total - sizes[0]))
  sizes=("${sizes[@]:1}")
  remove_oldest "合计超过 $(human_bytes "$MAX_TOTAL_BYTES")"
done
echo "保留 ${#complete[@]} 份完整备份，合计 $(human_bytes "$total")（上限 $KEEP 份、$(human_bytes "$MAX_TOTAL_BYTES")）"
find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name 'weiban-*' -mmin +1440 '!' -exec test -e '{}/manifest.txt' ';' -print -exec rm -rf -- '{}' + || true
df -h -- "$BACKUP_ROOT" | tail -n 1 || true

# 只剩最新这一份也超过上限：按总经理的口径保留它，登记「严重」提醒（备份本身是好的，退出码仍为 0，不挡发版）。
if ((total > MAX_TOTAL_BYTES)); then
  ops_alert backup_over_cap:hk critical "备份已完成，但这一份就有 $(human_bytes "$total")，超过合计上限 $(human_bytes "$MAX_TOTAL_BYTES")；已保留这一份、删除其余旧备份。请检查媒体增长，或在 weiban-backup.service 调高 BACKUP_MAX_TOTAL" backup_failed
fi

if ((!app_ok)); then
  ops_alert backup_app_down:hk critical '备份已完成，但应用没能恢复健康，网站可能已停止，请立即处理' backup_failed
  alerted=1
  exit 1
fi
