#!/usr/bin/env bash
# 完全隔离的本机部署/备份/恢复演练，只产生测试账户和临时秘密。
set -euo pipefail
umask 077
command -v age >/dev/null
command -v age-keygen >/dev/null
repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd -- "$repo_root"
project=${WEIBAN_SMOKE_PROJECT:-weiban-smoke-$RANDOM-$RANDOM}
restore_project=$project-restore
for candidate in "$project" "$restore_project"; do
  [[ -z $(docker ps -aq --filter "label=com.docker.compose.project=$candidate") ]] || { echo '演练项目已存在，拒绝使用或删除' >&2; exit 1; }
done
temporary=$(mktemp -d)
export WEIBAN_DEPLOY_ENV=$temporary/runtime.env
compose=(docker compose --env-file "$WEIBAN_DEPLOY_ENV" -f deploy/prod/compose.yml -f deploy/prod/smoke.override.yml)
cleanup() {
  result=$?
  if [[ $result != 0 ]]; then
    # 出错时先保留临时数据库的诊断，再清理本次项目；不输出环境或秘密文件。
    "${compose[@]}" -p "$project" logs --no-color --tail 80 postgres >&2 || true
    "${compose[@]}" -p "$restore_project" logs --no-color --tail 80 postgres >&2 || true
  fi
  "${compose[@]}" -p "$project" down --volumes --remove-orphans >/dev/null 2>&1 || true
  "${compose[@]}" -p "$restore_project" down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf -- "$temporary"
}
trap cleanup EXIT
node --input-type=module - "$temporary" <<'JS'
import {mkdirSync,writeFileSync,chmodSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
const dir=process.argv[2]; mkdirSync(dir+'/secrets',{mode:0o700});
const password=randomBytes(24).toString('hex');
for(const [name,value] of Object.entries({'postgres-password':password,'database-url':`postgres://weiban:${password}@postgres:5432/weiban`,kek:randomBytes(32).toString('base64')})) {
  const path=dir+'/secrets/'+name;
  writeFileSync(path,value,{mode:0o400});
  // umask 077 会把创建时的444变成400；显式chmod让容器UID1000也能读取。
  // 文件只读，宿主父目录仍700，其他宿主用户不能遍历临时秘密目录。
  chmodSync(path,0o444);
}
writeFileSync(dir+'/runtime.env',`SECRETS_DIR=${dir}/secrets\nWEB_HOST=app.localhost\nWEB_DOMAIN=http://app.localhost\nADMIN_DOMAIN=http://admin.localhost\nADMIN_PUBLIC_ORIGIN=http://admin.localhost:18080\nBILLING_PLATFORM_DAILY_CAP_MICROS=20000000\nAPP_IMAGE=weiban-deploy-app:selftest\nEDGE_IMAGE=weiban-deploy-edge:selftest\n`,{mode:0o600});
JS
build_ca=()
if [[ -n ${WEIBAN_BUILD_CA_FILE:-} ]]; then build_ca=(--secret "id=build_ca,src=$WEIBAN_BUILD_CA_FILE"); fi
docker build "${build_ca[@]}" --target app -f deploy/prod/Dockerfile -t weiban-deploy-app:selftest .
docker build "${build_ca[@]}" --target edge -f deploy/prod/Dockerfile -t weiban-deploy-edge:selftest .
"${compose[@]}" -p "$project" up -d --wait --no-build
printf '%s\n' 'smoke-only-password-canary' | "${compose[@]}" -p "$project" exec -T app node dist/identity.js create-admin deploy_admin
"${compose[@]}" -p "$project" exec -T app node dist/rotate-kek.js
"${compose[@]}" -p "$project" exec -T app node -e "import('sharp').then(s=>s.default({create:{width:32,height:32,channels:3,background:'#0aa35a'}}).png().toBuffer().then(b=>process.stdout.write(b)))" > "$temporary/image.png"
node deploy/prod/scripts/smoke-data.mjs seed http://127.0.0.1:18080 "$temporary/record.json" "$temporary/image.png"
age-keygen -o "$temporary/age-identity"
export BACKUP_AGE_RECIPIENT
BACKUP_AGE_RECIPIENT=$(age-keygen -y "$temporary/age-identity")
WEIBAN_COMPOSE_PROJECT=$project bash deploy/prod/scripts/backup.sh "$temporary/backups"
"${compose[@]}" -p "$project" stop app caddy
"${compose[@]}" -p "$restore_project" up -d --wait --no-build postgres
bundles=("$temporary"/backups/weiban-*)
[[ ${#bundles[@]} == 1 ]]
WEIBAN_COMPOSE_PROJECT=$restore_project bash deploy/prod/scripts/restore.sh "${bundles[0]}" "$temporary/age-identity"
"${compose[@]}" -p "$restore_project" up -d --wait --no-build
"${compose[@]}" -p "$restore_project" exec -T app node dist/rotate-kek.js
node deploy/prod/scripts/smoke-data.mjs verify http://127.0.0.1:18080 "$temporary/record.json"
# 不允许同一备份覆盖已有数据，即使账户和媒体可读也要验证拒绝分支。
"${compose[@]}" -p "$restore_project" stop app
if WEIBAN_COMPOSE_PROJECT=$restore_project bash deploy/prod/scripts/restore.sh "${bundles[0]}" "$temporary/age-identity"; then echo '错误：恢复覆盖了非空目标' >&2; exit 1; fi
echo '生产镜像、迁移、双域HTTP、加密备份/空卷恢复与非空目标拒绝验证通过'
