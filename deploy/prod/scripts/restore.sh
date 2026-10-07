#!/usr/bin/env bash
# 只恢复到新的空数据库与空媒体卷；不清空任何现有目标。
set -euo pipefail
umask 077
: "${WEIBAN_DEPLOY_ENV:?Set external deployment env file}"
command -v age >/dev/null
bundle=$(cd -- "${1:?Pass trusted backup bundle}" && pwd)
identity_file=${2:?Pass offline age identity file path}
script_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
compose=(docker compose --env-file "$WEIBAN_DEPLOY_ENV" -f "$script_root/compose.yml" -p "${WEIBAN_COMPOSE_PROJECT:-weiban-prod}")
[[ $(head -n 1 "$bundle/manifest.txt") == weiban-backup-v1 ]] || { echo '备份格式不支持' >&2; exit 1; }
(cd -- "$bundle" && sha256sum --check --status SHA256SUMS)
[[ -z $("${compose[@]}" ps --status running -q app) ]] || { echo '请先停止全部app/web/worker' >&2; exit 1; }
count=$("${compose[@]}" exec -T postgres psql -U weiban -d weiban -tAc "SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')")
[[ "$count" == 0 ]] || { echo '目标数据库非空，拒绝覆盖；请使用新的恢复项目与数据卷' >&2; exit 1; }
"${compose[@]}" run --rm --no-deps -T --entrypoint sh app -c 'test -z "$(ls -A /app/.data/media)"' || { echo '目标媒体卷非空，拒绝覆盖' >&2; exit 1; }
# 默认不自动启动服务；两部分都恢复并安装对应KEK后再由运维验证启动。
age -d -i "$identity_file" "$bundle/database.dump.age" | "${compose[@]}" exec -T postgres pg_restore -U weiban -d weiban --single-transaction --exit-on-error --no-owner
age -d -i "$identity_file" "$bundle/media.tar.age" | "${compose[@]}" run --rm --no-deps -T --entrypoint tar app --no-same-owner -C /app/.data/media -xf -
echo '数据库与媒体已恢复；服务保持停止。安装匹配KEK，运行只读校验、迁移状态及健康/数据验证后再启动。'
