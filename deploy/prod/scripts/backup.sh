#!/usr/bin/env bash
# 必须在部署节点调用；全部app/web/worker均需暂停，本Compose为单app模式。
set -euo pipefail
umask 077
: "${WEIBAN_DEPLOY_ENV:?Set external deployment env file}"
: "${BACKUP_AGE_RECIPIENT:?Set offline age public recipient}"
command -v age >/dev/null
backup_root=${1:?Pass secure backup destination directory}
script_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
compose=(docker compose --env-file "$WEIBAN_DEPLOY_ENV" -f "$script_root/compose.yml" -p "${WEIBAN_COMPOSE_PROJECT:-weiban-prod}")
mkdir -p -- "$backup_root"
bundle=$(mktemp -d "$backup_root/weiban-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")
was_running=$("${compose[@]}" ps --status running -q app)
resume() { if [[ -n "$was_running" ]]; then "${compose[@]}" up -d --wait --no-build app >/dev/null; fi; }
trap resume EXIT
"${compose[@]}" stop app >/dev/null
"${compose[@]}" exec -T postgres pg_dump -U weiban -d weiban --format=custom | age -r "$BACKUP_AGE_RECIPIENT" > "$bundle/database.dump.age.partial"
mv -- "$bundle/database.dump.age.partial" "$bundle/database.dump.age"
"${compose[@]}" run --rm --no-deps -T --entrypoint tar app -C /app/.data/media -cf - . | age -r "$BACKUP_AGE_RECIPIENT" > "$bundle/media.tar.age.partial"
mv -- "$bundle/media.tar.age.partial" "$bundle/media.tar.age"
(cd -- "$bundle" && sha256sum database.dump.age media.tar.age > SHA256SUMS)
printf '%s\n' 'weiban-backup-v1' "created_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)" 'storage=disk' 'kek_backup=separate-required' > "$bundle/manifest.txt"
printf '已完成加密备份：%s\n' "$bundle"
