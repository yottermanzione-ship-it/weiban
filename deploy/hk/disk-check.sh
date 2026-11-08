#!/usr/bin/env bash
# 磁盘使用率巡检：weiban-disk-check.timer 每 10 分钟调用，也可手动运行。
# 数据盘 /srv/weiban 或系统盘 / 的使用率达到 DISK_ALERT_PERCENT（默认 80）时发「警告」，
# 达到 DISK_CRITICAL_PERCENT（默认 90）时发「严重」。告警写系统日志（journalctl -t weiban-ops），
# 并登记到管理后台「运行提醒」。阈值和处理办法见 docs/ops/hk-server.md「六、磁盘、备份与清理」。
set -euo pipefail
export LC_ALL=C
# shellcheck source=deploy/hk/ops-lib.sh
. "$(dirname -- "${BASH_SOURCE[0]}")/ops-lib.sh"
warn_at=${DISK_ALERT_PERCENT:-80}
crit_at=${DISK_CRITICAL_PERCENT:-90}
read -r -a mounts <<<"${DISK_CHECK_MOUNTS:-/srv/weiban /}"
for mount in "${mounts[@]}"; do
  if ! line=$(df -B1 --output=pcent,avail -- "$mount" | tail -n 1); then
    echo "无法读取 $mount 的磁盘用量" >&2
    continue
  fi
  read -r pct avail <<<"$line"
  pct=${pct%\%}
  if [[ ! $pct =~ ^[0-9]+$ || ! $avail =~ ^[0-9]+$ ]]; then
    echo "$mount 的磁盘用量格式不认识：$line" >&2
    continue
  fi
  name='磁盘'
  echo "$name $mount：已用 ${pct}%，剩余 $(human_bytes "$avail")"
  ((pct >= warn_at)) || continue
  severity=warning
  if ((pct >= crit_at)); then severity=critical; fi
  ops_alert "host_disk_high:$mount" "$severity" \
    "服务器${name} $mount 已用 ${pct}%（剩余 $(human_bytes "$avail")），超过 ${warn_at}% 告警线，请按运维文档清理" host_disk_high
done
