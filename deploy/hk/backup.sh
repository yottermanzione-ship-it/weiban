#!/usr/bin/env bash
# 香港服务器每日加密备份（由 weiban-backup.timer 调用，也可手动运行）。
# 产物与 deploy/prod/scripts/backup.sh 同格式（weiban-backup-v1），可用 deploy/prod/scripts/restore.sh 恢复。
# 只保留最近 KEEP 份完整备份；KEK 与 age 解密身份不在备份里，须另行保管。
set -euo pipefail
umask 077
SRC=${WEIBAN_SRC:-/srv/weiban/src}
ENV_FILE=${WEIBAN_DEPLOY_ENV:-/srv/weiban/runtime.env}
RECIPIENT_FILE=${BACKUP_AGE_RECIPIENT_FILE:-/srv/weiban/keys/backup-recipient.txt}
BACKUP_ROOT=${1:-/srv/weiban/backups}
KEEP=${KEEP:-7}
command -v age >/dev/null
[[ -s "$RECIPIENT_FILE" ]] || { echo '缺少 age 公钥接收者文件' >&2; exit 1; }
compose=(docker compose --env-file "$ENV_FILE" -p "${WEIBAN_COMPOSE_PROJECT:-weiban-prod}"
  -f "$SRC/deploy/prod/compose.yml" -f "$SRC/deploy/hk/compose.override.yml")
mkdir -p -- "$BACKUP_ROOT"
bundle=$(mktemp -d "$BACKUP_ROOT/weiban-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")
was_running=$("${compose[@]}" ps --status running -q app)
# 只恢复本次暂停的既有容器，不重新解析配置、重建依赖或回退已生效的域名环境。
resume() { if [[ -n "$was_running" ]]; then "${compose[@]}" start --wait app >/dev/null; fi; }
trap resume EXIT
"${compose[@]}" stop app >/dev/null
"${compose[@]}" exec -T postgres pg_dump -U weiban -d weiban --format=custom | age -R "$RECIPIENT_FILE" > "$bundle/database.dump.age.partial"
mv -- "$bundle/database.dump.age.partial" "$bundle/database.dump.age"
"${compose[@]}" run --rm --no-deps -T --entrypoint tar app -C /app/.data/media -cf - . | age -R "$RECIPIENT_FILE" > "$bundle/media.tar.age.partial"
mv -- "$bundle/media.tar.age.partial" "$bundle/media.tar.age"
(cd -- "$bundle" && sha256sum database.dump.age media.tar.age > SHA256SUMS)
printf '%s\n' 'weiban-backup-v1' "created_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)" 'storage=disk' 'kek_backup=separate-required' > "$bundle/manifest.txt"
echo "已完成加密备份：$bundle"
# 保留最近 KEEP 份完整备份；删除超过 1 天仍未完成的残留目录。
mapfile -t complete < <(find "$BACKUP_ROOT" -maxdepth 2 -name manifest.txt -path '*/weiban-*' -printf '%h\n' | sort -r)
for old in "${complete[@]:$KEEP}"; do rm -rf -- "$old"; echo "已清理旧备份：$old"; done
find "$BACKUP_ROOT" -maxdepth 1 -type d -name 'weiban-*' -mmin +1440 '!' -exec test -e '{}/manifest.txt' ';' -print -exec rm -rf -- '{}' + || true
