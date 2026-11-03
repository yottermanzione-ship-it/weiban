# shellcheck shell=bash
# 香港服务器运维脚本的公共部分，被 backup.sh、disk-check.sh 引用，不单独执行。
#   - weiban_compose：固定生产项目的 docker compose 命令（与发版、备份共用同一份 override）。
#   - ops_alert：把运维异常写进系统日志，并登记到管理后台「运行提醒」页。
# 说明见 docs/ops/hk-server.md「六、磁盘、备份与清理」。
WEIBAN_SRC=${WEIBAN_SRC:-/srv/weiban/src}
WEIBAN_DEPLOY_ENV=${WEIBAN_DEPLOY_ENV:-/srv/weiban/runtime.env}
# shellcheck disable=SC2034 # 由引用本文件的脚本使用
weiban_compose=(docker compose --env-file "$WEIBAN_DEPLOY_ENV" -p "${WEIBAN_COMPOSE_PROJECT:-weiban-prod}"
  -f "$WEIBAN_SRC/deploy/prod/compose.yml" -f "$WEIBAN_SRC/deploy/hk/compose.override.yml")

# 字节数写成 3.2G 这样的人看得懂的形式。
human_bytes() { numfmt --to=iec -- "$1" 2>/dev/null || printf '%s 字节' "$1"; }

# ops_alert <合并键> <warning|critical> <一句话说明> <种类>
# 尽力而为、从不失败：先写系统日志（journalctl -t weiban-ops），再写进数据库表 push.admin_alerts，
# 管理后台「运行提醒」页即可看到。同一合并键还有未处理的提醒时只累加次数、更新说明，
# 与后台自己的提醒规则一致。种类不在契约 AdminAlertKind 里时，后台「类型」列显示 unsupported，
# 「说明」列照常显示；这条路径不发手机推送。数据盘真写满时数据库也写不进，只剩系统日志，
# 所以告警线定在 80%，留出处理时间。
ops_alert() {
  local key=$1 severity=$2 summary=$3 kind=$4 level=warning
  [[ $severity == critical ]] && level=crit
  echo "运维提醒（$severity）：$summary" >&2
  if command -v logger >/dev/null; then
    logger -t weiban-ops -p "user.$level" -- "$summary [$key]" || true
  fi
  [[ ${OPS_ALERT_DB:-1} == 1 ]] || return 0
  if ! timeout 30 "${weiban_compose[@]}" exec -T postgres psql -X -q -v ON_ERROR_STOP=1 -U weiban -d weiban \
    -v "key=$key" -v "severity=$severity" -v "summary=$summary" -v "kind=$kind" >/dev/null 2>&1 <<'SQL'
INSERT INTO push.admin_alerts AS a (id, kind, severity, dedupe_key, summary, first_raised_at, last_raised_at)
VALUES (gen_random_uuid(), :'kind', :'severity', :'key', :'summary', now(), now())
ON CONFLICT (dedupe_key) WHERE acknowledged_at IS NULL DO UPDATE SET
  summary = EXCLUDED.summary,
  last_raised_at = EXCLUDED.last_raised_at,
  occurrences = a.occurrences + 1,
  severity = CASE WHEN a.severity = 'critical' THEN 'critical' ELSE EXCLUDED.severity END;
SQL
  then
    echo '提醒没能写进管理后台（数据库不可用？），只记在系统日志里' >&2
  fi
  return 0
}
